import { describe, expect, it } from "vitest";
import { digestOf } from "../contracts/canonical.js";
import { validateSchema } from "../contracts/schemas.js";
import type { Anim, ExactRef, FilmChapters, FilmStyleRecipe, FilmTreatment, FontAssetManifest, PainterNode, ResolvedRenderPlan, StoryGraph } from "../contracts/types.js";
import { writeJson } from "../paths.js";
import { readFixture } from "../testing/fixtures.js";
import { createWorld } from "../testing/world.js";
import { planDigest } from "./fingerprint.js";

const world = createWorld();
const { service, paths } = world;
const graph = readFixture<StoryGraph>("project/story-graph.json");
const chapters = readFixture<FilmChapters>("project/chapters.json");
const treatment = (name: string) => readFixture<FilmTreatment>(`project/treatments/test-${name}.json`);

function compile(t: FilmTreatment, c: FilmChapters = chapters, options = {}) {
  const result = service.compile({ treatment: t, chapters: c, options });
  if (!result.ok) throw new Error(JSON.stringify(result.errors, null, 2));
  return result.result!;
}

function images(nodes: PainterNode[]): Extract<PainterNode, { type: "image" }>[] {
  return nodes.flatMap((n) => (n.type === "image" ? [n] : n.type === "group" ? images(n.children) : []));
}

function values(a: Anim): number[] {
  return typeof a === "number" ? [a] : a.keys.map((k) => k.v);
}

function frames(a: Anim): number {
  return typeof a === "number" ? 1 : a.keys.length;
}

function registerFont(name: string, fallback: ExactRef[], scope: FontAssetManifest["scope"] = { kind: "organization" }): ExactRef {
  const registry = service.registry;
  const template = registry.manifest<FontAssetManifest>(registry.record("font.fixture-sans-jp", "1.0.0")!);
  const manifest = { ...template, id: `font.test-${name}`, fallback, scope };
  expect(validateSchema("urn:film-spike:font-asset-manifest", manifest)).toEqual([]);
  const { record } = registry.promote({
    entity: "font", id: manifest.id, version: manifest.version, kind: "font", trust: "system", manifest, implementation: null,
    assets: [
      ...manifest.faces.map((face, i) => ({ name: `face-${i}`, bytes: registry.readBlob(face.sha256!) })),
      { name: "license", bytes: registry.readBlob(manifest.license.sha256!) },
    ],
    validationReportDigests: [], approvalIds: [], reviewId: null,
  });
  return { id: record.id, version: record.version, digest: record.manifestDigest };
}

function treatmentWithFont(ref: ExactRef, name: string): { recipe: FilmStyleRecipe; treatment: FilmTreatment } {
  const recipe = readFixture<FilmStyleRecipe>("recipes/test/baseline.r1.json");
  recipe.id = `org.local.test-${name}`;
  recipe.fonts = recipe.fonts.map((font) => ({ ...font, ref }));
  writeJson(`${paths.state}recipes/test-${name}.r1.json`, recipe);
  const t = treatment("baseline");
  return { recipe, treatment: { ...t, recipe: { id: recipe.id, revision: recipe.revision, digest: digestOf(recipe) }, shared: { ...t.shared, typography: ref } } };
}

describe("[A04] Chapter timing preserves user durations", () => {
  const compiled = compile(treatment("baseline"));
  const byScene = new Map(compiled.flatMap((c) => c.proposal.scenes.map((s) => [s.sceneId, s] as const)));

  it("[A04] keeps s2 = 9,000 ms, s4 = 4,250 ms, and s7 = 6,000 ms exactly", () => {
    expect(byScene.get("s2")).toMatchObject({ source: "user", durationMs: 9000 });
    expect(byScene.get("s4")).toMatchObject({ source: "user", durationMs: 4250 });
    expect(byScene.get("s7")).toMatchObject({ source: "user", durationMs: 6000 });
    for (const id of ["s1", "s3", "s5", "s6", "s8"]) expect(byScene.get(id)!.source).toBe("resolved");
  });

  it("[A04] keeps each Chapter runtime within its limit and agrees with the runtime formula", () => {
    for (const { plan, proposal } of compiled) {
      expect(proposal.runtimeMs).toBeLessThanOrEqual(proposal.limitMs!);
      const sum = proposal.scenes.reduce((a, s) => a + s.durationMs, 0);
      const n = proposal.scenes.length;
      expect(proposal.runtimeMs).toBe(proposal.titleMs + sum - n * proposal.overlapMs + n * proposal.gapMs);
      expect(plan.segments.at(-1)!.endMs).toBe(proposal.runtimeMs);
      expect(plan.segments[0]!.kind).toBe("title");
    }
    expect(compiled.map((c) => c.proposal.limitMs)).toEqual([60000, 40000]);
  });

  it("produces schema-valid Plans with a timing proposal digest", () => {
    for (const { plan, proposal, proposalDigest } of compiled) {
      expect(validateSchema("urn:film-spike:resolved-render-plan", plan)).toEqual([]);
      expect(validateSchema("urn:film-spike:timing-proposal", proposal)).toEqual([]);
      expect(proposalDigest).toBe(digestOf(proposal));
      expect(plan.timing.proposalDigest).toBe(proposalDigest);
    }
  });

  it("is deterministic: compiling twice gives identical Plan digests", () => {
    const again = compile(treatment("baseline"));
    expect(again.map((c) => planDigest(c.plan))).toEqual(compiled.map((c) => planDigest(c.plan)));
  });
});

