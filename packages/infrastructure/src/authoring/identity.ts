import { painterSourceDigest } from "../painter/identity.js";
// Digests of the compiler and painter sources, pinned in every Plan's lock.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { digestBytes, digestOf } from "../contracts/canonical.js";
import { COMPILER_VERSION } from "../compiler/compile.js";

const SRC = fileURLToPath(new URL("../", import.meta.url));
export const PAINTER_ABI = "film-painter@2";

function sources(dir: string): string[] {
  return readdirSync(`${SRC}${dir}`)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .sort()
    .map((f) => `${dir}/${f}`);
}

export function compilerIdentity(): { version: string; digest: string } {
  const files = [
    ...sources("compiler"),
    ...sources("capability-sdk"),
    "contracts/types.ts",
    "contracts/canonical.ts",
    "fonts/samples.ts",
  ];
  return {
    version: COMPILER_VERSION,
    digest: digestOf(
      files.map((f) => [f, digestBytes(readFileSync(`${SRC}${f}`))]),
    ),
  };
}

export function painterIdentity(): { abi: string; digest: string } {
  return {
    abi: PAINTER_ABI,
    digest: painterSourceDigest(),
  };
}
