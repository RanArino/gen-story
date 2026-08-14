import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { CliProcessError, runCliProcess } from "../cli-process";
import { detectAgentRuntime } from "../runtime-detection";

export class CodexGenerationError extends Error {
  constructor(
    message: string,
    readonly rawOutput?: string,
  ) {
    super(message);
    this.name = "CodexGenerationError";
  }
}

export type CodexJsonGenerationImage = {
  mimeType: string;
  body: Uint8Array;
};

export type CodexJsonGenerationInput = {
  prompt: string;
  jsonSchema: Record<string, unknown>;
  images?: readonly CodexJsonGenerationImage[];
  model?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  environment?: NodeJS.ProcessEnv;
  /** Only overridden by tests; defaults to the repository root. */
  repositoryRoot?: string;
};

const DEFAULT_GENERATION_TIMEOUT_MS = 180_000;
const MAX_GENERATION_ATTEMPTS = 2;
const DEFAULT_MODEL_LABEL = "codex-cli";
const MODEL_LINE_PATTERN = /^model:\s*(\S+)/m;

const IMAGE_EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function scratchRoot(repositoryRoot: string): string {
  return join(repositoryRoot, "data", "agent-runtime-scratch", "codex");
}

function parseModelFromStdout(stdout: string): string {
  return stdout.match(MODEL_LINE_PATTERN)?.[1] ?? DEFAULT_MODEL_LABEL;
}

async function invokeCodexOnce(
  input: CodexJsonGenerationInput,
): Promise<{ text: string; model: string }> {
  const repositoryRoot = input.repositoryRoot ?? process.cwd();
  const root = scratchRoot(repositoryRoot);
  await mkdir(root, { recursive: true });
  const scratchDir = await mkdtemp(join(root, "run-"));

  try {
    const schemaPath = join(scratchDir, "schema.json");
    const outputPath = join(scratchDir, "last-message.txt");
    await writeFile(schemaPath, JSON.stringify(input.jsonSchema));

    const imageArgs: string[] = [];
    for (const [index, image] of (input.images ?? []).entries()) {
      const extension = IMAGE_EXTENSION_BY_MIME_TYPE[image.mimeType] ?? "jpg";
      const imagePath = join(scratchDir, `image-${index}.${extension}`);
      await writeFile(imagePath, image.body);
      imageArgs.push("-i", imagePath);
    }

    const args = [
      "exec",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--ephemeral",
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      "-C",
      scratchDir,
      ...(input.model ? ["-m", input.model] : []),
      ...imageArgs,
      input.prompt,
    ];

    let stdout: string;
    try {
      const result = await runCliProcess({
        command: "codex",
        args,
        workingDirectory: scratchDir,
        allowedWorkingDirectoryRoot: root,
        timeoutMs: input.timeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS,
        signal: input.signal,
        environment: input.environment,
      });
      stdout = result.stdout;
    } catch (error) {
      if (error instanceof CliProcessError) {
        throw new CodexGenerationError(
          `Codex CLI generation failed (${error.reason}): ${error.message || error.stderr}`,
        );
      }
      throw error;
    }

    const text = await readFile(outputPath, "utf8").catch(() => "");
    if (text.trim().length === 0) {
      throw new CodexGenerationError("Codex CLI returned an empty response.");
    }

    return { text, model: parseModelFromStdout(stdout) };
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}

/**
 * Runs one Codex CLI JSON generation, verifying subscription-backed runtime
 * availability first and retrying a bounded number of times if the output
 * does not match `parse`'s expectations (schema mismatch, malformed JSON).
 */
export async function runCodexJsonGeneration<T>(
  input: CodexJsonGenerationInput,
  parse: (text: string, model: string) => T,
): Promise<T> {
  const detectionRoot = input.repositoryRoot ?? process.cwd();
  const detection = await detectAgentRuntime({
    provider: "codex",
    workingDirectory: detectionRoot,
    allowedWorkingDirectoryRoot: detectionRoot,
    environment: input.environment,
  });
  if (detection.status === "unavailable") {
    throw new CodexGenerationError(
      `Codex runtime is unavailable (${detection.reason}): ${detection.message}`,
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
    const { text, model } = await invokeCodexOnce(attemptInput);
    lastRawOutput = text;
    try {
      return parse(text, model);
    } catch (error) {
      lastError = error;
    }
  }

  throw new CodexGenerationError(
    `Codex CLI output did not match the expected schema after ${MAX_GENERATION_ATTEMPTS} attempt(s): ${String(lastError)}`,
    lastRawOutput,
  );
}
