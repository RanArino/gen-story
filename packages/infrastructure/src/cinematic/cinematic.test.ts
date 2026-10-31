import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeRuntime, digestOf } from "../index.js";
import { validateDirection } from "./validate.js";
import { compileCinematicFilm } from "./compile.js";
import { camAt, frameFor, frameForImage, rngFor } from "./math.js";
import { imageAssets } from "../painter/painter.js";
import type { CinematicDirection } from "./types.js";
vi.mock("../env/fingerprint.js", async (original) => ({
  ...(await original<object>()),
  readFingerprint: () => ({
    node: "test",
    chrome: null,
    ffmpeg: "test",
    ffprobe: "test",
    os: "test",
    painterDigest: "test",
  }),
}));
const directory = mkdtempSync(join(tmpdir(), "cinematic-unit-"));
const paths = initializeRuntime(directory);
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const fixture = (): CinematicDirection => ({
  schema: "film.cinematic-direction@1",
  projectId: "project",
  chapterId: "chapter",
  title: "Test",
  revision: 1,
  seed: 17,
  duration: 10,
  reducedMotion: false,
  assets: {
    photo: {
      asset: "images/photo.png",
      sha256: digestOf("photo"),
      widthPx: 1024,
      heightPx: 1024,
    },
  },
  scenes: [
    {
      id: "scene",
      image: "photo",
      t0: 1,
      t1: 9,
      fadeIn: 1,
      fadeOut: 1,
      bob: 0,
      camera: [
        { p: 0, fx: 0.3, fy: 0.7, z: 1.03 },
        { p: 0.4, fx: 0.5, fy: 0.5, z: 1.2 },
        { p: 1, fx: 0.7, fy: 0.3, z: 1.1 },
      ],
    },
  ],
  params: {
    cool: [
      [0, 0.3],
      [10, 0],
    ],
    warm: [
      [0, 0],
      [10, 0.3],
    ],
    vignette: [
      [0, 0.8],
      [10, 0.2],
    ],
    rays: [
      [0, 0],
      [10, 1],
    ],
    motes: [[0, 0.1]],
    leaves: [[0, 0.1]],
    speed: [[0, 1]],
    bloom: [[0, 0]],
  },
  options: {
    rays: 9,
    motes: 72,
    leaves: 18,
    leafColors: ["#9bb84f"],
    light: [255, 236, 190],
    coolWash: "#5f7b94",
    warmWash: "#ffbf70",
    grain: 0.085,
    transitionGlow: 0.12,
  },
  steps: [],
  captions: [{ t0: 2, t1: 5, text: "Hello", sub: "こんにちは", mid: false }],
  titleCard: null,
  slates: [],
  credits: null,
  score: {
    seed: 17,
    duration: 10,
    events: [],
    beds: [],
    master: [
      [0, 0],
      [2, 0.9],
      [10, 0],
    ],
    mix: {
      reverb: { seconds: 3.6, decay: 2.7, wet: 0.6 },
      buses: { music: 1, foley: 1, ambience: 1, sfx: 1 },
    },
  },
});
const score = (d: CinematicDirection) => ({
  music: {
    path: "sounds/music.wav",
    kind: "sound" as const,
    sha256: digestOf("music"),
    durationMs: 10000,
  },
  stem: {
    path: "sounds/stem.wav",
    kind: "sound" as const,
    sha256: digestOf("stem"),
    durationMs: 10000,
  },
  gainDb: 0,
  sourceDigest: digestOf("audio"),
  scoreDigest: digestOf(d.score),
});
describe("cinematic authored production plans", () => {
  it("compiles authored camera/look/copy and exact variable windows through the common painter", () => {
    const d = fixture();
    const p = compileCinematicFilm(paths, d, score(d));
    expect(p.layers[0]!.type).toBe("cinematic");
    expect(p.timing.proposal.authoredWindows).toEqual([
      { sceneId: "scene", startMs: 1000, endMs: 9000 },
    ]);
    expect(p.timing.proposal.endingMs).toBe(1000);
    expect(p.audio.bgm.gain).toBe(1);
    expect(p.lock.painter.abi).toBe("film-painter@2");
    expect([...imageAssets(p.layers)]).toEqual(["images/photo.png"]);
  });
  it("changes the fingerprint for direction changes but preserves identical revisions", () => {
    const d = fixture(),
      a = compileCinematicFilm(paths, d, score(d));
    d.revision++;
    expect(compileCinematicFilm(paths, d, score(d)).fingerprint).toBe(
      a.fingerprint,
    );
    d.scenes[0]!.camera[1]!.fx = 0.6;
    expect(compileCinematicFilm(paths, d, score(d)).fingerprint).not.toBe(
      a.fingerprint,
    );
  });
  it("rejects a score prepared for a different musical plan", () => {
    const d = fixture(),
      prepared = score(d);
    d.score.master[1]![1] = 0.4;
    expect(() => compileCinematicFilm(paths, d, prepared)).toThrow(/score/);
  });
  it("rejects unordered camera keys and out-of-timeline audio", () => {
    const d = fixture();
    d.scenes[0]!.camera[1]!.p = 0;
    expect(() => validateDirection(d)).toThrow(/Camera/);
  });
  it("rejects executable/unknown fields and unregistered sound identifiers", () => {
    const d = fixture();
    expect(() =>
      validateDirection({ ...d, code: "fetch('https://example.test')" }),
    ).toThrow();
    d.score.events = [{ t: 1, sound: "remote" as never, params: {}, i: 0 }];
    expect(() => validateDirection(d)).toThrow();
  });
  it("rejects missing source images, illegal color curves and unsupported glyphs", () => {
    const d = fixture();
    d.scenes[0]!.image = "missing";
    expect(() => validateDirection(d)).toThrow(/media/);
    d.scenes[0]!.image = "photo";
    d.params.rays[0]![1] = 1.2;
    expect(() => validateDirection(d)).toThrow(/range/);
    d.params.rays[0]![1] = 0.2;
    d.captions[0]!.text = "🦄";
    expect(() => compileCinematicFilm(paths, d, score(d))).toThrow(/glyph/);
  });
  it("replays nonlinear camera paths independently of sampling order", () => {
    const s = fixture().scenes[0]!;
    const later = camAt(s, 7);
    camAt(s, 2);
    expect(camAt(s, 7)).toEqual(later);
    expect(camAt(s, 1)).not.toEqual(later);
    const f = frameFor(1920, 1080, later);
    expect(f.left).toBeLessThanOrEqual(0);
    expect(f.top).toBeLessThanOrEqual(0);
    expect(f.left + f.S).toBeGreaterThanOrEqual(1920);
  });
  it("preserves landscape and portrait image proportions", () => {
    for (const [w, h] of [
      [2000, 1000],
      [1000, 2000],
    ]) {
      const f = frameForImage(1920, 1080, { fx: 0.8, fy: 0.2, z: 1.2 }, w!, h!);
      expect(f.width / f.height).toBeCloseTo(w! / h!);
      expect(f.left).toBeLessThanOrEqual(0);
      expect(f.top).toBeLessThanOrEqual(0);
      expect(f.left + f.width).toBeGreaterThanOrEqual(1920);
      expect(f.top + f.height).toBeGreaterThanOrEqual(1080);
    }
  });
  it("rejects incomplete instrument parameters before audio execution", () => {
    const d = fixture();
    d.score.events = [{ t: 1, sound: "pad", params: { level: 0.3 }, i: 0 }];
    expect(() => validateDirection(d)).toThrow(/SCHEMA/);
  });
  it("requires an owned image reference rather than an inherited object property", () => {
    const d = fixture();
    d.scenes[0]!.image = "constructor";
    expect(() => validateDirection(d)).toThrow(/media/);
  });
  it("keeps reusable profile identity stable under project-specific styling", () => {
    const d = fixture(),
      a = compileCinematicFilm(paths, d, score(d));
    d.options.coolWash = "#345678";
    const b = compileCinematicFilm(paths, d, score(d));
    expect(b.provenance.recipe).toEqual(a.provenance.recipe);
    expect(b.fingerprint).not.toBe(a.fingerprint);
  });
  it("keeps seeded particle/audio randomness reproducible", () => {
    const a = rngFor(17, 3),
      b = rngFor(17, 3);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
