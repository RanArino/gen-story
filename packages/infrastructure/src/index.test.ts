import { buildConcatPlan } from "./compiler/concat.js";
import { validateSchema } from "./contracts/schemas.js";
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compileFilm,
  directProjectChapter,
  compileProjectChapter,
  digestOf,
  recipeNames,
  runtimeRoot,
  type RuntimeInput,
} from "./index";
vi.mock("./env/fingerprint.js", () => ({
  readFingerprint: () => ({
    node: "test",
    chrome: null,
    ffmpeg: "test",
    ffprobe: "test",
    os: "test",
    painterDigest: "test",
  }),
}));
const directory = mkdtempSync(join(tmpdir(), "film-runtime-"));
const paths = {
  root: runtimeRoot,
  fixtures: `${runtimeRoot}assets/`,
  state: `${runtimeRoot}assets/`,
  media: `${directory}/`,
  out: `${directory}/`,
};
const input = (): RuntimeInput => ({
  projectId: "real-project",
  revision: 1,
  title: "My film",
  worldview: "A family walk",
  recipe: "quiet-cinema",
  reducedMotion: false,
  chapters: [
    {
      id: "first",
      title: "Opening",
      limitMs: 60000,
      scenes: [{ sceneId: "a", durationMs: 4123 }],
    },
    {
      id: "second",
      title: "Ending",
      limitMs: null,
      scenes: [{ sceneId: "b" }],
    },
  ],
  scenes: ["a", "b"].map((id) => ({
    id,
    asset: `images/${id}.png`,
    caption: id,
    source: `data/uploads/${id}`,
  })),
  media: ["a", "b"].map((id) => ({
    path: `images/${id}.png`,
    kind: "image",
    sha256: digestOf(id),
    widthPx: 1024,
    heightPx: 768,
  })),
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));
describe("production Film compiler", () => {
  it.each(recipeNames)(
    "compiles %s with real project identities and preserves entered durations",
    (recipe) => {
      const result = compileFilm(paths, { ...input(), recipe });
      expect(result.compiled).toHaveLength(2);
      expect(result.compiled[0]!.proposal.scenes[0]!.durationMs).toBe(4123);
      expect(result.compiled[0]!.plan.provenance.storyGraph.id).toBe(
        "real-project",
      );
    },
  );
  it("accepts application UUID scene and Chapter IDs in render snapshots", () => {
    const value = input();
    const sceneId = "1753da0f-28aa-4562-9130-601f029a3fe1";
    value.scenes[0]!.id = sceneId;
    value.chapters[0]!.id = "354eec82-8474-407f-88d1-24dd74983e69";
    value.chapters[0]!.scenes[0]!.sceneId = sceneId;
    const result = compileFilm(paths, value);
    expect(
      validateSchema(
        "urn:film-spike:resolved-render-plan",
        result.compiled[0]!.plan,
      ),
    ).toEqual([]);
  });
  it("blocks impossible limits before rendering", () => {
    const value = input();
    value.chapters[0]!.limitMs = 1000;
    expect(() => compileFilm(paths, value)).toThrow();
  });
  it("reuses an unaffected Chapter across revisions", () => {
    const before = compileFilm(paths, input());
    const changed = input();
    changed.revision++;
    changed.scenes[0]!.caption = "Changed";
    const after = compileFilm(paths, changed);
    expect(before.compiled[0]!.plan.fingerprint).not.toBe(
      after.compiled[0]!.plan.fingerprint,
    );
    expect(before.compiled[1]!.plan.fingerprint).toBe(
      after.compiled[1]!.plan.fingerprint,
    );
  });
  it("rejects an unsupported title glyph instead of substituting a font", () => {
    const value = input();
    value.chapters[0]!.title = "🦄";
    expect(() => compileFilm(paths, value)).toThrow();
  });
});

