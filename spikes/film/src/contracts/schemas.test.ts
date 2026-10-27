import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURES, contextFor, listFixtures, readFixture, type InvalidFixture } from "../testing/fixtures.js";
import { ERROR_CODES } from "./errors.js";
import { SCHEMA_KINDS, validateSchema, type SchemaKind } from "./schemas.js";
import { validateDocument } from "./semantic.js";
import type { StoryGraph } from "./types.js";

const graph = readFixture<StoryGraph>("project/story-graph.json");

const VALID: [SchemaKind, string][] = [
  ["story-graph", "project/story-graph.json"],
  ...listFixtures("project")
    .filter((f) => f.startsWith("project/chapters"))
    .map((f): [SchemaKind, string] => ["chapters", f]),
  ...listFixtures("valid").map((f): [SchemaKind, string] => [f.slice("valid/".length, -".json".length) as SchemaKind, f]),
];

const INVALID = readdirSync(`${FIXTURES}invalid`, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
  .flatMap((e) => listFixtures(`invalid/${e.name}`).map((f): [SchemaKind, string] => [e.name as SchemaKind, f]));

describe("canonical schemas", () => {
  it.each(VALID)("[A01] %s fixture %s is valid", (kind, file) => {
    const ctx = kind === "chapters" ? { storyGraph: graph } : {};
    expect(validateDocument(kind, readFixture(file), ctx)).toEqual([]);
  });

  it.each(INVALID)("[A02] %s fixture %s fails with its named code and path", (kind, file) => {
    const fixture = readFixture<InvalidFixture>(file);
    const code = file.split("/").pop()!.split(".")[0]!;
    expect(Object.keys(ERROR_CODES)).toContain(code);
    const errors = validateDocument(kind, fixture.document, contextFor(fixture.context));
    expect(errors[0]).toMatchObject({ code, path: fixture.expect.path });
  });

  it("[A01] every schema kind has a valid fixture and at least one invalid fixture", () => {
    const covered = new Set(VALID.map(([k]) => k));
    const invalid = new Set(INVALID.map(([k]) => k));
    for (const kind of SCHEMA_KINDS) {
      expect(covered, kind).toContain(kind);
      expect(invalid, kind).toContain(kind);
    }
  });

  it("[A03] every Recipe forbidden-content fixture is rejected by the schema itself", () => {
    const recipeInvalid = INVALID.filter(([k, f]) => k === "film-style-recipe" && f.includes("FS_SCHEMA_INVALID"));
    const names = recipeInvalid.map(([, f]) => f.split(".")[1]);
    for (const required of ["css-field", "code-in-description", "url-in-title", "path-param", "latest-version", "extends", "font-family-string", "prompt-field", "module-ref", "shader-param", "command-field"]) {
      expect(names).toContain(required);
    }
  });

  it("every schema rejects unknown top-level properties", () => {
    for (const kind of SCHEMA_KINDS) {
      expect(validateSchema(`urn:film-spike:${kind}`, { ...readFixture<object>(VALID.find(([name]) => name === kind)![1]), unknown: true }).length, kind).toBeGreaterThan(0);
    }
  });
});
