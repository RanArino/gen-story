import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createService } from "../authoring/service.js";
import { digestOf } from "../contracts/canonical.js";
import type { CapabilityManifest, CapabilityRequest } from "../contracts/types.js";
import { readFixture } from "../testing/fixtures.js";
import { operatorApproves, tempPaths } from "../testing/state.js";
import { candidateDir } from "./candidate.js";
import { checkManifest } from "./static.js";

const request = () => readFixture<CapabilityRequest>("requests/torn-reveal.request.json");

describe("candidate request and static gates", () => {
  it("requires exact request approval, defaults to dry run, and keeps quarantine out of the catalog", () => {
    const paths = tempPaths();
    const service = createService({ paths });
    const document = request();
    expect(service.candidateScaffold({ request: document }).errors[0]?.code).toBe("FS_APPROVAL_REQUIRED");
    const wrong = operatorApproves(paths, "execution", digestOf(document));
    expect(service.candidateScaffold({ request: document, approvalId: wrong }).errors[0]?.code).toBe("FS_APPROVAL_MISMATCH");
    const approvalId = operatorApproves(paths, "request", digestOf(document));
    expect(service.candidateScaffold({ request: document, approvalId }).ok).toBe(true);
    expect(existsSync(candidateDir(paths, document.id))).toBe(false);
    expect(service.candidateScaffold({ request: document, approvalId, dryRun: false }).ok).toBe(true);
    expect(service.catalogSearch({ query: "torn" }).result).toEqual([]);
    const file = `${candidateDir(paths, document.id)}implementation.mjs`;
    writeFileSync(file, "// author changes must survive repeat scaffolding\n");
    expect(service.candidateScaffold({ request: document, approvalId, dryRun: false }).ok).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("author changes");
  });
  it("refuses static checks before approved scaffolding and refuses path traversal", () => {
    const service = createService({ paths: tempPaths() });
    expect(service.candidateStaticCheck({ candidate: "torn-reveal" }).errors[0]?.code).toBe("FS_APPROVAL_REQUIRED");
    expect(service.candidateStaticCheck({ candidate: "../approvals" }).errors[0]?.code).toBe("FS_SCHEMA_INVALID");
  });
  it("writes a schema-valid static report bound to exact source bytes without executing them", () => {
    const paths = tempPaths();
    const service = createService({ paths });
    expect(service.bootstrap().ok).toBe(true);
    const document = request();
    const approvalId = operatorApproves(paths, "request", digestOf(document));
    expect(service.candidateScaffold({ request: document, approvalId, dryRun: false }).ok).toBe(true);
    const dir = candidateDir(paths, document.id);
    writeFileSync(`${dir}implementation.mjs`, 'throw new Error("not executed"); export default () => ({ layers: [], audio: [] });');
    const first = service.candidateStaticCheck({ candidate: document.id });
    expect(first.ok, JSON.stringify(first.errors)).toBe(true);
    const report = JSON.parse(readFileSync(`${dir}static.json`, "utf8"));
    expect(service.validate({ kind: "validation-report", document: report }).ok).toBe(true);
    writeFileSync(`${dir}implementation.mjs`, 'throw new Error("changed but still not executed"); export default () => ({ layers: [], audio: [] });');
    const second = service.candidateStaticCheck({ candidate: document.id });
    expect(second.ok).toBe(true);
    expect(second.hashes.execution).not.toBe(first.hashes.execution);
    expect(service.catalogSearch({ query: "torn" }).result).toEqual([]);
    writeFileSync(`${dir}implementation.mjs`, "export default () => ({ layers: [], audio: [] });\n");
    expect(service.candidateStaticCheck({ candidate: document.id }).ok).toBe(true);
    expect(readFileSync(`${dir}source.diff`, "utf8")).toBe("--- /dev/null\n+++ implementation.mjs\n@@ -0,0 +1,1 @@\n+export default () => ({ layers: [], audio: [] });\n");
  });
  it("detects fallback cycles without loading either implementation", () => {
    const a = readFixture<CapabilityManifest>("valid/capability-manifest.json");
    a.level = 1;
    a.id = "film.transition.cycle-a";
    const b = { ...a, id: "film.transition.cycle-b", fallback: { id: a.id, version: a.version } };
    a.fallback = { id: b.id, version: b.version };
    expect(() => checkManifest(a, (id) => id === a.id ? a : b)).toThrow("FS_FALLBACK_CYCLE");
  });
  it("rejects declared permissions before source execution", () => {
    const manifest = readFixture<CapabilityManifest>("valid/capability-manifest.json");
    manifest.permissions = ["network"];
    expect(() => checkManifest(manifest, () => undefined)).toThrow("FS_PERMISSION_FORBIDDEN");
  });
});
