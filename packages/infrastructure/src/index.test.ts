import { validateSchema } from "./contracts/schemas.js";
import { afterAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compileFilm,
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
