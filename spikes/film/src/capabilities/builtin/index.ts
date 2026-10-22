// Static table of engine-native (built-in) Capabilities. The loader returns an implementation only
// after checking its source bytes against the implementation digest in the registry record.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CapabilityFunction } from "../../capability-sdk/abi.js";
import { digestBytes } from "../../contracts/canonical.js";
import { fail } from "../../contracts/errors.js";
import type { CapabilityManifest, RegistryRecord } from "../../contracts/types.js";
import fullFrame from "./layout/full-frame/index.js";
import memoryBoard from "./layout/memory-board/index.js";
import pulseSplit from "./layout/pulse-split/index.js";
import beatPulse from "./motion/beat-pulse/index.js";
import parallaxCards from "./motion/parallax-cards/index.js";
import slowCamera from "./motion/slow-camera/index.js";
import staticMotion from "./motion/static/index.js";
import cardSlide from "./transition/card-slide/index.js";
import dip from "./transition/dip/index.js";
import directCut from "./transition/direct-cut/index.js";
import dissolve from "./transition/dissolve/index.js";
import editorialNote from "./typography/editorial-note/index.js";
import kineticPhrase from "./typography/kinetic-phrase/index.js";
import subtitle from "./typography/subtitle/index.js";
import subtitle110 from "./typography/subtitle@1.1.0/index.js";
import ambienceLed from "./sound/ambience-led/index.js";
import beatLed from "./sound/beat-led/index.js";
import intentionalSilence from "./sound/intentional-silence/index.js";
import noSurface from "./surface/no-surface/index.js";
import paperTone from "./surface/paper-tone/index.js";
import softVignette from "./surface/soft-vignette/index.js";
import lightLeak from "./effect/light-leak/index.js";
import darkenBriefly from "./connection/darken-briefly/index.js";

const BUILTIN_DIR = fileURLToPath(new URL("./", import.meta.url));

const IMPLEMENTATIONS: Record<string, CapabilityFunction> = {
  "layout/full-frame": fullFrame,
  "layout/memory-board": memoryBoard,
  "layout/pulse-split": pulseSplit,
  "motion/static": staticMotion,
  "motion/slow-camera": slowCamera,
  "motion/parallax-cards": parallaxCards,
  "motion/beat-pulse": beatPulse,
  "transition/direct-cut": directCut,
  "transition/dissolve": dissolve,
  "transition/card-slide": cardSlide,
  "transition/dip": dip,
  "typography/subtitle": subtitle,
  "typography/subtitle@1.1.0": subtitle110,
  "typography/editorial-note": editorialNote,
  "typography/kinetic-phrase": kineticPhrase,
  "sound/intentional-silence": intentionalSilence,
  "sound/ambience-led": ambienceLed,
  "sound/beat-led": beatLed,
  "surface/no-surface": noSurface,
  "surface/soft-vignette": softVignette,
  "surface/paper-tone": paperTone,
  "effect/light-leak": lightLeak,
  "connection/darken-briefly": darkenBriefly,
};

export interface BuiltinSource {
  key: string;
  manifest: CapabilityManifest;
  implementation: Buffer;
}

/**
 * A built-in's directory. The first version lives in `<kind>/<name>/`; each later version gets
 * its own `<kind>/<name>@<version>/`, so pinned Plans keep replaying the exact older code.
 */
function keyOf(id: string, version: string): string {
  const [, kind, name] = id.split(".");
  const versioned = `${kind}/${name}@${version}`;
  return versioned in IMPLEMENTATIONS ? versioned : `${kind}/${name}`;
}

export function builtinSources(): BuiltinSource[] {
  return Object.keys(IMPLEMENTATIONS).map((key) => ({
    key,
    manifest: JSON.parse(readFileSync(`${BUILTIN_DIR}${key}/manifest.json`, "utf8")) as CapabilityManifest,
    implementation: readFileSync(`${BUILTIN_DIR}${key}/index.ts`),
  }));
}

/** Returns the trusted implementation for a system record after verifying its source digest. */
export function loadBuiltin(record: RegistryRecord): CapabilityFunction {
  const key = keyOf(record.id, record.version);
  const fn = IMPLEMENTATIONS[key];
  if (record.trust !== "system" || !fn) fail("FS_NOT_PROMOTED", "", `${record.id}@${record.version} is not an engine-native Capability`);
  const manifest = JSON.parse(readFileSync(`${BUILTIN_DIR}${key}/manifest.json`, "utf8")) as CapabilityManifest;
  if (manifest.version !== record.version) fail("FS_REPLAY_MISSING_VERSION", "", `${record.id}@${record.version} has no engine-native implementation in this build`);
  const digest = digestBytes(readFileSync(`${BUILTIN_DIR}${key}/index.ts`));
  if (digest !== record.implementationDigest) {
    fail("FS_DIGEST_MISMATCH", "", `${record.id}@${record.version} source digest ${digest} differs from the registry record`);
  }
  return fn;
}
