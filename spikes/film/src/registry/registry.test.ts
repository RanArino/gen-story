import { readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FilmFailure } from "../contracts/errors.js";
import { validateDocument } from "../contracts/semantic.js";
import { validateSchema } from "../contracts/schemas.js";
import type { ApprovalRecord, CapabilityManifest } from "../contracts/types.js";
import { loadBuiltin } from "../capabilities/builtin/index.js";
import { readFixture } from "../testing/fixtures.js";
import { operatorApproves, tempPaths } from "../testing/state.js";
import { confirmationFor, createApproval, requireApproval } from "./approvals.js";
import { bootstrapBuiltins } from "./bootstrap.js";
import { Registry } from "./registry.js";
import { recordReview, requireAcceptedReview } from "./reviews.js";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof FilmFailure) return error.errors[0]?.code;
    throw error;
  }
  return undefined;
}

const manifest = readFixture<CapabilityManifest>("valid/capability-manifest.json");
const promoteInput = (implementation: string) => ({
  entity: "capability" as const,
  id: manifest.id,
  version: manifest.version,
  kind: manifest.kind,
  trust: "promoted" as const,
  manifest,
  implementation: Buffer.from(implementation),
  assets: [],
  validationReportDigests: [],
  approvalIds: [],
  reviewId: null,
});

describe("registry", () => {
  it("promotes append-only and rejects different bytes at an existing key", () => {
    const registry = new Registry(tempPaths().state);
    const first = registry.promote(promoteInput("export default () => ({ layers: [], audio: [] });"));
    expect(first.created).toBe(true);
    expect(validateSchema("urn:film-spike:registry-record", first.record)).toEqual([]);
    expect(registry.promote(promoteInput("export default () => ({ layers: [], audio: [] });")).created).toBe(false);
    expect(codeOf(() => registry.promote(promoteInput("export default () => null;")))).toBe("FS_VERSION_COLLISION");
    expect(registry.record(manifest.id, manifest.version)).toEqual(first.record);
  });

  it("resolves only exact { id, version, digest } references", () => {
    const registry = new Registry(tempPaths().state);
    const { record } = registry.promote(promoteInput("x"));
    expect(registry.resolve({ id: record.id, version: record.version, digest: record.manifestDigest }).manifest).toEqual(manifest);
    expect(codeOf(() => registry.resolve({ id: record.id, version: "1.0.1", digest: record.manifestDigest }))).toBe("FS_NOT_PROMOTED");
    expect(codeOf(() => registry.resolve({ id: record.id, version: "1.0.1", digest: record.manifestDigest }, "replay"))).toBe("FS_REPLAY_MISSING_VERSION");
    expect(codeOf(() => registry.resolve({ id: record.id, version: record.version, digest: `sha256:${"0".repeat(64)}` }))).toBe("FS_DIGEST_MISMATCH");
  });

  it("deactivation, deprecation, and rollback change new selection but not pinned resolution", () => {
    const registry = new Registry(tempPaths().state);
    const v1 = registry.promote(promoteInput("v1")).record;
    const v2 = registry.promote({ ...promoteInput("v2"), version: "1.1.0", manifest: { ...manifest, version: "1.1.0" } }).record;
    registry.activate(v1.id, "1.0.0");
    registry.activate(v2.id, "1.1.0");
    expect(registry.rollback(v1.id)).toEqual({ withdrawn: "1.1.0", restored: "1.0.0" });
    expect(registry.isOffered(v1.id, "1.1.0")).toBe(false);
    expect(registry.isOffered(v1.id, "1.0.0")).toBe(true);
    registry.deprecate(v1.id, "1.0.0");
    expect(registry.isOffered(v1.id, "1.0.0")).toBe(false);
    registry.deactivate(v1.id, "1.0.0");
    expect(registry.resolve({ id: v1.id, version: "1.0.0", digest: v1.manifestDigest }).record).toEqual(v1);
    expect(registry.resolve({ id: v2.id, version: "1.1.0", digest: v2.manifestDigest }).record).toEqual(v2);
  });

  it("verify detects an altered blob", () => {
    const paths = tempPaths();
    const registry = new Registry(paths.state);
    const { record } = registry.promote(promoteInput("original"));
    expect(registry.verify()).toEqual([]);
    const blob = `${registry.dir}blobs/sha256/${record.implementationDigest!.slice(7)}`;
    writeFileSync(blob, "tampered");
    expect(registry.verify().map((e) => e.code)).toEqual(["FS_DIGEST_MISMATCH"]);
  });
});

