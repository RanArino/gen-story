import { describe, expect, it } from "vitest";
import type { FilmTreatment } from "./film";
import {
  applyApprovedDirection,
  directionContentProblems,
  directionLocks,
  enforceDirectionLocks,
  isDefaultChapterTitle,
  isDirectionStale,
  transitionDirection,
  type FilmDirectionContent,
  type FilmDirectionProposal,
} from "./film-direction";

const scene = (sceneId: string) => ({
  sceneId,
  observation: "A person climbs stone stairs toward a shrine.",
  camera: {
    move: "climb" as const,
    focus: { x: 0.5, y: 0.3 },
    speed: 0.6,
    reason: "Follow the ascent.",
  },
  effects: { rays: 0.4, motes: 0.2, leaves: 0, warmth: 0.3 },
  footsteps: "stair" as const,
  ambience: { wind: 0.4, stream: 0 },
  sounds: [{ sound: "bird-chirp" as const, at: 0.3, gain: 0.5 }],
  captions: { ja: "一段ずつ", en: "Step by step" },
});
const content = (): FilmDirectionContent => ({
  chapterName: "石段の先の社",
  nameReason: "Torii and stairs lead to a shrine.",
  music: {
    mood: "静謐",
    tempoBpm: 72,
    key: "D",
    mode: "minor",
    instruments: ["pad", "koto-pluck"],
    melody: "sparse",
    arc: "rise",
    fromPrevious: "continue",
  },
  scenes: [scene("a"), scene("b")],
});
const treatment = (): FilmTreatment => ({
  projectId: "p",
  revision: 3,
  title: "Film",
  recipe: "quiet-cinema",
  reducedMotion: false,
  chapters: [
    {
      id: "c1",
      title: "チャプター 1",
      limitMs: null,
      scenes: [{ sceneId: "a" }, { sceneId: "b" }],
    },
  ],
});
const proposal = (
  over: Partial<FilmDirectionProposal> = {},
): FilmDirectionProposal => ({
  id: "d1",
  projectId: "p",
  chapterId: "c1",
  requestId: "r1",
  scope: "chapter",
  status: "proposed",
  inputDigest: "sha256:x",
  model: "claude-cli",
  error: null,
  content: content(),
  createdAt: "2026-11-03T00:00:00Z",
  updatedAt: "2026-11-03T00:00:00Z",
  ...over,
});

describe("film direction content", () => {
  it("accepts a complete proposal for exactly the Chapter's photos", () => {
    expect(directionContentProblems(content(), ["a", "b"])).toEqual([]);
  });
  it("rejects unknown moves, unregistered sounds, out-of-range values and long captions", () => {
    const bad = content() as unknown as {
      scenes: Record<string, unknown>[];
      music: Record<string, unknown>;
    };
    (bad.scenes[0]!.camera as Record<string, unknown>).move = "barrel-roll";
    bad.scenes[0]!.sounds = [{ sound: "explosion", at: 0.5, gain: 1 }];
    (bad.scenes[1]!.camera as Record<string, unknown>).speed = 2;
    bad.scenes[1]!.captions = { ja: "あ".repeat(121), en: "" };
    bad.music.tempoBpm = 300;
    bad.music.instruments = ["pad", "pad"];
    const problems = directionContentProblems(bad, ["a", "b"]).join("\n");
    expect(problems).toMatch(/scenes\[0\]\.camera\.move/);
    expect(problems).toMatch(/scenes\[0\]\.sounds/);
    expect(problems).toMatch(/scenes\[1\]\.camera\.speed/);
    expect(problems).toMatch(/scenes\[1\]\.captions/);
    expect(problems).toMatch(/tempoBpm/);
    expect(problems).toMatch(/instruments/);
  });
  it("rejects missing, extra or reordered photos", () => {
    expect(directionContentProblems(content(), ["b", "a"])).not.toEqual([]);
    expect(directionContentProblems(content(), ["a"])).not.toEqual([]);
    expect(directionContentProblems(content(), ["a", "b", "c"])).not.toEqual(
      [],
    );
  });
});

describe("film direction locks and approval", () => {
  it("treats only default Chapter N titles as unnamed", () => {
    expect(isDefaultChapterTitle("チャプター 3")).toBe(true);
    expect(isDefaultChapterTitle("Chapter 12")).toBe(true);
    expect(isDefaultChapterTitle("海辺の朝")).toBe(false);
  });
  it("keeps user-entered names and captions even if the Agent returns others", () => {
    const t = treatment();
    t.chapters[0]!.title = "私の名前";
    t.sceneCaptions = { a: { ja: "自分の言葉", en: "My words" } };
    const locks = directionLocks(t, "c1");
    expect(locks).toEqual({
      chapterName: "私の名前",
      captions: { a: { ja: "自分の言葉", en: "My words" } },
    });
    const enforced = enforceDirectionLocks(content(), locks);
    expect(enforced.chapterName).toBe("私の名前");
    expect(enforced.scenes[0]!.captions).toEqual({
      ja: "自分の言葉",
      en: "My words",
    });
    expect(enforced.scenes[1]!.captions).toEqual(scene("b").captions);
  });
  it("does not lock text that an earlier proposal for the Chapter wrote", () => {
    const t = applyApprovedDirection(
      treatment(),
      proposal({ status: "approved" }),
    );
    expect(directionLocks(t, "c1", [proposal()])).toEqual({
      chapterName: null,
      captions: {},
    });
  });
  it("writes the approved name and captions into the treatment only on approval", () => {
    expect(() => applyApprovedDirection(treatment(), proposal())).toThrow(
      /approved/,
    );
    const t = applyApprovedDirection(
      treatment(),
      proposal({ status: "approved" }),
    );
    expect(t.chapters[0]!.title).toBe("石段の先の社");
    expect(t.sceneCaptions?.b).toEqual({ ja: "一段ずつ", en: "Step by step" });
  });
  it("allows only valid lifecycle transitions and detects stale input", () => {
    const at = "2026-11-03T01:00:00Z";
    expect(transitionDirection(proposal(), "approved", at).status).toBe(
      "approved",
    );
    expect(() =>
      transitionDirection(proposal({ status: "failed" }), "approved", at),
    ).toThrow();
    expect(isDirectionStale(proposal(), "sha256:x")).toBe(false);
    expect(isDirectionStale(proposal(), "sha256:y")).toBe(true);
  });
});
