// Tool schemas are canonical DTOs; execution and approval policy belong to the service.
import { createService, type AuthoringService } from "../authoring/service.js";
import { failure, type ResultEnvelope } from "../contracts/envelope.js";
import { filmError } from "../contracts/errors.js";
import { schemaDocument, validateSchema } from "../contracts/schemas.js";
import { defaultPaths } from "../paths.js";

export const TOOL_METHODS = {
  catalog_search: "catalogSearch",
  catalog_inspect: "catalogInspect",
  validate: "validate",
  preflight: "preflight",
  compile: "compile",
  compile_concat: "compileConcat",
  concat_plan: "concatPlan",
  recipe_fork: "recipeFork",
  candidate_scaffold: "candidateScaffold",
  candidate_static_check: "candidateStaticCheck",
  candidate_compile: "candidateCompile",
  candidate_run: "candidateRun",
  candidate_evidence: "candidateEvidence",
  candidate_promotion_target: "candidatePromotionTarget",
  font_quarantine: "fontQuarantine",
  font_inspect: "fontInspect",
  font_promotion_target: "fontPromotionTarget",
  font_promote: "fontPromote",
  font_deactivate: "fontDeactivate",
  registry_promote: "registryPromote",
  registry_activate: "registryActivate",
  registry_deactivate: "registryDeactivate",
  registry_rollback: "registryRollback",
  registry_deprecate: "registryDeprecate",
  registry_verify: "registryVerify",
  replay: "replay",
  render_chapter: "renderChapter",
  render_concat: "renderConcat",
  contact_sheet: "contactSheet",
  review_record: "reviewRecord",
  grammar: "grammar",
} as const satisfies Record<string, keyof AuthoringService>;

interface InputSchema {
  description: string;
  properties: Record<string, unknown>;
  [key: string]: unknown;
}

export function listTools(): { name: string; description: string; inputSchema: InputSchema }[] {
  const document = schemaDocument("tool-calling");
  const definitions = document.$defs as Record<string, InputSchema>;
  return Object.keys(definitions).filter((key) => key.endsWith(".request")).map((key) => {
    const name = key.slice(0, -8);
    const inputSchema = definitions[`${name}.request`]!;
    return { name, description: inputSchema.description, inputSchema };
  });
}

export async function callTool(name: string, input: unknown, service: AuthoringService = createService({ paths: defaultPaths() })): Promise<ResultEnvelope> {
  if (!Object.hasOwn(TOOL_METHODS, name)) {
    return failure(name, true, [filmError("FS_SCHEMA_INVALID", "/tool", `unknown tool ${name}`)]);
  }
  const tool = listTools().find((entry) => entry.name === name)!;
  const errors = validateSchema(`urn:film-spike:tool-calling#/$defs/${name}.request`, input);
  if (errors.length) return failure(name, true, errors);
  const value = { ...(input as Record<string, unknown>) };
  if (Object.hasOwn(tool.inputSchema.properties, "dryRun")) value.dryRun ??= true;
  if (name === "compile" || name === "compile_concat") {
    value.write = !value.dryRun;
    delete value.dryRun;
  }
  const method = TOOL_METHODS[name as keyof typeof TOOL_METHODS];
  // The canonical per-method schema validated the DTO above. Keep the heterogeneous dispatch here.
  const invoke = service[method] as (input: Record<string, unknown>) => ResultEnvelope | Promise<ResultEnvelope>;
  return invoke(value);
}
