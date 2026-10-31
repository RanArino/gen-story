import { FilmFailure } from "./contracts/errors.js";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { compilerIdentity, painterIdentity } from "./authoring/identity.js";
import { loadBuiltin } from "./capabilities/builtin/index.js";
import {
  compileChapters,
  type CompileInput,
  type FontEntry,
} from "./compiler/compile.js";
import { buildConcatPlan } from "./compiler/concat.js";
import type { CatalogEntry } from "./compiler/resolve.js";
import { digestOf, digestBytes } from "./contracts/canonical.js";
import type {
  CapabilityManifest,
  FilmStyleRecipe,
  FilmTreatment,
  FontAssetManifest,
  ResolvedRenderPlan,
  StoryScene,
  ChapterArtifact,
} from "./contracts/types.js";
import { readFingerprint } from "./env/fingerprint.js";
import type { MediaLock, MediaLockEntry } from "./media/lock.js";
import { type FilmRuntimePaths, writeJson } from "./paths.js";
import { Registry } from "./registry/registry.js";
import { renderChapter } from "./render/render-chapter.js";
import { renderConcat } from "./render/concat.js";

export { digestOf, digestBytes };
export type { ResolvedRenderPlan, ChapterArtifact, MediaLockEntry };
export { FilmFailure } from "./contracts/errors.js";
export const runtimeRoot = fileURLToPath(new URL("../", import.meta.url));
const assets = `${runtimeRoot}assets/`;
export const recipeNames = [
  "quiet-cinema",
  "memory-board",
  "pulse-cut",
] as const;
export type RecipeName = (typeof recipeNames)[number];
export interface RuntimeChapter {
  settings?: {
    pacing?: number;
    motionAmount?: number;
    emphasis?: number;
    sfxLevel?: number;
    visualIntensity?: number;
  };
  id: string;
  title: string;
  limitMs: number | null;
  scenes: { sceneId: string; durationMs?: number }[];
}
export interface RuntimeInput {
  projectId: string;
  revision: number;
  title: string;
  worldview: string;
  recipe: RecipeName;
  reducedMotion: boolean;
  chapters: RuntimeChapter[];
  scenes: { id: string; asset: string; caption: string; source: string }[];
  media: MediaLockEntry[];
}

/** The app renders only immutable system bundles, never candidate code. */
export function initializeRuntime(directory: string): FilmRuntimePaths {
  const base = directory.endsWith("/") ? directory : `${directory}/`;
  const paths = {
    root: runtimeRoot,
    fixtures: assets,
    state: `${base}state/`,
    media: `${base}media/`,
    out: `${base}out/`,
  };
  mkdirSync(paths.out, { recursive: true });
  mkdirSync(paths.media, { recursive: true });
  if (!existsSync(`${paths.state}registry`))
    cpSync(`${assets}registry`, `${paths.state}registry`, { recursive: true });
  const lock = JSON.parse(
    readFileSync(`${assets}media-lock.json`, "utf8"),
  ) as MediaLock;
  for (const entry of lock.files) {
    const target = `${paths.media}${entry.path}`;
    if (!existsSync(target)) {
      mkdirSync(`${paths.media}sounds/`, { recursive: true });
      const bytes =
        entry.path === "sounds/silence.wav"
          ? readFileSync(`${assets}silence.wav`)
          : readFileSync(
              `${assets}registry/blobs/sha256/${entry.sha256.slice(7)}`,
            );
      if (digestBytes(bytes) !== entry.sha256)
        throw new Error("Bundled audio digest mismatch");
      writeFileSync(target, bytes);
    }
  }
  return paths;
}

