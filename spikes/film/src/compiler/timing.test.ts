import { describe, expect, it } from "vitest";
import type { FilmChapter } from "../contracts/types.js";
import { preflight, resolveTiming, sceneMinimums, type TimingInput } from "./timing.js";

function input(chapter: FilmChapter, weights: number[], beatMs: number | null = null): TimingInput {
  return {
    chapter,
    chapterPath: "/chapters/0",
    titleMs: 3000,
    overlapMs: 800,
    gapMs: 0,
    cut: { preferredSceneMs: 8000, minSceneMs: 2500, maxSceneMs: 14000, minHoldMs: 1500, beatMs },
    weights,
  };
}

const scenes = (...durations: (number | undefined)[]) => durations.map((d, i) => ({ sceneId: `s${i + 1}`, ...(d === undefined ? {} : { durationMs: d }) }));

describe("Chapter timing", () => {
  it("minimums account for the incoming and outgoing overlaps and the minimum hold", () => {
    expect(sceneMinimums(input({ id: "c1", title: "t", scenes: scenes(undefined, undefined, undefined) }, [1, 1, 1]))).toEqual([3100, 3100, 2500]);
  });

  it("water-fills the remaining time by weight when preferred durations do not fit", () => {
    const chapter = { id: "c1", title: "t", limitMs: 20000, scenes: scenes(undefined, 6000, undefined, undefined) };
    const p = resolveTiming(input(chapter, [1.25, 1, 0.75, 1]));
    expect(p.runtimeMs).toBe(20000);
    expect(p.remainingMs).toBe(0);
    const [a, b, c, d] = p.scenes;
    expect(b).toMatchObject({ source: "user", durationMs: 6000 });
    for (const s of [a!, c!, d!]) expect(s.durationMs).toBeGreaterThanOrEqual(s.minMs);
    expect(a!.durationMs).toBeGreaterThan(d!.durationMs);
    expect(d!.durationMs).toBeGreaterThan(c!.durationMs);
  });

  it("gives leftover milliseconds to earlier scenes on ties", () => {
    const chapter = { id: "c1", title: "t", limitMs: 16001, scenes: scenes(undefined, undefined, undefined) };
    const p = resolveTiming(input(chapter, [1, 1, 1]));
    expect(p.runtimeMs).toBe(16001);
    const [a, b] = p.scenes;
    expect(a!.durationMs).toBeGreaterThanOrEqual(b!.durationMs);
  });

  it("leaves unused time unused when preferred durations fit", () => {
    const p = resolveTiming(input({ id: "c1", title: "t", limitMs: 60000, scenes: scenes(undefined, undefined) }, [1, 1]));
    expect(p.scenes.map((s) => s.durationMs)).toEqual([8000, 8000]);
    expect(p.remainingMs).toBe(60000 - p.runtimeMs);
  });

  it("beat quantization floors only resolved scenes, never below their beat-rounded minimum", () => {
    const p = resolveTiming(input({ id: "c1", title: "t", limitMs: 18000, scenes: scenes(undefined, 4250, undefined) }, [1, 1, 1], 625));
    expect(p.scenes[1]!.durationMs).toBe(4250);
    for (const s of [p.scenes[0]!, p.scenes[2]!]) {
      expect(s.durationMs % 625).toBe(0);
      expect(s.durationMs).toBeGreaterThanOrEqual(s.minMs);
    }
    expect(p.runtimeMs).toBeLessThanOrEqual(18000);
  });

  it("preflight reports both too-short values and over-limit Chapters without changing them", () => {
    const short = { id: "c1", title: "t", scenes: scenes(1000, undefined) };
    expect(preflight(input(short, [1, 1])).map((e) => e.code)).toEqual(["FS_SCENE_TOO_SHORT_FOR_TRANSITIONS"]);
    const over = { id: "c1", title: "t", limitMs: 10000, scenes: scenes(5000, 5000, undefined) };
    const [error] = preflight(input(over, [1, 1, 1]));
    expect(error).toMatchObject({ code: "FS_PREFLIGHT_OVER_LIMIT", details: { limitMs: 10000, requiredMinMs: 13100, overByMs: 3100 } });
    expect(over.scenes[0]!.durationMs).toBe(5000);
  });
});
