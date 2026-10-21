// Independent review records. A review is evidence for promotion, never an approval.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { sha256Hex } from "../contracts/canonical.js";
import { fail } from "../contracts/errors.js";
import { validateSchema } from "../contracts/schemas.js";
import type { ReviewRecord } from "../contracts/types.js";
import { writeJson } from "../paths.js";

export type ReviewInput = Pick<ReviewRecord, "subjectDigest" | "subject" | "reviewer" | "verdict" | "notes">;

export function recordReview(stateDir: string, input: ReviewInput, now = new Date().toISOString()): ReviewRecord {
  const record: ReviewRecord = {
    schema: "film.review-record@1",
    id: `rev-${sha256Hex(`${input.subjectDigest}|${input.reviewer}|${now}`).slice(0, 12)}`,
    ...input,
    createdAt: now,
  };
  const errors = validateSchema("urn:film-spike:review-record", record);
  if (errors.length) fail("FS_SCHEMA_INVALID", errors[0]!.path, errors[0]!.message);
  writeJson(`${stateDir}reviews/${record.id}.json`, record);
  return record;
}

export function reviewsFor(stateDir: string, subjectDigest: string): ReviewRecord[] {
  const dir = `${stateDir}reviews/`;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(`${dir}${f}`, "utf8")) as ReviewRecord)
    .filter((r) => r.subjectDigest === subjectDigest);
}

export function requireAcceptedReview(stateDir: string, subjectDigest: string): ReviewRecord {
  const accepted = reviewsFor(stateDir, subjectDigest).find((r) => r.verdict === "accept");
  if (!accepted) fail("FS_REVIEW_REQUIRED", "", `no accepted independent review exists for ${subjectDigest}`);
  return accepted;
}