export function compileFilm(paths: FilmRuntimePaths, input: RuntimeInput) {
  const registry = new Registry(paths.state);
  const recipe = JSON.parse(
    readFileSync(`${assets}recipes/${input.recipe}.r1.json`, "utf8"),
  ) as FilmStyleRecipe;
  const treatment = JSON.parse(
    readFileSync(`${assets}treatments/${input.recipe}.json`, "utf8"),
  ) as FilmTreatment;
  treatment.id = input.projectId;
  treatment.projectId = input.projectId;
  treatment.revision = input.revision;
  treatment.storyGraph = { id: input.projectId, revision: input.revision };
  treatment.overallTitle = input.title;
  treatment.shared.worldview = input.worldview;
  treatment.chapters = input.chapters.map((c) => ({
    chapterId: c.id,
    settings: c.settings ?? {},
  }));
  const entries = new Map<string, CatalogEntry>();
  const fonts = new Map<string, FontEntry>();
  for (const record of registry.records()) {
    if (record.entity === "capability" && record.trust === "system") {
      entries.set(`${record.id}@${record.version}`, {
        record,
        manifest: registry.manifest<CapabilityManifest>(record),
        run: loadBuiltin(record),
      });
    } else if (record.entity === "font") {
      const manifest = registry.manifest<FontAssetManifest>(record);
      manifest.faces.forEach((face) => registry.readBlob(face.sha256!));
      fonts.set(`${record.id}@${record.version}`, { record, manifest });
    }
  }
  const media = JSON.parse(
    readFileSync(`${assets}media-lock.json`, "utf8"),
  ) as MediaLock;
  const silence = media.files.find((f) => f.path === "sounds/silence.wav")!;
  treatment.shared.bgm = {
    asset: silence.path,
    sha256: silence.sha256,
    gain: 0,
  };
  media.files.push(...input.media);
  const oldLockPath = `${paths.media}media-lock.json`;
  const previous = existsSync(oldLockPath)
    ? (JSON.parse(readFileSync(oldLockPath, "utf8")) as MediaLock)
    : null;
  if (previous)
    media.files.push(
      ...previous.files.filter(
        (f) => !media.files.some((n) => n.path === f.path),
      ),
    );
  writeJson(oldLockPath, media);
  const ci: CompileInput = {
    storyGraph: {
      schema: "film.story-graph@1",
      id: input.projectId,
      revision: input.revision,
      title: input.title,
      facts: [],
      scenes: input.scenes.map(
        (s) =>
          ({
            id: s.id,
            media: { asset: s.asset },
            caption: { ja: s.caption, en: "" },
            analysis: { subject: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } },
            emphasis: 0.5,
            emotion: recipe.curves,
            lineage: { source: "project", note: s.source },
          }) satisfies StoryScene,
      ),
    },
    chapters: {
      schema: "film.chapters@1",
      storyGraph: treatment.storyGraph,
      chapters: input.chapters,
    },
    treatment,
    recipe,
    recipeDigest: digestOf(recipe),
    catalog: { get: (id, version) => entries.get(`${id}@${version}`) },
    fonts: { get: (id, version) => fonts.get(`${id}@${version}`) },
    media,
    environmentDigest: digestOf(readFingerprint()),
    compiler: compilerIdentity(),
    painter: painterIdentity(),
    options: { reducedMotion: input.reducedMotion, forceLevel0: false },
  };
  // Exact Recipe references must resolve before execution, including their manifest digests.
  for (const ref of [
    ...recipe.capabilities.map((c) => c.ref),
    ...recipe.effects,
    ...recipe.fonts.map((f) => f.ref),
    treatment.shared.typography,
  ])
    registry.resolve(ref);
  return { compiled: compileChapters(ci), input: ci };
}

export async function renderFilmChapter(
  paths: FilmRuntimePaths,
  plan: ResolvedRenderPlan,
  jobId: string,
) {
  const file = `${paths.out}${jobId}.json`;
  writeJson(file, plan);
  const deps = { paths, liveEnvironment: () => readFingerprint() };
  const request = {
    planFile: file,
    approvedDigest: digestOf(plan),
    outName: jobId,
  };
  let result;
  try {
    result = await renderChapter(deps, request);
  } catch (error) {
    if (
      !(error instanceof FilmFailure) ||
      !error.errors.some((e) => e.code === "FS_ARTIFACT_VERIFY_FAILED")
    )
      throw error;
    result = await renderChapter(deps, { ...request, bypassCache: true });
  }
  return {
    artifact: result.artifact,
    file: `${paths.out}artifacts/${jobId}/${plan.chapter.id}.mp4`,
    cache: result.cache,
  };
}

export async function renderFilmAssembly(
  paths: FilmRuntimePaths,
  ci: CompileInput,
  chapters: { plan: ResolvedRenderPlan; artifact: ChapterArtifact }[],
  jobId: string,
) {
  const plan = buildConcatPlan({
    ...ci,
    chapters: chapters.map(({ plan, artifact }) => ({
      plan,
      planDigest: digestOf(plan),
      artifactSha256: artifact.files.mp4.sha256,
      stemSha256: artifact.files.stem.sha256,
      frames: artifact.frames,
    })),
  });
  const file = `${paths.out}${jobId}.json`;
  writeJson(file, plan);
  const result = await renderConcat(
    { paths, liveEnvironment: () => readFingerprint() },
    { planFile: file, approvedDigest: digestOf(plan), outName: jobId },
  );
  return {
    file: `${paths.out}artifacts/${jobId}/concat.mp4`,
    runtimeMs: result.artifact.runtimeMs,
    cache: result.cache,
  };
}

export { compileCinematicFilm } from "./cinematic/compile.js";
export {
  prepareCinematicScore,
  lockCinematicMedia,
} from "./cinematic/prepare.js";
export type { CinematicDirection, CinematicScore } from "./cinematic/types.js";
