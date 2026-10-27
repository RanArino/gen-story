import { recordReview, type ReviewInput } from "../registry/reviews.js";
import { requireApprovalTerminal } from "./approval-terminal.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createService, type RecipeForkInput } from "../authoring/service.js";
import { failure, type ResultEnvelope } from "../contracts/envelope.js";
import { filmError, FilmFailure } from "../contracts/errors.js";
import { SCHEMA_KINDS, type SchemaKind } from "../contracts/schemas.js";
import { APPROVAL_KINDS, REQUIRED_SLOTS, type ApprovalKind, type CapabilityRequest, type FilmChapters, type FilmTreatment, type VersionRef } from "../contracts/types.js";
import { readFingerprint } from "../env/fingerprint.js";
import type { FontDraft } from "../fonts/fonts.js";
import { defaultPaths } from "../paths.js";
import { confirmationFor, createApproval } from "../registry/approvals.js";
import { outRelative } from "../render/render-chapter.js";
import { startServer } from "../render/server.js";

const OUT_DIR = fileURLToPath(new URL("../../out/", import.meta.url));
const PKG_DIR = fileURLToPath(new URL("../../", import.meta.url));
const service = createService({ paths: defaultPaths() });

interface Parsed {
  positional: string[];
  flags: Record<string, string | true>;
}

function parse(args: string[]): Parsed {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]!;
    if (!arg.startsWith("--")) positional.push(arg);
    else if (args[i + 1] !== undefined && !args[i + 1]!.startsWith("--")) flags[arg.slice(2)] = args[++i]!;
    else flags[arg.slice(2)] = true;
  }
  return { positional, flags };
}

