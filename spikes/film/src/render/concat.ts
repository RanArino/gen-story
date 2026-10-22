// Assembles the concatenated film from cached Chapter artifacts. Only the overall title is painted;
// Chapter video is joined by stream copy, so its frames stay identical to the Chapter MP4s. The
// shared BGM is laid once across the whole timeline under each Chapter's cached stem.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { digestBytes } from "../contracts/canonical.js";
import type { Warning } from "../contracts/envelope.js";
import { fail, FilmFailure } from "../contracts/errors.js";
import type { ChapterArtifact, ConcatPlan } from "../contracts/types.js";
import { planDigest } from "../compiler/fingerprint.js";
import { writeJson } from "../paths.js";
import { requireApproval } from "../registry/approvals.js";
import { bedGraph } from "./audio.js";
import { withBrowser } from "./browser.js";
import { AAC, ffmpeg, frameCount, X264 } from "./ffmpeg.js";
import { captureVideo, loadConcatPlan, outRelative, requireEnvironment, type RenderDeps } from "./render-chapter.js";
import { startServer } from "./server.js";
import { verifyMp4 } from "./verify.js";

/** Metadata of a verified concatenated film (evidence; not a canonical schema document). */
export interface ConcatArtifact {
  planDigest: string;
  fingerprint: string;
  environment: string;
  runtimeMs: number;
  frames: number;
  parts: { kind: "overall-title" | "chapter" | "join"; chapterId: string | null; startFrame: number; frames: number }[];
  chapters: { chapterId: string; artifactSha256: string; offsetMs: number }[];
  file: { name: string; sha256: string; bytes: number };
  verified: boolean;
}

export interface ConcatRender {
  artifact: ConcatArtifact;
  cache: "hit" | "miss";
  files: string[];
  warnings: Warning[];
  blocked: string[];
  renderMs: number;
}

/** Finds the cached Chapter artifact whose MP4 bytes the concatenation Plan pinned. */
export function findChapterArtifact(stateDir: string, mp4Sha256: string): { dir: string; artifact: ChapterArtifact } {
  const root = `${stateDir}cache/chapters/`;
  for (const name of existsSync(root) ? readdirSync(root) : []) {
    const meta = `${root}${name}/artifact.json`;
    if (name.startsWith(".") || !existsSync(meta)) continue;
    const artifact = JSON.parse(readFileSync(meta, "utf8")) as ChapterArtifact;
    if (artifact.verified && artifact.files.mp4.sha256 === mp4Sha256) {
      const dir = `${root}${name}/`;
      if (digestBytes(readFileSync(`${dir}${artifact.files.mp4.name}`)) !== mp4Sha256) break;
      return { dir, artifact };
    }
  }
  return fail("FS_ARTIFACT_VERIFY_FAILED", "/chapters", `no intact cached Chapter artifact has MP4 ${mp4Sha256}; render the Chapter first`);
}

function cachedConcat(dir: string, digest: string, warnings: Warning[]): ConcatArtifact | null {
  const meta = `${dir}concat.json`;
  if (!existsSync(meta)) return null;
  const artifact = JSON.parse(readFileSync(meta, "utf8")) as ConcatArtifact;
  if (artifact.verified && artifact.planDigest === digest && existsSync(`${dir}${artifact.file.name}`) && digestBytes(readFileSync(`${dir}${artifact.file.name}`)) === artifact.file.sha256) {
    return artifact;
  }
  warnings.push({ code: "FS_CACHE_CORRUPT", path: dir, message: "a cached concatenation did not match its digests; it was discarded and rebuilt", disposition: null });
  rmSync(dir, { recursive: true, force: true });
  return null;
}

