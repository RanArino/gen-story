import { describe, expect, it } from "vitest";
import { inventoryReference, productionReferenceMapping } from "./inventory.js";

describe("reference feature audit", () => {
  it("accounts for scene-specific direction and every scalar, including unknown features", () => {
    const report = inventoryReference({
      version: 2,
      assets: { a: { src: "a.jpg" } },
      opening: { duration: 3, title: { text: "Opening" } },
      scenes: [
        {
          id: "s1",
          camera: [{ p: 0 }, { p: 1 }],
          look: [
            { at: 0, rays: 0.2 },
            { at: 2, warm: 0.4 },
          ],
          music: [{ instrument: "pad" }],
          sfx: [{ sound: "bell" }],
          steps: { period: 1 },
          unknown: { "a/b": true },
        },
      ],
      ending: { credits: { text: "End" } },
      score: { chords: [] },
    });
    expect(report.segments.map((s) => s.id)).toEqual([
      "opening",
      "s1",
      "ending",
    ]);
    expect(report.segments[1]).toMatchObject({
      cameraKeys: 2,
      lookFields: ["rays", "warm"],
      musicEvents: 1,
      soundEvents: 1,
      hasSteps: true,
    });
    expect(report.scalarPaths).toContain("/scenes/0/unknown/a~1b");
    expect(report.scalarPaths).toContain("/ending/credits/text");
    expect(report.assets).toEqual(["a"]);
  });
  it("rejects non-reference input rather than publishing an empty successful report", () => {
    expect(() => inventoryReference({ scenes: [] })).toThrow(/v2/);
    expect(() => inventoryReference(null)).toThrow(/v2/);
  });
  it("keeps score and Agent creation explicitly missing instead of claiming parity", () => {
    expect(
      productionReferenceMapping.find(
        (f) => f.feature === "score, chord progression and melody",
      )?.status,
    ).toBe("missing");
    expect(
      productionReferenceMapping.find(
        (f) => f.feature === "image analysis and creative direction",
      )?.status,
    ).toBe("missing");
  });
});
