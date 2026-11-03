// Runtime assets are read-only; project snapshots and caches live in application-owned directories.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface FilmRuntimePaths {
  root: string; // packages/infrastructure/
  fixtures: string;
  media: string; // immutable project assets and bundled sounds
  state: string; // exact registry and verified cache
  out: string; // attempt plans and output bindings
}

/** Writes a file atomically: a temporary sibling, then rename. */
export function writeAtomic(path: string, data: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}`;
  writeFileSync(temp, data);
  renameSync(temp, path);
}

export function writeJson(path: string, value: unknown): void {
  writeAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}
