import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  CliProcessError,
  createCliEnvironment,
  runCliProcess,
} from "./cli-process";

const temporaryRoot = mkdtempSync(join(tmpdir(), "gen-story-cli-process-"));
const workingDirectory = join(temporaryRoot, "work");
mkdirSync(workingDirectory);

afterAll(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

function runNode(
  script: string,
  overrides: Partial<Parameters<typeof runCliProcess>[0]> = {},
) {
  return runCliProcess({
    command: process.execPath,
    args: ["-e", script],
    workingDirectory,
    allowedWorkingDirectoryRoot: temporaryRoot,
    timeoutMs: 2_000,
    ...overrides,
  });
}

describe("safe CLI process boundary", () => {
  it("copies only explicitly allowed environment variables", () => {
    expect(
      createCliEnvironment({
        PATH: "/usr/bin",
        HOME: "/tmp/operator",
        OPENAI_API_KEY: "must-not-leak",
        ANTHROPIC_API_KEY: "must-not-leak",
        GEMINI_API_KEY: "must-not-leak",
        UNRELATED: "must-not-leak",
      }),
    ).toEqual({ PATH: "/usr/bin", HOME: "/tmp/operator" });
  });

  it("passes arguments literally without shell interpretation", async () => {
    const literalArgument = "hello; echo injected && $(whoami)";
    const result = await runNode("console.log(process.argv[1])", {
      args: ["-e", "console.log(process.argv[1])", literalArgument],
    });

    expect(result.stdout.trim()).toBe(literalArgument);
    expect(result.exitCode).toBe(0);
  });

  it("passes stdin and strips API keys from the child environment", async () => {
    const result = await runNode(
      [
        "let input = '';",
        "process.stdin.setEncoding('utf8');",
        "process.stdin.on('data', chunk => input += chunk);",
        "process.stdin.on('end', () => console.log(JSON.stringify({ input, key: process.env.OPENAI_API_KEY ?? null })));",
      ].join(""),
      {
        stdin: "new turn",
        environment: {
          ...process.env,
          OPENAI_API_KEY: "must-not-leak",
        },
      },
    );

    expect(JSON.parse(result.stdout)).toEqual({ input: "new turn", key: null });
  });

  it("redacts captured output and errors", async () => {
    const secret = "operator-secret-value";
    const error = await runNode(
      `process.stderr.write(${JSON.stringify(secret)}); process.exit(2)`,
      {
        environment: { ...process.env, SESSION_TOKEN: secret },
      },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CliProcessError);
    expect(error).toMatchObject({
      reason: "failed",
      exitCode: 2,
      stderr: "[REDACTED]",
    });
  });

  it("terminates a process after its timeout", async () => {
    const error = await runNode("setInterval(() => {}, 1_000)", {
      timeoutMs: 25,
      killGraceMs: 25,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CliProcessError);
    expect(error).toMatchObject({ reason: "timed_out" });
  });

  it("terminates a process when its abort signal is canceled", async () => {
    const controller = new AbortController();
    const running = runNode("setInterval(() => {}, 1_000)", {
      signal: controller.signal,
      killGraceMs: 25,
    });
    setTimeout(() => controller.abort(), 25);

    const error = await running.catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(CliProcessError);
    expect(error).toMatchObject({ reason: "canceled" });
  });

  it("rejects a working directory outside the allowed root", async () => {
    await expect(
      runNode("console.log('no')", {
        workingDirectory: tmpdir(),
      }),
    ).rejects.toThrow(/inside the allowed root/);
  });
});