export async function renderConcat(deps: RenderDeps, input: { planFile: string; approvalId?: string; outName?: string }): Promise<ConcatRender> {
  const { paths } = deps;
  const started = performance.now();
  const plan = loadConcatPlan<ConcatPlan>(paths, input.planFile);
  const digest = planDigest(plan);
  requireApproval(paths.state, input.approvalId, "concat", digest);
  requireEnvironment(deps, plan.lock.environment);

  const planPath = outRelative(paths, input.planFile);
  const outName = input.outName ?? planPath.split("/").at(-2)!;
  const fps = plan.profile.fps;
  const cacheDir = `${paths.state}cache/concat/${plan.fingerprint.slice("sha256:".length)}/`;
  const warnings: Warning[] = [];
  const sources = plan.chapters.map((c) => {
    const found = findChapterArtifact(paths.state, c.artifactSha256);
    if (found.artifact.runtimeMs !== c.runtimeMs) fail("FS_ARTIFACT_VERIFY_FAILED", "/chapters", `${c.chapterId} runtime differs from the concatenation Plan`);
    return { ...c, ...found };
  });

  let artifact = cachedConcat(cacheDir, digest, warnings);
  const cache: "hit" | "miss" = artifact ? "hit" : "miss";
  let blocked: string[] = [];
  if (!artifact) {
    const work = `${paths.state}cache/concat/.tmp-${process.pid}/`;
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    try {
      const titleFrames = frameCount(plan.overallTitle.titleMs, fps);
      const holdFrames = frameCount(plan.connection.darkenMs, fps);
      const server = await startServer(paths);
      try {
        blocked = (await withBrowser((browser) => captureVideo(browser, server.origin, planPath, titleFrames, fps, `${work}title.mp4`))).blocked;
      } finally {
        await server.close();
      }

      const parts: ConcatArtifact["parts"] = [{ kind: "overall-title", chapterId: null, startFrame: 0, frames: titleFrames }];
      const list: string[] = [`${work}title.mp4`];
      let frame = titleFrames;
      for (const [i, s] of sources.entries()) {
        const video = `${work}${s.chapterId}.video.mp4`;
        await ffmpeg(["-i", `${s.dir}${s.artifact.files.mp4.name}`, "-map", "0:v", "-c", "copy", video]);
        list.push(video);
        parts.push({ kind: "chapter", chapterId: s.chapterId, startFrame: frame, frames: s.artifact.frames });
        frame += s.artifact.frames;
        if (i === sources.length - 1) break;
        // The darken hold: the Chapter's last frame, brightness ramped linearly toward brightnessTo
        // at each output frame time, as film.connection.darken-briefly declares.
        const last = `${work}${s.chapterId}.last.png`;
        await ffmpeg(["-i", video, "-vf", `select=eq(n\\,${s.artifact.frames - 1})`, "-frames:v", "1", last]);
        const k = `(1-${1 - plan.connection.brightnessTo}*N*1000/(${fps}*${plan.connection.darkenMs}))`;
        const hold = `${work}join-${i}.mp4`;
        await ffmpeg(["-loop", "1", "-framerate", String(fps), "-i", last, "-frames:v", String(holdFrames), "-vf", `format=rgb24,geq=r='r(X,Y)*${k}':g='g(X,Y)*${k}':b='b(X,Y)*${k}'`, ...X264, "-an", hold]);
        list.push(hold);
        parts.push({ kind: "join", chapterId: s.chapterId, startFrame: frame, frames: holdFrames });
        frame += holdFrames;
      }
      writeFileSync(`${work}list.txt`, list.map((f) => `file '${f}'`).join("\n") + "\n");
      await ffmpeg(["-f", "concat", "-safe", "0", "-i", `${work}list.txt`, "-c:v", "copy", `${work}video.mp4`]);

      const bed = bedGraph({
        bgm: plan.audio.bgm,
        runtimeMs: plan.runtimeMs,
        stems: sources.map((s) => ({ file: `${s.dir}${s.artifact.files.stem.name}`, startMs: s.offsetMs })),
        mediaDir: paths.media,
        firstInput: 1,
      });
      const name = "concat.mp4";
      await ffmpeg(["-i", `${work}video.mp4`, ...bed.inputs, "-filter_complex", bed.filter, "-map", "0:v", "-c:v", "copy", "-map", bed.output, ...AAC, "-movflags", "+faststart", `${work}${name}`]);
      const errors = await verifyMp4(`${work}${name}`, frame, plan.profile);
      if (errors.length) throw new FilmFailure(errors);
      const bytes = readFileSync(`${work}${name}`);
      artifact = {
        planDigest: digest,
        fingerprint: plan.fingerprint,
        environment: plan.lock.environment,
        runtimeMs: plan.runtimeMs,
        frames: frame,
        parts,
        chapters: plan.chapters.map((c) => ({ chapterId: c.chapterId, artifactSha256: c.artifactSha256, offsetMs: c.offsetMs })),
        file: { name, sha256: digestBytes(bytes), bytes: statSync(`${work}${name}`).size },
        verified: true,
      };
      for (const f of readdirSync(work)) if (f !== name) rmSync(`${work}${f}`);
      writeJson(`${work}concat.json`, artifact);
      rmSync(cacheDir, { recursive: true, force: true });
      mkdirSync(`${paths.state}cache/concat/`, { recursive: true });
      renameSync(work, cacheDir);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }

  const target = `${paths.out}artifacts/${outName}/`;
  mkdirSync(target, { recursive: true });
  copyFileSync(`${cacheDir}${artifact.file.name}`, `${target}concat.mp4`);
  copyFileSync(`${cacheDir}concat.json`, `${target}concat.json`);
  return {
    artifact,
    cache,
    files: [`out/artifacts/${outName}/concat.mp4`, `out/artifacts/${outName}/concat.json`],
    warnings,
    blocked,
    renderMs: Math.round(performance.now() - started),
  };
}
