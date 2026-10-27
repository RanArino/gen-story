// Quarantine files are never registry entries. Every report binds the exact reviewed bytes.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { CapabilityFunction } from "../capability-sdk/abi.js";
import type { CatalogEntry } from "../compiler/resolve.js";
import { canonicalJson, digestBytes, digestOf } from "../contracts/canonical.js";
import { fail, FilmFailure } from "../contracts/errors.js";
import { validateDocument } from "../contracts/semantic.js";
import type { CapabilityManifest, CapabilityRequest, RegistryRecord, ValidationReport } from "../contracts/types.js";
import { writeAtomic, writeJson, type SpikePaths } from "../paths.js";
import { requireApproval } from "../registry/approvals.js";
import type { Registry } from "../registry/registry.js";
import { requireAcceptedReview, reviewBinding } from "../registry/reviews.js";
import { candidateInputs } from "./inputs.js";
import { checkOutput, executeContained, runtimeIdentity } from "./runtime.js";
import { checkManifest, checkSource } from "./static.js";

export function candidateDir(paths: SpikePaths, candidate: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(candidate)) fail("FS_SCHEMA_INVALID", "/candidate", "candidate must be a simple slug");
  return `${paths.state}quarantine/capabilities/${candidate}/`;
}

export function scaffold(paths: SpikePaths, input: { request: CapabilityRequest; approvalId?: string; dryRun?: boolean }) {
  const errors = validateDocument("capability-request", input.request);
  if (errors.length) throw new FilmFailure(errors);
  const requestDigest = digestOf(input.request);
  const approval = requireApproval(paths.state, input.approvalId, "request", requestDigest);
  const candidate = input.request.id;
  const dir = candidateDir(paths, candidate);
  const receipt = { request: input.request, requestDigest, approvalId: approval.id };
  if (existsSync(`${dir}request.json`)) {
    const old = JSON.parse(readFileSync(`${dir}request.json`, "utf8")) as typeof receipt;
    if (old.requestDigest !== requestDigest) fail("FS_VERSION_COLLISION", "/candidate", "candidate already belongs to another request");
    return { candidate, requestDigest, created: false };
  }
  if (existsSync(dir)) fail("FS_VERSION_COLLISION", "/candidate", "candidate directory exists without a request receipt");
  if (input.dryRun ?? true) return { candidate, requestDigest, created: false };
  const template = JSON.parse(readFileSync(`${paths.fixtures}valid/capability-manifest.json`, "utf8")) as CapabilityManifest;
  const manifest: CapabilityManifest = {
    ...template, ...input.request.proposed, kind: input.request.kind,
    title: input.request.title, description: input.request.problem,
    provenance: { author: input.request.requester.name, source: `request ${requestDigest}`, license: "internal" },
  };
  writeJson(`${dir}request.json`, receipt);
  writeJson(`${dir}manifest.json`, manifest);
  writeAtomic(`${dir}implementation.mjs`, '// Author against film-capability@1. This placeholder is not a completed Capability.\nexport default function capability() { throw new Error("Implement approved request"); }\n');
  return { candidate, requestDigest, created: true };
}