describe("[A05] over-constrained Chapters are blocked", () => {
  it("[A05] returns FS_PREFLIGHT_OVER_LIMIT with the over-by amount and produces no Plan", () => {
    const over = readFixture<FilmChapters>("project/chapters.over-constrained.json");
    const before = JSON.stringify(over);
    const result = service.compile({ treatment: treatment("baseline"), chapters: over, write: true });
    expect(result.ok).toBe(false);
    expect(result.result).toBeUndefined();
    expect(result.evidence).toEqual([]);
    const error = result.errors.find((e) => e.code === "FS_PREFLIGHT_OVER_LIMIT")!;
    expect(error.path).toBe("/chapters/0");
    expect(error.details).toMatchObject({ limitMs: 30000 });
    const details = error.details as { requiredMinMs: number; overByMs: number; fixedScenes: unknown[] };
    expect(details.overByMs).toBe(details.requiredMinMs - 30000);
    expect(details.overByMs).toBeGreaterThan(0);
    expect(details.fixedScenes).toHaveLength(3);
    expect(JSON.stringify(over)).toBe(before);
    const preflight = service.preflight({ treatment: treatment("baseline"), chapters: over });
    expect(preflight.errors.map((e) => e.code)).toEqual(["FS_PREFLIGHT_OVER_LIMIT"]);
  });
});

describe("[A06] limits are honoured", () => {
  it("[A06] with the limit removed, blank scenes get their clamped preferred durations", () => {
    const [c1] = compile(treatment("baseline"), readFixture<FilmChapters>("project/chapters.no-limit.json"));
    expect(c1!.proposal.limitMs).toBeNull();
    expect(c1!.proposal.remainingMs).toBeNull();
    const recipe = readFixture<FilmStyleRecipe>("recipes/test/baseline.r1.json");
    for (const s of c1!.proposal.scenes.filter((x) => x.source === "resolved")) {
      const scene = graph.scenes.find((g) => g.id === s.sceneId)!;
      const preferred = Math.round(recipe.timing.preferredSceneMs * (1 + (scene.emphasis - 0.5) * 0.5));
      expect(s.durationMs).toBe(Math.min(recipe.timing.maxSceneMs, Math.max(s.minMs, preferred)));
    }
  });

  it("[A06] a duration below the transition minimum fails and is never changed", () => {
    const short = readFixture<FilmChapters>("project/chapters.too-short.json");
    const result = service.compile({ treatment: treatment("baseline"), chapters: short });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatchObject({ code: "FS_SCENE_TOO_SHORT_FOR_TRANSITIONS", path: "/chapters/0/scenes/1/durationMs" });
    expect(result.errors[0]!.details).toMatchObject({ durationMs: 400, minMs: 3100 });
    expect(short.chapters[0]!.scenes[1]!.durationMs).toBe(400);
  });

  it("beat-quantized Cuts floor resolved scenes to whole beats and keep user values", () => {
    const compiled = compile(treatment("pulse"));
    for (const { proposal } of compiled) {
      for (const s of proposal.scenes) {
        if (s.source === "resolved") expect(s.durationMs % 625).toBe(0);
        expect(s.durationMs).toBeGreaterThanOrEqual(s.minMs);
      }
      expect(proposal.runtimeMs).toBeLessThanOrEqual(proposal.limitMs!);
    }
    expect(compiled[0]!.proposal.scenes.find((s) => s.sceneId === "s4")!.durationMs).toBe(4250);
  });
});

