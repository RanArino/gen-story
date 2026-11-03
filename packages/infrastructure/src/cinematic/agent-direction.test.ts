import { describe, expect, it } from "vitest";
import { digestOf } from "../contracts/canonical.js";
import type { ResolvedRenderPlan } from "../contracts/types.js";
import type { RuntimeChapter, RuntimeInput } from "../index.js";
import {
  cameraForMove,
  directApprovedChapter,
  scoreForDirection,
  type ApprovedChapterDirection,
  type ApprovedSceneDirection,
} from "./agent-direction.js";
import { camAt, frameForImage } from "./math.js";
import { validateDirection } from "./validate.js";

const scene = (
  sceneId: string,
  over: Partial<ApprovedSceneDirection> = {},
): ApprovedSceneDirection => ({
  sceneId,
  camera: { move: "push-in", focus: { x: 0.4, y: 0.4 }, speed: 0.5 },
  effects: { rays: 0.3, motes: 0.2, leaves: 0, warmth: 0.2 },
  footsteps: "none",
  ambience: { wind: 0.3, stream: 0 },
  sounds: [],
  ...over,
});
const approved = (
  over: Partial<ApprovedChapterDirection["music"]> = {},
): ApprovedChapterDirection => ({
  music: {
    tempoBpm: 72,
    key: "D",
    mode: "minor",
    instruments: ["pad", "koto-pluck", "low-swell"],
    melody: "medium",
    arc: "rise",
    fromPrevious: "continue",
    ...over,
  },
  scenes: [
    scene("stairs", {
      camera: { move: "climb", focus: { x: 0.5, y: 0.25 }, speed: 0.7 },
      footsteps: "stair",
      sounds: [{ sound: "bird-chirp", at: 0.4, gain: 0.6 }],
    }),
    scene("sea", {
      camera: { move: "pan-right", focus: { x: 0.5, y: 0.5 }, speed: 0.3 },
      ambience: { wind: 0.1, stream: 0.8 },
      sounds: [{ sound: "temple-bell", at: 0.8, gain: 0.5 }],
    }),
  ],
});
const windows = [
  { id: "stairs", t0: 1.5, t1: 7 },
  { id: "sea", t0: 6.4, t1: 12 },
];
const timingPlan = {
  timing: { proposal: { runtimeMs: 13000, overlapMs: 600 } },
  segments: [
    { kind: "title", startMs: 0, endMs: 1500 },
    { kind: "scene", sceneId: "stairs", startMs: 1500, endMs: 7000 },
    { kind: "scene", sceneId: "sea", startMs: 6400, endMs: 12000 },
    { kind: "title", startMs: 12000, endMs: 13000 },
  ],
  lock: { environment: "e", painter: { abi: "p" }, fonts: [] },
} as unknown as ResolvedRenderPlan;
const input = {
  projectId: "project",
  revision: 2,
  title: "Film",
  worldview: "",
  recipe: "quiet-cinema",
  reducedMotion: false,
  outputProfile: "portrait-1080p30@1",
  chapters: [],
  scenes: [
    {
      id: "stairs",
      asset: "images/a.png",
      caption: "一段ずつ",
      subtitle: "Step by step",
      source: "a",
    },
    {
      id: "sea",
      asset: "images/b.png",
      caption: "",
      subtitle: "",
      source: "b",
    },
  ],
  media: [
    {
      path: "images/a.png",
      kind: "image",
      sha256: digestOf("a"),
      widthPx: 800,
      heightPx: 1200,
    },
    {
      path: "images/b.png",
      kind: "image",
      sha256: digestOf("b"),
      widthPx: 1600,
      heightPx: 900,
    },
  ],
} as unknown as RuntimeInput;
const chapter: RuntimeChapter = {
  id: "chapter",
  title: "石段の先の社",
  limitMs: null,
  scenes: [{ sceneId: "stairs" }, { sceneId: "sea" }],
};

