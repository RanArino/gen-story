// Locations used by the spike. Tests pass their own temporary state and out directories.
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface SpikePaths {
  root: string; // spikes/film/
  fixtures: string;
  media: string; // .media/
  state: string; // .state/
  out: string; // out/
}

export function defaultPaths(): SpikePaths {
  const root = fileURLToPath(new URL("../", import.meta.url));
  return { root, fixtures: `${root}fixtures/`, media: `${root}.media/`, state: `${root}.state/`, out: `${root}out/` };
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
