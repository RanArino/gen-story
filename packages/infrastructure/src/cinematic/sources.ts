import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { digestBytes, digestOf } from "../contracts/canonical.js";
export const CINEMATIC_BROWSER_FILES = [
  "math.js",
  "visual.js",
  "audio.js",
  "audio-browser.js",
  "sounds/_dsp.js",
  ...[
    "pad",
    "koto-pluck",
    "footstep",
    "wind",
    "stream",
    "bird-chirp",
    "suzu",
    "clap",
    "temple-bell",
    "low-swell",
  ].map((s) => `sounds/${s}.js`),
];
export const cinematicRoot = fileURLToPath(new URL("./", import.meta.url));
export function cinematicIdentity() {
  return {
    version: "film-cinematic-compiler@1",
    digest: digestOf(
      [
        ...CINEMATIC_BROWSER_FILES,
        "compile.ts",
        "types.ts",
        "validate.ts",
        "sources.ts",
        "prepare.ts",
      ].map((name) => [
        name,
        digestBytes(readFileSync(`${cinematicRoot}${name}`)),
      ]),
    ),
  };
}
