import { writeJson } from "../paths.js";
// Quarantined candidates in a temporary test world. Requests, approvals, and source are written
// only under the world's temporary state; the operator's quarantine and registry are never touched.
import { readFileSync, writeFileSync } from "node:fs";
import { candidateDir } from "../candidates/candidate.js";
import { digestOf } from "../contracts/canonical.js";
import type { CapabilityManifest, CapabilityRequest, FilmChapters, FilmTreatment } from "../contracts/types.js";
import { FIXTURES, readFixture } from "./fixtures.js";
import { operatorApproves } from "./state.js";
import type { World } from "./world.js";

export const VALID_DIR = `${FIXTURES}candidates/valid/torn-reveal/`;
export const INVALID_DIR = `${FIXTURES}candidates/invalid/`;
export const chapters = () => readFixture<FilmChapters>("project/chapters.json");

export interface ScaffoldedCandidate {
  candidate: string;
  dir: string;
  manifest: CapabilityManifest;
  requestApproval: string;
}

/**
 * Scaffolds a candidate under an approved request and replaces its files. `manifest` is either a
 * complete Manifest or overrides applied to the scaffolded one.
 */
export function scaffoldCandidate(world: World, candidate: string, manifest: Partial<CapabilityManifest>, source: string, complete = false): ScaffoldedCandidate {
  const base = readFixture<CapabilityRequest>("requests/torn-reveal.request.json");
  const request: CapabilityRequest = { ...base, id: candidate, title: `${candidate} test candidate`, proposed: { id: manifest.id!, version: manifest.version! } };
  const requestApproval = operatorApproves(world.paths, "request", digestOf(request));
  const scaffolded = world.service.candidateScaffold({ request, approvalId: requestApproval, dryRun: false });
  if (!scaffolded.ok) throw new Error(JSON.stringify(scaffolded.errors));
  const dir = candidateDir(world.paths, candidate);
  const written = complete ? (manifest as CapabilityManifest) : { ...(JSON.parse(readFileSync(`${dir}manifest.json`, "utf8")) as CapabilityManifest), ...manifest };
  writeFileSync(`${dir}manifest.json`, JSON.stringify(written, null, 2));
  writeFileSync(`${dir}implementation.mjs`, source);
  return { candidate, dir, manifest: written, requestApproval };
}

/** The committed copy of the real torn-reveal 1.0.0 Manifest and implementation. */
export function scaffoldTornReveal(world: World, candidate = "torn-reveal"): ScaffoldedCandidate {
  const manifest = JSON.parse(readFileSync(`${VALID_DIR}manifest.json`, "utf8")) as CapabilityManifest;
  return scaffoldCandidate(world, candidate, manifest, readFileSync(`${VALID_DIR}implementation.mjs`, "utf8"), true);
}

/** Static check, then an execution approval and the contained run, as the operator would allow. */
export function checkAndRun(world: World, candidate: string): { executionDigest: string; executionApproval: string } {
  const checked = world.service.candidateStaticCheck({ candidate });
  if (!checked.ok) throw new Error(JSON.stringify(checked.errors));
  const executionDigest = checked.hashes.execution!;
  const executionApproval = operatorApproves(world.paths, "execution", executionDigest);
  const run = world.service.candidateRun({ candidate, approvalId: executionApproval, dryRun: false });
  if (!run.ok) throw new Error(JSON.stringify(run.errors));
  return { executionDigest, executionApproval };
}

/** Every gate after scaffolding, as the operator and an independent reviewer would allow. Needs Chrome for evidence. */
export async function promoteThroughLifecycle(world: World, candidate: string, treatment: FilmTreatment): Promise<string> {
  const { service, paths } = world;
  const { executionApproval } = checkAndRun(world, candidate);
  const compiled = service.candidateCompile({ candidate, treatment, chapters: chapters() });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.errors));
  const evidence = await service.candidateEvidence({ candidate, approvalId: executionApproval, dryRun: false });
  if (!evidence.ok) throw new Error(JSON.stringify(evidence.errors));
  const target = service.candidatePromotionTarget({ candidate }).result!;
  operatorReviews(world, { candidate, subjectDigest: target.digest, subject: target.subject, reviewer: "test reviewer", verdict: "accept", notes: "Test review." });
  const promoted = service.registryPromote({ candidate, approvalId: operatorApproves(paths, "promotion", target.digest), dryRun: false });
  if (!promoted.ok) throw new Error(JSON.stringify(promoted.errors));
  return target.digest;
}

/** Simulated operator evidence in isolated test state; the service itself never writes reviews. */
export function operatorReviews(world: World, input: import("../registry/reviews.js").ReviewInput) {
  const prepared = world.service.reviewRecord({ ...input, dryRun: true });
  if (!prepared.ok) throw new Error(JSON.stringify(prepared.errors));
  const p = prepared.result!;
  const record: import("../contracts/types.js").ReviewRecordV2 = {
    schema: "film.review-record@2", id: `rev-${digestOf(input).slice(7, 19)}`, ...input,
    author: p.author, requester: p.requester, operator: "test operator", createdAt: new Date().toISOString(),
    confirmation: { kind: "interactive-tty", value: p.confirmation, confirmedAt: new Date().toISOString() },
  };
  writeJson(`${world.paths.state}reviews/${record.id}.json`, record);
  return record;
}
