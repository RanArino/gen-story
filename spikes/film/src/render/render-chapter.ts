// Renders one Resolved Render Plan into a verified Chapter artifact: an MP4 with the BGM mixed in,
// a WAV stem of the Chapter's other sound, and metadata. Media is cached by render digest.
import { chapterCacheDir, resolveChapterCache } from "./cache.js";
import { verifyAudio } from "./inputs.js";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { availableParallelism } from "node:os";
import { relative, resolve } from "node:path";
import type { Browser } from "puppeteer-core";
import { digestBytes, digestOf } from "../contracts/canonical.js";
import type { Warning } from "../contracts/envelope.js";
import { fail, FilmFailure } from "../contracts/errors.js";
import { validateSchema } from "../contracts/schemas.js";
import type { ChapterArtifact, ResolvedRenderPlan } from "../contracts/types.js";
import { planDigest } from "../compiler/fingerprint.js";
import { frameCount, proposalDigest } from "../compiler/timing.js";
import type { EnvFingerprint } from "../env/fingerprint.js";
import { readMediaLock } from "../media/lock.js";
import { writeJson, type SpikePaths } from "../paths.js";
import { requireApproval } from "../registry/approvals.js";
import { bedGraph, stemGraph } from "./audio.js";
import { openPlan, withBrowser } from "./browser.js";
import { AAC, ffmpeg, pngEncoder } from "./ffmpeg.js";
import { startServer, type ServerLog } from "./server.js";
import { verifyMp4 } from "./verify.js";

export interface RenderDeps {
  paths: SpikePaths;
  /** The environment the renderer runs in now; Plans pin the one they were compiled in. */
  liveEnvironment: () => EnvFingerprint;
}

export interface FrameSample {
  frame: number;
  tMs: number;
  sha256: string;
}

export interface ChapterRender {
  artifact: ChapterArtifact;
  cache: "hit" | "miss";
  samples: FrameSample[];
  /** Files written under out/artifacts/<name>/, as `out/...` paths. */
  files: string[];
  warnings: Warning[];
  /** Non-local requests the capture pages attempted (each aborted). */
  blocked: string[];
  fonts: string[];
  server: ServerLog | null;
  renderMs: number;
}

export const SAMPLE_COUNT = 12;

/** Twelve evenly spaced frames used for replay hashes, contact sheets, and preview checks. */
export function sampleFrames(frames: number): number[] {
  return Array.from({ length: SAMPLE_COUNT }, (_, i) => Math.floor(((i + 0.5) * frames) / SAMPLE_COUNT));
}

export function frameTime(frame: number, fps: number): number {
  return (frame * 1000) / fps;
}

/** A Plan path as the render server addresses it: relative to out/. Plans outside out/ are refused. */
export function outRelative(paths: SpikePaths, planFile: string): string {
  const full = resolve(paths.root, planFile);
  const rel = relative(paths.out, full);
  if (rel.startsWith("..") || resolve(paths.out, rel) !== full) fail("FS_SCHEMA_INVALID", "/plan", `${planFile} is not under out/`);
  return rel;
}

function readPlan<T>(paths: SpikePaths, planFile: string, kind: "resolved-render-plan" | "concat-plan"): T {
  const full = resolve(paths.root, planFile);
  if (!existsSync(full)) fail("FS_SCHEMA_INVALID", "/plan", `${planFile} does not exist`);
  const plan = JSON.parse(readFileSync(full, "utf8")) as T;
  const errors = validateSchema(`urn:film-spike:${kind}`, plan);
  if (errors.length) throw new FilmFailure(errors);
  return plan;
}

export function loadChapterPlan(paths: SpikePaths, planFile: string): ResolvedRenderPlan {
  return readPlan<ResolvedRenderPlan>(paths, planFile, "resolved-render-plan");
}

export function loadConcatPlan<T>(paths: SpikePaths, planFile: string): T {
  return readPlan<T>(paths, planFile, "concat-plan");
}

