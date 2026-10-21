// Registers every engine-native Capability with trust `system` and activates it. Idempotent:
// a second run finds identical records and changes nothing.
import { builtinSources } from "../capabilities/builtin/index.js";
import type { Mutation } from "../contracts/envelope.js";
import { FilmFailure } from "../contracts/errors.js";
import { validateDocument } from "../contracts/semantic.js";
import { readLockedBytes, readMediaLock } from "../media/lock.js";
import type { Registry } from "./registry.js";

export function bootstrapBuiltins(registry: Registry, mediaDir: string): Mutation[] {
  const lock = readMediaLock(mediaDir);
  const mutations: Mutation[] = [];
  for (const source of builtinSources()) {
    const errors = validateDocument("capability-manifest", source.manifest);
    if (errors.length) throw new FilmFailure(errors);
    const { record, created } = registry.promote({
      entity: "capability",
      id: source.manifest.id,
      version: source.manifest.version,
      kind: source.manifest.kind,
      trust: "system",
      manifest: source.manifest,
      implementation: source.implementation,
      assets: source.manifest.assets.map((a) => ({ name: a.name, bytes: readLockedBytes(mediaDir, lock, a.media) })),
      validationReportDigests: [],
      approvalIds: [],
      reviewId: null,
    });
    if (created) mutations.push({ kind: "registry.promote", target: `${record.id}@${record.version}`, beforeDigest: null, afterDigest: record.manifestDigest });
    if (registry.activate(record.id, record.version)) {
      mutations.push({ kind: "registry.activate", target: `${record.id}@${record.version}`, beforeDigest: null, afterDigest: record.manifestDigest });
    }
  }
  return mutations;
}
