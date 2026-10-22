// M5: the three system Cuts, Recipe-only variation, bounded Chapter variation, and diversity.
// Compiler checks run on fixture-font forks of the system Recipes in a temporary world. Painter
// checks need CHROME_PATH. The real-font evidence (renders, the evaluator's matching, the clean
// source tree around the fork) is produced by the operator against the local registry and checked
// where it exists, like A24.
import { existsSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { digestOf } from "../contracts/canonical.js";
import type { ResultEnvelope } from "../contracts/envelope.js";
import type { CapabilityManifest, ChapterArtifact, Cut, FilmChapters, FilmStyleRecipe, FilmTreatment, ResolvedRenderPlan } from "../contracts/types.js";
import { defaultPaths } from "../paths.js";
import { openPlan, withBrowser, type PlanPage } from "../render/browser.js";
import { startServer } from "../render/server.js";
import { CUTS, forkCut, systemRecipe, systemTreatment, type CutName } from "../testing/cuts.js";
import { listFixtures, readFixture } from "../testing/fixtures.js";
import { contrast, hexLuminance, luminances, mean, percentile, pngRgb } from "../testing/media.js";
import { createWorld } from "../testing/world.js";
import { differingMetrics, grammarMetrics } from "./grammar.js";

const CHROME = !!process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH);
const MINUTE = 60_000;
const chapters = readFixture<FilmChapters>("project/chapters.json");
const world = createWorld({ liveEnvironment: CHROME });
const { service, paths } = world;

function ok<T>(env: ResultEnvelope<T>): T {
  expect(env.errors).toEqual([]);
  return env.result!;
}

function compile(treatment: FilmTreatment, options = {}, outName?: string): ResolvedRenderPlan[] {
  return ok(service.compile({ treatment, chapters, options, ...(outName ? { write: true, outName } : {}) })).map((c) => c.plan);
}

const NO_SURFACE = { slots: { surface: { id: "film.surface.no-surface", version: "1.0.0" } }, effects: [] };
const cuts = Object.fromEntries(CUTS.map((name) => [name, forkCut(world, name, `org.local.${name}-fixture`)])) as Record<CutName, ReturnType<typeof forkCut>>;