/** Reads a JSON input file. A missing or unparsable file is the user's input error, not a crash. */
function readArg<T>(file: string | true | undefined, name: string): T {
  const inputError = (message: string) => new FilmFailure([{ ...filmError("FS_SCHEMA_INVALID", `/--${name}`, message), owner: "user", remediation: "Pass a readable JSON file." }]);
  if (typeof file !== "string") throw inputError(`missing --${name} <file>`);
  let text: string;
  try {
    text = readFileSync(resolve(PKG_DIR, file), "utf8");
  } catch {
    throw inputError(`cannot read ${file}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw inputError(`${file} is not valid JSON`);
  }
}

function str(value: string | true | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Prints an envelope (JSON with --json) and maps it to an exit code. */
function report(env: ResultEnvelope, args: Parsed, summary?: (env: ResultEnvelope) => string[]): number {
  if (args.flags.json) {
    console.log(JSON.stringify(env, null, 2));
    return env.ok ? 0 : 1;
  }
  console.log(`${env.operation}: ${env.ok ? "ok" : "failed"}${env.dryRun ? " (dry run)" : ""}`);
  for (const e of env.errors) {
    console.log(`  ${e.code} ${e.path || "/"} ${e.message}`);
    if (e.details) console.log(`    ${JSON.stringify(e.details)}`);
    console.log(`    owner: ${e.owner}; ${e.remediation}`);
  }
  if (env.ok && summary) for (const line of summary(env)) console.log(`  ${line}`);
  for (const [name, digest] of Object.entries(env.hashes)) console.log(`  ${name}: ${digest}`);
  for (const m of env.mutations) console.log(`  ${m.kind} ${m.target}`);
  for (const e of env.evidence) console.log(`  wrote ${e}`);
  return env.ok ? 0 : 1;
}

function doctor(): number {
  const env = readFingerprint();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(`${OUT_DIR}env.json`, `${JSON.stringify(env, null, 2)}\n`);
  console.log(`node ${env.node}`);
  console.log(env.chrome ? `chrome ${env.chrome.version} (${env.chrome.path})` : "chrome: CHROME_PATH not set");
  console.log(`ffmpeg ${env.ffmpeg}, ffprobe ${env.ffprobe}`);
  console.log(`os ${env.os}`);
  console.log(`painter ${env.painterDigest}`);
  console.log("wrote out/env.json");
  return env.chrome ? 0 : 1;
}

const KIND_ALIASES: Record<string, SchemaKind> = {
  recipe: "film-style-recipe",
  treatment: "film-treatment",
  manifest: "capability-manifest",
  request: "capability-request",
  font: "font-asset-manifest",
  plan: "resolved-render-plan",
};

function validate(args: Parsed): number {
  const [given, file] = args.positional;
  const kind = given ? (KIND_ALIASES[given] ?? given) : undefined;
  if (!kind || !SCHEMA_KINDS.includes(kind as SchemaKind) || !file) {
    console.error(`usage: film-spike validate <${[...Object.keys(KIND_ALIASES), ...SCHEMA_KINDS].join("|")}> <file> [--json]`);
    return 2;
  }
  // Invalid fixtures wrap the document with its expected error path.
  const raw = readArg<unknown>(file, "file");
  const document = raw !== null && typeof raw === "object" && "expect" in raw && "document" in raw ? raw.document : raw;
  return report(service.validate({ kind: kind as SchemaKind, document }), args);
}

/** Operator-only. Requires an interactive terminal and the typed first eight digest characters. */
async function approve(args: Parsed): Promise<number> {
  const [kind, digest] = args.positional;
  if (!kind || !APPROVAL_KINDS.includes(kind as ApprovalKind) || !digest) {
    console.error(`usage: film-spike approve <${APPROVAL_KINDS.join("|")}> <sha256:digest> [--subject <text>]`);
    return 2;
  }
  try {
    requireApprovalTerminal(process.stdin.isTTY, process.stdout.isTTY);
  } catch (error) {
    console.error((error as Error).message);
    return 1;
  }
  const subject = str(args.flags.subject) ?? digest;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(`Approve ${kind} for ${subject}\n  digest ${digest}`);
    const operator = (await rl.question("Operator name: ")).trim();
    const confirmation = (await rl.question("Type the first 8 hex characters of the digest to approve: ")).trim();
    if (confirmation !== confirmationFor(digest)) {
      console.error("Confirmation does not match; nothing was approved.");
      return 1;
    }
    const record = createApproval(defaultPaths().state, { kind: kind as ApprovalKind, targetDigest: digest, subject, operator: operator || "operator", confirmation });
    console.log(`approved: ${record.id}`);
    return 0;
  } catch (error) {
    if (error instanceof FilmFailure) {
      console.error(error.message);
      return 1;
    }
    throw error;
  } finally {
    rl.close();
  }
}

function catalog(args: Parsed): number {
  const [sub, a, b] = args.positional;
  if (sub === "search" && a) {
    return report(service.catalogSearch({ query: a, ...(str(args.flags.kind) ? { kind: str(args.flags.kind)! } : {}) }), args, (env) =>
      (env.result as { id: string; version: string; title: string }[]).map((h) => `${h.id}@${h.version}  ${h.title}`),
    );
  }
  if (sub === "inspect" && a && b) return report(service.catalogInspect({ id: a, version: b }), args);
  console.error("usage: film-spike catalog search <query> [--kind <kind>] | catalog inspect <id> <version>");
  return 2;
}

async function candidate(args: Parsed): Promise<number> {
  const [sub, value] = args.positional;
  const approvalId = str(args.flags.approval);
  if (sub === "scaffold" && value) return report(service.candidateScaffold({ request: readArg<CapabilityRequest>(value, "request"), ...(approvalId ? { approvalId } : {}), dryRun: !args.flags.apply }), args);
  if (sub === "run" && value) return report(service.candidateRun({ candidate: value, ...(approvalId ? { approvalId } : {}), dryRun: !args.flags.apply }), args);
  if (sub === "static-check" && value) return report(service.candidateStaticCheck({ candidate: value, dryRun: args.flags["dry-run"] === true }), args);
  if (sub === "compile" && value) {
    const { treatment, chapters } = compileArgs(args);
    return report(service.candidateCompile({ candidate: value, treatment, chapters, dryRun: args.flags["dry-run"] === true }), args, (env) =>
      (env.result as { variants: { options: object; active: string; compiled: boolean }[] }).variants.map((v) => `${JSON.stringify(v.options)}: ${v.active}${v.compiled ? " (compiled)" : " (resolved only)"}`),
    );
  }
  if (sub === "evidence" && value) return report(await service.candidateEvidence({ candidate: value, ...(approvalId ? { approvalId } : {}), dryRun: !args.flags.apply }), args);
  if (sub === "promotion-target" && value) {
    return report(service.candidatePromotionTarget({ candidate: value }), args, (env) => {
      const r = env.result as { subject: string; digest: string };
      return [
        `${r.subject} promotion target ${r.digest}`,
        `review with: film-spike review record ${r.digest} --candidate ${value} --subject ${r.subject} --reviewer <name> --verdict accept|reject --notes <text>`,
        `then approve with: film-spike approve promotion ${r.digest} --subject ${r.subject}`,
      ];
    });
  }
  console.error(
    "usage: film-spike candidate scaffold <request.json> --approval <id> [--apply] | static-check <candidate> | compile <candidate> --treatment <file> --chapters <file> | run <candidate> --approval <id> [--apply] | evidence <candidate> --approval <id> [--apply] | promotion-target <candidate>",
  );
  return 2;
}

async function review(args: Parsed): Promise<number> {
  const [sub, subjectDigest] = args.positional;
  const verdict = str(args.flags.verdict);
  const candidate = str(args.flags.candidate);
  const [subject, reviewer, notes] = [str(args.flags.subject), str(args.flags.reviewer), str(args.flags.notes)];
  if (sub !== "record" || !subjectDigest || !candidate || !subject || !reviewer || !notes || (verdict !== "accept" && verdict !== "reject")) {
    console.error("usage: film-spike review record <sha256:digest> --candidate <id> --subject <text> --reviewer <name> --verdict accept|reject --notes <text>");
    return 2;
  }
  const input: ReviewInput = { candidate, subjectDigest, subject, reviewer, verdict, notes };
  if (!args.flags["dry-run"] && (!process.stdin.isTTY || !process.stdout.isTTY)) return report(service.reviewRecord({ ...input, dryRun: false }), args);
  const prepared = service.reviewRecord({ ...input, dryRun: true });
  if (args.flags["dry-run"] || !prepared.ok) return report(prepared, args);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const operator = await rl.question("Recording operator: ");
    const confirmation = await rl.question(`Type ${prepared.result!.confirmation} to record this review: `);
    const recorded = recordReview(defaultPaths(), service.registry, input, operator, confirmation);
    console.log(`recorded ${recorded.id}`);
    return 0;
  } finally { rl.close(); }
}

function font(args: Parsed): number {
  const [sub, a, b] = args.positional;
  const dryRun = !args.flags.apply;
  const approvalId = str(args.flags.approval);
  switch (sub) {
    case "fixtures":
      return report(service.fontFixtures(), args, (env) => (env.result as string[]).map((d) => `wrote .state/quarantine/fonts/incoming/${d}/`));
    case "quarantine":
      if (!a || !b) break;
      return report(service.fontQuarantine({ incoming: a, manifest: readArg<FontDraft>(b, "draft"), dryRun }), args, (env) => [
        `candidate ${(env.result as { candidateId: string }).candidateId}`,
      ]);
    case "inspect":
      if (!a) break;
      return report(service.fontInspect({ candidate: a, dryRun: args.flags["dry-run"] === true }), args, (env) => env.dryRun ? [] : [
        `approve with: film-spike approve promotion ${(env.result as { subjectDigest: string }).subjectDigest} --subject ${a}`,
      ]);
    case "promotion-target":
      if (!a) break;
      return report(service.fontPromotionTarget({ candidate: a }), args);
    case "promote":
      if (!a) break;
      return report(service.fontPromote({ candidate: a, ...(approvalId ? { approvalId } : {}), dryRun }), args);
    case "deactivate":
      if (!a || !b) break;
      return report(service.fontDeactivate({ id: a, version: b, ...(approvalId ? { approvalId } : {}), dryRun }), args);
  }
  console.error(
    "usage: film-spike font fixtures | quarantine <incoming-dir> <draft.json> [--apply] | inspect <candidate> | promote <candidate> --approval <id> [--apply] | deactivate <id> <version> --approval <id> [--apply]",
  );
  return 2;
}

function registryCommand(args: Parsed): number {
  const [sub, id, version] = args.positional;
  const dryRun = !args.flags.apply;
  const approvalId = str(args.flags.approval);
  const exact = id && version ? { id, version, ...(approvalId ? { approvalId } : {}), dryRun } : null;
  if (sub === "verify") return report(service.registryVerify(), args);
  if (sub === "activate" && exact) return report(service.registryActivate(exact), args);
  if (sub === "deactivate" && exact) return report(service.registryDeactivate(exact), args);
  if (sub === "deprecate" && exact) return report(service.registryDeprecate(exact), args);
  if (sub === "rollback" && id) return report(service.registryRollback({ id, ...(approvalId ? { approvalId } : {}), dryRun }), args);
  if (sub === "promote" && id) return report(service.registryPromote({ candidate: id, ...(approvalId ? { approvalId } : {}), dryRun }), args);
  console.error("usage: film-spike registry verify | promote <candidate> --approval <id> [--apply] | activate|deactivate|deprecate <id> <version> --approval <id> [--apply] | rollback <id> --approval <id> [--apply]");
  return 2;
}

/** Parses `a@1.0.0,b@1.1.0` into exact version references. */
function versionRefs(value: string): VersionRef[] {
  return value.split(",").map((item) => {
    const at = item.lastIndexOf("@");
    if (at <= 0) throw new FilmFailure([{ ...filmError("FS_SCHEMA_INVALID", "/--ref", `${item} is not <id>@<version>`), owner: "user" }]);
    return { id: item.slice(0, at), version: item.slice(at + 1) };
  });
}

/** Parses `slot=id@version,...` into a map of exact version references. */
function assignments(value: string | undefined, allowed: readonly string[], name: string): Record<string, VersionRef> {
  if (!value) return {};
  return Object.fromEntries(
    value.split(",").map((item) => {
      const [key, ref] = item.split("=");
      if (!key || !ref || !allowed.includes(key)) {
        throw new FilmFailure([{ ...filmError("FS_SCHEMA_INVALID", `/--${name}`, `${item} is not <${allowed.join("|")}>=<id>@<version>`), owner: "user" }]);
      }
      return [key, versionRefs(ref)[0]!];
    }),
  );
}

function recipe(args: Parsed): number {
  const [sub, id, revision] = args.positional;
  const as = str(args.flags.as);
  if (sub !== "fork" || !id || !revision || !as) {
    console.error(
      "usage: film-spike recipe fork <id> <revision> --as <org.local.id> [--revision r1] [--title <text>] [--slots slot=id@version,...] [--fonts caption|title=id@version,...] [--effects id@version,...|none] [--apply]",
    );
    return 2;
  }
  const effects = str(args.flags.effects);
  const input: RecipeForkInput = {
    source: { id, revision },
    id: as,
    slots: assignments(str(args.flags.slots), REQUIRED_SLOTS, "slots"),
    fonts: assignments(str(args.flags.fonts), ["caption", "title"], "fonts"),
    dryRun: !args.flags.apply,
    ...(str(args.flags.revision) ? { revision: str(args.flags.revision)! } : {}),
    ...(str(args.flags.title) ? { title: str(args.flags.title)! } : {}),
    ...(effects ? { effects: effects === "none" ? [] : versionRefs(effects) } : {}),
  };
  return report(service.recipeFork(input), args, (env) => {
    const r = env.result as { recipe: { id: string; revision: string; capabilities: { slot: string; ref: VersionRef }[] } };
    return [`${r.recipe.id}@${r.recipe.revision}`, ...r.recipe.capabilities.map((c) => `${c.slot}: ${c.ref.id}@${c.ref.version}`)];
  });
}

function grammar(args: Parsed): number {
  if (!args.positional.length) {
    console.error("usage: film-spike grammar <plans-dir>... [--json]");
    return 2;
  }
  return report(service.grammar({ plansDirs: args.positional }), args, (env) =>
    (env.result as { plans: string; metrics: unknown }[]).map((r) => `${r.plans}: ${JSON.stringify(r.metrics)}`),
  );
}

function compileArgs(args: Parsed) {
  return {
    treatment: readArg<FilmTreatment>(args.flags.treatment, "treatment"),
    chapters: readArg<FilmChapters>(args.flags.chapters, "chapters"),
    options: { forceLevel0: args.flags["force-level0"] === true, reducedMotion: args.flags["reduced-motion"] === true },
  };
}

function replay(args: Parsed): number {
  const [planFile] = args.positional;
  if (!planFile) {
    console.error("usage: film-spike replay <plan> --treatment <file> --chapters <file>");
    return 2;
  }
  const { treatment, chapters } = compileArgs(args);
  return report(service.replay({ planFile, treatment, chapters }), args, (env) => [`${(env.result as { chapter: string }).chapter} replays at ${env.hashes.plan}`]);
}

function preflight(args: Parsed): number {
  return report(service.preflight(compileArgs(args)), args, () => ["every Chapter fits its limit and transitions"]);
}

function compile(args: Parsed): number {
  const concatDir = str(args.flags.concat);
  if (concatDir) {
    const env = service.compileConcat({ treatment: readArg<FilmTreatment>(args.flags.treatment, "treatment"), chapters: readArg<FilmChapters>(args.flags.chapters, "chapters"), plansDir: concatDir, write: args.flags["dry-run"] !== true });
    return report(env, args, (e) => [`${(e.result as { runtimeMs: number }).runtimeMs} ms`, `approve with: film-spike approve concat ${e.hashes.plan} --subject ${concatDir}`]);
  }
  const input = compileArgs(args);
  const env = service.compile({ ...input, write: args.flags["dry-run"] !== true });
  return report(env, args, (e) =>
    (e.result as { proposal: { chapterId: string; runtimeMs: number; limitMs: number | null; scenes: { sceneId: string; source: string; durationMs: number }[] }; proposalDigest: string }[]).flatMap((c) => [
      `${c.proposal.chapterId}: ${c.proposal.runtimeMs} ms of ${c.proposal.limitMs ?? "no limit"}; ${c.proposal.scenes.map((s) => `${s.sceneId}=${s.durationMs}${s.source === "user" ? "*" : ""}`).join(" ")}`,
      `  approve timing with: film-spike approve timing ${c.proposalDigest} --subject ${c.proposal.chapterId}`,
    ]),
  );
}

async function render(args: Parsed): Promise<number> {
  const [sub, planFile] = args.positional;
  const approvalId = str(args.flags.approval);
  const lines = (e: ResultEnvelope) => {
    if (e.dryRun) return [];
    const r = e.result as { cache: string; renderMs: number; artifact: { frames: number; runtimeMs: number } };
    return [`${r.artifact.frames} frames, ${r.artifact.runtimeMs} ms; cache ${r.cache}; ${(r.renderMs / 1000).toFixed(1)} s`];
  };
  if (sub === "chapter" && planFile) {
    return report(await service.renderChapter({ planFile, ...(approvalId ? { approvalId } : {}), bypassCache: args.flags["no-cache"] === true, dryRun: args.flags["dry-run"] === true }), args, lines);
  }
  if (sub === "concat" && planFile) return report(await service.renderConcat({ planFile, ...(approvalId ? { approvalId } : {}), dryRun: args.flags["dry-run"] === true }), args, lines);
  console.error("usage: film-spike render chapter <plan> --approval <id> [--no-cache] | render concat <concat.plan.json> --approval <id>");
  return 2;
}

/** Serves the preview page for a Plan until interrupted. */
async function preview(args: Parsed): Promise<number> {
  const [planFile] = args.positional;
  if (!planFile) {
    console.error("usage: film-spike preview <plan>");
    return 2;
  }
  const paths = defaultPaths();
  const plan = outRelative(paths, planFile);
  const server = await startServer(paths);
  console.log(`${server.origin}/runtime/preview.html?plan=${encodeURIComponent(plan)}`);
  console.log("Press Ctrl-C to stop.");
  await new Promise<void>((done) => process.once("SIGINT", done));
  await server.close();
  return 0;
}

async function sheet(args: Parsed): Promise<number> {
  const [planFile] = args.positional;
  if (!planFile) {
    console.error("usage: film-spike contact-sheet <plan> [--grayscale]");
    return 2;
  }
  return report(await service.contactSheet({ planFile, grayscale: args.flags.grayscale === true, dryRun: args.flags["dry-run"] === true }), args);
}

const commands: Record<string, (args: Parsed) => number | Promise<number>> = {
  doctor,
  validate,
  bootstrap: (args) => report(service.bootstrap(), args, (env) => [`${(env.result as { records: number }).records} registry records`]),
  approve,
  catalog,
  candidate,
  font,
  registry: registryCommand,
  review,
  recipe,
  preflight,
  compile,
  replay,
  render,
  preview,
  "contact-sheet": sheet,
  grammar,
};

const [name, ...rest] = process.argv.slice(2);
const command = name ? commands[name] : undefined;
if (!command) {
  console.error(`usage: film-spike <${Object.keys(commands).join("|")}> ...`);
  process.exit(2);
}
const parsed = parse(rest);
try {
  process.exit(await command(parsed));
} catch (error) {
  if (!(error instanceof FilmFailure)) throw error;
  process.exit(report(failure(name!, true, error.errors), parsed));
}