it("renders entered primary/secondary words and preserves explicit hidden captions", () => {
  const value = input();
  value.scenes[0]!.caption = "My saved words";
  value.scenes[0]!.subtitle = "Second line";
  const first = compileFilm(paths, value);
  expect(first.compiled[0]!.plan.texts.map((t) => t.text)).toContain(
    "My saved words",
  );
  expect(first.compiled[0]!.plan.texts.map((t) => t.text)).toContain(
    "Second line",
  );
  value.scenes[0]!.caption = "";
  value.scenes[0]!.subtitle = "";
  const hidden = compileFilm(paths, value);
  expect(
    hidden.compiled[0]!.plan.texts.filter((t) => t.role === "caption"),
  ).toEqual([]);
  expect(hidden.compiled[0]!.plan.fingerprint).not.toBe(
    first.compiled[0]!.plan.fingerprint,
  );
  expect(hidden.compiled[1]!.plan.fingerprint).toBe(
    first.compiled[1]!.plan.fingerprint,
  );
});

it.each(recipeNames)(
  "directs %s project photos through the cinematic runtime with complete reusable audio",
  (recipe) => {
    const value = { ...input(), recipe };
    const timing = compileFilm(paths, value);
    const first = timing.compiled[0]!;
    const directed = directProjectChapter(
      value,
      value.chapters[0]!,
      first.plan,
    );
    expect(directed.direction.scenes[0]!.framing).toBe("contain");
    expect(directed.direction.scenes[0]!.camera).toHaveLength(3);
    expect(
      new Set(directed.direction.scenes[0]!.camera.map((k) => k.z)).size,
    ).toBeGreaterThan(1);
    expect(
      directed.direction.scenes[0]!.t1 - directed.direction.scenes[0]!.t0,
    ).toBeCloseTo(4.123);
    expect(directed.direction.params.rays[1]![1]).toBeGreaterThan(0);
    expect(directed.direction.score.events.some((e) => e.sound === "pad")).toBe(
      true,
    );
    const durationMs = Math.round(directed.direction.duration * 1000);
    const score = {
      music: {
        path: "sounds/music.wav",
        kind: "sound" as const,
        sha256: digestOf("music"),
        durationMs,
      },
      stem: {
        path: "sounds/stem.wav",
        kind: "sound" as const,
        sha256: digestOf("stem"),
        durationMs,
      },
      gainDb: 0,
      sourceDigest: digestOf("audio"),
      scoreDigest: digestOf(directed.direction.score),
    };
    const plan = compileProjectChapter(
      paths,
      directed.direction,
      first.plan,
      score,
    );
    expect(plan.layers[0]!.type).toBe("cinematic");
    expect(plan.audio.events.map((e) => e.asset)).toEqual([
      score.music.path,
      score.stem.path,
    ]);
    expect(plan.audio.bgm.gain).toBe(0);
    const concat = buildConcatPlan({
      ...timing.input,
      titlePlan: first.plan,
      chapters: [
        {
          plan,
          planDigest: digestOf(plan),
          artifactSha256: digestOf("mp4"),
          stemSha256: digestOf("stem"),
          frames: Math.round((durationMs * 30) / 1000),
        },
      ],
    });
    expect(concat.audio.bgm.gain).toBe(0);
    expect(concat.chapters[0]!.stemSha256).toBe(digestOf("stem"));
    expect(concat.overallTitle.text).toBe(value.title);
    expect(validateSchema("urn:film-spike:concat-plan", concat)).toEqual([]);

    expect(validateSchema("urn:film-spike:resolved-render-plan", plan)).toEqual(
      [],
    );
    const changed = structuredClone(value);
    changed.revision++;
    changed.scenes[0]!.caption = "New words";
    const after = compileFilm(paths, changed);
    expect(
      directProjectChapter(
        changed,
        changed.chapters[0]!,
        after.compiled[0]!.plan,
      ).fingerprint,
    ).not.toBe(directed.fingerprint);
    expect(
      directProjectChapter(
        changed,
        changed.chapters[1]!,
        after.compiled[1]!.plan,
      ).fingerprint,
    ).toBe(
      directProjectChapter(value, value.chapters[1]!, timing.compiled[1]!.plan)
        .fingerprint,
    );
  },
);
