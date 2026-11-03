// Compatibility and safety-fallback resolution. Pure: the caller passes exact, already
// digest-verified registry entries; nothing here reads the registry or the filesystem.
import { filmError, FilmFailure, type FilmError } from "../contracts/errors.js";
import type { CapabilityFunction } from "../capability-sdk/abi.js";
import type {
  CapabilityManifest,
  ChapterSettings,
  FilmStyleRecipe,
  ParamSpec,
  ParamValue,
  RegistryRecord,
} from "../contracts/types.js";

export interface CatalogEntry {
  record: RegistryRecord;
  manifest: CapabilityManifest;
  run: CapabilityFunction;
}

export interface Catalog {
  get(id: string, version: string): CatalogEntry | undefined;
}

export interface ResolveOptions {
  forceLevel0: boolean;
  reducedMotion: boolean;
  profile: string;
}

export interface ResolvedSlot {
  slot: string;
  requested: CatalogEntry;
  active: CatalogEntry;
  chain: CatalogEntry[];
  params: Record<string, ParamValue>;
}

export interface Resolution {
  slots: ResolvedSlot[]; // required slots in REQUIRED_SLOTS order of the Recipe
  effects: ResolvedSlot[]; // optional effects that remain active
  omitted: string[]; // optional effects dropped by forceLevel0
}

const key = (m: { id: string; version: string }) => `${m.id}@${m.version}`;

/** The validated safety-fallback chain from `entry` to its Level 0 end. */
export function fallbackChain(
  entry: CatalogEntry,
  catalog: Catalog,
  path: string,
): CatalogEntry[] {
  const chain = [entry];
  let node = entry;
  while (node.manifest.level !== 0) {
    const edge = node.manifest.fallback;
    if (!edge) {
      if (node === entry && entry.manifest.kind === "effect") return chain; // optional, may be omitted
      const code =
        node === entry ? "FS_FALLBACK_MISSING" : "FS_FALLBACK_NOT_LEVEL0";
      throw new FilmFailure([
        filmError(
          code,
          path,
          `${key(node.manifest)} has no safety-fallback edge toward Level 0`,
          { chain: chain.map((c) => key(c.manifest)) },
        ),
      ]);
    }
    const next = catalog.get(edge.id, edge.version);
    if (!next) {
      throw new FilmFailure([
        filmError(
          "FS_FALLBACK_MISSING",
          path,
          `fallback ${key(edge)} of ${key(node.manifest)} is not registered`,
        ),
      ]);
    }
    if (chain.some((c) => key(c.manifest) === key(next.manifest))) {
      throw new FilmFailure([
        filmError(
          "FS_FALLBACK_CYCLE",
          path,
          `fallback cycle: ${[...chain, next].map((c) => key(c.manifest)).join(" -> ")}`,
        ),
      ]);
    }
    if (next.manifest.kind !== entry.manifest.kind) {
      throw new FilmFailure([
        filmError(
          "FS_FALLBACK_NOT_LEVEL0",
          path,
          `fallback ${key(edge)} is not a ${entry.manifest.kind}`,
        ),
      ]);
    }
    chain.push(next);
    node = next;
  }
  return chain;
}

function selectActive(
  chain: CatalogEntry[],
  options: ResolveOptions,
): CatalogEntry | null {
  const end = chain.at(-1)!;
  if (options.forceLevel0) return end.manifest.level === 0 ? end : null;
  if (options.reducedMotion)
    return chain.find((c) => c.manifest.reducedMotion !== "fallback") ?? end;
  return chain[0]!;
}

function checkValue(spec: ParamSpec, value: ParamValue): string | null {
  switch (spec.type) {
    case "boolean":
      return typeof value === "boolean" ? null : "expects a boolean";
    case "enum":
      return typeof value === "string" && spec.values?.includes(value)
        ? null
        : `expects one of ${spec.values?.join(", ")}`;
    default:
      if (typeof value !== "number") return "expects a number";
      if (spec.type === "integer" && !Number.isInteger(value))
        return "expects an integer";
      if (
        (spec.min !== undefined && value < spec.min) ||
        (spec.max !== undefined && value > spec.max)
      )
        return `must be within [${spec.min}, ${spec.max}]`;
      return null;
  }
}

function recipeParamErrors(
  recipe: FilmStyleRecipe,
  catalog: Catalog,
): FilmError[] {
  const errors: FilmError[] = [];
  const refs = [...recipe.capabilities.map((c) => c.ref), ...recipe.effects];
  for (const [capId, values] of Object.entries(recipe.params)) {
    const ref = refs.find((r) => r.id === capId);
    const manifest = ref
      ? catalog.get(ref.id, ref.version)?.manifest
      : undefined;
    if (!manifest) continue;
    for (const [name, value] of Object.entries(values)) {
      const path = `/params/${capId}/${name}`;
      const spec = manifest.params[name];
      if (!spec)
        errors.push(
          filmError(
            "FS_SEMANTIC_INVALID",
            path,
            `${capId} has no parameter ${name}`,
          ),
        );
      else if (spec.authority === "compiler-only")
        errors.push(
          filmError("FS_SEMANTIC_INVALID", path, `${name} is compiler-only`),
        );
      else {
        const problem = checkValue(spec, value);
        if (problem)
          errors.push(
            filmError("FS_SEMANTIC_INVALID", path, `${name} ${problem}`),
          );
      }
    }
  }
  return errors;
}