describe("three system Cuts", () => {
  it("[A23] each Treatment shares one identity across Chapters and varies only allowlisted fields within bounds", () => {
    for (const name of CUTS) {
      const recipe = systemRecipe(name);
      const treatment = systemTreatment(name);
      expect(ok(service.validate({ kind: "film-style-recipe", document: recipe }))).toEqual({ valid: true });
      expect(ok(service.validate({ kind: "film-treatment", document: treatment }))).toEqual({ valid: true });
      expect(recipe.chapterAllowlist.map((a) => a.field)).toEqual(["pacing", "motionAmount", "emphasis", "sfxLevel", "visualIntensity"]);
      expect(recipe.chapterAllowlist.every((a) => a.min <= a.max)).toBe(true);

      // One Cut per Chapter; each is valid against the Treatment's Recipe and is the Chapter's state.
      const own = listFixtures("project/cuts").map((f) => readFixture<Cut>(f)).filter((c) => c.treatment.id === treatment.id);
      expect(own.map((c) => c.chapterId).sort()).toEqual(["c1", "c2"]);
      for (const cut of own) {
        expect(ok(service.validate({ kind: "cut", document: cut }))).toEqual({ valid: true });
        expect(treatment.chapters.find((c) => c.chapterId === cut.chapterId)!.settings).toEqual(cut.settings);
      }

      // The Chapters differ, but only in allowlisted Chapter settings.
      const [c1, c2] = compile(cuts[name].treatment);
      expect(treatment.chapters[0]!.settings).not.toEqual(treatment.chapters[1]!.settings);
      expect(c2!.shared).toEqual(c1!.shared);
      expect(c2!.audio.bgm).toMatchObject({ asset: c1!.audio.bgm.asset, sha256: c1!.audio.bgm.sha256, gain: c1!.audio.bgm.gain });
      expect(c2!.fonts).toEqual(c1!.fonts);
      expect(c2!.lock.capabilities).toEqual(c1!.lock.capabilities);
      const allowed = new Set<string>(recipe.chapterAllowlist.map((a) => a.field));
      c1!.capabilities.forEach((s, i) => {
        const other = c2!.capabilities[i]!;
        expect(other.active).toEqual(s.active);
        const changed = Object.keys(s.params).filter((k) => s.params[k] !== other.params[k]);
        expect(changed.filter((k) => !allowed.has(k))).toEqual([]);
      });
    }
  });

  it("[A23] a Chapter override outside the Recipe's allowlist bounds or fields is rejected", () => {
    const treatment = systemTreatment("quiet-cinema");
    const max = systemRecipe("quiet-cinema").chapterAllowlist.find((a) => a.field === "motionAmount")!.max;
    const tooMuch = structuredClone(treatment);
    tooMuch.chapters[1]!.settings.motionAmount = max + 0.1;
    const env = service.validate({ kind: "film-treatment", document: tooMuch });
    expect(env.errors.map((e) => [e.code, e.path])).toEqual([["FS_SEMANTIC_INVALID", "/chapters/1/settings/motionAmount"]]);

    const cut = structuredClone(readFixture<Cut>("project/cuts/quiet-cinema.c2.json"));
    cut.settings.motionAmount = max + 0.1;
    expect(service.validate({ kind: "cut", document: cut }).errors.map((e) => [e.code, e.path])).toEqual([["FS_SEMANTIC_INVALID", "/settings/motionAmount"]]);

    const transition = structuredClone(treatment) as unknown as { chapters: { settings: Record<string, unknown> }[] };
    transition.chapters[1]!.settings.transition = "film.transition.direct-cut";
    expect(new Set(service.validate({ kind: "film-treatment", document: transition }).errors.map((e) => e.code))).toEqual(new Set(["FS_SCHEMA_INVALID"]));
  });

  it("[A22] recipe fork creates an organization Recipe with another typography Capability and font, and it compiles", () => {
    const changes = {
      slots: {
        typography: { id: "film.typography.editorial-note", version: "1.1.0" },
        transition: { id: "film.transition.dip", version: "1.0.0" },
        surface: { id: "film.surface.paper-tone", version: "1.0.0" },
      },
      fonts: { caption: { id: "font.fixture-sans-jp", version: "1.0.0" }, title: { id: "font.fixture-sans-jp", version: "1.0.0" } },
    };
    const source = { id: "system.quiet-cinema", revision: "r1" };
    const dry = service.recipeFork({ source, id: "org.local.quiet-editorial", ...changes });
    expect(dry.dryRun).toBe(true);
    expect(dry.mutations).toEqual([]);
    expect(existsSync(`${paths.state}recipes/org.local.quiet-editorial.r1.json`)).toBe(false);

    const { recipe, treatment } = forkCut(world, "quiet-cinema", "org.local.quiet-editorial", changes);
    expect(recipe).toMatchObject({ scope: "organization", lineage: { forkedFrom: { ...source, digest: digestOf(systemRecipe("quiet-cinema")) } } });
    expect(service.recipeFork({ source, id: "org.local.quiet-editorial", ...changes, dryRun: false }).mutations).toEqual([]);
    const collision = service.recipeFork({ source, id: "org.local.quiet-editorial", ...changes, title: "Another title", dryRun: false });
    expect(collision.errors.map((e) => [e.code, e.owner])).toEqual([["FS_VERSION_COLLISION", "recipe-author"]]);
    expect(service.recipeFork({ source, id: "system.quiet-editorial", ...changes }).errors.map((e) => e.code)).toEqual(["FS_SEMANTIC_INVALID"]);

    const [c1] = compile(treatment);
    const slot = (s: string) => c1!.capabilities.find((c) => c.slot === s)!.active;
    expect(slot("typography")).toEqual({ id: "film.typography.editorial-note", version: "1.1.0" });
    expect(slot("transition")).toEqual({ id: "film.transition.dip", version: "1.0.0" });
    expect(slot("surface")).toEqual({ id: "film.surface.paper-tone", version: "1.0.0" });
    expect(c1!.lock.fonts.map((f) => f.id)).toEqual(["font.fixture-sans-jp"]);
    expect(c1!.provenance.recipe).toEqual(treatment.recipe);
  });

  it("[A22] a font-family string fails the Recipe schema and a Latin-only caption font fails preflight on Japanese glyphs", () => {
    const named = structuredClone(systemRecipe("quiet-cinema")) as unknown as { fonts: { ref: unknown }[] };
    named.fonts[0]!.ref = "Noto Sans JP";
    expect(new Set(service.validate({ kind: "film-style-recipe", document: named }).errors.map((e) => e.code))).toEqual(new Set(["FS_SCHEMA_INVALID"]));
    const family = { ...systemRecipe("quiet-cinema"), fontFamily: "Noto Sans JP" };
    expect(new Set(service.validate({ kind: "film-style-recipe", document: family }).errors.map((e) => e.code))).toEqual(new Set(["FS_SCHEMA_INVALID"]));

    // font.fixture-latin stands in for Cormorant Garamond: promoted, Latin-only.
    const latin = { id: "font.fixture-latin", version: "1.0.0" };
    const { treatment } = forkCut(world, "quiet-cinema", "org.local.quiet-latin", { fonts: { caption: latin, title: latin } });
    const env = service.preflight({ treatment, chapters });
    expect(new Set(env.errors.map((e) => e.code))).toEqual(new Set(["FS_GLYPH_MISSING"]));
    expect(env.errors.some((e) => e.path.endsWith("/caption/ja"))).toBe(true);
  });

  it("[A21] the three Cuts differ on at least three grammar metrics with no surface and no effects, from one compiler and painter", () => {
    const plans = CUTS.map((name) => {
      const { treatment } = forkCut(world, name, `org.local.${name}-eval`, NO_SURFACE);
      const compiled = compile(treatment);
      for (const plan of compiled) {
        expect(plan.capabilities.find((c) => c.slot === "surface")!.active.id).toBe("film.surface.no-surface");
        expect(plan.capabilities.some((c) => c.slot.startsWith("effect."))).toBe(false);
      }
      return compiled;
    });
    const metrics = plans.map((p) => grammarMetrics(p));
    console.info("[A21] grammar", JSON.stringify(Object.fromEntries(CUTS.map((n, i) => [n, metrics[i]]))));
    for (let i = 0; i < 3; i += 1) {
      for (let j = i + 1; j < 3; j += 1) expect(differingMetrics(metrics[i]!, metrics[j]!).length, `${CUTS[i]} vs ${CUTS[j]}`).toBeGreaterThanOrEqual(3);
    }
    const all = plans.flat();
    expect(new Set(all.map((p) => JSON.stringify([p.lock.compiler, p.lock.painter]))).size).toBe(1);
  });

  it("[A18] forced Level 0 keeps every scene, title, and caption of all three Cuts using only Level 0 Capabilities", () => {
    for (const name of CUTS) {
      const plans = compile(cuts[name].treatment, { forceLevel0: true }, `${name}-level0`);
      for (const plan of plans) {
        for (const s of plan.capabilities) {
          const record = service.registry.record(s.active.id, s.active.version)!;
          expect(service.registry.manifest<CapabilityManifest>(record).level, `${name} ${s.active.id}`).toBe(0);
        }
        const chapter = chapters.chapters[plan.chapter.index]!;
        expect(plan.segments.map((s) => s.sceneId)).toEqual([null, ...chapter.scenes.map((s) => s.sceneId)]);
        expect(plan.texts.filter((t) => t.role === "title").map((t) => t.text)).toEqual([chapter.title]);
        const graph = readFixture<{ scenes: { id: string; caption: { ja: string; en: string } }[] }>("project/story-graph.json");
        for (const [i, s] of chapter.scenes.entries()) {
          const caption = graph.scenes.find((g) => g.id === s.sceneId)!.caption;
          const own = plan.texts.filter((t) => t.segment === i + 1 && t.role === "caption").map((t) => t.text.toLowerCase());
          expect(own).toEqual([caption.ja, caption.en].map((t) => t.toLowerCase()));
        }
      }
    }
  });
});

