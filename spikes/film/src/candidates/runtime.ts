import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import type { CapabilityInput, CapabilityOutput } from "../capability-sdk/abi.js";
import { runContained } from "../containment/contained.js";
import { digestBytes } from "../contracts/canonical.js";
import { fail } from "../contracts/errors.js";
import type { CapabilityManifest } from "../contracts/types.js";
import { writeAtomic, writeJson } from "../paths.js";
import { SDK_IMPORT } from "./static.js";

const ENTRY = fileURLToPath(new URL("./runner-entry.mjs", import.meta.url));
const HELPERS = fileURLToPath(new URL("../capability-sdk/helpers.ts", import.meta.url));

/** The SDK is trusted, transpiled once per run, and identified in the execution target. */
export function runtimeIdentity(): string {
  const files = [ENTRY, HELPERS, fileURLToPath(import.meta.url), fileURLToPath(new URL("./inputs.ts", import.meta.url)), fileURLToPath(new URL("../containment/contained.ts", import.meta.url))];
  return digestBytes(files.map((file) => readFileSync(file, "utf8")).join("\n"));
}

export function executeContained(source: string, inputs: CapabilityInput[], dir: string, repetitions: number): string[][] {
  // Static parsing has restricted imports to this exact SDK specifier.
  const javascript = source.replace(/(["'])film-capability-sdk\1/g, '"./sdk.mjs"');
  writeAtomic(`${dir}/implementation.mjs`, javascript);
  const sdk = ts.transpileModule(readFileSync(HELPERS, "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  writeAtomic(`${dir}/sdk.mjs`, sdk);
  writeJson(`${dir}/inputs.json`, inputs);
  const result = runContained(ENTRY, [`${dir}/implementation.mjs`, `${dir}/inputs.json`, String(repetitions)], { readRoots: [ENTRY, dir] });
  if (result.timedOut || /heap out of memory|allocation failed/i.test(result.stderr)) fail("FS_RESOURCE_CEILING", "", "candidate exceeded the 30-second or memory ceiling");
  if (result.status !== 0) fail("FS_RUNTIME_ERROR", "", result.stderr.slice(0, 2000));
  try {
    return (JSON.parse(result.stdout) as { outputs: string[][] }).outputs;
  } catch {
    return fail("FS_RUNTIME_ERROR", "", "candidate did not produce the runner protocol");
  }
}

export function checkOutput(raw: string, manifest: CapabilityManifest): CapabilityOutput {
  const value = JSON.parse(raw) as CapabilityOutput;
  if (!value || !Array.isArray(value.layers) || !Array.isArray(value.audio)) fail("FS_RUNTIME_ERROR", "", "output needs layers and audio arrays");
  let primitives = 0;
  let keyframes = 0;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const obj = node as Record<string, unknown>;
    if (typeof obj.type === "string") primitives += 1;
    if (Array.isArray(obj.keys)) keyframes += obj.keys.length;
    Object.values(obj).forEach(walk);
  };
  walk(value);
  if (primitives > manifest.budgets.maxPrimitives || keyframes > manifest.budgets.maxKeyframes || value.audio.length > manifest.budgets.maxAudioEvents) {
    fail("FS_RESOURCE_CEILING", "", "candidate output exceeds declared primitive, keyframe, or audio budget", { primitives, keyframes, audioEvents: value.audio.length });
  }
  return value;
}

// Exposed for the static contract tests and documentation, not a configurable import map.
export { SDK_IMPORT };
