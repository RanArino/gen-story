// Returns the executable implementation for a promoted registry record. Only records reach here;
// quarantined candidates are never read. Engine-native records load from the built-in table.
// Promoted implementations run from their registry bytes in the contained process, one call each.
import type { CapabilityFunction, CapabilityOutput } from "../capability-sdk/abi.js";
import { executeContained } from "../candidates/runtime.js";
import { fail } from "../contracts/errors.js";
import type { RegistryRecord } from "../contracts/types.js";
import type { Registry } from "../registry/registry.js";
import { loadBuiltin } from "./builtin/index.js";

export interface PromotedLoading {
  registry: Registry;
  /** Where the contained runner writes the transpiled module and each call's input. */
  scratchDir: string;
}

export function loadImplementation(record: RegistryRecord, promoted?: PromotedLoading): CapabilityFunction {
  if (record.trust === "system") return loadBuiltin(record);
  if (!promoted || !record.implementationDigest) return fail("FS_NOT_PROMOTED", "", `${record.id}@${record.version} has no loadable implementation in this build`);
  const source = promoted.registry.readBlob(record.implementationDigest).toString("utf8");
  const dir = `${promoted.scratchDir}${record.implementationDigest.slice("sha256:".length)}`;
  return (input) => JSON.parse(executeContained(source, [input], dir, 1)[0]![0]!) as CapabilityOutput;
}
