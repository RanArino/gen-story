import { describe, expect, it } from "vitest";
import type { CapabilityFunction } from "../capability-sdk/abi.js";
import { FilmFailure } from "../contracts/errors.js";
import type { CapabilityManifest, FilmStyleRecipe, RegistryRecord } from "../contracts/types.js";
import { readFixture } from "../testing/fixtures.js";
import { resolveRecipe, type Catalog, type CatalogEntry } from "./resolve.js";

const template = readFixture<CapabilityManifest>("valid/capability-manifest.json");
const noop: CapabilityFunction = () => ({ layers: [], audio: [] });
const DIGEST = `sha256:${"1".repeat(64)}`;

function entry(kind: string, name: string, level: 0 | 1, fallback: string | null, extra: Partial<CapabilityManifest> = {}): CatalogEntry {
  const id = `film.${kind}.${name}`;
  const manifest = {
    ...template,
    id,
    kind,
    level,
    reducedMotion: "same",
    media: kind === "layout" || kind === "motion" ? { types: ["image"], min: 1, max: 1 } : { types: [], min: 0, max: 0 },
    fallback: fallback ? { id: `film.${kind}.${fallback}`, version: "1.0.0" } : null,
    params: {},
    ...extra,
  } as CapabilityManifest;
  return { manifest, run: noop, record: { manifestDigest: DIGEST, implementationDigest: DIGEST, assetDigests: [] } as unknown as RegistryRecord };
}

function catalogOf(entries: CatalogEntry[]): Catalog {
  const map = new Map(entries.map((e) => [`${e.manifest.id}@${e.manifest.version}`, e]));
  return { get: (id, version) => map.get(`${id}@${version}`) };
}

const base = [
  entry("layout", "full", 0, null),
  entry("motion", "still", 0, null),
  entry("transition", "cut", 0, null),
  entry("typography", "plain", 0, null),
  entry("sound", "quiet", 0, null),
  entry("surface", "none", 0, null),
];

function recipeWith(slots: Record<string, string>, effects: string[] = []): FilmStyleRecipe {
  const recipe = readFixture<FilmStyleRecipe>("valid/film-style-recipe.json");
  const names: Record<string, string> = { layout: "full", motion: "still", transition: "cut", typography: "plain", sound: "quiet", surface: "none", ...slots };
  return {
    ...recipe,
    params: {},
    capabilities: Object.entries(names).map(([slot, name]) => ({ slot: slot as never, ref: { id: `film.${slot}.${name}`, version: "1.0.0", digest: DIGEST } })),
    effects: effects.map((e) => ({ id: `film.effect.${e}`, version: "1.0.0", digest: DIGEST })),
  };
}

function codes(fn: () => unknown): string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof FilmFailure) return error.errors.map((e) => e.code);
    throw error;
  }
  return [];
}

const options = { forceLevel0: false, reducedMotion: false, profile: "landscape-1080p30@1" };

describe("compatibility and fallback resolver", () => {
  it("materializes the chain and selects Level 0 under forceLevel0", () => {
    const catalog = catalogOf([...base, entry("layout", "board", 1, "full")]);
    const normal = resolveRecipe(recipeWith({ layout: "board" }), catalog, options);
    expect(normal.slots[0]!.active.manifest.id).toBe("film.layout.board");
    expect(normal.slots[0]!.chain.map((c) => c.manifest.id)).toEqual(["film.layout.board"]);
    const forced = resolveRecipe(recipeWith({ layout: "board" }), catalog, { ...options, forceLevel0: true });
    expect(forced.slots[0]!.chain.map((c) => c.manifest.id)).toEqual(["film.layout.board", "film.layout.full"]);
  });

  it("rejects a Level 1 Capability without an edge (FS_FALLBACK_MISSING)", () => {
    expect(codes(() => resolveRecipe(recipeWith({ layout: "lonely" }), catalogOf([...base, entry("layout", "lonely", 1, null)]), options))).toEqual(["FS_FALLBACK_MISSING"]);
    expect(codes(() => resolveRecipe(recipeWith({ layout: "dangling" }), catalogOf([...base, entry("layout", "dangling", 1, "gone")]), options))).toEqual(["FS_FALLBACK_MISSING"]);
  });

  it("rejects cycles (FS_FALLBACK_CYCLE) and chains that end above Level 0 (FS_FALLBACK_NOT_LEVEL0)", () => {
    const cycle = catalogOf([...base, entry("layout", "a", 1, "b"), entry("layout", "b", 1, "a")]);
    expect(codes(() => resolveRecipe(recipeWith({ layout: "a" }), cycle, options))).toEqual(["FS_FALLBACK_CYCLE"]);
    const stuck = catalogOf([...base, entry("layout", "a", 1, "b"), entry("layout", "b", 1, null)]);
    expect(codes(() => resolveRecipe(recipeWith({ layout: "a" }), stuck, options))).toEqual(["FS_FALLBACK_NOT_LEVEL0"]);
  });

  it("enforces requires and incompatibleWith on the active set (FS_COMPAT_CONFLICT)", () => {
    const needsFull = entry("motion", "needs-full", 0, null, { requires: ["film.layout.full"] });
    const hatesFull = entry("motion", "hates-full", 0, null, { incompatibleWith: ["film.layout.full"] });
    const catalog = catalogOf([...base, entry("layout", "board", 1, "full"), needsFull, hatesFull]);
    expect(codes(() => resolveRecipe(recipeWith({ layout: "board", motion: "needs-full" }), catalog, options))).toEqual(["FS_COMPAT_CONFLICT"]);
    expect(resolveRecipe(recipeWith({ layout: "board", motion: "needs-full" }), catalog, { ...options, forceLevel0: true }).slots).toHaveLength(6);
    expect(codes(() => resolveRecipe(recipeWith({ motion: "hates-full" }), catalog, options))).toEqual(["FS_COMPAT_CONFLICT"]);
  });

  it("rejects unsupported profiles and unregistered references", () => {
    const narrow = entry("surface", "narrow", 0, null, { aspectRatios: ["9:16"] });
    expect(codes(() => resolveRecipe(recipeWith({ surface: "narrow" }), catalogOf([...base, narrow]), options))).toEqual(["FS_COMPAT_CONFLICT"]);
    expect(codes(() => resolveRecipe(recipeWith({ surface: "missing" }), catalogOf(base), options))).toEqual(["FS_NOT_PROMOTED"]);
  });

  it("omits an optional effect without a Level 0 end only under forceLevel0", () => {
    const catalog = catalogOf([...base, entry("effect", "glow", 1, null)]);
    expect(resolveRecipe(recipeWith({}, ["glow"]), catalog, options).effects).toHaveLength(1);
    const forced = resolveRecipe(recipeWith({}, ["glow"]), catalog, { ...options, forceLevel0: true });
    expect(forced.effects).toHaveLength(0);
    expect(forced.omitted).toEqual(["film.effect.glow@1.0.0"]);
  });

  it("validates Recipe parameters against the requested Manifest", () => {
    const withParam = entry("transition", "fade", 0, null, {
      params: { curve: { type: "enum", default: "linear", values: ["linear"], scope: "project", authority: "user-exposable", description: "Curve." } },
    });
    const recipe = { ...recipeWith({ transition: "fade" }), params: { "film.transition.fade": { curve: "bouncy", speed: 2 } } };
    expect(codes(() => resolveRecipe(recipe, catalogOf([...base, withParam]), options))).toEqual(["FS_SEMANTIC_INVALID", "FS_SEMANTIC_INVALID"]);
  });
});