describe("[A13] safe crop", () => {
  it.each(["baseline", "board", "pulse"])("[A13] every image crop in the %s Plans contains the subject bounds", (name) => {
    for (const options of [{}, { reducedMotion: true }, { forceLevel0: true }]) {
      for (const { plan } of compile(treatment(name), chapters, options)) {
        const sceneOf = (asset: string) => graph.scenes.find((s) => s.media.asset === asset)!;
        for (const image of images(plan.layers)) {
          const media = plan.lock.media.find((m) => m.asset === image.asset)!;
          expect(media).toBeDefined();
          const lockEntry = readFixture<{ files: { path: string; widthPx: number; heightPx: number }[] }>("../.media/media-lock.json").files.find((f) => f.path === image.asset)!;
          const subject = sceneOf(image.asset).analysis.subject;
          const sx = subject.x * lockEntry.widthPx;
          const sy = subject.y * lockEntry.heightPx;
          const keysCount = Math.max(frames(image.src.x), frames(image.src.y), frames(image.src.w), frames(image.src.h));
          const at = (a: Anim, k: number) => values(a)[Math.min(k, values(a).length - 1)]!;
          for (let k = 0; k < keysCount; k += 1) {
            const x = at(image.src.x, k);
            const y = at(image.src.y, k);
            const w = at(image.src.w, k);
            const h = at(image.src.h, k);
            expect(x).toBeLessThanOrEqual(sx + 0.01);
            expect(y).toBeLessThanOrEqual(sy + 0.01);
            expect(x + w).toBeGreaterThanOrEqual(sx + subject.w * lockEntry.widthPx - 0.01);
            expect(y + h).toBeGreaterThanOrEqual(sy + subject.h * lockEntry.heightPx - 0.01);
            expect(x).toBeGreaterThanOrEqual(-0.01);
            expect(x + w).toBeLessThanOrEqual(lockEntry.widthPx + 0.01);
          }
        }
      }
    }
  });
});

describe("[A15] Japanese glyph coverage", () => {
  it("deduplicates shared font fallbacks without reporting an acyclic diamond as a cycle", () => {
    const leaf = registerFont("leaf", []);
    const branch = registerFont("branch", [leaf]);
    const root = registerFont("root", [branch, leaf]);
    const variant = treatmentWithFont(root, "shared-fallback");
    const result = service.compile({ treatment: variant.treatment, chapters });
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    const locked = result.result![0]!.plan.lock.fonts.map((font) => font.id);
    expect(locked.sort()).toEqual([root.id, branch.id, leaf.id].sort());
  });

  it("[A25] rejects a private project font hidden in an organization font fallback", () => {
    const privateFont = registerFont("private", [], { kind: "project", projectId: "another-project" });
    const root = registerFont("organization", [privateFont]);
    const variant = treatmentWithFont(root, "private-fallback");
    for (const result of [
      service.validate({ kind: "film-style-recipe", document: variant.recipe }),
      service.validate({ kind: "film-treatment", document: variant.treatment }),
      service.preflight({ treatment: variant.treatment, chapters }),
      service.compile({ treatment: variant.treatment, chapters }),
    ]) {
      expect(result.ok).toBe(false);
      expect(result.errors.map((error) => error.code)).toContain("FS_FONT_SCOPE");
    }
  });

  it("[A25] a project Treatment cannot reach a different project's font through a fallback", () => {
    const privateFont = registerFont("other-project", [], { kind: "project", projectId: "another-project" });
    const root = registerFont("current-project", [privateFont], { kind: "project", projectId: "sando" });
    const t = treatment("baseline");
    const variant = { ...t, projectFonts: [root], shared: { ...t.shared, typography: root } };
    const result = service.compile({ treatment: variant, chapters });
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual(expect.objectContaining({ code: "FS_FONT_SCOPE", path: "/projectFonts/0/fallback/0" }));
  });

  it("[A15] every caption glyph is covered by the Plan's recorded font chain", () => {
    for (const { plan } of compile(treatment("baseline"))) {
      const manifests = plan.lock.fonts.map((f) => service.registry.manifest<FontAssetManifest>(service.registry.record(f.id, f.version)!));
      const covered = (c: string) => manifests.some((m) => m.coverage.ranges!.some(([lo, hi]) => c.codePointAt(0)! >= lo && c.codePointAt(0)! <= hi));
      expect(plan.texts.length).toBeGreaterThan(0);
      for (const t of plan.texts) {
        for (const ch of t.text.replace(/\s/g, "")) expect(covered(ch), ch).toBe(true);
        for (const alias of t.font) expect(plan.fonts.map((f) => f.alias)).toContain(alias);
      }
    }
  });

  it("[A15] swapping in a Latin-only caption font gives FS_GLYPH_MISSING before any Plan", () => {
    const recipe = readFixture<FilmStyleRecipe>("recipes/test/baseline.r1.json");
    const latin = service.registry.record("font.fixture-latin", "1.0.0")!;
    const latinRef = { id: latin.id, version: latin.version, digest: latin.manifestDigest };
    const variant: FilmStyleRecipe = { ...recipe, id: "org.local.test-latin", fonts: [{ role: "caption", ref: latinRef }, recipe.fonts[1]!] };
    writeJson(`${paths.state}recipes/test-latin.r1.json`, variant);
    const t = treatment("baseline");
    const result = service.compile({
      treatment: { ...t, id: "test-latin", recipe: { id: variant.id, revision: "r1", digest: digestOf(variant) }, shared: { ...t.shared, typography: latinRef } },
      chapters,
    });
    expect(result.ok).toBe(false);
    expect(result.result).toBeUndefined();
    const glyph = result.errors.filter((e) => e.code === "FS_GLYPH_MISSING");
    expect(glyph.length).toBeGreaterThan(0);
    expect(glyph[0]!.path).toMatch(/^\/scenes\/\d+\/caption\/ja$/);
  });
});