/** Refuses a Plan compiled in a different environment: replay determinism holds only in the pinned one. */
export function requireEnvironment(deps: RenderDeps, pinned: string): void {
  const live = digestOf(deps.liveEnvironment());
  if (live !== pinned) fail("FS_ENV_MISMATCH", "/lock/environment", `the Plan pins environment ${pinned}, but this one is ${live}`, { pinned, live });
}

function fileEntry(path: string, name: string) {
  return { name, sha256: digestBytes(readFileSync(path)), bytes: statSync(path).size };
}

export interface CaptureResult {
  samples: FrameSample[];
  blocked: string[];
}

/**
 * Captures frames 0..frames-1 of a Plan into a video-only MP4. Several pages draw consecutive
 * frames in parallel; frames are written to the encoder strictly in order.
 */
export async function captureVideo(browser: Browser, origin: string, planPath: string, frames: number, fps: number, out: string, samples: number[] = []): Promise<CaptureResult> {
  const workers = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));
  const contexts = await Promise.all(Array.from({ length: workers }, () => browser.createBrowserContext()));
  const pages = await Promise.all(contexts.map((c) => openPlan(c, origin, planPath)));
  const sink = pngEncoder(out, fps);
  const wanted = new Set(samples);
  const hashes: FrameSample[] = [];
  let ok = false;
  try {
    for (let n = 0; n < frames; n += workers) {
      const batch = await Promise.all(pages.slice(0, Math.min(workers, frames - n)).map((p, k) => p.frame(frameTime(n + k, fps))));
      for (let k = 0; k < batch.length; k += 1) {
        const frame = n + k;
        if (wanted.has(frame)) hashes.push({ frame, tMs: frameTime(frame, fps), sha256: digestBytes(batch[k]!) });
        await sink.write(batch[k]!);
      }
    }
    ok = true;
  } finally {
    await sink.close().catch((error: unknown) => {
      if (ok) throw error;
    });
    await Promise.all(contexts.map((c) => c.close()));
  }
  return { samples: hashes, blocked: pages.flatMap((p) => p.blocked) };
}

export interface RenderChapterInput {
  planFile: string;
  approvalId?: string;
  bypassCache?: boolean;
  outName?: string;
}