export function staticCheck(paths: SpikePaths, registry: Registry, candidate: string, persist = true) {
  const dir = candidateDir(paths, candidate);
  if (!existsSync(`${dir}request.json`)) fail("FS_APPROVAL_REQUIRED", "/candidate", "scaffold from an approved request first");
  const receipt = JSON.parse(readFileSync(`${dir}request.json`, "utf8")) as { request: CapabilityRequest; requestDigest: string; approvalId: string };
  requireApproval(paths.state, receipt.approvalId, "request", digestOf(receipt.request));
  const manifest = JSON.parse(readFileSync(`${dir}manifest.json`, "utf8")) as CapabilityManifest;
  const source = readFileSync(`${dir}implementation.mjs`, "utf8");
  if (manifest.id !== receipt.request.proposed.id || manifest.version !== receipt.request.proposed.version || manifest.kind !== receipt.request.kind) fail("FS_APPROVAL_MISMATCH", "/manifest", "candidate identity differs from its approved request");
  if (Buffer.byteLength(source) + Buffer.byteLength(JSON.stringify(manifest)) > 256 * 1024) fail("FS_RESOURCE_CEILING", "", "candidate exceeds 256 KB");
  const existing = registry.record(manifest.id, manifest.version);
  if (existing && (existing.manifestDigest !== digestOf(manifest) || existing.implementationDigest !== digestBytes(source))) {
    fail("FS_VERSION_COLLISION", "/manifest/version", `${manifest.id}@${manifest.version} is already promoted with different bytes`);
  }
  const promoted = (id: string, version: string): CapabilityManifest | undefined => {
    if (id === manifest.id && version === manifest.version) return manifest;
    const record = registry.record(id, version);
    return record?.entity === "capability" ? registry.manifest<CapabilityManifest>(record) : undefined;
  };
  // A cycle may run through other quarantined candidates; report it as a cycle before requiring
  // that the chain end in promoted Capabilities. Only sibling manifests are read, never their code.
  checkManifest(manifest, (id, version) => promoted(id, version) ?? quarantinedManifest(paths, id, version));
  checkManifest(manifest, promoted);
  checkSource(source);
  const target = { request: digestOf(receipt.request), manifest: digestOf(manifest), implementation: digestBytes(source), runtime: runtimeIdentity(), inputs: digestOf(candidateInputs(manifest)) };
  const executionDigest = digestOf(target);
  const report: ValidationReport = {
    schema: "film.validation-report@1",
    subject: { entity: "capability", id: manifest.id, version: manifest.version, digest: executionDigest },
    gate: "static", ok: true,
    checks: ["request", "manifest", "permissions", "fallback", "source", "size"].map((name) => ({ name, ok: true })),
    data: { candidate, target }, toolchain: { node: process.version }, createdAt: new Date().toISOString(),
  };
  if (persist) {
    writeJson(`${dir}static.json`, report);
    const lines = (source.endsWith("\n") ? source.slice(0, -1) : source).split("\n");
    const ending = source.endsWith("\n") ? "" : "\\ No newline at end of file\n";
    writeAtomic(`${dir}source.diff`, `--- /dev/null\n+++ implementation.mjs\n@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}\n${ending}`);
  }
  return { report, executionDigest };
}

function quarantinedManifest(paths: SpikePaths, id: string, version: string): CapabilityManifest | undefined {
  const root = `${paths.state}quarantine/capabilities/`;
  if (!existsSync(root)) return undefined;
  for (const name of readdirSync(root).sort()) {
    const file = `${root}${name}/manifest.json`;
    if (!existsSync(file)) continue;
    const manifest = JSON.parse(readFileSync(file, "utf8")) as CapabilityManifest;
    if (manifest.id === id && manifest.version === version) return manifest;
  }
  return undefined;
}

/** The candidate's current bytes, provided its saved static report still binds them. */
export function checkedCandidate(paths: SpikePaths, registry: Registry, candidate: string) {
  const dir = candidateDir(paths, candidate);
  if (!existsSync(`${dir}static.json`)) fail("FS_SEMANTIC_INVALID", "/candidate", "a passing static report is required before execution");
  const saved = JSON.parse(readFileSync(`${dir}static.json`, "utf8")) as ValidationReport;
  // Reparse without importing. Changed source, SDK, runner, or fixture inputs invalidates the saved gate.
  const checked = staticCheck(paths, registry, candidate, false);
  if (!saved.ok || saved.gate !== "static" || saved.subject.digest !== checked.executionDigest) fail("FS_DIGEST_MISMATCH", "/candidate", "static report is stale; rerun static-check, inspect its report, and obtain its execution approval");
  const manifest = JSON.parse(readFileSync(`${dir}manifest.json`, "utf8")) as CapabilityManifest;
  const source = readFileSync(`${dir}implementation.mjs`, "utf8");
  return { dir, executionDigest: checked.executionDigest, staticReport: saved, manifest, source };
}

/** The saved runtime report, provided it was produced for the current execution target. */
export function runtimeReport(dir: string, executionDigest: string): ValidationReport {
  if (!existsSync(`${dir}runtime.json`)) fail("FS_SEMANTIC_INVALID", "/candidate", "a passing runtime report is required; run the candidate first");
  const report = JSON.parse(readFileSync(`${dir}runtime.json`, "utf8")) as ValidationReport;
  if (!report.ok || report.gate !== "runtime" || report.subject.digest !== executionDigest) fail("FS_DIGEST_MISMATCH", "/candidate", "runtime report is stale; run the candidate again under its execution approval");
  return report;
}

/**
 * A catalog entry for compiling a quarantined candidate before promotion. It is never persisted,
 * and its function refuses to run: quarantined code executes only in the contained process.
 */
export function quarantinedEntry(paths: SpikePaths, registry: Registry, candidate: string): { entry: CatalogEntry; executionDigest: string; dir: string } {
  const c = checkedCandidate(paths, registry, candidate);
  const { id, version, kind } = c.manifest;
  // Only the lock fields are read during compilation.
  const record = { id, version, kind, manifestDigest: digestOf(c.manifest), implementationDigest: digestBytes(c.source), assetDigests: [] } as unknown as RegistryRecord;
  const run: CapabilityFunction = () => fail("FS_NOT_PROMOTED", "", `${id}@${version} is quarantined; its code never runs in-process`);
  return { entry: { record, manifest: c.manifest, run }, executionDigest: c.executionDigest, dir: c.dir };
}

