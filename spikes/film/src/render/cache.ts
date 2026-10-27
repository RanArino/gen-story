// Immutable media and originating Plan live separately from current output bindings.
import { existsSync, readFileSync } from "node:fs";
import { digestBytes } from "../contracts/canonical.js";
import { fail } from "../contracts/errors.js";
import type {
  ChapterArtifact,
  ResolvedRenderPlan,
} from "../contracts/types.js";
import { planDigest, renderDigest } from "../compiler/fingerprint.js";

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
      `cached Chapter media failed checksum verification: ${dir}`,
    );
  }
}

export function resolveChapterCache(
  state: string,
  plan: ResolvedRenderPlan,
): { dir: string; artifact: ChapterArtifact } | null {
  const dir = chapterCacheDir(state, plan);
  if (!existsSync(`${dir}artifact.json`)) return null;
  const artifact = JSON.parse(
    readFileSync(`${dir}artifact.json`, "utf8"),
  ) as ChapterArtifact;
  if (!existsSync(`${dir}origin.plan.json`) || !existsSync(`${dir}frames.json`))
    fail(
      "FS_ARTIFACT_VERIFY_FAILED",
      "/chapters",
      "cached originating Plan or frame evidence is missing",
    );
  const origin = JSON.parse(
    readFileSync(`${dir}origin.plan.json`, "utf8"),
  ) as ResolvedRenderPlan;
  if (
    planDigest(origin) !== artifact.planDigest ||
    renderDigest(origin) !== renderDigest(plan)
  )
    fail(
      "FS_ARTIFACT_VERIFY_FAILED",
      "/chapters",
      "cached Plan identity is damaged",
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
