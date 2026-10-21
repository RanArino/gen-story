// Digest-bound operator approvals. Only the interactive CLI creates them (see adapters/cli.ts);
// services only check them. An approval binds one kind to one exact target digest.
import { existsSync, readFileSync } from "node:fs";
import { sha256Hex } from "../contracts/canonical.js";
import { fail } from "../contracts/errors.js";
import { validateSchema } from "../contracts/schemas.js";
import type { ApprovalKind, ApprovalRecord } from "../contracts/types.js";
import { writeJson } from "../paths.js";

function approvalPath(stateDir: string, id: string): string {
  return `${stateDir}approvals/${id}.json`;
}

export function confirmationFor(digest: string): string {
  return digest.slice("sha256:".length, "sha256:".length + 8);
}

export interface ApprovalInput {
  kind: ApprovalKind;
  targetDigest: string;
  subject: string;
  operator: string;
  /** The first eight hex characters of the target digest, typed by the operator. */
  confirmation: string;
}

export function createApproval(stateDir: string, input: ApprovalInput, now = new Date().toISOString()): ApprovalRecord {
  if (input.confirmation !== confirmationFor(input.targetDigest)) {
    fail("FS_APPROVAL_MISMATCH", "/confirmation", "the typed confirmation does not match the target digest");
  }
  const record: ApprovalRecord = {
    schema: "film.approval-record@1",
    id: `appr-${sha256Hex(`${input.kind}|${input.targetDigest}|${now}`).slice(0, 12)}`,
    ...input,
    createdAt: now,
  };
  const errors = validateSchema("urn:film-spike:approval-record", record);
  if (errors.length) fail("FS_SCHEMA_INVALID", errors[0]!.path, errors[0]!.message);
  writeJson(approvalPath(stateDir, record.id), record);
  return record;
}

export function readApproval(stateDir: string, id: string): ApprovalRecord | undefined {
  if (!/^appr-[0-9a-f]{12}$/.test(id)) return undefined;
  const path = approvalPath(stateDir, id);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as ApprovalRecord) : undefined;
}

export function requireApproval(stateDir: string, approvalId: string | undefined, kind: ApprovalKind, targetDigest: string): ApprovalRecord {
  if (!approvalId) fail("FS_APPROVAL_REQUIRED", "/approvalId", `a ${kind} approval for ${targetDigest} is required`, { kind, targetDigest });
  const record = readApproval(stateDir, approvalId);
  if (!record) fail("FS_APPROVAL_REQUIRED", "/approvalId", `approval ${approvalId} does not exist`, { kind, targetDigest });
  if (record.kind !== kind || record.targetDigest !== targetDigest) {
    fail("FS_APPROVAL_MISMATCH", "/approvalId", `approval ${approvalId} is a ${record.kind} approval for ${record.targetDigest}`, {
      expectedKind: kind,
      expectedDigest: targetDigest,
    });
  }
  return record;
}
