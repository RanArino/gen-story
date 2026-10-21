// Font Asset lifecycle: quarantine → contained inspection → explicit promotion. Quarantined bytes
// are never read by the compiler or the registry loader; only promoted records are resolvable.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { canonicalJson, digestBytes, digestOf } from "../contracts/canonical.js";
import { fail, filmError, FilmFailure, isErrorCode, type FilmError } from "../contracts/errors.js";
import { validateDocument } from "../contracts/semantic.js";
import type { FontAssetManifest, ValidationCheck, ValidationReport, VersionRef } from "../contracts/types.js";
import { runContained } from "../containment/contained.js";
import { writeAtomic, writeJson } from "../paths.js";
import { requireApproval } from "../registry/approvals.js";
import type { Registry } from "../registry/registry.js";

export const FONT_MAX_BYTES = 32 * 1024 * 1024;
const INSPECTOR = fileURLToPath(new URL("./inspector-entry.mjs", import.meta.url));

export interface FontPaths {
  state: string;
}

/** Draft manifests may give fallbacks as { id, version }; quarantine pins the registry digest. */
export type FontDraft = Omit<FontAssetManifest, "fallback"> & { fallback: (VersionRef & { digest?: string })[] };

export function incomingDir(state: string, name: string): string {
  return `${state}quarantine/fonts/incoming/${name}/`;
}

export function candidateDir(state: string, candidateId: string): string {
  return `${state}quarantine/fonts/${candidateId}/`;
}

export function candidateIdOf(manifest: Pick<FontAssetManifest, "id" | "version">): string {
  return `${manifest.id.slice("font.".length)}-${manifest.version.replaceAll(".", "-")}`;
}

function readCandidate(state: string, candidateId: string): FontAssetManifest {
  const path = `${candidateDir(state, candidateId)}manifest.json`;
  if (!existsSync(path)) fail("FS_FONT_MISSING", "", `font candidate ${candidateId} is not in quarantine`);
  return JSON.parse(readFileSync(path, "utf8")) as FontAssetManifest;
}

export interface QuarantineResult {
  candidateId: string;
  manifest: FontAssetManifest;
  digest: string;
}

export function quarantineFont(paths: FontPaths, registry: Registry, incoming: string, draft: FontDraft, dryRun: boolean): QuarantineResult {
  const source = incomingDir(paths.state, incoming);
  const fallback = draft.fallback.map((ref, i) => {
    if (ref.digest) return { id: ref.id, version: ref.version, digest: ref.digest };
    const record = registry.record(ref.id, ref.version);
    if (!record) fail("FS_FONT_MISSING", `/fallback/${i}`, `fallback ${ref.id}@${ref.version} is not a promoted font`);
    return { id: ref.id, version: ref.version, digest: record.manifestDigest };
  });
  const files = [...draft.faces.map((f) => f.file), draft.license.file];
  for (const file of files) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(file)) fail("FS_SCHEMA_INVALID", "/faces", `${file} is not a plain file name`);
    if (!existsSync(`${source}${file}`)) fail("FS_FONT_MISSING", "", `${file} is not in ${source}`);
  }
  const faces = draft.faces.map((face, i) => {
    const digest = digestBytes(readFileSync(`${source}${face.file}`));
    if (face.sha256 && face.sha256 !== digest) fail("FS_DIGEST_MISMATCH", `/faces/${i}/sha256`, `${face.file} is ${digest}, not ${face.sha256}`);
    return { ...face, sha256: digest };
  });
  const manifest: FontAssetManifest = {
    ...draft,
    faces,
    fallback,
    coverage: { scripts: draft.coverage.scripts },
    license: { ...draft.license, sha256: digestBytes(readFileSync(`${source}${draft.license.file}`)) },
  };
  const errors = validateDocument("font-asset-manifest", manifest);
  if (errors.length) throw new FilmFailure(errors);
  const candidateId = candidateIdOf(manifest);
  if (!dryRun) {
    const target = candidateDir(paths.state, candidateId);
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    for (const file of files) cpSync(`${source}${file}`, `${target}${file}`);
    writeJson(`${target}manifest.json`, manifest);
  }
  return { candidateId, manifest, digest: digestOf(manifest) };
}