export async function renderChapter(deps: RenderDeps, input: RenderChapterInput): Promise<ChapterRender> {
  const { paths } = deps;
  const started = performance.now();
  const plan = loadChapterPlan(paths, input.planFile);
  if (proposalDigest(plan.timing.proposal) !== plan.timing.proposalDigest) fail("FS_DIGEST_MISMATCH", "/timing/proposalDigest", "the Plan's timing proposal does not match its digest");
  requireApproval(paths.state, input.approvalId, "timing", plan.timing.proposalDigest);
  requireEnvironment(deps, plan.lock.environment);

  const digest = planDigest(plan);
  const planPath = outRelative(paths, input.planFile);
  const outName = input.outName ?? planPath.split("/").at(-2)!;
  const chapterId = plan.chapter.id;
  const cacheDir = chapterCacheDir(paths.state, plan);
  verifyAudio(paths.media, [plan.audio.bgm, ...plan.audio.events]);
  const warnings: Warning[] = [];
  const frames = frameCount(plan.timing.proposal.runtimeMs, plan.profile.fps);

  let artifact = input.bypassCache ? null : resolveChapterCache(paths.state, plan)?.artifact ?? null;
  let cache: "hit" | "miss" = artifact ? "hit" : "miss";
  let capture: CaptureResult & { fonts: string[] } = { samples: [], blocked: [], fonts: [] };
  let serverLog: ServerLog | null = null;

  if (!artifact) {
    cache = "miss";
    const work = `${paths.state}cache/chapter-media-v2/.tmp-${process.pid}-${chapterId}/`;
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    try {
      const audioDir = `${work}audio/`;
      verifyAudio(paths.media, [plan.audio.bgm, ...plan.audio.events], audioDir);
      const server = await startServer(paths);
      try {
        const result = await withBrowser(async (browser) => {
          const video = await captureVideo(browser, server.origin, planPath, frames, plan.profile.fps, `${work}video.mp4`, sampleFrames(frames));
          const page = await openPlan(browser, server.origin, planPath);
          const fonts = await page.fonts();
          await page.page.close();
          return { ...video, fonts };
        });
        capture = result;
        serverLog = server.log;
      } finally {
        await server.close();
      }
      const lock = readMediaLock(paths.media);
      const assetMs = (asset: string) => lock.files.find((f) => f.path === asset)?.durationMs ?? 0;
      const runtimeMs = plan.timing.proposal.runtimeMs;
      const stem = stemGraph(plan.audio.events, runtimeMs, audioDir, assetMs);
      const stemName = `${chapterId}.stem.wav`;
      await ffmpeg([...stem.inputs, "-filter_complex", stem.filter, "-map", stem.output, "-c:a", "pcm_s16le", "-ar", "48000", "-ac", "2", "-fflags", "+bitexact", "-flags:a", "+bitexact", `${work}${stemName}`]);
      const bed = bedGraph({ bgm: plan.audio.bgm, runtimeMs, stems: [{ file: `${work}${stemName}`, startMs: 0 }], mediaDir: audioDir, firstInput: 1 });
      const mp4Name = `${chapterId}.mp4`;
      await ffmpeg(["-i", `${work}video.mp4`, ...bed.inputs, "-filter_complex", bed.filter, "-map", "0:v", "-c:v", "copy", "-map", bed.output, ...AAC, "-movie_timescale", "48000", "-movflags", "+faststart", `${work}${mp4Name}`]);
      rmSync(`${work}video.mp4`);

      const errors = await verifyMp4(`${work}${mp4Name}`, frames, plan.profile, plan.timing.proposal.limitMs);
      if (errors.length) throw new FilmFailure(errors);
      artifact = {
        schema: "film.chapter-artifact@1",
        chapterId,
        order: plan.chapter.index,
        title: plan.chapter.title,
        scenes: plan.provenance.scenes,
        recipe: plan.provenance.recipe,
        capabilityLock: plan.lock.capabilities,
        fonts: plan.lock.fonts,
        bgm: { asset: plan.audio.bgm.asset, sha256: plan.audio.bgm.sha256 },
        planDigest: digest,
        fingerprint: plan.fingerprint,
        environment: plan.lock.environment,
        runtimeMs,
        frames,
        files: { mp4: fileEntry(`${work}${mp4Name}`, mp4Name), stem: fileEntry(`${work}${stemName}`, stemName) },
        verified: true,
      };
      const schemaErrors = validateSchema("urn:film-spike:chapter-artifact", artifact);
      if (schemaErrors.length) throw new FilmFailure(schemaErrors);
      writeJson(`${work}artifact.json`, artifact);
      writeJson(`${work}frames.json`, { planDigest: digest, samples: capture.samples });
      writeJson(`${work}origin.plan.json`, plan);
      rmSync(audioDir, { recursive: true, force: true });
      if (!existsSync(cacheDir)) renameSync(work, cacheDir);
      else {
        const existing = resolveChapterCache(paths.state, plan)!;
        if (digestOf(existing.artifact.files) !== digestOf(artifact.files)) fail("FS_NONDETERMINISTIC", "/files", "replay differs from immutable cached media");
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  const samples = input.bypassCache ? capture.samples : (JSON.parse(readFileSync(`${cacheDir}frames.json`, "utf8")) as { samples: FrameSample[] }).samples;
  const target = `${paths.out}artifacts/${outName}/`;
  mkdirSync(target, { recursive: true });
  const files: string[] = [];
  for (const [from, to] of [
    [artifact.files.mp4.name, `${chapterId}.mp4`],
    [artifact.files.stem.name, `${chapterId}.stem.wav`],
  ] as const) {
    copyFileSync(`${cacheDir}${from}`, `${target}${to}`);
    files.push(`out/artifacts/${outName}/${to}`);
  }
  writeJson(`${target}${chapterId}.json`, artifact);
  writeJson(`${target}${chapterId}.frames.json`, { planDigest: digest, samples });
  files.push(`out/artifacts/${outName}/${chapterId}.json`, `out/artifacts/${outName}/${chapterId}.frames.json`);
  return { artifact, cache, samples, files, warnings, blocked: capture.blocked, fonts: capture.fonts, server: serverLog, renderMs: Math.round(performance.now() - started) };
}