describe.skipIf(!CHROME)("three system Cuts in the painter", () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    for (const name of CUTS) {
      compile(cuts[name].treatment, {}, name);
      compile(cuts[name].treatment, { forceLevel0: true }, `${name}-level0`);
    }
    server = await startServer(paths);
  });
  afterAll(async () => server?.close());

  const pages = (name: string, fn: (page: PlanPage, plan: ResolvedRenderPlan) => Promise<void>) =>
    withBrowser(async (browser) => {
      for (const id of ["c1", "c2"]) {
        const plan = JSON.parse(readFileSync(`${paths.out}plans/${name}/${id}.plan.json`, "utf8")) as ResolvedRenderPlan;
        await fn(await openPlan(browser, server.origin, `plans/${name}/${id}.plan.json`), plan);
      }
    });

  it("[A18] the painter draws the title and both captions of every scene in each forced Level 0 Chapter", async () => {
    for (const name of CUTS) {
      await pages(`${name}-level0`, async (page, plan) => {
        for (const [i, seg] of plan.segments.entries()) {
          const drawn = await page.draw((seg.startMs + seg.endMs) / 2);
          const expected = plan.texts.filter((t) => t.segment === i).map((t) => [t.role, t.text]);
          for (const e of expected) expect(drawn.map((t) => [t.role, t.text]), `${name} ${plan.chapter.id} segment ${i}`).toContainEqual(e);
        }
      });
    }
  }, 5 * MINUTE);

  it("[A14] every caption of the three Cuts meets 4.5:1 against its sampled backing and sits inside the 90% title-safe area", async () => {
    const results: { cut: string; chapter: string; text: string; p95: number }[] = [];
    for (const name of CUTS) {
      await pages(name, async (page, plan) => {
        for (const w of plan.texts.filter((t) => t.role === "caption")) {
          const t = (w.startMs + w.endMs) / 2;
          const caption = (await page.draw(t)).find((m) => m.role === "caption" && m.text === w.text)!;
          expect(caption, w.text).toBeDefined();
          const b = caption.box;
          expect(b.x >= 96 && b.y >= 54 && b.x + b.w <= 1824 && b.y + b.h <= 1026, `${name} ${w.text}`).toBe(true);
          const backing = luminances(await pngRgb(await page.frame(t, { omitRoles: ["caption"] }), b));
          const text = hexLuminance(caption.color);
          const worst = text > mean(backing) ? percentile(backing, 95) : percentile(backing, 5);
          results.push({ cut: name, chapter: plan.chapter.id, text: w.text, p95: contrast(text, worst) });
        }
      });
    }
    console.info("[A14] Cut caption contrast min", Object.fromEntries(CUTS.map((n) => [n, Math.min(...results.filter((r) => r.cut === n).map((r) => r.p95)).toFixed(2)])));
    expect(results.filter((r) => r.p95 < 4.5).map((r) => `${r.cut} ${r.chapter} ${r.text}: ${r.p95.toFixed(2)}:1`)).toEqual([]);
  }, 5 * MINUTE);
});

