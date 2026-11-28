import { describe, expect, it } from "vitest";
import {
  FULL_FRAME_LAYOUT,
  cropPhotoBox,
  frameLayoutFor,
  layoutOverrideError,
  resolveFrameLayout,
} from "./film-layout";
import { validateFilm, type FilmTreatment } from "./film";

const base = {
  photo: { x: 0.5, y: 0.4, width: 0.6, height: 0.6 },
  caption: { x: 0.5, y: 0.7, size: 0.04 },
};

describe("frame layout", () => {
  it("resolves each part from the photo, then the Film, then the template", () => {
    const film = { caption: { x: 0.3, y: 0.1, size: 0.05 } };
    const scene = { photo: { x: 0.6, y: 0.5, width: 0.4, height: 0.4 } };
    expect(resolveFrameLayout(base, film, scene)).toEqual({
      photo: scene.photo,
      caption: film.caption,
    });
    expect(resolveFrameLayout(base, film)).toEqual({
      photo: base.photo,
      caption: film.caption,
    });
    expect(resolveFrameLayout(base)).toEqual(base);
  });

  it("falls back to the full frame for sizes a template does not define", () => {
    expect(frameLayoutFor({ "16:9": base }, "9:16")).toBe(FULL_FRAME_LAYOUT);
    expect(frameLayoutFor(undefined, "16:9")).toBe(FULL_FRAME_LAYOUT);
    expect(frameLayoutFor({ "16:9": base }, "16:9")).toBe(base);
  });

  it("rejects values outside the frame and unknown parts", () => {
    expect(layoutOverrideError({})).toBeNull();
    expect(layoutOverrideError(base)).toBeNull();
    expect(
      layoutOverrideError({ photo: { ...base.photo, width: 1.4 } }),
    ).toMatch(/photo/);
    expect(
      layoutOverrideError({ caption: { ...base.caption, size: 0.5 } }),
    ).toMatch(/caption/);
    expect(layoutOverrideError({ title: {} })).toMatch(/unknown/);
    expect(layoutOverrideError(null)).toMatch(/object/);
  });

  it("re-cuts the photo box to a crop, keeping its short side inside the frame", () => {
    // A portrait card in a 9:16 video becomes a square of the same width.
    const portrait = { x: 0.5, y: 0.4, width: 0.64, height: 0.64 };
    const square = cropPhotoBox(portrait, "1:1", 1080, 1920);
    expect(square).toMatchObject({ x: 0.5, y: 0.4, width: 0.64, crop: "1:1" });
    expect(square.width * 1080).toBeCloseTo(square.height * 1920, 0);
    // A landscape crop of the same card is as tall as the card was wide, up to the frame width.
    const wide = cropPhotoBox(portrait, "16:9", 1080, 1920);
    expect(wide.width).toBe(1);
    expect((wide.width * 1080) / (wide.height * 1920)).toBeCloseTo(16 / 9, 2);
    expect(layoutOverrideError({ photo: square })).toBeNull();
    expect(layoutOverrideError({ photo: { ...square, crop: "4:3" } })).toMatch(
      /crop/,
    );
  });

  it("validates Film and per-photo layouts on the treatment", () => {
    const treatment: FilmTreatment = {
      projectId: "p",
      revision: 1,
      title: "Trip",
      recipe: "memory-board",
      reducedMotion: false,
      chapters: [
        { id: "c", title: "One", limitMs: null, scenes: [{ sceneId: "s1" }] },
      ],
      layout: { caption: base.caption },
      sceneLayouts: { s1: { photo: base.photo } },
    };
    expect(() => validateFilm(treatment, ["s1"])).not.toThrow();
    expect(() =>
      validateFilm({ ...treatment, sceneLayouts: { gone: {} } }, ["s1"]),
    ).toThrow(/unavailable/);
    expect(() =>
      validateFilm(
        { ...treatment, layout: { photo: { ...base.photo, x: 2 } } },
        ["s1"],
      ),
    ).toThrow(/photo/);
  });
});
