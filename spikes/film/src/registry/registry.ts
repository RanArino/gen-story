// The authoritative local registry. Content-addressed blobs, append-only records keyed by
// id@version, and a separate activation state. Resolution is exact: { id, version, digest }.
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { canonicalJson, digestBytes } from "../contracts/canonical.js";
import { fail, filmError, type FilmError } from "../contracts/errors.js";
import { validateSchema } from "../contracts/schemas.js";
import type { ExactRef, RegistryRecord } from "../contracts/types.js";
import { writeAtomic, writeJson } from "../paths.js";

export interface PromoteInput {
  entity: RegistryRecord["entity"];
  id: string;
  version: string;
  kind: RegistryRecord["kind"];
  trust: RegistryRecord["trust"];
  manifest: object;
  implementation: Uint8Array | null;
  assets: { name: string; bytes: Uint8Array }[];
  validationReportDigests: string[];
  approvalIds: string[];
  reviewId: string | null;
}

interface ActivationEntry {
  offered: string[];
  deprecated: string[];
  history: { action: "activate" | "deactivate" | "deprecate" | "rollback"; version: string }[];
}
type Activation = Record<string, ActivationEntry>;

export interface Resolved<M = unknown> {
  record: RegistryRecord;
  manifest: M;
}

export class Registry {
  readonly dir: string;

  constructor(
    stateDir: string,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.dir = `${stateDir}registry/`;
  }

  private blobPath(digest: string): string {
    return `${this.dir}blobs/sha256/${digest.slice("sha256:".length)}`;
  }

  private recordPath(id: string, version: string): string {
    return `${this.dir}records/${id}@${version}.json`;
  }

  putBlob(bytes: Uint8Array): string {
    const digest = digestBytes(bytes);
    const path = this.blobPath(digest);
    if (!existsSync(path)) writeAtomic(path, bytes);
    return digest;
  }

  readBlob(digest: string): Buffer {
    const path = this.blobPath(digest);
    if (!existsSync(path)) fail("FS_DIGEST_MISMATCH", "", `blob ${digest} is missing`);
    const bytes = readFileSync(path);
    if (digestBytes(bytes) !== digest) fail("FS_DIGEST_MISMATCH", "", `blob ${digest} does not match its content`);
    return bytes;
  }