function pnpmStoreRoot(): string {
  const require = createRequire(import.meta.url);
  const entry = realpathSync(require.resolve("fontkit"));
  const marker = "/node_modules/.pnpm/";
  const at = entry.indexOf(marker);
  if (at < 0) throw new Error(`cannot locate the pnpm store from ${entry}`);
  return entry.slice(0, at + marker.length);
}

function fontkitModule(): string {
  const require = createRequire(import.meta.url);
  const main = realpathSync(require.resolve("fontkit"));
  return main.replace(/main\.cjs$/, "module.mjs");
}

function toErrors(checks: ValidationCheck[]): FilmError[] {
  return checks
    .filter((c) => !c.ok)
    .map((c) => filmError(c.code && isErrorCode(c.code) ? c.code : "FS_FONT_INVALID", c.path ?? "", c.message ?? c.name));
}

/** Fallback closure: every edge resolves to a promoted font, and the chain is acyclic. */
function fallbackChecks(registry: Registry, manifest: FontAssetManifest): ValidationCheck[] {
  const checks: ValidationCheck[] = [];
  const visit = (refs: FontAssetManifest["fallback"], trail: string[]): void => {
    for (const ref of refs) {
      const key = `${ref.id}@${ref.version}`;
      if (trail.includes(key) || ref.id === manifest.id) {
        checks.push({ name: "fallback-acyclic", ok: false, code: "FS_FALLBACK_CYCLE", message: `fallback cycle through ${key}` });
        continue;
      }
      try {
        const next = registry.resolve<FontAssetManifest>(ref).manifest;
        if (next.scope.kind === "project" && (manifest.scope.kind !== "project" || manifest.scope.projectId !== next.scope.projectId)) {
          checks.push({ name: "fallback-scope", ok: false, code: "FS_FONT_SCOPE", message: `${key} is limited to project ${next.scope.projectId}` });
        }
        visit(next.fallback, [...trail, key]);
      } catch (error) {
        const reason = error instanceof FilmFailure ? error.message : String(error);
        checks.push({ name: "fallback-closure", ok: false, code: "FS_FONT_MISSING", message: `${key}: ${reason}` });
      }
    }
  };
  visit(manifest.fallback, [`${manifest.id}@${manifest.version}`]);
  if (!checks.length) checks.push({ name: "fallback-closure", ok: true });
  return checks;
}

export interface InspectionResult {
  report: ValidationReport;
  reportDigest: string;
  manifest: FontAssetManifest; // with verified coverage ranges
  errors: FilmError[];
}