describe("approved Agent direction", () => {
  it("turns each named move into distinct camera paths", () => {
    const moves = [
      "hold",
      "push-in",
      "pull-out",
      "pan-left",
      "pan-right",
      "tilt-up",
      "tilt-down",
      "climb",
      "walk-in",
      "reveal",
    ] as const;
    const paths = new Set(
      moves.map((move) =>
        JSON.stringify(
          cameraForMove({ move, focus: { x: 0.4, y: 0.4 }, speed: 0.5 }, false)
            .keys,
        ),
      ),
    );
    // walk-in shares push-in's path and differs only by walking bob.
    expect(paths.size).toBe(moves.length - 1);
  });
  it("climbs upward toward the focus with walking bob only when footsteps exist", () => {
    const camera = {
      move: "climb" as const,
      focus: { x: 0.5, y: 0.25 },
      speed: 0.7,
    };
    const { keys, bob } = cameraForMove(camera, true);
    expect(keys[0]!.fy).toBeGreaterThan(keys.at(-1)!.fy);
    expect(keys.at(-1)!.z).toBeGreaterThan(keys[0]!.z);
    expect(bob).toBeGreaterThan(0);
    expect(cameraForMove(camera, false).bob).toBe(0);
  });
  it("shows the whole photo at rest and moves the frame toward the focus when zoomed", () => {
    const rest = frameForImage(
      1920,
      1080,
      { fx: 0.2, fy: 0.2, z: 1 },
      1600,
      900,
      "follow",
    );
    expect(rest.left).toBeGreaterThanOrEqual(0);
    expect(rest.left + rest.width).toBeLessThanOrEqual(1920);
    const left = frameForImage(
      1920,
      1080,
      { fx: 0.2, fy: 0.5, z: 1.8 },
      1600,
      900,
      "follow",
    );
    const right = frameForImage(
      1920,
      1080,
      { fx: 0.8, fy: 0.5, z: 1.8 },
      1600,
      900,
      "follow",
    );
    expect(left.left).toBeGreaterThan(right.left);
    for (const f of [left, right]) {
      expect(f.left).toBeLessThanOrEqual(0);
      expect(f.left + f.width).toBeGreaterThanOrEqual(1920);
    }
  });
  it("derives different harmony and tempo from different music specs", () => {
    const a = scoreForDirection(approved(), windows, 13, 7, 1).score;
    const b = scoreForDirection(
      approved({ key: "G", mode: "major", tempoBpm: 120, melody: "flowing" }),
      windows,
      13,
      7,
      1,
    ).score;
    const pads = (s: typeof a) =>
      s.events.filter((e) => e.sound === "pad").map((e) => e.params.notes);
    const plucks = (s: typeof a) =>
      s.events.filter((e) => e.sound === "koto-pluck").length;
    expect(pads(a)).not.toEqual(pads(b));
    expect(plucks(b)).toBeGreaterThan(plucks(a));
  });
  it("places footsteps and scene sounds inside their own photo windows", () => {
    const { score, steps } = scoreForDirection(approved(), windows, 13, 7, 1);
    const footsteps = score.events.filter((e) => e.sound === "footstep");
    expect(footsteps.length).toBeGreaterThan(3);
    expect(footsteps.every((e) => e.t >= 1.5 && e.t <= 7)).toBe(true);
    expect(steps.map((s) => s.t)).toEqual(footsteps.map((e) => e.t));
    const bird = score.events.find((e) => e.sound === "bird-chirp")!;
    expect(bird.t).toBeCloseTo(1.5 + 0.4 * 5.5);
    const bell = score.events.find((e) => e.sound === "temple-bell")!;
    expect(bell.t).toBeCloseTo(6.4 + 0.8 * 5.6);
    expect(score.beds.map((b) => b.name)).toEqual(["wind", "stream"]);
    expect(score.mix.buses.foley).toBe(1);
    expect(score.events.map((e) => e.i)).toEqual(score.events.map((_, i) => i));
  });
  it("materializes a valid portrait direction with follow framing and the reviewed copy", () => {
    const { direction, fingerprint } = directApprovedChapter(
      input,
      chapter,
      timingPlan,
      approved(),
    );
    expect(() => validateDirection(direction)).not.toThrow();
    expect(direction.profile).toBe("portrait-1080p30@1");
    expect(direction.scenes.map((s) => s.framing)).toEqual([
      "follow",
      "follow",
    ]);
    expect(direction.scenes[0]!.bob).toBeGreaterThan(0);
    expect(direction.titleCard?.display).toBe("石段の先の社");
    expect(direction.captions).toHaveLength(1);
    expect(direction.captions[0]).toMatchObject({
      text: "一段ずつ",
      sub: "Step by step",
    });
    const mid = camAt(direction.scenes[0]!, 4);
    expect(mid.fy).toBeLessThan(direction.scenes[0]!.camera[0]!.fy);
    const other = directApprovedChapter(input, chapter, timingPlan, {
      ...approved(),
      scenes: [approved().scenes[0]!, scene("sea")],
    });
    expect(other.fingerprint).not.toBe(fingerprint);
  });
  it("refuses a direction made for different photos", () => {
    expect(() =>
      directApprovedChapter(input, chapter, timingPlan, {
        ...approved(),
        scenes: [scene("sea"), scene("stairs")],
      }),
    ).toThrow(/no longer matches/);
  });
});