  record(id: string, version: string): RegistryRecord | undefined {
    const path = this.recordPath(id, version);
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as RegistryRecord) : undefined;
  }

  records(): RegistryRecord[] {
    const dir = `${this.dir}records/`;
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => JSON.parse(readFileSync(`${dir}${f}`, "utf8")) as RegistryRecord);
  }

  manifest<M>(record: RegistryRecord): M {
    return JSON.parse(this.readBlob(record.manifestDigest).toString("utf8")) as M;
  }

  /**
   * Append-only promotion. Identical bytes at an existing key are a no-op success; different
   * bytes fail with FS_VERSION_COLLISION. Nothing is written unless every check passes.
   */
  promote(input: PromoteInput): { record: RegistryRecord; created: boolean } {
    const manifestBytes = Buffer.from(canonicalJson(input.manifest));
    const manifestDigest = digestBytes(manifestBytes);
    const implementationDigest = input.implementation ? digestBytes(input.implementation) : null;
    const assetDigests = input.assets.map((a) => ({ name: a.name, digest: digestBytes(a.bytes) }));
    const existing = this.record(input.id, input.version);
    if (existing) {
      const same =
        existing.manifestDigest === manifestDigest &&
        existing.implementationDigest === implementationDigest &&
        canonicalJson(existing.assetDigests) === canonicalJson(assetDigests);
      if (same) return { record: existing, created: false };
      fail("FS_VERSION_COLLISION", "", `${input.id}@${input.version} already exists with different bytes`, {
        existing: existing.manifestDigest,
        submitted: manifestDigest,
      });
    }
    const record: RegistryRecord = {
      schema: "film.registry-record@1",
      entity: input.entity,
      id: input.id,
      version: input.version,
      kind: input.kind,
      trust: input.trust,
      manifestDigest,
      implementationDigest,
      assetDigests,
      validationReportDigests: input.validationReportDigests,
      approvalIds: input.approvalIds,
      reviewId: input.reviewId,
      createdAt: this.now(),
    };
    const schemaErrors = validateSchema("urn:film-spike:registry-record", record);
    if (schemaErrors.length) throw new Error(`internal: invalid registry record ${JSON.stringify(schemaErrors)}`);
    this.putBlob(manifestBytes);
    if (input.implementation) this.putBlob(input.implementation);
    for (const asset of input.assets) this.putBlob(asset.bytes);
    writeJson(this.recordPath(input.id, input.version), record);
    return { record, created: true };
  }

  /**
   * Exact resolution. Missing entries are FS_NOT_PROMOTED (or FS_REPLAY_MISSING_VERSION when
   * replaying a pinned Plan); a digest that differs from the record is FS_DIGEST_MISMATCH.
   */
  resolve<M>(ref: ExactRef, mode: "compile" | "replay" = "compile", path = ""): Resolved<M> {
    const record = this.record(ref.id, ref.version);
    if (!record) {
      if (mode === "replay") fail("FS_REPLAY_MISSING_VERSION", path, `${ref.id}@${ref.version} is not in the registry`);
      fail("FS_NOT_PROMOTED", path, `${ref.id}@${ref.version} is not a promoted registry entry`);
    }
    if (record.manifestDigest !== ref.digest) {
      fail("FS_DIGEST_MISMATCH", path, `${ref.id}@${ref.version} has digest ${record.manifestDigest}, not ${ref.digest}`);
    }
    return { record, manifest: this.manifest<M>(record) };
  }

  private readActivation(): Activation {
    const path = `${this.dir}activation.json`;
    return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Activation) : {};
  }

  private writeActivation(activation: Activation): void {
    writeJson(`${this.dir}activation.json`, activation);
  }

  private entry(activation: Activation, id: string): ActivationEntry {
    activation[id] ??= { offered: [], deprecated: [], history: [] };
    return activation[id];
  }

  private requireRecord(id: string, version: string): void {
    if (!this.record(id, version)) fail("FS_NOT_PROMOTED", "", `${id}@${version} is not a promoted registry entry`);
  }

  activate(id: string, version: string): boolean {
    this.requireRecord(id, version);
    const activation = this.readActivation();
    const entry = this.entry(activation, id);
    if (entry.offered.includes(version)) return false;
    entry.offered.push(version);
    entry.history.push({ action: "activate", version });
    this.writeActivation(activation);
    return true;
  }

  deactivate(id: string, version: string): boolean {
    this.requireRecord(id, version);
    const activation = this.readActivation();
    const entry = this.entry(activation, id);
    if (!entry.offered.includes(version)) return false;
    entry.offered = entry.offered.filter((v) => v !== version);
    entry.history.push({ action: "deactivate", version });
    this.writeActivation(activation);
    return true;
  }

  deprecate(id: string, version: string): boolean {
    this.requireRecord(id, version);
    const activation = this.readActivation();
    const entry = this.entry(activation, id);
    if (entry.deprecated.includes(version)) return false;
    entry.deprecated.push(version);
    entry.history.push({ action: "deprecate", version });
    this.writeActivation(activation);
    return true;
  }

  /** Withdraws the most recently activated version and re-offers the one activated before it. */
  rollback(id: string): { withdrawn: string; restored: string } {
    const activation = this.readActivation();
    const entry = this.entry(activation, id);
    const activated = entry.history.filter((h) => h.action === "activate").map((h) => h.version);
    const withdrawn = activated.at(-1);
    const restored = activated.slice(0, -1).reverse().find((v) => v !== withdrawn);
    if (!withdrawn || !restored) fail("FS_NOT_PROMOTED", "", `${id} has no earlier activated version to roll back to`);
    entry.offered = [...entry.offered.filter((v) => v !== withdrawn && v !== restored), restored];
    entry.history.push({ action: "rollback", version: restored });
    this.writeActivation(activation);
    return { withdrawn, restored };
  }

  /** Offered for new work: activated and not deprecated. Pinned references resolve regardless. */
  isOffered(id: string, version: string): boolean {
    const entry = this.readActivation()[id];
    return !!entry && entry.offered.includes(version) && !entry.deprecated.includes(version);
  }

  verify(): FilmError[] {
    const errors: FilmError[] = [];
    for (const record of this.records()) {
      const digests = [record.manifestDigest, record.implementationDigest, ...record.assetDigests.map((a) => a.digest)];
      for (const digest of digests) {
        if (!digest) continue;
        try {
          this.readBlob(digest);
        } catch {
          errors.push(filmError("FS_DIGEST_MISMATCH", `${record.id}@${record.version}`, `blob ${digest} is missing or altered`));
        }
      }
    }
    return errors;
  }

  ensureDirs(): void {
    mkdirSync(`${this.dir}records`, { recursive: true });
    mkdirSync(`${this.dir}blobs/sha256`, { recursive: true });
  }
}
