// Spike-grade containment: a Node.js child process under the permission model. Read access is
// limited to the given roots, write access to at most one evidence directory, with no network,
// child processes, workers, addons, or WASI, an empty environment, a heap cap, and a wall-clock kill.
// This is not a production sandbox.
import { spawnSync } from "node:child_process";

export const CONTAINED_TIMEOUT_MS = 30_000;

export interface ContainedOptions {
  readRoots: string[];
  writeRoot?: string;
  timeoutMs?: number;
}

export interface ContainedResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  durationMs: number;
}

export function runContained(entry: string, args: string[], options: ContainedOptions): ContainedResult {
  const flags = [
    "--permission",
    ...options.readRoots.map((root) => `--allow-fs-read=${root}`),
    ...(options.writeRoot ? [`--allow-fs-write=${options.writeRoot}`] : []),
    "--max-old-space-size=256",
    "--disallow-code-generation-from-strings",
  ];
  const started = performance.now();
  const result = spawnSync(process.execPath, [...flags, entry, ...args], {
    env: {},
    encoding: "utf8",
    timeout: options.timeoutMs ?? CONTAINED_TIMEOUT_MS,
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut: result.error !== undefined && (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT",
    durationMs: Math.round(performance.now() - started),
  };
}
