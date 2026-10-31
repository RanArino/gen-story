import { describe, expect, it } from "vitest";
import { validateFilm, type FilmTreatment } from "./film";
const film = (): FilmTreatment => ({
  projectId: "p",
  revision: 1,
  title: "Film",
  recipe: "quiet-cinema",
  reducedMotion: false,
  chapters: [
    {
      id: "c1",
      title: "Opening",
      limitMs: 60000,
      scenes: [{ sceneId: "s1", durationMs: 4123 }],
    },
  ],
});
describe("Film invariants", () => {
  it("saves unassigned and empty Chapter drafts while blocking their render", () => {
    const input = film();
    input.chapters[0]!.scenes = [];
    expect(() => validateFilm(input, ["s1"], "draft")).not.toThrow();
    expect(() => validateFilm(input, ["s1"])).toThrow("at least one scene");
    input.chapters = [];
    expect(() => validateFilm(input, ["s1"], "draft")).not.toThrow();
    expect(() => validateFilm(input, ["s1"])).toThrow("at least one Chapter");
  });
  it("preserves explicit durations and permits unlimited Chapters", () => {
    const input = film();
    input.chapters[0]!.limitMs = null;
    validateFilm(input, ["s1"]);
    expect(input.chapters[0]!.scenes[0]!.durationMs).toBe(4123);
  });
  it("rejects unavailable and duplicate scenes", () => {
    expect(() => validateFilm(film(), [])).toThrow("unavailable");
    const input = film();
    input.chapters.push({ ...input.chapters[0]!, id: "c2" });
    expect(() => validateFilm(input, ["s1"])).toThrow("only one Chapter");
  });
  it("requires Chapter titles, membership, and positive duration values", () => {
    for (const change of [
      { title: " " },
      { scenes: [] },
      { limitMs: 0 },
      { scenes: [{ sceneId: "s1", durationMs: -1 }] },
    ]) {
      const input = film();
      Object.assign(input.chapters[0]!, change);
      expect(() => validateFilm(input, ["s1"])).toThrow();
    }
  });
});
