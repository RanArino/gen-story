import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import { CliProcessError, runCliProcess } from "../cli-process";
import { detectAgentRuntime } from "../runtime-detection";

export class ClaudeGenerationError extends Error {
  constructor(
    message: string,
    readonly rawOutput?: string,
  ) {
    super(message);
    this.name = "ClaudeGenerationError";
  }
}

export type ClaudeJsonGenerationImage = {
  mimeType: string;
  body: Uint8Array;
};

export type ClaudeJsonGenerationInput = {
  prompt: string;
  jsonSchema: Record<string, unknown>;
  images?: readonly ClaudeJsonGenerationImage[];
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  environment?: NodeJS.ProcessEnv;
  /** Only overridden by tests; defaults to the repository root. */
  repositoryRoot?: string;
};

const DEFAULT_GENERATION_TIMEOUT_MS = 180_000;
const MAX_GENERATION_ATTEMPTS = 2;
const DEFAULT_MODEL_LABEL = "claude-cli";

type ClaudeStreamEvent = Record<string, unknown>;

function scratchRoot(repositoryRoot: string): string {
  return join(repositoryRoot, "data", "agent-runtime-scratch", "claude");
}

// `claude -p --output-format stream-json` prints one JSON object per line;
// non-JSON lines (there should be none, but nothing guarantees it) are
// ignored rather than failing the whole call.
function parseStreamEvents(stdout: string): ClaudeStreamEvent[] {
  const events: ClaudeStreamEvent[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    try {
      events.push(JSON.parse(trimmed) as ClaudeStreamEvent);
    } catch {
      continue;
    }
  }
  return events;
}

function findModel(events: readonly ClaudeStreamEvent[]): string {
  const init = events.find(
    (event) => event.type === "system" && event.subtype === "init",
  );
  const model = init?.model;
  return typeof model === "string" && model.length > 0
    ? model
    : DEFAULT_MODEL_LABEL;
}

async function invokeClaudeOnce(
  input: ClaudeJsonGenerationInput,
): Promise<{ text: string; model: string }> {
  const repositoryRoot = input.repositoryRoot ?? process.cwd();
  const root = scratchRoot(repositoryRoot);
  await mkdir(root, { recursive: true });
  // Claude Code auto-discovers CLAUDE.md/skills/plugins from its working
  // directory; running from an isolated per-call scratch dir (in addition to
  // --setting-sources "") keeps a stateless JSON generation call from being
  // influenced by whatever project happens to host this API process.
  const scratchDir = await mkdtemp(join(root, "run-"));

  try {
    const content: Record<string, unknown>[] = [
      { type: "text", text: input.prompt },
    ];
    for (const image of input.images ?? []) {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: image.mimeType,
          data: Buffer.from(image.body).toString("base64"),
        },
      });
    }
    const stdin = `${JSON.stringify({
      type: "user",
      message: { role: "user", content },
    })}\n`;

    const args = [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--json-schema",
      JSON.stringify(input.jsonSchema),
      "--tools",
      "",
      "--no-session-persistence",
      "--permission-mode",
      "bypassPermissions",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      "--disable-slash-commands",
      ...(input.model ? ["--model", input.model] : []),
    ];

    let stdout: string;
    try {
      const result = await runCliProcess({
        command: "claude",
        args,
        workingDirectory: scratchDir,
        allowedWorkingDirectoryRoot: root,
        timeoutMs: input.timeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS,
        signal: input.signal,
        environment: input.environment,
        stdin,
      });
      stdout = result.stdout;
    } catch (error) {
      if (error instanceof CliProcessError) {
        // error.message is a generic summary for a non-zero exit;
        // error.stderr usually carries the actual reason. Both matter — see
        // the matching fix in codex-json-generation.ts.
        const detail = [error.message, error.stderr]
          .filter((part) => part.trim().length > 0)
          .join(" — stderr: ");
        throw new ClaudeGenerationError(
          `Claude CLI generation failed (${error.reason}): ${detail}`,
          error.stderr,
        );
      }
      throw error;
    }

    const events = parseStreamEvents(stdout);
    const model = findModel(events);
    const resultEvent = [...events]
      .reverse()
      .find((event) => event.type === "result");

    if (resultEvent == null) {
      throw new ClaudeGenerationError(
        "Claude CLI did not return a result event.",
        stdout,
      );
    }
    if (resultEvent.is_error === true) {
      throw new ClaudeGenerationError(
        `Claude CLI reported an error: ${String(resultEvent.result ?? resultEvent.subtype ?? "unknown error")}`,
        stdout,
      );
    }

    const structuredOutput = resultEvent.structured_output;
    if (structuredOutput == null) {
      throw new ClaudeGenerationError(
        "Claude CLI returned no structured output.",
        stdout,
      );
    }

    return { text: JSON.stringify(structuredOutput), model };
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}

/**
 * Runs one Claude CLI JSON generation, verifying subscription-backed runtime
 * availability first and retrying a bounded number of times if the output
 * does not match `parse`'s expectations (schema mismatch, malformed JSON).
 */
export async function runClaudeJsonGeneration<T>(
  input: ClaudeJsonGenerationInput,
  parse: (text: string, model: string) => T,
): Promise<T> {
  const detectionRoot = input.repositoryRoot ?? process.cwd();
  const detection = await detectAgentRuntime({
    provider: "claude",
    workingDirectory: detectionRoot,
    allowedWorkingDirectoryRoot: detectionRoot,
    environment: input.environment,
  });
  if (detection.status === "unavailable") {
    throw new ClaudeGenerationError(
      `Claude runtime is unavailable (${detection.reason}): ${detection.message}`,
    );
  }

  let lastError: unknown;
  let lastRawOutput = "";
  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const attemptInput =
      attempt === 1
        ? input
        : {
            ...input,
            prompt: `${input.prompt}\n\nYour previous response did not match the required JSON schema exactly. Return ONLY valid JSON matching the schema, with no commentary.`,
          };
    const { text, model } = await invokeClaudeOnce(attemptInput);
    lastRawOutput = text;
    try {
      return parse(text, model);
    } catch (error) {
      lastError = error;
    }
  }

  throw new ClaudeGenerationError(
    `Claude CLI output did not match the expected schema after ${MAX_GENERATION_ATTEMPTS} attempt(s): ${String(lastError)}`,
    lastRawOutput,
  );
}
