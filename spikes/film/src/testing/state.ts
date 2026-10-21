// Temporary state and out directories for tests, plus a non-interactive operator approval helper.
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { confirmationFor, createApproval } from "../registry/approvals.js";
import type { ApprovalKind } from "../contracts/types.js";
import { defaultPaths, type SpikePaths } from "../paths.js";

export function tempPaths(): SpikePaths {
  const dir = realpathSync(mkdtempSync(`${tmpdir()}/film-spike-test-`));
  return { ...defaultPaths(), state: `${dir}/state/`, out: `${dir}/out/` };
}

/** Stands in for the operator typing the confirmation at the interactive `approve` prompt. */
export function operatorApproves(paths: SpikePaths, kind: ApprovalKind, targetDigest: string, subject = "test"): string {
  return createApproval(paths.state, { kind, targetDigest, subject, operator: "test operator", confirmation: confirmationFor(targetDigest) }).id;
}
