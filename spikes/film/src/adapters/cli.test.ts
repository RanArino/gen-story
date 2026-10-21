import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { validateSchema } from "../contracts/schemas.js";
import { defaultPaths } from "../paths.js";

const root = defaultPaths().root;

function cli(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", "src/adapters/cli.ts", ...args], { cwd: root, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
}

describe("film-spike CLI", () => {
  it("[A02] validate --json prints a schema-valid failed envelope with the fixture's code and path", () => {
    const run = cli("validate", "recipe", "fixtures/invalid/film-style-recipe/FS_SCHEMA_INVALID.latest-version.json", "--json");
    expect(run.status).toBe(1);
    const env = JSON.parse(run.stdout);
    expect(validateSchema("urn:film-spike:result-envelope", env)).toEqual([]);
    expect(env.errors[0]).toMatchObject({ code: "FS_SCHEMA_INVALID", path: "/capabilities/0/ref/version" });
  });

  it("[A01] validate --json accepts a valid fixture", () => {
    const run = cli("validate", "story-graph", "fixtures/project/story-graph.json", "--json");
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout)).toMatchObject({ ok: true, operation: "validate", dryRun: true });
  });

  it.each([
    ["story-graph", "FS_SCHEMA_INVALID.null-document.json", ""],
    ["film-treatment", "FS_SCHEMA_INVALID.missing-fields.json", "/schema"],
  ])("[A02] validate %s rejects malformed documents before context lookups", (kind, file, path) => {
    const run = cli("validate", kind, `fixtures/invalid/${kind}/${file}`, "--json");
    expect(run.status).toBe(1);
    const env = JSON.parse(run.stdout);
    expect(validateSchema("urn:film-spike:result-envelope", env)).toEqual([]);
    expect(env.errors[0]).toMatchObject({ code: "FS_SCHEMA_INVALID", path });
  });

  it("approve refuses to run without an interactive terminal", () => {
    const run = cli("approve", "promotion", `sha256:${"a".repeat(64)}`);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("interactive terminal");
  });
});
