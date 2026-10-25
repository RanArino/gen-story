// Cross-field rules that JSON Schema cannot express. They run only after schema validation passed.
import { filmError, type FilmError } from "./errors.js";
import { schemaId, validateSchema, type SchemaKind } from "./schemas.js";
import {
  CAPABILITY_KINDS,
  REQUIRED_SLOTS,
  type CapabilityManifest,
  type ChapterSettings,
  type Cut,
  type FilmChapters,
  type FilmStyleRecipe,
  type FilmTreatment,
  type FontAssetManifest,
  type StoryGraph,
  type VersionRef,
} from "./types.js";

export interface SemanticContext {
  storyGraph?: StoryGraph;
  /** The Recipe a Treatment or Cut is bound to. */
  recipe?: FilmStyleRecipe;
  /** Looks up a Font Asset Manifest by exact id and version (registry or fixtures). */
  font?: (ref: VersionRef) => FontAssetManifest | undefined;
}

export function kindOfCapabilityId(id: string): string | undefined {
  const kind = id.split(".")[1];
  return CAPABILITY_KINDS.find((k) => k === kind);
}

/** Indexes of values that repeat an earlier value; the first occurrence is not reported. */
function repeats<T>(values: T[]): Set<number> {
  const seen = new Set<T>();
  const out = new Set<number>();
  values.forEach((v, i) => (seen.has(v) ? out.add(i) : seen.add(v)));
  return out;
}

function semantic(path: string, message: string): FilmError {
  return filmError("FS_SEMANTIC_INVALID", path, message);
}

function storyGraphRules(graph: StoryGraph): FilmError[] {
  const errors: FilmError[] = [];
  const dupScenes = repeats(graph.scenes.map((s) => s.id));
  graph.scenes.forEach((s, i) => {
    if (dupScenes.has(i)) errors.push(semantic(`/scenes/${i}/id`, `scene id ${s.id} is not unique`));
    const claim = s.caption.claim;
    if (!claim) return;
    const fact = graph.facts.find((f) => f.id === claim.factId);
    if (!fact) errors.push(semantic(`/scenes/${i}/caption/claim/factId`, `claim cites unknown fact ${claim.factId}`));
    else if (!fact.confirmed) errors.push(semantic(`/scenes/${i}/caption/claim/factId`, `claim cites unconfirmed fact ${claim.factId}`));
  });
  return errors;
}

function chaptersRules(doc: FilmChapters, ctx: SemanticContext): FilmError[] {
  const errors: FilmError[] = [];
  const dupChapters = repeats(doc.chapters.map((c) => c.id));
  const placed = new Set<string>();
  doc.chapters.forEach((c, ci) => {
    if (dupChapters.has(ci)) errors.push(semantic(`/chapters/${ci}/id`, `chapter id ${c.id} is not unique`));
    c.scenes.forEach((s, si) => {
      const path = `/chapters/${ci}/scenes/${si}/sceneId`;
      if (placed.has(s.sceneId)) errors.push(semantic(path, `scene ${s.sceneId} is placed in more than one position`));
      placed.add(s.sceneId);
      if (ctx.storyGraph && !ctx.storyGraph.scenes.some((g) => g.id === s.sceneId)) {
        errors.push(semantic(path, `scene ${s.sceneId} is not in the Story Graph`));
      }
    });
  });
  if (ctx.storyGraph && (ctx.storyGraph.id !== doc.storyGraph.id || ctx.storyGraph.revision !== doc.storyGraph.revision)) {
    errors.push(semantic("/storyGraph", "chapters reference a different Story Graph revision"));
  }
  return errors;
}

function manifestRules(m: CapabilityManifest): FilmError[] {
  const errors: FilmError[] = [];
  if (kindOfCapabilityId(m.id) !== m.kind) errors.push(semantic("/kind", `kind ${m.kind} does not match id ${m.id}`));
  if (m.fallback && kindOfCapabilityId(m.fallback.id) !== m.kind) {
    errors.push(semantic("/fallback/id", "a safety-fallback edge must point to the same kind"));
  }
  if (m.media.min > m.media.max) errors.push(semantic("/media", "media.min exceeds media.max"));
  for (const [name, p] of Object.entries(m.params)) {
    const path = `/params/${name}`;
    if (p.type === "enum") {
      if (!p.values?.includes(String(p.default))) errors.push(semantic(`${path}/default`, "enum default is not one of values"));
    } else if (p.type === "boolean") {
      if (typeof p.default !== "boolean") errors.push(semantic(`${path}/default`, "boolean default expected"));
    } else {
      if (typeof p.default !== "number") errors.push(semantic(`${path}/default`, "numeric default expected"));
      else if ((p.min !== undefined && p.default < p.min) || (p.max !== undefined && p.default > p.max)) {
        errors.push(semantic(`${path}/default`, "default is outside its bounds"));
      } else if (p.type === "integer" && !Number.isInteger(p.default)) {
        errors.push(semantic(`${path}/default`, "integer default expected"));
      }
    }
  }
  return errors;
}

function fontScopeErrors(path: string, ref: VersionRef, ctx: SemanticContext, allowProject: string | null, visited = new Set<string>()): FilmError[] {
  const key = `${ref.id}@${ref.version}`;
  if (visited.has(key)) return [];
  visited.add(key);
  const manifest = ctx.font?.(ref);
  if (!manifest) return [];
  const errors: FilmError[] = [];
  if (manifest.scope.kind === "project" && manifest.scope.projectId !== allowProject) {
    errors.push(filmError("FS_FONT_SCOPE", path, `${ref.id}@${ref.version} is limited to project ${manifest.scope.projectId}`));
  }
  manifest.fallback.forEach((fallback, i) => errors.push(...fontScopeErrors(`${path}/fallback/${i}`, fallback, ctx, allowProject, visited)));
  return errors;
}

