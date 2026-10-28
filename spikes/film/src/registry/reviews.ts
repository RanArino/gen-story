// Independent review records. Candidate promotion prepares and records them (candidates/candidate.ts).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fail } from "../contracts/errors.js";
import { validateSchema } from "../contracts/schemas.js";
import type { ReviewRecord, ReviewRecordV2 } from "../contracts/types.js";
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