/** Execution is permitted only for the exact source and inputs bound by a passing static report. */
export function runCandidate(paths: SpikePaths, registry: Registry, input: { candidate: string; approvalId?: string; dryRun?: boolean }) {
  const { dir, executionDigest, manifest, source } = checkedCandidate(paths, registry, input.candidate);
  const approval = requireApproval(paths.state, input.approvalId, "execution", executionDigest);
  if (input.dryRun ?? true) return { executionDigest, report: null };
  const fixtures = candidateInputs(manifest);
  const inputs = fixtures.map((fixture) => fixture.input);
  const repeated = executeContained(source, inputs, `${dir}run-first`, 2);
  const restarted = executeContained(source, inputs, `${dir}run-second`, 1);
  fixtures.forEach((fixture, i) => {
    const first = repeated[i]?.[0];
    if (first === undefined || first !== repeated[i]?.[1] || first !== restarted[i]?.[0]) fail("FS_NONDETERMINISTIC", `/fixtures/${i}`, `${fixture.name} changed between repeated calls or processes`);
    checkOutput(first, manifest);
  });
  const report: ValidationReport = {
    schema: "film.validation-report@1",
    subject: { entity: "capability", id: manifest.id, version: manifest.version, digest: executionDigest },
    gate: "runtime", ok: true,
    checks: fixtures.map((fixture) => ({ name: fixture.name, ok: true })),
    data: { approvalId: approval.id, executionsPerFixture: 3, processes: 2, outputs: repeated.map((outputs) => digestBytes(outputs[0]!)) },
    toolchain: { node: process.version }, createdAt: new Date().toISOString(),
  };
  writeJson(`${dir}runtime.json`, report);
  return { executionDigest, report };
}

function boundReport(dir: string, file: string, executionDigest: string): Record<string, unknown> {
  if (!existsSync(`${dir}${file}`)) fail("FS_SEMANTIC_INVALID", "/candidate", `${file} is required before promotion`);
  const report = JSON.parse(readFileSync(`${dir}${file}`, "utf8")) as { ok?: boolean; subject?: { digest?: string } };
  if (report.ok !== true || report.subject?.digest !== executionDigest) fail("FS_DIGEST_MISMATCH", "/candidate", `${file} does not bind the current execution target`);
  return report;
}

/** What the review and the promotion approval bind: the exact bytes plus every gate's report. */
export function planPromotion(paths: SpikePaths, registry: Registry, candidate: string) {
  const c = checkedCandidate(paths, registry, candidate);
  const reports = {
    static: c.staticReport,
    runtime: runtimeReport(c.dir, c.executionDigest),
    compile: boundReport(c.dir, "compile.json", c.executionDigest),
    evidence: boundReport(c.dir, "evidence.json", c.executionDigest),
  };
  const target = {
    subject: `${c.manifest.id}@${c.manifest.version}`,
    manifest: digestOf(c.manifest),
    implementation: digestBytes(c.source),
    execution: c.executionDigest,
    reports: Object.fromEntries(Object.entries(reports).map(([name, report]) => [name, digestOf(report)])),
  };
  return { ...c, reports, target, promotionDigest: digestOf(target) };
}

/** Promotion needs an accepted independent review of the target, then an exact promotion approval. */
export function promoteCandidate(paths: SpikePaths, registry: Registry, input: { candidate: string; approvalId?: string; dryRun?: boolean }) {
  const plan = planPromotion(paths, registry, input.candidate);
  const review = requireAcceptedReview(paths.state, plan.promotionDigest, reviewBinding(paths, registry, input.candidate));
  const approval = requireApproval(paths.state, input.approvalId, "promotion", plan.promotionDigest);
  if (input.dryRun ?? true) return { plan, record: null, created: false };
  const receipt = JSON.parse(readFileSync(`${plan.dir}request.json`, "utf8")) as { approvalId: string };
  const reportDigests = Object.values(plan.reports).map((report) => registry.putBlob(Buffer.from(canonicalJson(report))));
  const { record, created } = registry.promote({
    entity: "capability",
    id: plan.manifest.id,
    version: plan.manifest.version,
    kind: plan.manifest.kind,
    trust: "promoted",
    manifest: plan.manifest,
    implementation: Buffer.from(plan.source),
    assets: [],
    validationReportDigests: reportDigests,
    approvalIds: [receipt.approvalId, String(plan.reports.runtime.data?.approvalId), approval.id],
    reviewId: review.id,
  });
  registry.activate(record.id, record.version);
  return { plan, record, created };
}
