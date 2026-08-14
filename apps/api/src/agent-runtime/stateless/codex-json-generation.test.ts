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
  CodexGenerationError,
  runCodexJsonGeneration,
} from "./codex-json-generation";

const temporaryRoot = mkdtempSync(join(tmpdir(), "gen-story-codex-json-gen-"));
const binDir = join(temporaryRoot, "bin");
const homeDir = join(temporaryRoot, "home");
const repositoryRoot = join(temporaryRoot, "repo");
mkdirSync(binDir);
mkdirSync(homeDir);
mkdirSync(repositoryRoot);

afterAll(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

// Fake `codex` scripts use a `#!/usr/bin/env node` shebang, so PATH must
// still resolve the real `node` alongside the shadowed `codex` binary.
const fakeCliPath = `${binDir}${delimiter}${dirname(process.execPath)}`;

/**
 * Writes a fake `codex` executable onto `binDir` (shadowing the real CLI via
 * PATH) that answers `--version`/`login status` for runtime detection and
 * runs `execBody` (raw JS, `args`/`fs`/`path` in scope) for `exec` calls.
 */
function writeFakeCodex(execBody: string): void {
  const path = join(binDir, "codex");
  writeFileSync(
    path,
    [
      "#!/usr/bin/env node",
      "const fs = require('fs');",
      "const path = require('path');",
      "const args = process.argv.slice(2);",
      "if (args[0] === '--version') { process.stdout.write('codex-cli 0.147.0'); process.exit(0); }",
      "if (args[0] === 'login' && args[1] === 'status') { process.stdout.write('Logged in using ChatGPT'); process.exit(0); }",
      "if (args[0] === 'exec') {",
      execBody,
      "  process.exit(0);",
      "}",
      "process.stderr.write('unrecognized fake codex invocation'); process.exit(1);",
    ].join("\n"),
    { mode: 0o755 },
  );
}

function generate<T>(
  overrides: Partial<Parameters<typeof runCodexJsonGeneration>[0]> = {},
  parse: (text: string, model: string) => T = (text) => JSON.parse(text) as T,
) {
  return runCodexJsonGeneration(
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

describe("runCodexJsonGeneration", () => {
  it("invokes codex exec with the expected argv and returns the parsed result", async () => {
    writeFakeCodex(`
      const outIdx = args.indexOf('--output-last-message');
      fs.writeFileSync(args[outIdx + 1], JSON.stringify({ ok: true }));
      process.stdout.write('model: gpt-test-model\\n');
    `);

    const result = await generate({}, (text, model) => ({
      value: JSON.parse(text),
      model,
    }));

    expect(result).toEqual({ value: { ok: true }, model: "gpt-test-model" });
  });

  it("passes --sandbox read-only, --skip-git-repo-check, --ephemeral, and the schema/output flags", async () => {
    let capturedArgs: string[] = [];
    writeFakeCodex(`
      const outIdx = args.indexOf('--output-last-message');
      fs.writeFileSync(args[outIdx + 1], '{}');
      fs.writeFileSync(path.join(process.env.HOME, 'captured-args.json'), JSON.stringify(args));
    `);

    await generate();

    capturedArgs = JSON.parse(
      readFileSync(join(homeDir, "captured-args.json"), "utf8"),
    );
    expect(capturedArgs).toEqual(
      expect.arrayContaining([
        "--sandbox",
        "read-only",
        "--skip-git-repo-check",
        "--ephemeral",
        "--output-schema",
        "--output-last-message",
        "-C",
        "describe this",
      ]),
    );
  });

  it("writes each image to a scratch file and passes its path with -i", async () => {
    writeFakeCodex(`
      const outIdx = args.indexOf('--output-last-message');
      const imageIndexes = args.reduce((acc, value, index) => {
        if (value === '-i') acc.push(index + 1);
        return acc;
      }, []);
      const imageSizes = imageIndexes.map((index) => fs.statSync(args[index]).size);
      fs.writeFileSync(args[outIdx + 1], JSON.stringify({ imageCount: imageIndexes.length, imageSizes }));
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

    expect(result).toEqual({ imageCount: 2, imageSizes: [3, 4] });
  });

  it("retries once when the output does not parse, then succeeds", async () => {
    writeFakeCodex(`
      const outIdx = args.indexOf('--output-last-message');
      const counterFile = path.join(process.env.HOME, 'attempts.txt');
      const attempt = fs.existsSync(counterFile) ? Number(fs.readFileSync(counterFile, 'utf8')) + 1 : 1;
      fs.writeFileSync(counterFile, String(attempt));
      fs.writeFileSync(args[outIdx + 1], attempt === 1 ? 'not valid json' : JSON.stringify({ attempt }));
    `);

    const result = await generate();

    expect(result).toEqual({ attempt: 2 });
  });

  it("fails with the raw output after exhausting retries on persistently malformed output", async () => {
    writeFakeCodex(`
      const outIdx = args.indexOf('--output-last-message');
      fs.writeFileSync(args[outIdx + 1], 'still not json');
    `);

    const error = await generate().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CodexGenerationError);
    expect((error as CodexGenerationError).rawOutput).toBe("still not json");
  });

  it("wraps a non-zero codex exec exit as CodexGenerationError", async () => {
    writeFakeCodex(`
      process.stderr.write('codex exec failed');
      process.exit(2);
    `);

    const error = await generate().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CodexGenerationError);
    expect((error as Error).message).toMatch(/Codex CLI generation failed/);
  });

  it("fails fast when codex is not logged in, without attempting exec", async () => {
    const path = join(binDir, "codex");
    writeFileSync(
      path,
      [
        "#!/usr/bin/env node",
        "const args = process.argv.slice(2);",
        "if (args[0] === '--version') { process.stdout.write('codex-cli 0.147.0'); process.exit(0); }",
        "if (args[0] === 'login' && args[1] === 'status') { process.stdout.write('Not logged in'); process.exit(0); }",
        "process.stderr.write('exec should not have been called'); process.exit(1);",
      ].join("\n"),
      { mode: 0o755 },
    );

    const error = await generate().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CodexGenerationError);
    expect((error as Error).message).toMatch(
      /Codex runtime is unavailable \(not_logged_in\)/,
    );
  });
});
