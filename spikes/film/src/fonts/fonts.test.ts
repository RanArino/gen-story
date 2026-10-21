import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import * as fontkit from "fontkit";
import { FilmFailure } from "../contracts/errors.js";
import { Registry } from "../registry/registry.js";
import { readFixture } from "../testing/fixtures.js";
import { writeAtomic } from "../paths.js";
import { operatorApproves, tempPaths } from "../testing/state.js";
import { writeFixtureFonts } from "./fixtures.js";
import { candidateDir, incomingDir, inspectFont, promoteFont, quarantineFont, type FontDraft } from "./fonts.js";
import { JA_SAMPLE_SET, LATIN_SAMPLE_SET } from "./samples.js";

const paths = tempPaths();
const registry = new Registry(paths.state);
const SAMPLES = { Latn: LATIN_SAMPLE_SET, Jpan: JA_SAMPLE_SET };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof FilmFailure) return error.errors[0]?.code;
    throw error;
  }
  return undefined;
}

function admit(incoming: string, draftFile: string) {
  const draft = readFixture<FontDraft>(`fonts/${draftFile}`);
  const { candidateId } = quarantineFont(paths, registry, incoming, draft, false);
  const inspection = inspectFont(paths, registry, candidateId, SAMPLES);
  return { candidateId, inspection };
}

function promote(candidateId: string, digest: string) {
  return promoteFont(paths, registry, candidateId, operatorApproves(paths, "promotion", digest), false);
}

beforeAll(() => {
  writeFixtureFonts(paths.state, paths.fixtures);
});

describe("fixture fonts", () => {
  it("parse with fontkit and map the declared characters", () => {
    const font = fontkit.create(readFileSync(`${incomingDir(paths.state, "fixture-sans-jp")}FixtureSansJP-Regular.ttf`)) as fontkit.Font;
    expect(font.hasGlyphForCodePoint("朝".codePointAt(0)!)).toBe(true);
    expect(font.hasGlyphForCodePoint("A".codePointAt(0)!)).toBe(true);
    expect(font.unitsPerEm).toBe(1000);
  });
});

