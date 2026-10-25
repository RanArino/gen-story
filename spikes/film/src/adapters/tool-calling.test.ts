import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createService, type AuthoringService } from "../authoring/service.js";
import { digestBytes, digestOf } from "../contracts/canonical.js";
import type { FilmTreatment, FilmChapters } from "../contracts/types.js";
import type { ResultEnvelope } from "../contracts/envelope.js";
import { schemaDocument, validateSchema } from "../contracts/schemas.js";
import { defaultPaths, writeJson, type SpikePaths } from "../paths.js";
import { scaffoldTornReveal } from "../testing/candidates.js";
import { readFixture } from "../testing/fixtures.js";
import { operatorApproves } from "../testing/state.js";
import { createWorld, TEST_ENV, type World } from "../testing/world.js";
import { callTool, listTools, TOOL_METHODS } from "./tool-calling.js";

interface Fixture {
  tool: string;
  input: Record<string, unknown>;
  cli: string[];
  expected: { ok: boolean; errorCodes: string[]; mutationKinds: string[] };
}
const original = defaultPaths();
const fixtures = readdirSync(`${original.fixtures}tool-calling`).filter((name) => name.endsWith(".json")).sort();
const sandbox = mkdtempSync(`${tmpdir()}/film-tool-conformance-`);
const root = `${sandbox}/package/`;
const paths: SpikePaths = { root, fixtures: `${root}fixtures/`, state: `${root}.state/`, out: `${root}out/`, media: `${root}.media/` };
let baseline: World;
let tokens: Record<string, string>;

function expand(value: unknown): unknown {
  if (typeof value === "string") return tokens[value] ?? value;
  if (Array.isArray(value)) return value.map(expand);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.$fixture === "string") return readFixture(obj.$fixture);
    return Object.fromEntries(Object.entries(obj).map(([key, entry]) => [key, expand(entry)]));
  }
  return value;
}

function reset(): AuthoringService {
  rmSync(paths.state, { recursive: true, force: true });
  rmSync(paths.out, { recursive: true, force: true });
  cpSync(baseline.paths.state, paths.state, { recursive: true });
  cpSync(baseline.paths.out, paths.out, { recursive: true });
  writeJson(`${paths.out}env.json`, TEST_ENV);
  return createService({ paths });
}

function snapshot(): Record<string, string> {
  return Object.fromEntries([paths.state, paths.out].flatMap((dir) =>
    readdirSync(dir, { recursive: true, withFileTypes: true }).filter((file) => file.isFile())
      .map((file) => [`${file.parentPath}/${file.name}`, digestBytes(readFileSync(`${file.parentPath}/${file.name}`))]),
  ));
}

function withoutEvidenceTime(env: ResultEnvelope): unknown {
  const result = JSON.parse(JSON.stringify(env)) as ResultEnvelope;
  const strip = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    for (const [key, entry] of Object.entries(value)) {
      if (key === "createdAt") delete (value as Record<string, unknown>)[key];
      else strip(entry);
    }
  };
  // candidate.compile hashes its timestamped report. Verify that hash before normalizing it.
  if (env.operation === "candidate.compile" && env.ok) {
    expect(env.hashes.report).toBe(digestOf(env.result));
    strip(result.result);
    result.hashes.report = digestOf(result.result);
  }
  strip(result);
  return result;
}

beforeAll(() => {
  baseline = createWorld();
  scaffoldTornReveal(baseline, "tool-candidate");
  expect(baseline.service.candidateStaticCheck({ candidate: "tool-candidate" }).ok).toBe(true);
  const compiled = baseline.service.compile({ treatment: readFixture<FilmTreatment>("project/treatments/test-baseline.json"), chapters: readFixture<FilmChapters>("project/chapters.json"), write: true });
  expect(compiled.ok, JSON.stringify(compiled.errors)).toBe(true);
  tokens = {
    $timingApproval: operatorApproves(baseline.paths, "timing", compiled.result![0]!.proposalDigest),
    $requestApproval: operatorApproves(baseline.paths, "request", digestOf(readFixture("requests/torn-reveal.request.json"))),
    $promotionApproval: operatorApproves(baseline.paths, "promotion", baseline.service.registry.record("film.transition.dissolve", "1.0.0")!.manifestDigest),
  };
  mkdirSync(root, { recursive: true });
  cpSync(`${original.root}src`, `${root}src`, { recursive: true });
  cpSync(`${original.root}schemas`, `${root}schemas`, { recursive: true });
  writeJson(`${root}package.json`, { type: "module" });
  // The CLI runs in a copied package with isolated state; source media and fixtures stay read-only.
  symlinkSync(original.fixtures, paths.fixtures.slice(0, -1));
  symlinkSync(original.media, paths.media.slice(0, -1));
  symlinkSync(`${original.root}node_modules`, `${root}node_modules`);
  symlinkSync(`${original.root}../../node_modules`, `${sandbox}/node_modules`);
}, 30_000);

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
  if (baseline) rmSync(`${baseline.paths.state}..`, { recursive: true, force: true });
});