function recipeRules(r: FilmStyleRecipe, ctx: SemanticContext): FilmError[] {
  const errors: FilmError[] = [];
  for (const slot of REQUIRED_SLOTS) {
    const count = r.capabilities.filter((c) => c.slot === slot).length;
    if (count !== 1) errors.push(semantic("/capabilities", `slot ${slot} must be filled exactly once, found ${count}`));
  }
  r.capabilities.forEach((c, i) => {
    if (kindOfCapabilityId(c.ref.id) !== c.slot) errors.push(semantic(`/capabilities/${i}/ref/id`, `${c.ref.id} cannot fill slot ${c.slot}`));
  });
  r.effects.forEach((e, i) => {
    if (kindOfCapabilityId(e.id) !== "effect") errors.push(semantic(`/effects/${i}/id`, `${e.id} is not an effect`));
  });
  const selected = new Set([...r.capabilities.map((c) => c.ref.id), ...r.effects.map((e) => e.id)]);
  for (const id of Object.keys(r.params)) {
    if (!selected.has(id)) errors.push(semantic(`/params/${id}`, `parameters for ${id}, which the Recipe does not select`));
  }
  const t = r.timing;
  if (!(t.minSceneMs <= t.preferredSceneMs && t.preferredSceneMs <= t.maxSceneMs)) {
    errors.push(semantic("/timing", "timing must satisfy minSceneMs <= preferredSceneMs <= maxSceneMs"));
  }
  const dupFields = repeats(r.chapterAllowlist.map((a) => a.field));
  r.chapterAllowlist.forEach((a, i) => {
    if (dupFields.has(i)) errors.push(semantic(`/chapterAllowlist/${i}/field`, `${a.field} is listed twice`));
    if (a.min > a.max) errors.push(semantic(`/chapterAllowlist/${i}`, "min exceeds max"));
  });
  const dupRoles = repeats(r.fonts.map((f) => f.role));
  r.fonts.forEach((f, i) => {
    if (dupRoles.has(i)) errors.push(semantic(`/fonts/${i}/role`, `font role ${f.role} is listed twice`));
    // A reusable Recipe (system or organization) can never carry a project-only font.
    errors.push(...fontScopeErrors(`/fonts/${i}/ref`, f.ref, ctx, null));
  });
  return errors;
}

export function settingsRules(settings: ChapterSettings, base: string, recipe: FilmStyleRecipe | undefined): FilmError[] {
  if (!recipe) return [];
  const errors: FilmError[] = [];
  for (const [field, value] of Object.entries(settings)) {
    const allowed = recipe.chapterAllowlist.find((a) => a.field === field);
    if (!allowed) errors.push(semantic(`${base}/${field}`, `${field} is not in the Recipe's Chapter allowlist`));
    else if (value < allowed.min || value > allowed.max) {
      errors.push(semantic(`${base}/${field}`, `${field}=${value} is outside [${allowed.min}, ${allowed.max}]`));
    }
  }
  return errors;
}

function treatmentRules(t: FilmTreatment, ctx: SemanticContext): FilmError[] {
  const errors: FilmError[] = [];
  const dup = repeats(t.chapters.map((c) => c.chapterId));
  t.chapters.forEach((c, i) => {
    if (dup.has(i)) errors.push(semantic(`/chapters/${i}/chapterId`, `chapter ${c.chapterId} is listed twice`));
    errors.push(...settingsRules(c.settings, `/chapters/${i}/settings`, ctx.recipe));
  });
  t.projectFonts.forEach((f, i) => errors.push(...fontScopeErrors(`/projectFonts/${i}`, f, ctx, t.projectId)));
  errors.push(...fontScopeErrors("/shared/typography", t.shared.typography, ctx, t.projectId));
  if (ctx.recipe) {
    if (ctx.recipe.id !== t.recipe.id || ctx.recipe.revision !== t.recipe.revision) {
      errors.push(semantic("/recipe", "the Treatment is bound to a different Recipe revision"));
    }
    const offered = [...ctx.recipe.fonts.map((f) => f.ref), ...t.projectFonts];
    if (!offered.some((f) => f.id === t.shared.typography.id && f.version === t.shared.typography.version)) {
      errors.push(semantic("/shared/typography", "core typography must be a Recipe font or a project font"));
    }
    if (ctx.recipe.output.profile !== t.shared.outputProfile) {
      errors.push(semantic("/shared/outputProfile", "output profile differs from the Recipe"));
    }
  }
  return errors;
}

function cutRules(c: Cut, ctx: SemanticContext): FilmError[] {
  return settingsRules(c.settings, "/settings", ctx.recipe);
}

/** Schema validation first; semantic rules only for schema-valid documents. */
export function validateDocument(kind: SchemaKind, document: unknown, ctx: SemanticContext = {}): FilmError[] {
  const schemaErrors = validateSchema(schemaId(kind), document);
  if (schemaErrors.length) return schemaErrors;
  switch (kind) {
    case "story-graph":
      return storyGraphRules(document as StoryGraph);
    case "chapters":
      return chaptersRules(document as FilmChapters, ctx);
    case "capability-manifest":
      return manifestRules(document as CapabilityManifest);
    case "film-style-recipe":
      return recipeRules(document as FilmStyleRecipe, ctx);
    case "film-treatment":
      return treatmentRules(document as FilmTreatment, ctx);
    case "cut":
      return cutRules(document as Cut, ctx);
    default:
      return [];
  }
}
