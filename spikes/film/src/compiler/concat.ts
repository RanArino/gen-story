// Concatenation Plan: the approved overall title, the ordered cached Chapter artifacts, and the
// connection between them. It never redraws Chapter scenes; only the overall title is painted.
import { filmError, FilmFailure } from "../contracts/errors.js";
import type { ConcatPlanV2, FilmStyleRecipe, FilmTreatment, PlanLock, ResolvedRenderPlan, VersionRef } from "../contracts/types.js";
import { CAPABILITY_ABI } from "../capability-sdk/abi.js";
import type { MediaLock } from "../media/lock.js";
import { lockFonts, PROFILES, SCHEMA_VERSION, type FontCatalog } from "./compile.js";
import { concatFingerprint } from "./fingerprint.js";
import { frameCount } from "./timing.js";
import type { Catalog, CatalogEntry } from "./resolve.js";

export const CONNECTION: VersionRef = { id: "film.connection.darken-briefly", version: "1.0.0" };

export interface ConcatInput {
  chapters: { plan: ResolvedRenderPlan; planDigest: string; artifactSha256: string; stemSha256: string; frames: number }[];
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

export function buildConcatPlan(input: ConcatInput): ConcatPlanV2 {
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

  const titleFrames = frameCount(titleMs, profile.fps);
  const joinFrames = frameCount(darkenMs, profile.fps);
  let offset = titleFrames;
  const chapters = input.chapters.map((c, i) => {
    const entry = { chapterId: c.plan.chapter.id, planDigest: c.planDigest, artifactSha256: c.artifactSha256, stemSha256: c.stemSha256, frames: c.frames, runtimeMs: c.frames * 1000 / profile.fps, offsetMs: offset * 1000 / profile.fps };
    offset += c.frames + (i < input.chapters.length - 1 ? joinFrames : 0);
    return entry;
  });
  const runtimeMs = offset * 1000 / profile.fps;

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
  const plan: ConcatPlanV2 = {
    schema: "film.concat-plan@2",
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
      stemSha256: chapters.map((c) => c.stemSha256),
      frames: chapters.map((c) => c.frames!),
      overallTitle: input.treatment.overallTitle,
      connection: { ...CONNECTION, manifestDigest: connection.record.manifestDigest, implementationDigest: connection.record.implementationDigest },
      lock,
    }),
  };
  return plan;
}