describe("[A17] reduced motion", () => {
  function maxSrcStepPerFrame(plan: ResolvedRenderPlan): number {
    let max = 0;
    for (const image of images(plan.layers)) {
      const scale = 1920 / values(image.src.w)[0]!;
      for (const axis of ["x", "y", "w"] as const) {
        const a = image.src[axis];
        if (typeof a === "number") continue;
        for (let k = 1; k < a.keys.length; k += 1) {
          const dt = a.keys[k]!.t - a.keys[k - 1]!.t;
          if (a.keys[k - 1]!.ease === "step" || dt === 0) continue;
          const perFrame = (Math.abs(a.keys[k]!.v - a.keys[k - 1]!.v) * scale) / Math.max(1, (dt * 30) / 1000);
          max = Math.max(max, perFrame);
        }
      }
    }
    return max;
  }

  it("[A17] replaces beat-pulse with static and Level 1 motion with its reduced-motion fallback", () => {
    const pulse = compile(treatment("pulse"), chapters, { reducedMotion: true });
    expect(pulse[0]!.plan.capabilities.find((c) => c.slot === "motion")!.active.id).toBe("film.motion.static");
    const board = compile(treatment("board"), chapters, { reducedMotion: true });
    const active = Object.fromEntries(board[0]!.plan.capabilities.map((c) => [c.slot, c.active.id]));
    expect(active.motion).toBe("film.motion.slow-camera");
    expect(active.transition).toBe("film.transition.dissolve");
    expect(board[0]!.plan.capabilities.find((c) => c.slot === "motion")!.chain).toEqual(["film.motion.parallax-cards@1.0.0", "film.motion.slow-camera@1.0.0"]);
  });

  it("[A17] keeps the frame-to-frame camera change below 1 output pixel", () => {
    for (const name of ["baseline", "board", "pulse"]) {
      for (const { plan } of compile(treatment(name), chapters, { reducedMotion: true })) {
        expect(maxSrcStepPerFrame(plan), name).toBeLessThan(1);
      }
    }
  });
});