export function inspectFont(
  paths: FontPaths,
  registry: Registry,
  candidateId: string,
  samples: Record<string, readonly string[]>,
  now = new Date().toISOString(),
): InspectionResult {
  const manifest = readCandidate(paths.state, candidateId);
  const dir = candidateDir(paths.state, candidateId);
  const temp = realpathSync(mkdtempSync(`${tmpdir()}/film-font-`));
  try {
    cpSync(dir, `${temp}/candidate`, { recursive: true });
    const job = {
      fontkitModule: fontkitModule(),
      maxBytes: FONT_MAX_BYTES,
      manifest,
      samples,
      faces: manifest.faces.map((f) => ({ ...f, path: `${temp}/candidate/${f.file}` })),
      license: { path: existsSync(`${temp}/candidate/${manifest.license.file}`) ? `${temp}/candidate/${manifest.license.file}` : null, sha256: manifest.license.sha256 },
    };
    writeAtomic(`${temp}/job.json`, JSON.stringify(job));
    const run = runContained(INSPECTOR, [`${temp}/job.json`], { readRoots: [INSPECTOR, `${temp}/`, pnpmStoreRoot()] });
    let checks: ValidationCheck[];
    let data: { faces?: unknown[]; coverage?: [number, number][]; glyphCount?: number } = {};
    if (run.timedOut) {
      checks = [{ name: "inspector", ok: false, code: "FS_RESOURCE_CEILING", message: "font inspection exceeded the time ceiling" }];
    } else {
      try {
        const parsed = JSON.parse(run.stdout) as { checks: ValidationCheck[]; data: typeof data };
        checks = parsed.checks;
        data = parsed.data;
      } catch {
        checks = [{ name: "inspector", ok: false, code: "FS_FONT_INVALID", message: `inspector failed: ${run.stderr.slice(0, 500)}` }];
      }
    }
    checks.push(...fallbackChecks(registry, manifest));
    const verified: FontAssetManifest = { ...manifest, coverage: { scripts: manifest.coverage.scripts, ranges: data.coverage ?? [] } };
    const report: ValidationReport = {
      schema: "film.validation-report@1",
      subject: { entity: "font", id: manifest.id, version: manifest.version, digest: digestOf(verified) },
      gate: "font-inspection",
      ok: checks.every((c) => c.ok),
      checks,
      data: { faces: data.faces ?? [], glyphCount: data.glyphCount ?? 0, durationMs: run.durationMs },
      toolchain: { node: process.version },
      createdAt: now,
    };
    writeJson(`${dir}inspection.json`, report);
    writeJson(`${dir}manifest.verified.json`, verified);
    return { report, reportDigest: digestOf(report), manifest: verified, errors: toErrors(checks) };
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export interface PromotionPlan {
  manifest: FontAssetManifest;
  manifestDigest: string;
  report: ValidationReport;
  reportDigest: string;
}

/** Everything promotion checks before it needs an approval; also used by dry runs. */
export function planFontPromotion(paths: FontPaths, candidateId: string): PromotionPlan {
  const dir = candidateDir(paths.state, candidateId);
  if (!existsSync(`${dir}inspection.json`)) fail("FS_FONT_INVALID", "", `${candidateId} has no inspection report; run font inspect first`);
  const report = JSON.parse(readFileSync(`${dir}inspection.json`, "utf8")) as ValidationReport;
  if (!report.ok) throw new FilmFailure(toErrors(report.checks));
  const manifest = JSON.parse(readFileSync(`${dir}manifest.verified.json`, "utf8")) as FontAssetManifest;
  const manifestDigest = digestOf(manifest);
  if (manifestDigest !== report.subject.digest) fail("FS_DIGEST_MISMATCH", "", "the verified manifest changed after inspection");
  for (const face of manifest.faces) {
    if (digestBytes(readFileSync(`${dir}${face.file}`)) !== face.sha256) fail("FS_DIGEST_MISMATCH", "", `${face.file} changed after inspection`);
  }
  const license = `${dir}${manifest.license.file}`;
  if (!existsSync(license) || digestBytes(readFileSync(license)) !== manifest.license.sha256) {
    fail("FS_DIGEST_MISMATCH", "/license", `${manifest.license.file} changed after inspection`);
  }
  return { manifest, manifestDigest, report, reportDigest: digestOf(report) };
}

export function promoteFont(paths: FontPaths, registry: Registry, candidateId: string, approvalId: string | undefined, dryRun: boolean) {
  const plan = planFontPromotion(paths, candidateId);
  const approval = requireApproval(paths.state, approvalId, "promotion", plan.manifestDigest);
  if (dryRun) return { plan, record: null, created: false };
  const dir = candidateDir(paths.state, candidateId);
  registry.putBlob(Buffer.from(canonicalJson(plan.report)));
  const { record, created } = registry.promote({
    entity: "font",
    id: plan.manifest.id,
    version: plan.manifest.version,
    kind: "font",
    trust: "promoted",
    manifest: plan.manifest,
    implementation: null,
    assets: [
      ...plan.manifest.faces.map((f, i) => ({ name: `face-${i}`, bytes: readFileSync(`${dir}${f.file}`) })),
      { name: "license", bytes: readFileSync(`${dir}${plan.manifest.license.file}`) },
    ],
    validationReportDigests: [plan.reportDigest],
    approvalIds: [approval.id],
    reviewId: null,
  });
  registry.activate(record.id, record.version);
  return { plan, record, created };
}

/** Face bytes for a promoted font record, verified against the registry. */
export function fontFaceBytes(registry: Registry, manifest: FontAssetManifest, index: number): Buffer {
  const face = manifest.faces[index];
  if (!face?.sha256) fail("FS_FONT_MISSING", "", `${manifest.id} has no face ${index}`);
  return registry.readBlob(face.sha256);
}