describe("approvals and reviews", () => {
  it("bind one kind to one exact digest and require the typed confirmation", () => {
    const paths = tempPaths();
    const digest = `sha256:${"a".repeat(64)}`;
    expect(codeOf(() => createApproval(paths.state, { kind: "request", targetDigest: digest, subject: "x", operator: "op", confirmation: "deadbeef" }))).toBe(
      "FS_APPROVAL_MISMATCH",
    );
    const id = operatorApproves(paths, "request", digest);
    const record = JSON.parse(readFileSync(`${paths.state}approvals/${id}.json`, "utf8")) as ApprovalRecord;
    expect(validateDocument("approval-record", record)).toEqual([]);
    expect(record.confirmation).toBe(confirmationFor(digest));
    expect(requireApproval(paths.state, id, "request", digest).id).toBe(id);
    expect(codeOf(() => requireApproval(paths.state, undefined, "request", digest))).toBe("FS_APPROVAL_REQUIRED");
    expect(codeOf(() => requireApproval(paths.state, "appr-000000000000", "request", digest))).toBe("FS_APPROVAL_REQUIRED");
    expect(codeOf(() => requireApproval(paths.state, id, "promotion", digest))).toBe("FS_APPROVAL_MISMATCH");
    expect(codeOf(() => requireApproval(paths.state, id, "request", `sha256:${"b".repeat(64)}`))).toBe("FS_APPROVAL_MISMATCH");
  });

  it("promotion evidence needs an accepted independent review", () => {
    const paths = tempPaths();
    const digest = `sha256:${"c".repeat(64)}`;
    expect(codeOf(() => requireAcceptedReview(paths.state, digest))).toBe("FS_REVIEW_REQUIRED");
    recordReview(paths.state, { subjectDigest: digest, subject: "x", reviewer: "reviewer", verdict: "reject", notes: "Edge flickers." });
    expect(codeOf(() => requireAcceptedReview(paths.state, digest))).toBe("FS_REVIEW_REQUIRED");
    recordReview(paths.state, { subjectDigest: digest, subject: "x", reviewer: "reviewer", verdict: "accept", notes: "Fixed." });
    expect(requireAcceptedReview(paths.state, digest).verdict).toBe("accept");
  });
});

describe("built-in bootstrap", () => {
  it("registers every built-in with trust system, idempotently, and loads them only by verified digest", () => {
    const paths = tempPaths();
    const registry = new Registry(paths.state);
    const first = bootstrapBuiltins(registry, paths.media);
    // 22 Capabilities; the three typography Capabilities each in two versions.
    expect(first.filter((m) => m.kind === "registry.promote")).toHaveLength(25);
    expect(bootstrapBuiltins(registry, paths.media)).toEqual([]);
    const records = registry.records();
    expect(records.every((r) => r.trust === "system" && r.implementationDigest)).toBe(true);
    const ambience = records.find((r) => r.id === "film.sound.ambience-led")!;
    expect(ambience.assetDigests.map((a) => a.name)).toEqual(["ambience", "hit"]);
    for (const record of records) {
      expect(typeof loadBuiltin(record)).toBe("function");
      expect(validateDocument("capability-manifest", registry.manifest(record))).toEqual([]);
    }
    expect(codeOf(() => loadBuiltin({ ...records[0]!, implementationDigest: `sha256:${"0".repeat(64)}` }))).toBe("FS_DIGEST_MISMATCH");
    const subtitles = records.filter((r) => r.id === "film.typography.subtitle").sort((a, b) => (a.version < b.version ? -1 : 1));
    expect(subtitles.map((r) => r.version)).toEqual(["1.0.0", "1.1.0"]);
    expect(subtitles[0]!.implementationDigest).not.toBe(subtitles[1]!.implementationDigest);
    expect(loadBuiltin(subtitles[0]!)).not.toBe(loadBuiltin(subtitles[1]!));
    expect(codeOf(() => loadBuiltin({ ...subtitles[1]!, version: "1.2.0" }))).toBe("FS_REPLAY_MISSING_VERSION");
  });

  it("every Level 1 built-in declares a same-kind fallback edge that terminates at Level 0", () => {
    const paths = tempPaths();
    const registry = new Registry(paths.state);
    bootstrapBuiltins(registry, paths.media);
    const manifests = registry.records().map((r) => registry.manifest<CapabilityManifest>(r));
    const byId = new Map(manifests.map((m) => [m.id, m]));
    for (const m of manifests.filter((x) => x.level === 1 && x.kind !== "effect")) {
      let node: CapabilityManifest | undefined = m;
      const seen = new Set<string>();
      while (node && node.level !== 0) {
        expect(seen.has(node.id)).toBe(false);
        seen.add(node.id);
        node = node.fallback ? byId.get(node.fallback.id) : undefined;
      }
      expect(node?.level, m.id).toBe(0);
    }
    expect(byId.get("film.effect.light-leak")!.fallback).toBeNull();
  });
});