describe("Tool Calling", () => {
  it("[A29] covers every public service operation and lists no approval or CLI-only tools", () => {
    const methods = Object.keys(createService({ paths })).filter((name) => !["registry", "bootstrap", "fontFixtures"].includes(name));
    expect(Object.values(TOOL_METHODS).sort()).toEqual(methods.sort());
    const defs = schemaDocument("tool-calling").$defs as Record<string, unknown>;
    const operations = schemaDocument("tool-calling")["x-operations"] as string[];
    expect(operations.map((operation) => operation.replaceAll(".", "_").replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)).sort()).toEqual(listTools().map((tool) => tool.name).sort());
    expect(listTools().map((tool) => tool.name).sort()).toEqual(Object.keys(defs).filter((key) => key.endsWith(".request")).map((key) => key.slice(0, -8)).sort());
    expect(listTools().some((tool) => /approv|bootstrap|font_fixtures/i.test(tool.name))).toBe(false);
    for (const tool of listTools()) expect(tool.description.length).toBeGreaterThan(0);
  });

  it("[A29] rejects unknown tools and invalid DTOs before delegation", async () => {
    const service = reset();
    const spy = vi.spyOn(service, "candidateRun");
    expect((await callTool("approve", {}, service)).errors[0]?.code).toBe("FS_SCHEMA_INVALID");
    expect((await callTool("candidate_run", { candidate: "tool-candidate", extra: true }, service)).errors[0]?.code).toBe("FS_SCHEMA_INVALID");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("[A29] every mutating tool supplies dryRun true by default", async () => {
    const service = reset();
    const mutating = ["compile", "compile_concat", "recipe_fork", "candidate_scaffold", "candidate_static_check", "candidate_compile", "candidate_run", "candidate_evidence", "font_quarantine", "font_inspect", "font_promote", "font_deactivate", "registry_promote", "registry_activate", "registry_deactivate", "registry_rollback", "registry_deprecate", "render_chapter", "render_concat", "contact_sheet", "review_record"];
    const values: Record<string, unknown> = {
      treatment: readFixture("project/treatments/test-baseline.json"), chapters: readFixture("project/chapters.json"),
      request: readFixture("requests/torn-reveal.request.json"), candidate: "tool-candidate", incoming: "fixture-sans-jp",
      manifest: readFixture("fonts/fixture-sans-jp.draft.json"), id: "org.local.tool-fork", version: "1.0.0",
      source: { id: "org.local.test-baseline", revision: "r1" }, planFile: "out/test.plan.json", plansDir: "out/plans/test",
      subjectDigest: `sha256:${"a".repeat(64)}`, subject: "test", reviewer: "test reviewer", verdict: "accept", notes: "Test review.",
    };
    for (const name of mutating) {
      const tool = listTools().find((entry) => entry.name === name)!;
      expect(tool.inputSchema.properties.dryRun).toEqual({ type: "boolean", default: true });
      const input = Object.fromEntries((tool.inputSchema.required as string[]).map((key) => [key, values[key]]));
      const method = TOOL_METHODS[name as keyof typeof TOOL_METHODS];
      const spy = vi.spyOn(service, method).mockImplementation(() => ({ ok: true } as never));
      const response = await callTool(name, input, service);
      expect(response.ok, JSON.stringify(response)).toBe(true);
      expect(spy).toHaveBeenCalledWith(expect.objectContaining(name === "compile" || name === "compile_concat" ? { write: false } : { dryRun: true }));
      expect(input).not.toHaveProperty("dryRun");
      spy.mockRestore();
    }
  });

  it.each(fixtures)("[A29] CLI --json and adapter agree: %s", async (file) => {
    const fixture = readFixture<Fixture>(`tool-calling/${file}`);
    const service = reset();
    const before = snapshot();
    const input = expand(fixture.input) as Record<string, unknown>;
    const adapter = await callTool(fixture.tool, input, service);
    expect(adapter.ok, JSON.stringify(adapter)).toBe(fixture.expected.ok);
    expect(adapter.errors.map((error) => error.code)).toEqual(fixture.expected.errorCodes);
    expect(adapter.mutations.map((mutation) => mutation.kind)).toEqual(fixture.expected.mutationKinds);
    expect(validateSchema("urn:film-spike:result-envelope", adapter)).toEqual([]);
    if (adapter.dryRun || !adapter.ok) expect(snapshot()).toEqual(before);
    reset();
    const cliBefore = snapshot();
    const args = expand(fixture.cli) as string[];
    expect(args).not.toContain("approve");
    const run = spawnSync(process.execPath, ["--import", "tsx", `${root}src/adapters/cli.ts`, ...args, "--json"], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    expect(run.status, run.stderr || run.stdout).toBe(fixture.expected.ok ? 0 : 1);
    const cli = JSON.parse(run.stdout) as ResultEnvelope;
    expect(withoutEvidenceTime(cli)).toEqual(withoutEvidenceTime(adapter));
    if (cli.dryRun || !cli.ok) expect(snapshot()).toEqual(cliBefore);
  }, 15_000);
});
