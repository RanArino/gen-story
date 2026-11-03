// Reads the media lock written by prepare-media.ts and verifies locked bytes on demand.
import { existsSync, readFileSync } from "node:fs";
import { digestBytes } from "../contracts/canonical.js";
import { fail } from "../contracts/errors.js";

export interface MediaLockEntry {
  path: string;
  kind: "image" | "sound";
  sha256: string;
  widthPx?: number;
  heightPx?: number;
  durationMs?: number;
}
export interface MediaLock {
  version: 1;
  beatMs: number;
  files: MediaLockEntry[];
}

export function readMediaLock(mediaDir: string): MediaLock {
  const path = `${mediaDir}media-lock.json`;
  if (!existsSync(path))
    fail(
      "FS_ARTIFACT_VERIFY_FAILED",
      "",
      "media-lock.json is missing; run prepare:media",
    );
  return JSON.parse(readFileSync(path, "utf8")) as MediaLock;
}

export function lockedEntry(
  lock: MediaLock,
  asset: string,
  path = "",
): MediaLockEntry {
  const entry = lock.files.find((f) => f.path === asset);
  if (!entry)
    fail("FS_DIGEST_MISMATCH", path, `${asset} is not in the media lock`);
  return entry;
}

/** Reads locked bytes and fails if they drifted from the lock. */
export function readLockedBytes(
  mediaDir: string,
  lock: MediaLock,
  asset: string,
): Buffer {
  const entry = lockedEntry(lock, asset);
  const bytes = readFileSync(`${mediaDir}${asset}`);
  if (digestBytes(bytes) !== entry.sha256)
    fail("FS_DIGEST_MISMATCH", "", `${asset} no longer matches the media lock`);
  return bytes;
}
