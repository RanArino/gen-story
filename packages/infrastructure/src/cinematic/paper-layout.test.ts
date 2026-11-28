import { describe, expect, it } from "vitest";
import { paperCardFrame, wrapBalanced } from "./math.js";

const PHI = (1 + Math.sqrt(5)) / 2;
// Full-width CJK glyphs are one em; Latin glyphs average about half an em.
const measure = (text: string, size: number) =>
  Array.from(text).reduce(
    (width, ch) => width + (ch.charCodeAt(0) > 0x2e80 ? size : size * 0.5),
    0,
  );
const note = {
  text: "実りの色に背を押され、旅がはじまる",
  sub: "Pushed gently by the color of harvest, the journey begins.",
  measure,
};
const views = {
  portrait: { width: 1080, height: 1920 },
  square: { width: 1080, height: 1080 },
  landscape: { width: 1920, height: 1080 },
};
const photos = [
  [1024, 1024],
  [1536, 1024],
  [1024, 1536],
] as const;
const rest = { fx: 0.5, fy: 0.5, z: 1 };

describe("Memory Board card and note layout", () => {
  it("keeps the note below the photo in portrait and square frames", () => {
    for (const view of [views.portrait, views.square])
      for (const [w, h] of photos) {
        const card = paperCardFrame(
          view.width,
          view.height,
          rest,
          w,
          h,
          0,
          note,
        );
        const cardBottom = card.y + card.height / 2 + card.border;
        // The tilted print's lowest corner still clears the note's top edge.
        const tilt =
          (card.width / 2 + card.border) * Math.abs(Math.sin(card.rotation));
        expect(card.note!.y - card.note!.height / 2).toBeGreaterThan(
          cardBottom + tilt,
        );
      }
  });

  it("lets the note overlap the photo's lower edge in landscape frames", () => {
    for (const [w, h] of photos) {
      const card = paperCardFrame(1920, 1080, rest, w, h, 0, note);
      const cardBottom = card.y + card.height / 2 + card.border;
      const noteTop = card.note!.y - card.note!.height / 2;
      expect(noteTop).toBeLessThan(cardBottom);
      expect(card.note!.y + card.note!.height / 2).toBeGreaterThan(cardBottom);
    }
  });

  it("stays inside the safe margin at the deepest camera zoom", () => {
    for (const view of Object.values(views))
      for (const [w, h] of photos)
        for (const z of [1, 3]) {
          const card = paperCardFrame(
            view.width,
            view.height,
            { fx: 0.5, fy: 0.5, z },
            w,
            h,
            0,
            note,
          );
          const margin = Math.min(view.width, view.height) * 0.08;
          expect(card.y - card.height / 2 - card.border).toBeGreaterThanOrEqual(
            margin - 1e-6,
          );
          expect(card.note!.y + card.note!.height / 2).toBeLessThanOrEqual(
            view.height - margin + 1e-6,
          );
        }
  });

  it("puts the photo's lower edge on the golden section line when there is room", () => {
    const card = paperCardFrame(1080, 1920, rest, 1536, 1024, 0, note);
    expect(card.y + card.height / 2 + card.border).toBeCloseTo(1920 / PHI, 6);
  });

  it("keeps the note at least card/φ wide and no wider than the frame's safe width", () => {
    const card = paperCardFrame(1080, 1920, rest, 1536, 1024, 0, {
      ...note,
      text: "朝",
      sub: "",
    });
    expect(card.note!.width).toBeCloseTo(
      (card.width + card.border * 2) / PHI,
      6,
    );
  });
});

describe("balanced caption wrapping", () => {
  it("keeps a caption that fits on one line", () => {
    expect(wrapBalanced("朝の駅", 500, (t) => measure(t, 40))).toEqual([
      "朝の駅",
    ]);
  });

  it("breaks Japanese after punctuation and never starts a line with it", () => {
    const lines = wrapBalanced(note.text, 500, (t) => measure(t, 40));
    expect(lines).toEqual(["実りの色に背を押され、", "旅がはじまる"]);
  });

  it("evens English lines instead of leaving a short last word", () => {
    const lines = wrapBalanced(note.sub, 600, (t) => measure(t, 30));
    expect(lines).toHaveLength(2);
    const [a, b] = lines.map((line) => measure(line, 30));
    expect(Math.abs(a! - b!)).toBeLessThan(120);
    expect(lines.join(" ")).toBe(note.sub);
  });
});
