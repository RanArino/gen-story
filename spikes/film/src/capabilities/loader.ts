// Returns the executable implementation for a promoted registry record. Only records reach here;
// quarantined candidates are never read. Engine-native records load from the built-in table.
import type { CapabilityFunction } from "../capability-sdk/abi.js";
import { fail } from "../contracts/errors.js";
import type { RegistryRecord } from "../contracts/types.js";
import { loadBuiltin } from "./builtin/index.js";

export function loadImplementation(record: RegistryRecord): CapabilityFunction {
  if (record.trust === "system") return loadBuiltin(record);
  return fail("FS_NOT_PROMOTED", "", `${record.id}@${record.version} has no loadable implementation in this build`);
}
