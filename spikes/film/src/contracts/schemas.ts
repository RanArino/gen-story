// Loads the canonical JSON Schemas (draft 2020-12) and converts Ajv errors into FS_SCHEMA_INVALID.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import { filmError, type FilmError } from "./errors.js";

export const SCHEMA_DIR = fileURLToPath(new URL("../../schemas/", import.meta.url));

export const SCHEMA_KINDS = [
  "story-graph",
  "chapters",
  "capability-request",
  "capability-manifest",
  "film-style-recipe",
  "font-asset-manifest",
  "film-treatment",
  "cut",
  "registry-record",
  "approval-record",
  "review-record",
  "validation-report",
  "timing-proposal",
  "resolved-render-plan",
  "concat-plan",
  "chapter-artifact",
  "result-envelope",
] as const;
export type SchemaKind = (typeof SCHEMA_KINDS)[number];

let ajv: Ajv2020 | null = null;
const compiled = new Map<string, ValidateFunction>();

function instance(): Ajv2020 {
  if (ajv) return ajv;
  ajv = new Ajv2020({ allErrors: false, strict: true, strictTypes: false, discriminator: true });
  ajv.addKeyword("x-operations");
  for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith(".schema.json")).sort()) {
    ajv.addSchema(JSON.parse(readFileSync(`${SCHEMA_DIR}${file}`, "utf8")) as object);
  }
  return ajv;
}

export function schemaValidator(id: string): ValidateFunction {
  const cached = compiled.get(id);
  if (cached) return cached;
  const fn = instance().getSchema(id);
  if (!fn) throw new Error(`unknown schema ${id}`);
  compiled.set(id, fn);
  return fn;
}

export function schemaDocument(kind: SchemaKind | "tool-calling"): Record<string, unknown> {
  return JSON.parse(readFileSync(`${SCHEMA_DIR}${kind}.schema.json`, "utf8")) as Record<string, unknown>;
}

function toPath(error: ErrorObject): string {
  if (error.keyword === "additionalProperties" || error.keyword === "unevaluatedProperties") {
    const extra = (error.params as { additionalProperty?: string; unevaluatedProperty?: string });
    const name = extra.additionalProperty ?? extra.unevaluatedProperty ?? "";
    return `${error.instancePath}/${name.replaceAll("~", "~0").replaceAll("/", "~1")}`;
  }
  if (error.keyword === "required") {
    return `${error.instancePath}/${(error.params as { missingProperty: string }).missingProperty}`;
  }
  return error.instancePath;
}

export function validateSchema(id: string, document: unknown): FilmError[] {
  const fn = schemaValidator(id);
  if (fn(document)) return [];
  return (fn.errors ?? []).map((e) =>
    filmError("FS_SCHEMA_INVALID", toPath(e), `${e.instancePath || "/"} ${e.message ?? "is invalid"}`, {
      keyword: e.keyword,
      schemaPath: e.schemaPath,
    }),
  );
}

export function schemaId(kind: SchemaKind): string {
  return `urn:film-spike:${kind}`;
}
