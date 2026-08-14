import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  ClaudeGenerationError,
  runClaudeJsonGeneration,
} from "./claude-json-generation";

const temporaryRoot = mkdtempSync(join(tmpdir(), "gen-story-claude-json-gen-"));
const binDir = join(temporaryRoot, "bin");
const homeDir = join(temporaryRoot, "home");
const repositoryRoot = join(temporaryRoot, "repo");
mkdirSync(binDir);
mkdirSync(homeDir);
mkdirSync(repositoryRoot);

afterAll(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

// Fake `claude` scripts use a `#!/usr/bin/env node` shebang, so PATH must
// still resolve the real `node` alongside the shadowed `claude` binary.
const fakeCliPath = `${binDir}${delimiter}${dirname(process.execPath)}`;

/**
 * Writes a fake `claude` executable onto `binDir` (shadowing the real CLI via
 * PATH) that answers `--version`/`auth status` for runtime detection and
 * runs `generationBody` (raw JS, `args`/`stdinData`/`fs` in scope, must
 * `process.stdout.write(...)` a full stream-json transcript) for `-p` calls.
 */
function writeFakeClaude(generationBody: string): void {
  const path = join(binDir, "claude");
  writeFileSync(
    path,
    [
      "#!/usr/bin/env node",
      "const fs = require('fs');",
      "const args = process.argv.slice(2);",
      "if (args[0] === '--version') { process.stdout.write('2.1.220 (Claude Code)'); process.exit(0); }",
      "if (args[0] === 'auth' && args[1] === 'status') { process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'pro' })); process.exit(0); }",
      "let stdinData = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => { stdinData += chunk; });",
      "process.stdin.on('end', () => {",
      generationBody,
      "});",
    ].join("\n"),
    { mode: 0o755 },
  );
}

function initEvent(): string {
  return JSON.stringify({
    type: "system",
    subtype: "init",
    model: "claude-sonnet-5",
  });
}

function resultEvent(structuredOutput: unknown): string {
  return JSON.stringify({
    type: "result",
    is_error: false,
    subtype: "success",
    structured_output: structuredOutput,
  });
}

function generate<T>(
  overrides: Partial<Parameters<typeof runClaudeJsonGeneration>[0]> = {},
  parse: (text: string, model: string) => T = (text) => JSON.parse(text) as T,
) {
  return runClaudeJsonGeneration(
    {
      prompt: "describe this",
      jsonSchema: { type: "object" },
      repositoryRoot,
      environment: { PATH: fakeCliPath, HOME: homeDir },
      timeoutMs: 5_000,
      ...overrides,
    },
    parse,
  );
}

describe("runClaudeJsonGeneration", () => {
  it("invokes claude -p and returns the parsed structured output", async () => {
    writeFakeClaude(`
      process.stdout.write(${JSON.stringify(initEvent())} + '\\n');
      process.stdout.write(${JSON.stringify(resultEvent({ ok: true }))} + '\\n');
      process.exit(0);
    `);

    const result = await generate({}, (text, model) => ({
      value: JSON.parse(text),
      model,
    }));

    expect(result).toEqual({ value: { ok: true }, model: "claude-sonnet-5" });
  });

  it("passes --tools '', --permission-mode bypassPermissions, and the json schema", async () => {
    writeFakeClaude(`
      fs.writeFileSync(process.env.HOME + '/captured-args.json', JSON.stringify(args));
      process.stdout.write(${JSON.stringify(initEvent())} + '\\n');
      process.stdout.write(${JSON.stringify(resultEvent({}))} + '\\n');
      process.exit(0);
    `);

    await generate();

    const capturedArgs = JSON.parse(
      readFileSync(join(homeDir, "captured-args.json"), "utf8"),
    );
    expect(capturedArgs).toEqual(
      expect.arrayContaining([
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--tools",
        "",
        "--permission-mode",
        "bypassPermissions",
        "--json-schema",
        JSON.stringify({ type: "object" }),
      ]),
    );
  });

  it("sends each image as a base64 content block on stdin", async () => {
    writeFakeClaude(`
      const message = JSON.parse(stdinData);
      const imageBlocks = message.message.content.filter((block) => block.type === 'image');
      process.stdout.write(${JSON.stringify(initEvent())} + '\\n');
      process.stdout.write(JSON.stringify({
        type: 'result',
        is_error: false,
        structured_output: {
          imageCount: imageBlocks.length,
          mediaTypes: imageBlocks.map((b) => b.source.media_type),
        },
      }) + '\\n');
      process.exit(0);
    `);

    const result = await generate(
      {
        images: [
          { mimeType: "image/jpeg", body: new Uint8Array([1, 2, 3]) },
          { mimeType: "image/png", body: new Uint8Array([4, 5, 6, 7]) },
        ],
      },
      (text) => JSON.parse(text),
    );

    expect(result).toEqual({
      imageCount: 2,
      mediaTypes: ["image/jpeg", "image/png"],
    });
  });

  it("retries once when structured_output does not parse, then succeeds", async () => {
    writeFakeClaude(`
      const counterFile = process.env.HOME + '/attempts.txt';
      const attempt = fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, 'utf8')) + 1 : 1;
      fs.writeFileSync(counterFile, String(attempt));
      process.stdout.write(${JSON.stringify(initEvent())} + '\\n');
      process.stdout.write(JSON.stringify({
        type: 'result',
        is_error: false,
        structured_output: attempt === 1 ? 'not an object' : { attempt },
      }) + '\\n');
      process.exit(0);
    `);

    const result = await generate({}, (text) => {
      const parsed = JSON.parse(text);
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("attempt" in parsed)
      ) {
        throw new Error("malformed");
      }
      return parsed;
    });

    expect(result).toEqual({ attempt: 2 });
  });

  it("fails with the raw output after exhausting retries on persistently malformed output", async () => {
    writeFakeClaude(`
      process.stdout.write(${JSON.stringify(initEvent())} + '\\n');
      process.stdout.write(${JSON.stringify(resultEvent("still bad"))} + '\\n');
      process.exit(0);
    `);

    const error = await generate({}, (text) => {
      const parsed = JSON.parse(text);
      if (parsed !== "expected") {
        throw new Error("malformed");
      }
      return parsed;
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ClaudeGenerationError);
    expect((error as ClaudeGenerationError).rawOutput).toBe(
      JSON.stringify("still bad"),
    );
  });

  it("wraps a Claude-reported error result as ClaudeGenerationError", async () => {
    writeFakeClaude(`
      process.stdout.write(${JSON.stringify(initEvent())} + '\\n');
      process.stdout.write(JSON.stringify({ type: 'result', is_error: true, subtype: 'error_max_turns', result: 'ran out of turns' }) + '\\n');
      process.exit(0);
    `);

    const error = await generate().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ClaudeGenerationError);
    expect((error as Error).message).toMatch(/Claude CLI reported an error/);
  });

  it("wraps a non-zero claude exit as ClaudeGenerationError", async () => {
    writeFakeClaude(`
      process.stderr.write('claude failed');
      process.exit(2);
    `);

    const error = await generate().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ClaudeGenerationError);
    expect((error as Error).message).toMatch(/Claude CLI generation failed/);
  });

  it("fails fast when claude is not logged in, without attempting generation", async () => {
    const path = join(binDir, "claude");
    writeFileSync(
      path,
      [
        "#!/usr/bin/env node",
        "const args = process.argv.slice(2);",
        "if (args[0] === '--version') { process.stdout.write('2.1.220 (Claude Code)'); process.exit(0); }",
        "if (args[0] === 'auth' && args[1] === 'status') { process.stdout.write(JSON.stringify({ loggedIn: false })); process.exit(0); }",
        "process.stderr.write('generation should not have been called'); process.exit(1);",
      ].join("\n"),
      { mode: 0o755 },
    );

    const error = await generate().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ClaudeGenerationError);
    expect((error as Error).message).toMatch(
      /Claude runtime is unavailable \(not_logged_in\)/,
    );
  });
});