describe("Font Asset lifecycle", () => {
  it("[A24] a Japanese font passes quarantine, contained inspection, and explicit promotion", () => {
    const { candidateId, inspection } = admit("fixture-sans-jp", "fixture-sans-jp.draft.json");
    expect(inspection.errors).toEqual([]);
    expect(inspection.report.ok).toBe(true);
    expect(inspection.manifest.coverage.ranges!.length).toBeGreaterThan(0);
    expect(registry.record("font.fixture-sans-jp", "1.0.0")).toBeUndefined();
    expect(codeOf(() => promoteFont(paths, registry, candidateId, undefined, false))).toBe("FS_APPROVAL_REQUIRED");
    expect(codeOf(() => promoteFont(paths, registry, candidateId, operatorApproves(paths, "execution", inspection.report.subject.digest), false))).toBe(
      "FS_APPROVAL_MISMATCH",
    );
    const { record, created } = promote(candidateId, inspection.report.subject.digest);
    expect(created).toBe(true);
    expect(record!.manifestDigest).toBe(inspection.report.subject.digest);
    expect(registry.isOffered("font.fixture-sans-jp", "1.0.0")).toBe(true);
    // Promoting identical bytes again is a no-op success.
    expect(promote(candidateId, inspection.report.subject.digest).created).toBe(false);
  });

  it("[A24] a fallback is pinned to the promoted digest and the Latin-only font promotes with Latin coverage", () => {
    const serif = admit("fixture-serif-jp", "fixture-serif-jp.draft.json");
    expect(serif.inspection.errors).toEqual([]);
    expect(serif.inspection.manifest.fallback[0]!.digest).toBe(registry.record("font.fixture-sans-jp", "1.0.0")!.manifestDigest);
    promote(serif.candidateId, serif.inspection.report.subject.digest);
    const latin = admit("fixture-latin", "fixture-latin.draft.json");
    expect(latin.inspection.errors).toEqual([]);
    promote(latin.candidateId, latin.inspection.report.subject.digest);
  });

  it("[A25] truncated bytes are rejected with FS_FONT_INVALID", () => {
    const { candidateId, inspection } = admit("fixture-truncated", "negative/truncated.draft.json");
    expect(inspection.errors.map((e) => e.code)).toContain("FS_FONT_INVALID");
    expect(codeOf(() => promote(candidateId, inspection.report.subject.digest))).toBe("FS_FONT_INVALID");
  });

  it("[A25] a license changed after inspection blocks promotion", () => {
    const { candidateId, inspection } = admit("fixture-latin", "fixture-latin.draft.json");
    expect(inspection.errors).toEqual([]);
    writeAtomic(`${candidateDir(paths.state, candidateId)}${inspection.manifest.license.file}`, "Changed after inspection");
    expect(codeOf(() => promote(candidateId, inspection.report.subject.digest))).toBe("FS_DIGEST_MISMATCH");
  });

  it("[A25] a Latin-only font claiming Japanese coverage is rejected with FS_FONT_COVERAGE_CLAIM", () => {
    const { candidateId, inspection } = admit("fixture-latin", "negative/latin-claims-japanese.draft.json");
    expect(inspection.errors.map((e) => e.code)).toEqual(["FS_FONT_COVERAGE_CLAIM"]);
    expect(codeOf(() => promote(candidateId, inspection.report.subject.digest))).toBe("FS_FONT_COVERAGE_CLAIM");
  });

  it("[A25] a manifest without embedding rights is rejected with FS_LICENSE_INCOMPLETE", () => {
    const { candidateId, inspection } = admit("fixture-latin", "negative/missing-embedding-rights.draft.json");
    expect(inspection.errors.map((e) => e.code)).toEqual(["FS_LICENSE_INCOMPLETE"]);
    expect(codeOf(() => promote(candidateId, inspection.report.subject.digest))).toBe("FS_LICENSE_INCOMPLETE");
  });

  it("[A25] a font with restricted embedding in its OS/2 table is rejected", () => {
    const draft = readFixture<FontDraft>("fonts/fixture-latin.draft.json");
    draft.id = "font.fixture-restricted";
    const source = incomingDir(paths.state, "fixture-latin");
    const target = incomingDir(paths.state, "fixture-restricted");
    const bytes = readFileSync(`${source}${draft.faces[0]!.file}`);
    const tableCount = bytes.readUInt16BE(4);
    let os2Offset: number | undefined;
    for (let i = 0; i < tableCount; i += 1) {
      const at = 12 + i * 16;
      if (bytes.toString("ascii", at, at + 4) === "OS/2") os2Offset = bytes.readUInt32BE(at + 8);
    }
    expect(os2Offset).toBeDefined();
    bytes.writeUInt16BE(0x0002, os2Offset! + 8);
    writeAtomic(`${target}${draft.faces[0]!.file}`, bytes);
    writeAtomic(`${target}${draft.license.file}`, readFileSync(`${source}${draft.license.file}`));
    const { candidateId } = quarantineFont(paths, registry, "fixture-restricted", draft, false);
    const inspection = inspectFont(paths, registry, candidateId, SAMPLES);
    expect(inspection.errors.map((e) => e.code)).toContain("FS_LICENSE_INCOMPLETE");
    expect(codeOf(() => promote(candidateId, inspection.report.subject.digest))).toBe("FS_LICENSE_INCOMPLETE");
    expect(registry.record(draft.id, draft.version)).toBeUndefined();
  });

  it("[A25] inspection prevents an organization font from falling back to a project-only font", () => {
    const temporary = tempPaths();
    const temporaryRegistry = new Registry(temporary.state);
    writeFixtureFonts(temporary.state, temporary.fixtures);
    const privateDraft = readFixture<FontDraft>("fonts/fixture-latin.draft.json");
    privateDraft.id = "font.fixture-private";
    privateDraft.scope = { kind: "project", projectId: "private-project" };
    const privateCandidate = quarantineFont(temporary, temporaryRegistry, "fixture-latin", privateDraft, false).candidateId;
    const inspection = inspectFont(temporary, temporaryRegistry, privateCandidate, SAMPLES);
    expect(inspection.errors).toEqual([]);
    promoteFont(temporary, temporaryRegistry, privateCandidate, operatorApproves(temporary, "promotion", inspection.report.subject.digest), false);
    const organizationDraft = readFixture<FontDraft>("fonts/fixture-latin.draft.json");
    organizationDraft.id = "font.fixture-organization";
    organizationDraft.fallback = [{ id: privateDraft.id, version: privateDraft.version }];
    const candidate = quarantineFont(temporary, temporaryRegistry, "fixture-latin", organizationDraft, false).candidateId;
    const result = inspectFont(temporary, temporaryRegistry, candidate, SAMPLES);
    expect(result.errors.map((error) => error.code)).toContain("FS_FONT_SCOPE");
    expect(temporaryRegistry.record(organizationDraft.id, organizationDraft.version)).toBeUndefined();
  });

  it("[A25] Latin bytes submitted under the promoted Japanese id@version collide", () => {
    const before = registry.record("font.fixture-sans-jp", "1.0.0")!;
    const { candidateId, inspection } = admit("fixture-latin", "negative/collides-sans-jp.draft.json");
    expect(inspection.errors).toEqual([]);
    expect(codeOf(() => promote(candidateId, inspection.report.subject.digest))).toBe("FS_VERSION_COLLISION");
    expect(registry.record("font.fixture-sans-jp", "1.0.0")).toEqual(before);
  });

  it("[A25] no rejected candidate appears in the font registry", () => {
    const fonts = registry.records().filter((r) => r.entity === "font").map((r) => r.id);
    expect(fonts.sort()).toEqual(["font.fixture-latin", "font.fixture-sans-jp", "font.fixture-serif-jp"]);
    expect(registry.verify()).toEqual([]);
  });
});
