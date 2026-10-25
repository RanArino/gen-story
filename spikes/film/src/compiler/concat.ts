// Concatenation Plan: the approved overall title, the ordered cached Chapter artifacts, and the
// connection between them. It never redraws Chapter scenes; only the overall title is painted.
import { filmError, FilmFailure } from "../contracts/errors.js";
import type { ConcatPlan, FilmStyleRecipe, FilmTreatment, PlanLock, ResolvedRenderPlan, VersionRef } from "../contracts/types.js";
import { CAPABILITY_ABI } from "../capability-sdk/abi.js";
import type { MediaLock } from "../media/lock.js";
import { lockFonts, PROFILES, SCHEMA_VERSION, type FontCatalog } from "./compile.js";
import { concatFingerprint } from "./fingerprint.js";
import type { Catalog, CatalogEntry } from "./resolve.js";

export const CONNECTION: VersionRef = { id: "film.connection.darken-briefly", version: "1.0.0" };

export interface ConcatInput {
  chapters: { plan: ResolvedRenderPlan; planDigest: string; artifactSha256: string }[];
  treatment: FilmTreatment;
  recipe: FilmStyleRecipe;
  catalog: Catalog;
  fonts: FontCatalog;
  media: MediaLock;
  environmentDigest: string;
  compiler: { version: string; digest: string };
  painter: { abi: string; digest: string };
}

function entryOf(catalog: Catalog, ref: VersionRef, path: string): CatalogEntry {
  const entry = catalog.get(ref.id, ref.version);
  if (!entry) throw new FilmFailure([filmError("FS_NOT_PROMOTED", path, `${ref.id}@${ref.version} is not a promoted registry entry`)]);
  return entry;
}

export function buildConcatPlan(input: ConcatInput): ConcatPlan {
  if (!input.chapters.length) throw new FilmFailure([filmError("FS_SEMANTIC_INVALID", "/chapters", "a concatenation needs at least one Chapter artifact")]);
  const first = input.chapters[0]!.plan;
  const profile = PROFILES[first.profile.id]!;
  const typographyRef = first.capabilities.find((c) => c.slot === "typography")!.active;
  const typography = entryOf(input.catalog, typographyRef, "/typography");
  const connection = entryOf(input.catalog, CONNECTION, "/connection");
  const darkenMs = connection.manifest.timing.gapMs ?? 800;
  const brightnessTo = Number(connection.manifest.params.brightnessTo?.default ?? 0.45);
  const titleMs = typography.manifest.timing.titleMs ?? 3000;

  const titleAliases = first.texts.find((t) => t.role === "title")?.font ?? first.fonts.map((f) => f.alias);
  const usedFonts = first.fonts.filter((f) => titleAliases.includes(f.alias));
  const title = typography.run({
    abi: CAPABILITY_ABI,
    kind: "typography",
    segment: "overall-title",
    profile: { id: profile.id, widthPx: profile.widthPx, heightPx: profile.heightPx, fps: profile.fps },
    window: { startMs: 0, endMs: titleMs, inOverlapMs: 0, outOverlapMs: 0 },
    chapter: { id: "film", title: input.treatment.overallTitle, index: -1, sceneIndex: -1, sceneCount: 0 },
    curves: input.recipe.curves,
    params: first.capabilities.find((c) => c.slot === "typography")!.params,
    options: { reducedMotion: first.options.reducedMotion, seed: 0 },
    theme: { palette: input.recipe.palette, fonts: { caption: titleAliases, title: titleAliases }, overallTitle: input.treatment.overallTitle },
    assets: {},
  });

  let offset = titleMs;
  const chapters = input.chapters.map((c, i) => {
    const entry = { chapterId: c.plan.chapter.id, planDigest: c.planDigest, artifactSha256: c.artifactSha256, runtimeMs: c.plan.timing.proposal.runtimeMs, offsetMs: offset };
    offset += entry.runtimeMs + (i < input.chapters.length - 1 ? darkenMs : 0);
    return entry;
  });
  const runtimeMs = titleMs + chapters.reduce((sum, c) => sum + c.runtimeMs, 0) + (chapters.length - 1) * darkenMs;
  if (offset !== runtimeMs) throw new Error("internal: concatenation offsets disagree with the runtime formula");

  const bgm = first.audio.bgm;
  const fontEntries = usedFonts.map((f) => input.fonts.get(f.font.id, f.font.version)).filter((e) => e !== undefined);
  const lock: PlanLock = {
    capabilities: [connection, typography].map((e) => ({
      slot: e.manifest.kind,
      id: e.manifest.id,
      version: e.manifest.version,
      manifestDigest: e.record.manifestDigest,
      implementationDigest: e.record.implementationDigest,
      assetDigests: e.record.assetDigests,
    })),
    fonts: lockFonts(fontEntries),
    media: [{ asset: bgm.asset, sha256: bgm.sha256 }],
    compiler: input.compiler,
    painter: input.painter,
    schemaVersion: SCHEMA_VERSION,
    profile: profile.id,
    environment: input.environmentDigest,
  };
  const plan: ConcatPlan = {
    schema: "film.concat-plan@1",
    chapters,
    profile,
    frameQuantization: "round-half-up@1",
    overallTitle: { text: input.treatment.overallTitle, titleMs, layers: title.layers },
    connection: { ref: CONNECTION, darkenMs, brightnessTo },
    audio: { bgm: { ...bgm, durationMs: runtimeMs } },
    fonts: usedFonts,
    runtimeMs,
    lock,
    fingerprint: concatFingerprint({
      artifactSha256: chapters.map((c) => c.artifactSha256),
      overallTitle: input.treatment.overallTitle,
      connection: { ...CONNECTION, manifestDigest: connection.record.manifestDigest, implementationDigest: connection.record.implementationDigest },
      lock,
    }),
  };
  return plan;
}
