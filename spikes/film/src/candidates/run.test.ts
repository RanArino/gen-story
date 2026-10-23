import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createService } from "../authoring/service.js";
import { digestOf } from "../contracts/canonical.js";
import type { CapabilityRequest } from "../contracts/types.js";
import { readFixture } from "../testing/fixtures.js";
import { operatorApproves, tempPaths } from "../testing/state.js";
import { candidateDir } from "./candidate.js";

function prepared(source: string) {
  const paths = tempPaths();
  const service = createService({ paths });
  service.bootstrap();
  const request = readFixture<CapabilityRequest>("requests/torn-reveal.request.json");
  const requestApproval = operatorApproves(paths, "request", digestOf(request));
  expect(service.candidateScaffold({ request, approvalId: requestApproval, dryRun: false }).ok).toBe(true);
  const dir = candidateDir(paths, request.id);
  const manifest = JSON.parse(readFileSync(`${dir}manifest.json`, "utf8"));
  manifest.fixtures = [
    { name: "landscape", sourceAspect: "16:9", caption: "ja" },
    { name: "square", sourceAspect: "1:1", caption: "en" },
    { name: "portrait", sourceAspect: "2:3", caption: "ja" },
    { name: "ultrawide", sourceAspect: "21:9", caption: "empty" },
  ];
  writeFileSync(`${dir}manifest.json`, JSON.stringify(manifest));
  // Test-only implementations and approvals never touch the operator's quarantine or registry.
  writeFileSync(`${dir}implementation.mjs`, source);
  return { paths, service, dir, candidate: request.id, requestApproval };
}

const EMPTY = "export default () => ({ layers: [], audio: [] });";

describe("candidate execution gate", () => {
  it("requires static evidence and exact execution approval, and dry run executes nothing", () => {
    const w = prepared(EMPTY);
    expect(w.service.candidateRun({ candidate: w.candidate }).errors[0]?.code).toBe("FS_SEMANTIC_INVALID");
    const checked = w.service.candidateStaticCheck({ candidate: w.candidate });
    expect(checked.ok, JSON.stringify(checked.errors)).toBe(true);
    const saved = readFileSync(`${w.dir}static.json`, "utf8");
    expect(w.service.candidateRun({ candidate: w.candidate, dryRun: false }).errors[0]?.code).toBe("FS_APPROVAL_REQUIRED");
    expect(w.service.candidateRun({ candidate: w.candidate, approvalId: w.requestApproval }).errors[0]?.code).toBe("FS_APPROVAL_MISMATCH");
    const approvalId = operatorApproves(w.paths, "execution", checked.hashes.execution!);
    expect(w.service.candidateRun({ candidate: w.candidate, approvalId }).ok).toBe(true);
    expect(existsSync(`${w.dir}run-first`)).toBe(false);
    expect(readFileSync(`${w.dir}static.json`, "utf8")).toBe(saved);
    const run = w.service.candidateRun({ candidate: w.candidate, approvalId, dryRun: false });
    expect(run.ok, JSON.stringify(run.errors)).toBe(true);
    expect(w.service.validate({ kind: "validation-report", document: run.result!.report }).ok).toBe(true);
    expect(run.result!.report!.data?.executionsPerFixture).toBe(3);
    expect(w.service.catalogSearch({ query: "torn" }).result).toEqual([]);
  });

  it("rejects changed source under a previously checked and approved target", () => {
    const w = prepared(EMPTY);
    const checked = w.service.candidateStaticCheck({ candidate: w.candidate });
    const approvalId = operatorApproves(w.paths, "execution", checked.hashes.execution!);
    writeFileSync(`${w.dir}implementation.mjs`, `${EMPTY}\n// changed`);
    expect(w.service.candidateRun({ candidate: w.candidate, approvalId, dryRun: false }).errors[0]?.code).toBe("FS_DIGEST_MISMATCH");
    expect(existsSync(`${w.dir}run-first`)).toBe(false);
  });

  it.each([
    ['let count = 0; export default () => ({ layers: [], audio: [], count: count++ });', "FS_NONDETERMINISTIC"],
    ['export default input => { if (input.scene.media.at(0).heightPx > input.scene.media.at(0).widthPx) throw new Error("portrait"); return { layers: [], audio: [] }; };', "FS_RUNTIME_ERROR"],
    ['export default () => ({ layers: Array.from({ length: 513 }, () => ({ type: "rect" })), audio: [] });', "FS_RESOURCE_CEILING"],
  ])("rejects failing test implementations and keeps them out of the catalog", (source, code) => {
    const w = prepared(source);
    const checked = w.service.candidateStaticCheck({ candidate: w.candidate });
    expect(checked.ok, JSON.stringify(checked.errors)).toBe(true);
    const approvalId = operatorApproves(w.paths, "execution", checked.hashes.execution!);
    const run = w.service.candidateRun({ candidate: w.candidate, approvalId, dryRun: false });
    expect(run.errors[0]?.code).toBe(code);
    expect(existsSync(`${w.dir}runtime.json`)).toBe(false);
    expect(w.service.catalogSearch({ query: "torn" }).result).toEqual([]);
  });
});
