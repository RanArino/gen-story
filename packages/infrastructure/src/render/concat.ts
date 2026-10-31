// Assembles the concatenated film from cached Chapter artifacts. Only the overall title is painted;
// Chapter video is joined by stream copy, so its frames stay identical to the Chapter MP4s. The
// shared BGM is laid once across the whole timeline under each Chapter's cached stem.
import { verifyChapterFiles } from "./cache.js";
import { verifyAudio } from "./inputs.js";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { digestBytes } from "../contracts/canonical.js";
import type { Warning } from "../contracts/envelope.js";
import { fail, FilmFailure } from "../contracts/errors.js";
import type {
  ChapterArtifact,
  ConcatPlan,
  ConcatPlanV2,
} from "../contracts/types.js";
import { planDigest } from "../compiler/fingerprint.js";
import { frameCount } from "../compiler/timing.js";
import { writeJson } from "../paths.js";
import { bedGraph, SAMPLE_RATE } from "./audio.js";
import { withBrowser } from "./browser.js";
import { AAC, ffmpeg, X264 } from "./ffmpeg.js";
import {
  captureVideo,
  loadConcatPlan,
  outRelative,
  requireEnvironment,
  type RenderDeps,
} from "./render-chapter.js";
import { startServer } from "./server.js";
import { verifyMp4 } from "./verify.js";

