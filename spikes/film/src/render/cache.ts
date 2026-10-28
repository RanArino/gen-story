// Immutable media and originating Plan live separately from current output bindings.
import { existsSync, readFileSync } from "node:fs";
import { digestBytes } from "../contracts/canonical.js";
import { fail } from "../contracts/errors.js";
import type {
  ChapterArtifact,
  ResolvedRenderPlan,
} from "../contracts/types.js";
import { planDigest, renderDigest } from "../compiler/fingerprint.js";

const REBUILD =
  "render the Chapter with the cache bypassed (--no-cache) to replace it";

function readEntry<T>(file: string): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fail(
      "FS_ARTIFACT_VERIFY_FAILED",
      "/chapters",
      `cached ${file} is unreadable; ${REBUILD}`,
    );
  }
}

export function chapterCacheDir(
  state: string,
  plan: ResolvedRenderPlan,
): string {
  return `${state}cache/chapter-media-v2/${renderDigest(plan).slice(7)}/`;
}

export function verifyChapterFiles(
  dir: string,
  artifact: ChapterArtifact,
): void {
  if (
    !artifact.verified ||
    ![artifact.files.mp4, artifact.files.stem].every(
      (f) =>
        existsSync(`${dir}${f.name}`) &&
        digestBytes(readFileSync(`${dir}${f.name}`)) === f.sha256,
    )
  ) {
    fail(
      "FS_ARTIFACT_VERIFY_FAILED",
      "/chapters",
      `cached Chapter media failed checksum verification: ${dir}; ${REBUILD}`,
    );
  }
}

export function resolveChapterCache(
  state: string,
  plan: ResolvedRenderPlan,
): { dir: string; artifact: ChapterArtifact } | null {
  const dir = chapterCacheDir(state, plan);
  if (!existsSync(`${dir}artifact.json`)) return null;
  const artifact = readEntry<ChapterArtifact>(`${dir}artifact.json`);
  if (!existsSync(`${dir}origin.plan.json`) || !existsSync(`${dir}frames.json`))
    fail(
      "FS_ARTIFACT_VERIFY_FAILED",
      "/chapters",
      `cached originating Plan or frame evidence is missing; ${REBUILD}`,
    );
  const origin = readEntry<ResolvedRenderPlan>(`${dir}origin.plan.json`);
  if (
    planDigest(origin) !== artifact.planDigest ||
    renderDigest(origin) !== renderDigest(plan)
  )
    fail(
      "FS_ARTIFACT_VERIFY_FAILED",
      "/chapters",
      `cached Plan identity is damaged; ${REBUILD}`,
    );
  verifyChapterFiles(dir, artifact);
  return {
    dir,
    artifact: {
      ...artifact,
      planDigest: planDigest(plan),
      fingerprint: plan.fingerprint,
      order: plan.chapter.index,
    },
  };
}