describe("fallback resolution and forced Level 0", () => {
  it("preserves both incoming and outgoing transition envelopes on an interior segment", () => {
    const [c1] = compile(treatment("board"));
    const scene = c1!.plan.segments[1]!;
    const group = c1!.plan.layers.find((n) => n.type === "group" && n.startMs === scene.startMs)!;
    const keyTimes = (node: PainterNode): number[] => {
      if (node.type !== "group") return [];
      const own = typeof node.translateX === "object" ? node.translateX.keys.map((k) => k.t) : [];
      return [...own, ...node.children.flatMap(keyTimes)];
    };
    expect(keyTimes(group)).toContain(scene.startMs);
    expect(keyTimes(group)).toContain(c1!.plan.segments[0]!.endMs);
    expect(keyTimes(group)).toContain(c1!.plan.segments[2]!.startMs);
    expect(keyTimes(group)).toContain(scene.endMs);
  });

  it("forceLevel0 activates only Level 0 Capabilities and omits optional effects with a warning", () => {
    for (const name of ["baseline", "board", "pulse"]) {
      for (const { plan } of compile(treatment(name), chapters, { forceLevel0: true })) {
        for (const c of plan.capabilities) {
          const record = service.registry.record(c.active.id, c.active.version)!;
          expect(service.registry.manifest<{ level: number }>(record).level, c.active.id).toBe(0);
        }
        expect(plan.capabilities.some((c) => c.slot.startsWith("effect."))).toBe(false);
        if (name === "baseline") expect(plan.warnings.map((w) => w.code)).toContain("FS_EFFECT_OMITTED");
      }
    }
  });

  it("records every materialized default and the requested-to-active chain in the Plan and lock", () => {
    const [c1] = compile(treatment("board"));
    const sound = c1!.plan.capabilities.find((c) => c.slot === "sound")!;
    expect(sound.params).toEqual({ sfxLevel: 0.5, hits: true });
    const lockIds = c1!.plan.lock.capabilities.map((c) => `${c.id}@${c.version}`);
    expect(lockIds).toContain("film.layout.memory-board@1.0.0");
    expect(c1!.plan.lock.capabilities.every((c) => c.implementationDigest?.startsWith("sha256:"))).toBe(true);
  });
});

describe("fingerprints", () => {
  it("a one-scene duration change invalidates only its Chapter", () => {
    const base = compile(treatment("baseline"));
    const edited = structuredClone(chapters);
    edited.chapters[1]!.scenes[1]!.durationMs = 6500;
    const after = compile(treatment("baseline"), edited);
    expect(after[0]!.plan.fingerprint).toBe(base[0]!.plan.fingerprint);
    expect(after[1]!.plan.fingerprint).not.toBe(base[1]!.plan.fingerprint);
  });

  it("a shared project change invalidates every Chapter", () => {
    const base = compile(treatment("baseline"));
    const t = treatment("baseline");
    const after = compile({ ...t, shared: { ...t.shared, worldview: "A different worldview." } });
    expect(after[0]!.plan.fingerprint).not.toBe(base[0]!.plan.fingerprint);
    expect(after[1]!.plan.fingerprint).not.toBe(base[1]!.plan.fingerprint);
  });
});

describe("concatenation Plan", () => {
  it("runtime is overall title + Σ Chapter runtimes + one 800 ms darken per join; fingerprint follows artifacts", () => {
    const compiled = compile(treatment("baseline"));
    const fake = (n: number) => ({ files: { mp4: { name: "x.mp4", sha256: `sha256:${String(n).repeat(64).slice(0, 64)}`, bytes: 1 }, stem: { name: "x.wav", sha256: `sha256:${"e".repeat(64)}`, bytes: 1 } } });
    const result = service.concatPlan({ treatment: treatment("baseline"), chapters, artifacts: compiled.map((c, i) => ({ plan: c.plan, artifact: fake(i + 1) })) });
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const plan = result.result!;
    const sum = compiled.reduce((a, c) => a + Math.floor((c.proposal.runtimeMs * 30 + 500) / 1000) * 1000 / 30, 0);
    expect(plan.runtimeMs).toBe(plan.overallTitle.titleMs + sum + 800);
    expect(plan.connection).toMatchObject({ ref: { id: "film.connection.darken-briefly", version: "1.0.0" }, darkenMs: 800, brightnessTo: 0.45 });
    expect(plan.chapters.map((c) => c.offsetMs)).toEqual([plan.overallTitle.titleMs, plan.overallTitle.titleMs + Math.floor((compiled[0]!.proposal.runtimeMs * 30 + 500) / 1000) * 1000 / 30 + 800]);
    const changed = service.concatPlan({ treatment: treatment("baseline"), chapters, artifacts: compiled.map((c, i) => ({ plan: c.plan, artifact: fake(i + 3) })) });
    expect(changed.result!.fingerprint).not.toBe(plan.fingerprint);
  });
});