// Operator evidence from the local registry (real fonts); see the spike README, "Three Cuts".
const local = defaultPaths();
const evidence = (file: string) => `${local.out}evidence/${file}`;

describe("local M5 evidence", () => {
  it.skipIf(!existsSync(evidence("recipe-variation.json")))("[A22] the forked Recipe rendered with no change under src or schemas", () => {
    const record = JSON.parse(readFileSync(evidence("recipe-variation.json"), "utf8")) as {
      gitStatusBefore: string;
      gitStatusAfter: string;
      recipe: { id: string; revision: string; digest: string };
      chapters: string[];
    };
    expect(record.gitStatusBefore).toBe("");
    expect(record.gitStatusAfter).toBe("");
    const recipe = JSON.parse(readFileSync(`${local.state}recipes/${record.recipe.id}.${record.recipe.revision}.json`, "utf8")) as FilmStyleRecipe;
    expect(digestOf(recipe)).toBe(record.recipe.digest);
    expect(recipe.lineage?.forkedFrom.id).toBe("system.quiet-cinema");
    const typography = recipe.capabilities.find((c) => c.slot === "typography")!.ref.id;
    expect(typography).not.toBe(systemRecipe("quiet-cinema").capabilities.find((c) => c.slot === "typography")!.ref.id);
    expect(recipe.fonts.map((f) => f.ref.id)).not.toEqual(systemRecipe("quiet-cinema").fonts.map((f) => f.ref.id));
    expect(record.chapters).toEqual(["c1", "c2"]);
    for (const id of record.chapters) {
      const meta = JSON.parse(readFileSync(`${local.out}artifacts/quiet-editorial/${id}.json`, "utf8")) as ChapterArtifact;
      expect(meta).toMatchObject({ verified: true, recipe: record.recipe });
    }
  });

  it.skipIf(!existsSync(evidence("diversity-review.json")))("[A21] the independent evaluator matched every grayscale sheet to its Cut", () => {
    const review = JSON.parse(readFileSync(evidence("diversity-review.json"), "utf8")) as {
      evaluator: { kind: string; recipesVisible: boolean };
      matches: { sheet: string; cut: string }[];
    };
    const key = JSON.parse(readFileSync(evidence("diversity/key.json"), "utf8")) as Record<string, string>;
    expect(review.evaluator.recipesVisible).toBe(false);
    expect(review.matches.map((m) => m.sheet).sort()).toEqual(Object.keys(key).sort());
    expect(new Set(review.matches.map((m) => m.cut)).size).toBe(3);
    for (const m of review.matches) expect(m.cut, `sheet ${m.sheet}`).toBe(key[m.sheet]);
  });
});
