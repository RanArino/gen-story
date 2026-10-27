// Independent review evidence is prepared by services and recorded only by a terminal operator.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { sha256Hex } from "../contracts/canonical.js";
import { fail } from "../contracts/errors.js";
import { validateSchema } from "../contracts/schemas.js";
import type { CapabilityRequest, ReviewRecord, ReviewRecordV2 } from "../contracts/types.js";
import { writeJson, type SpikePaths } from "../paths.js";
import { planPromotion } from "../candidates/candidate.js";
import type { Registry } from "./registry.js";
import { confirmationFor } from "./approvals.js";

export interface ReviewInput {
  candidate: string;
  subjectDigest: string;
  subject: string;
  reviewer: string;
  verdict: "accept" | "reject";
  notes: string;
}

// Compare Unicode case equivalents, including expansions, after compatibility normalization.
export function normalizedIdentity(value: string): string {
  return [...value.trim().normalize("NFKC")].map(c => c === "ı" ? c : c.toUpperCase().toLowerCase()).join("").replaceAll("ς", "σ");
}

export function reviewBinding(paths: SpikePaths, registry: Registry, candidate: string) {
  const target = planPromotion(paths, registry, candidate);
  const receipt = JSON.parse(readFileSync(`${target.dir}request.json`, "utf8")) as { request: CapabilityRequest };
  return { candidate, subject: target.target.subject, subjectDigest: target.promotionDigest, author: target.manifest.provenance.author, requester: receipt.request.requester.name };
}

export function prepareReview(paths: SpikePaths, registry: Registry, input: ReviewInput) {
  const binding = reviewBinding(paths, registry, input.candidate);
  if (input.subjectDigest !== binding.subjectDigest || input.subject !== binding.subject) fail("FS_DIGEST_MISMATCH", "/subjectDigest", "review target is stale; recompute candidate promotion-target");
  const reviewer = normalizedIdentity(input.reviewer);
  if (!reviewer || [binding.author, binding.requester].some(a => normalizedIdentity(a) === reviewer)) fail("FS_REVIEW_REQUIRED", "/reviewer", "reviewer must differ from both Manifest author and requester");
  const probe = { schema: "film.review-record@1", id: "rev-000000000000", subjectDigest: input.subjectDigest, subject: input.subject, reviewer: input.reviewer, verdict: input.verdict, notes: input.notes, createdAt: new Date().toISOString() };
  const errors = validateSchema("urn:film-spike:review-record", probe);
  if (errors.length) fail("FS_SCHEMA_INVALID", errors[0]!.path, errors[0]!.message);
  const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
  const command = `film-spike review record ${quote(input.subjectDigest)} --candidate ${quote(input.candidate)} --subject ${quote(input.subject)} --reviewer ${quote(input.reviewer)} --verdict ${input.verdict} --notes ${quote(input.notes)}`;
  return { ...input, ...binding, operatorCommand: command, confirmation: confirmationFor(binding.subjectDigest) };
}

export function recordReview(paths: SpikePaths, registry: Registry, input: ReviewInput, operator: string, confirmation: string): ReviewRecordV2 {
  if (!process.stdin.isTTY || !process.stdout.isTTY) fail("FS_OPERATOR_REQUIRED", "", "review recording requires interactive stdin and stdout");
  const prepared = prepareReview(paths, registry, input);
  if (confirmation !== prepared.confirmation) fail("FS_APPROVAL_MISMATCH", "/confirmation", "type the current target digest confirmation exactly");
  if (!operator.trim()) fail("FS_SCHEMA_INVALID", "/operator", "recording operator is required");
  const now = new Date().toISOString();
  const record: ReviewRecordV2 = {
    schema: "film.review-record@2", id: `rev-${sha256Hex(`${input.subjectDigest}|${input.reviewer}|${now}`).slice(0, 12)}`,
    ...input, author: prepared.author, requester: prepared.requester, operator, createdAt: now,
    confirmation: { kind: "interactive-tty", value: confirmation, confirmedAt: now },
  };
  const errors = validateSchema("urn:film-spike:review-record", record);
  if (errors.length) fail("FS_SCHEMA_INVALID", errors[0]!.path, errors[0]!.message);
  writeJson(`${paths.state}reviews/${record.id}.json`, record);
  return record;
}

export function reviewsFor(stateDir: string, subjectDigest: string): ReviewRecord[] {
  const dir = `${stateDir}reviews/`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => f.endsWith(".json")).map(f => JSON.parse(readFileSync(`${dir}${f}`, "utf8")) as ReviewRecord).filter(r => r.subjectDigest === subjectDigest);
}

export function requireAcceptedReview(stateDir: string, subjectDigest: string, binding: { candidate: string; subject: string; author: string; requester: string }): ReviewRecordV2 {
  const accepted = reviewsFor(stateDir, subjectDigest).find((r): r is ReviewRecordV2 =>
    r.schema === "film.review-record@2" && validateSchema("urn:film-spike:review-record", r).length === 0 &&
    r.verdict === "accept" && r.candidate === binding.candidate && r.subject === binding.subject && r.author === binding.author && r.requester === binding.requester &&
    ![r.author, r.requester].some(a => normalizedIdentity(a) === normalizedIdentity(r.reviewer)) &&
    r.confirmation.value === confirmationFor(subjectDigest));
  if (!accepted) fail("FS_REVIEW_REQUIRED", "", `no current accepted independent v2 review exists for ${subjectDigest}`);
  return accepted;
}