function materialize(
  entry: CatalogEntry,
  recipe: FilmStyleRecipe,
  settings: ChapterSettings,
): Record<string, ParamValue> {
  const params: Record<string, ParamValue> = {};
  for (const [name, spec] of Object.entries(entry.manifest.params)) {
    let value: ParamValue = spec.default;
    const fromRecipe = recipe.params[entry.manifest.id]?.[name];
    if (fromRecipe !== undefined) value = fromRecipe;
    const fromChapter = (settings as Record<string, number | undefined>)[name];
    if (
      fromChapter !== undefined &&
      spec.scope !== "project" &&
      typeof value === "number"
    ) {
      value = Math.min(
        spec.max ?? fromChapter,
        Math.max(spec.min ?? fromChapter, fromChapter),
      );
    }
    params[name] = value;
  }
  return params;
}

export function resolveRecipe(
  recipe: FilmStyleRecipe,
  catalog: Catalog,
  options: ResolveOptions,
  settings: ChapterSettings = {},
): Resolution {
  const errors: FilmError[] = [];
  const resolveRef = (
    slot: string,
    ref: { id: string; version: string },
    path: string,
  ): ResolvedSlot | null => {
    const requested = catalog.get(ref.id, ref.version);
    if (!requested) {
      errors.push(
        filmError(
          "FS_NOT_PROMOTED",
          path,
          `${key(ref)} is not a promoted registry entry`,
        ),
      );
      return null;
    }
    try {
      const chain = fallbackChain(requested, catalog, path);
      const active = selectActive(chain, options);
      if (!active) return null;
      return {
        slot,
        requested,
        active,
        chain: chain.slice(0, chain.indexOf(active) + 1),
        params: materialize(active, recipe, settings),
      };
    } catch (error) {
      if (error instanceof FilmFailure) errors.push(...error.errors);
      else throw error;
      return null;
    }
  };

  const slots = recipe.capabilities.map((c, i) =>
    resolveRef(c.slot, c.ref, `/capabilities/${i}/ref`),
  );
  const effects = recipe.effects.map((e, i) =>
    resolveRef(`effect.${i}`, e, `/effects/${i}`),
  );
  errors.push(...recipeParamErrors(recipe, catalog));
  if (errors.length) throw new FilmFailure(errors);

  const omitted = recipe.effects
    .filter((_, i) => effects[i] === null)
    .map((e) => key(e));
  const active = [...slots, ...effects].filter(
    (s): s is ResolvedSlot => s !== null,
  );
  const activeIds = new Set(active.map((s) => s.active.manifest.id));
  for (const s of active) {
    const m = s.active.manifest;
    const path = s.slot.startsWith("effect.")
      ? `/effects/${s.slot.slice(7)}`
      : `/capabilities/${recipe.capabilities.findIndex((c) => c.slot === s.slot)}/ref`;
    for (const required of m.requires) {
      if (!activeIds.has(required))
        errors.push(
          filmError(
            "FS_COMPAT_CONFLICT",
            path,
            `${key(m)} requires ${required}`,
          ),
        );
    }
    for (const other of m.incompatibleWith) {
      if (activeIds.has(other))
        errors.push(
          filmError(
            "FS_COMPAT_CONFLICT",
            path,
            `${key(m)} is incompatible with ${other}`,
          ),
        );
    }
    if (!m.profiles.includes(options.profile))
      errors.push(
        filmError(
          "FS_COMPAT_CONFLICT",
          path,
          `${key(m)} does not support profile ${options.profile}`,
        ),
      );
    if (!m.aspectRatios.includes("16:9"))
      errors.push(
        filmError(
          "FS_COMPAT_CONFLICT",
          path,
          `${key(m)} does not support a 16:9 frame`,
        ),
      );
    if (
      (m.kind === "layout" || m.kind === "motion") &&
      (m.media.min > 1 || m.media.max < 1)
    ) {
      errors.push(
        filmError(
          "FS_COMPAT_CONFLICT",
          path,
          `${key(m)} needs ${m.media.min}-${m.media.max} images per scene; scenes have 1`,
        ),
      );
    }
  }
  if (errors.length) throw new FilmFailure(errors);
  return {
    slots: slots as ResolvedSlot[],
    effects: effects.filter((s): s is ResolvedSlot => s !== null),
    omitted,
  };
}
