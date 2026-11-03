import { describe, expect, it } from "vitest";
import {
  normalizeSceneCaptions,
  subtitleLines,
  validateFilm,
  type FilmTreatment,
} from "./film";
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

it("validates Film-only caption overrides independently of Chapter membership", () => {
  const value = film();
  value.sceneCaptions = { a: { ja: "My words", en: "" } };
  expect(() => validateFilm(value, ["a", "b", "s1"])).not.toThrow();
  value.sceneCaptions.a!.ja = "";
  expect(() => validateFilm(value, ["a", "b", "s1"])).not.toThrow();
  value.sceneCaptions.a!.ja = "x".repeat(121);
  expect(() => validateFilm(value, ["a", "b", "s1"])).toThrow(/120/);
  value.sceneCaptions.a = { ja: "", en: "x".repeat(201) };
  expect(() => validateFilm(value, ["a", "b", "s1"])).toThrow(/200/);
  value.sceneCaptions = { foreign: { ja: "No", en: "" } };
  expect(() => validateFilm(value, ["a", "b", "s1"])).toThrow(/unavailable/);
});

it("accepts only the three supported video sizes", () => {
  const value = film();
  for (const aspect of ["16:9", "9:16", "1:1"] as const) {
    value.outputAspect = aspect;
    expect(() => validateFilm(value, ["s1"])).not.toThrow();
  }
  (value as { outputAspect: string }).outputAspect = "4:3";
  expect(() => validateFilm(value, ["s1"])).toThrow(/size/);
});

it("reads legacy primary/secondary captions as Japanese/English", () => {
  expect(
    normalizeSceneCaptions({
      old: { text: "階段", subtext: "Stairs" },
      next: { ja: "海", en: "Sea" },
      broken: { text: 3 },
    }),
  ).toEqual({
    old: { ja: "階段", en: "Stairs" },
    next: { ja: "海", en: "Sea" },
    broken: { ja: "", en: "" },
  });
  expect(normalizeSceneCaptions(undefined)).toBeUndefined();
});

it("selects burned-in lines for each export subtitle mode", () => {
  const caption = { ja: "海へ", en: "To the sea" };
  expect(subtitleLines(caption, "both")).toEqual({
    text: "海へ",
    sub: "To the sea",
  });
  expect(subtitleLines(caption, "ja")).toEqual({ text: "海へ", sub: "" });
  expect(subtitleLines(caption, "en")).toEqual({
    text: "To the sea",
    sub: "",
  });
  expect(subtitleLines(caption, "none")).toEqual({ text: "", sub: "" });
});
