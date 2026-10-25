// Parse candidate source without importing it. Execution remains a separate approved gate.
import ts from "typescript";
import type { CapabilityManifest } from "../contracts/types.js";
import { fail, FilmFailure } from "../contracts/errors.js";
import { validateDocument } from "../contracts/semantic.js";

const FORBIDDEN = new Set([
  "process", "require", "eval", "Function", "globalThis", "fetch", "Date", "performance",
  "setTimeout", "setInterval", "setImmediate", "WebAssembly", "Atomics", "SharedArrayBuffer",
  "global", "window", "self", "constructor", "__proto__", "prototype", "Reflect", "Proxy",
]);
export const SDK_IMPORT = "film-capability-sdk";

export function checkSource(source: string): void {
  if (Buffer.byteLength(source) > 256 * 1024) fail("FS_RESOURCE_CEILING", "/implementation", "candidate exceeds 256 KB");
  const ast = ts.createSourceFile("implementation.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const diagnostics = (ast as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics.length) fail("FS_SCHEMA_INVALID", "/implementation", "candidate is not valid JavaScript");
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      if (spec && (!ts.isStringLiteral(spec) || spec.text !== SDK_IMPORT)) fail("FS_FORBIDDEN_IMPORT", "/implementation", "imports are allowed only from film-capability-sdk");
    }
    if (node.kind === ts.SyntaxKind.ImportKeyword || ts.isImportEqualsDeclaration(node)) fail("FS_FORBIDDEN_GLOBAL", "/implementation", "dynamic imports are forbidden");
    const abiWindowProperty = ts.isIdentifier(node) && node.text === "window" && ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;
    if ((ts.isIdentifier(node) || ts.isStringLiteral(node)) && FORBIDDEN.has(node.text) && !abiWindowProperty) fail("FS_FORBIDDEN_GLOBAL", "/implementation", `${node.text} is forbidden`);
    if (ts.isElementAccessExpression(node)) fail("FS_FORBIDDEN_GLOBAL", "/implementation", "computed property access is not supported in candidate code; use array methods and named properties");
    if (ts.isPropertyAccessExpression(node) && node.expression.getText(ast) === "Math" && node.name.text === "random") fail("FS_FORBIDDEN_GLOBAL", "/implementation", "Math.random is forbidden");
    ts.forEachChild(node, visit);
  };
  visit(ast);
}

export function checkManifest(manifest: CapabilityManifest, lookup: (id: string, version: string) => CapabilityManifest | undefined): void {
  // Permission denial precedes generic schema/semantic validation.
  if (manifest.permissions?.length) fail("FS_PERMISSION_FORBIDDEN", "/permissions", "candidate permissions must be empty");
  const errors = validateDocument("capability-manifest", manifest);
  if (errors.length) throw new FilmFailure(errors);
  const seen = new Set<string>();
  let current = manifest;
  while (true) {
    const key = `${current.id}@${current.version}`;
    if (seen.has(key)) fail("FS_FALLBACK_CYCLE", "/fallback", `fallback cycle at ${key}`);
    seen.add(key);
    if (current.level === 0) return;
    if (!current.fallback) fail("FS_FALLBACK_MISSING", "/fallback", `${key} has no Level 0 fallback`);
    const next = lookup(current.fallback.id, current.fallback.version);
    if (!next) fail("FS_FALLBACK_MISSING", "/fallback", `${key} fallback is unavailable`);
    if (next.kind !== manifest.kind) fail("FS_FALLBACK_NOT_LEVEL0", "/fallback", "fallback kind differs");
    current = next;
  }
}