/** Metadata of a verified concatenated film (evidence; not a canonical schema document). */
export interface ConcatArtifact {
  planDigest: string;
  fingerprint: string;
  environment: string;
  runtimeMs: number;
  frames: number;
  parts: {
    kind: "overall-title" | "chapter" | "join";
    chapterId: string | null;
    startFrame: number;
    frames: number;
  }[];
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

/** Finds the cached Chapter artifact whose MP4 bytes the concatenation Plan pinned; `stageStem` as in verifyChapterFiles. */
export function findChapterArtifact(
  stateDir: string,
  mp4Sha256: string,
  stemSha256?: string,
  stageStem?: string,
): { dir: string; artifact: ChapterArtifact } {
  for (const namespace of ["chapter-media-v2", "chapters"]) {
    const root = `${stateDir}cache/${namespace}/`;
    for (const name of existsSync(root) ? readdirSync(root) : []) {
      const meta = `${root}${name}/artifact.json`;
      if (name.startsWith(".") || !existsSync(meta)) continue;
      const artifact = JSON.parse(
        readFileSync(meta, "utf8"),
      ) as ChapterArtifact;
      if (
        artifact.verified &&
        artifact.files.mp4.sha256 === mp4Sha256 &&
        (!stemSha256 || artifact.files.stem.sha256 === stemSha256)
      ) {
        const dir = `${root}${name}/`;
        verifyChapterFiles(dir, artifact, stageStem);
        return { dir, artifact };
      }
    }
  }
  return fail(
    "FS_ARTIFACT_VERIFY_FAILED",
    "/chapters",
    `no intact cached Chapter artifact has MP4 ${mp4Sha256}; render the Chapter first`,
  );
}

function cachedConcat(
  dir: string,
  digest: string,
  warnings: Warning[],
): ConcatArtifact | null {
  const meta = `${dir}concat.json`;
  if (!existsSync(meta)) return null;
  const artifact = JSON.parse(readFileSync(meta, "utf8")) as ConcatArtifact;
  if (
    artifact.verified &&
    artifact.planDigest === digest &&
    existsSync(`${dir}${artifact.file.name}`) &&
    digestBytes(readFileSync(`${dir}${artifact.file.name}`)) ===
      artifact.file.sha256
  ) {
    return artifact;
  }
  warnings.push({
    code: "FS_CACHE_CORRUPT",
    path: dir,
    message:
      "a cached concatenation did not match its digests; it was discarded and rebuilt",
    disposition: null,
  });
  rmSync(dir, { recursive: true, force: true });
  return null;
}

/** The prerequisites a dry run checks too, before any media: a v2 Plan, its concat approval, and the pinned environment. */
export function requireConcatPlan(
  deps: RenderDeps,
  input: { planFile: string; approvedDigest: string },
): { plan: ConcatPlanV2; digest: string } {
  const plan = loadConcatPlan<ConcatPlan>(deps.paths, input.planFile);
  if (plan.schema !== "film.concat-plan@2")
    fail(
      "FS_SCHEMA_INVALID",
      "/schema",
      "legacy concatenation is read-only; compile a v2 Plan and obtain a new concat approval",
    );
  const digest = planDigest(plan);
  if (input.approvedDigest !== digest)
    throw new Error("Assembly approval does not match the plan");
  requireEnvironment(deps, plan.lock.environment);
  return { plan, digest };
}

/** The pinned Chapter artifacts in Plan order; with `stageDir`, each verified stem is staged there. */
function chapterSources(
  stateDir: string,
  plan: ConcatPlanV2,
  stageDir?: string,
) {
  return plan.chapters.map((c, i) => {
    const stem = stageDir ? `${stageDir}stem-${i}.wav` : undefined;
    const found = findChapterArtifact(
      stateDir,
      c.artifactSha256,
      c.stemSha256,
      stem,
    );
    if (found.artifact.frames !== c.frames)
      fail(
        "FS_ARTIFACT_VERIFY_FAILED",
        "/chapters",
        `${c.chapterId} runtime differs from the concatenation Plan`,
      );
    return { ...c, ...found, stem };
  });
}

export async function renderConcat(
  deps: RenderDeps,
  input: { planFile: string; approvedDigest: string; outName?: string },
): Promise<ConcatRender> {
  const { paths } = deps;
  const started = performance.now();
  const { plan, digest } = requireConcatPlan(deps, input);

  const planPath = outRelative(paths, input.planFile);
  const outName = input.outName ?? planPath.split("/").at(-2)!;
  const fps = plan.profile.fps;
  const cacheDir = `${paths.state}cache/concat/${plan.fingerprint.slice("sha256:".length)}/`;
  const warnings: Warning[] = [];

  let artifact = cachedConcat(cacheDir, digest, warnings);
  const cache: "hit" | "miss" = artifact ? "hit" : "miss";
  let blocked: string[] = [];
  if (artifact) {
    // A hit still needs the approved BGM and intact Chapter media; a miss verifies both while staging them.
    verifyAudio(paths.media, [plan.audio.bgm]);
    chapterSources(paths.state, plan);
  } else {
    const work = `${paths.state}cache/concat/.tmp-${process.pid}/`;
    rmSync(work, { recursive: true, force: true });
    mkdirSync(work, { recursive: true });
    try {
      const audioDir = `${work}audio/`;
      verifyAudio(paths.media, [plan.audio.bgm], audioDir);
      const sources = chapterSources(paths.state, plan, work);
      const stagedSources = sources.map((s) => ({
        file: s.stem!,
        startMs: s.offsetMs,
        startSample: Math.round((s.offsetMs * SAMPLE_RATE) / 1000),
      }));
      const titleFrames = frameCount(plan.overallTitle.titleMs, fps);
      const holdFrames = frameCount(plan.connection.darkenMs, fps);
      const server = await startServer(paths);
      try {
        blocked = (
          await withBrowser((browser) =>
            captureVideo(
              browser,
              server.origin,
              planPath,
              titleFrames,
              fps,
              `${work}title.mp4`,
            ),
          )
        ).blocked;
      } finally {
        await server.close();
      }

      const parts: ConcatArtifact["parts"] = [
        {
          kind: "overall-title",
          chapterId: null,
          startFrame: 0,
          frames: titleFrames,
        },
      ];
      const list = [{ file: `${work}title.mp4`, frames: titleFrames }];
      let frame = titleFrames;
      for (const [i, s] of sources.entries()) {
        const video = `${work}${s.chapterId}.video.mp4`;
        await ffmpeg([
          "-i",
          `${s.dir}${s.artifact.files.mp4.name}`,
          "-map",
          "0:v",
          "-c",
          "copy",
          "-movie_timescale",
          "48000",
          video,
        ]);
        list.push({ file: video, frames: s.artifact.frames });
        parts.push({
          kind: "chapter",
          chapterId: s.chapterId,
          startFrame: frame,
          frames: s.artifact.frames,
        });
        frame += s.artifact.frames;
        if (i === sources.length - 1) break;
        // The darken hold: the Chapter's last frame, brightness ramped linearly toward brightnessTo
        // at each output frame time, as film.connection.darken-briefly declares.
        const last = `${work}${s.chapterId}.last.png`;
        await ffmpeg([
          "-i",
          video,
          "-vf",
          `select=eq(n\\,${s.artifact.frames - 1})`,
          "-frames:v",
          "1",
          last,
        ]);
        const k = `(1-${1 - plan.connection.brightnessTo}*N*1000/(${fps}*${plan.connection.darkenMs}))`;
        const hold = `${work}join-${i}.mp4`;
        await ffmpeg([
          "-loop",
          "1",
          "-framerate",
          String(fps),
          "-i",
          last,
          "-frames:v",
          String(holdFrames),
          "-vf",
          `format=rgb24,geq=r='r(X,Y)*${k}':g='g(X,Y)*${k}':b='b(X,Y)*${k}'`,
          ...X264,
          "-an",
          hold,
        ]);
        list.push({ file: hold, frames: holdFrames });
        parts.push({
          kind: "join",
          chapterId: s.chapterId,
          startFrame: frame,
          frames: holdFrames,
        });
        frame += holdFrames;
      }
      writeFileSync(
        `${work}list.txt`,
        list
          .map((part) => `file '${part.file}'\nduration ${part.frames / fps}`)
          .join("\n") + "\n",
      );
      await ffmpeg([
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        `${work}list.txt`,
        "-c:v",
        "copy",
        "-movie_timescale",
        "48000",
        `${work}video.mp4`,
      ]);

      const bed = bedGraph({
        bgm: plan.audio.bgm,
        runtimeMs: plan.runtimeMs,
        stems: stagedSources,
        mediaDir: audioDir,
        firstInput: 1,
      });
      const name = "concat.mp4";
      await ffmpeg([
        "-i",
        `${work}video.mp4`,
        ...bed.inputs,
        "-filter_complex",
        bed.filter,
        "-map",
        "0:v",
        "-c:v",
        "copy",
        "-map",
        bed.output,
        ...AAC,
        "-movie_timescale",
        "48000",
        "-movflags",
        "+faststart",
        `${work}${name}`,
      ]);
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
        chapters: plan.chapters.map((c) => ({
          chapterId: c.chapterId,
          artifactSha256: c.artifactSha256,
          offsetMs: c.offsetMs,
        })),
        file: {
          name,
          sha256: digestBytes(bytes),
          bytes: statSync(`${work}${name}`).size,
        },
        verified: true,
      };
      for (const f of readdirSync(work))
        if (f !== name) rmSync(`${work}${f}`, { recursive: true, force: true });
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
    files: [
      `out/artifacts/${outName}/concat.mp4`,
      `out/artifacts/${outName}/concat.json`,
    ],
    warnings,
    blocked,
    renderMs: Math.round(performance.now() - started),
  };
}
