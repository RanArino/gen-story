import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import {
  compareVersions,
  detectAgentRuntime,
  parseCliVersionOutput,
} from "./runtime-detection";

// These tests spawn real subprocesses; under heavy parallel test load the
// default 5s per-test timeout can be too tight.
vi.setConfig({ testTimeout: 20_000 });

const temporaryRoot = mkdtempSync(join(tmpdir(), "gen-story-runtime-detect-"));
const workingDirectory = join(temporaryRoot, "work");
mkdirSync(workingDirectory);

afterAll(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

let fakeCliCounter = 0;

/** Writes an executable Node script standing in for `codex`/`claude` on argv. */
function writeFakeCli(body: string): string {
  const path = join(temporaryRoot, `fake-cli-${fakeCliCounter++}.mjs`);
  writeFileSync(path, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  return path;
}

function detect(
  binary: string,
  overrides: Partial<Parameters<typeof detectAgentRuntime>[0]> = {},
) {
  return detectAgentRuntime({
    provider: "codex",
    binary,
    workingDirectory,
    allowedWorkingDirectoryRoot: temporaryRoot,
    // Generous headroom: many subprocess-spawning test files now run in
    // parallel in this workspace, and a tight timeout here flakes under load
    // even though the fake CLI itself responds instantly.
    timeoutMs: 8_000,
    ...overrides,
  });
}

describe("version output parsing", () => {
  it("extracts a version number from codex-style output", () => {
    expect(parseCliVersionOutput("codex-cli 0.147.0")).toBe("0.147.0");
  });

  it("extracts a version number from claude-style output", () => {
    expect(parseCliVersionOutput("2.1.220 (Claude Code)")).toBe("2.1.220");
  });

  it("returns null when no version number is present", () => {
    expect(parseCliVersionOutput("no version here")).toBeNull();
  });
});

describe("compareVersions", () => {
  it("treats equal versions as equal", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
  });

  it("orders a higher version above a lower one", () => {
    expect(compareVersions("1.3.0", "1.2.9")).toBe(1);
    expect(compareVersions("1.2.9", "1.3.0")).toBe(-1);
  });

  it("pads missing segments with zero", () => {
    expect(compareVersions("2.0", "2.0.0")).toBe(0);
    expect(compareVersions("2.1", "2.0.9")).toBe(1);
  });
});

describe("detectAgentRuntime", () => {
  it("reports availability for a ChatGPT-authenticated codex CLI", async () => {
    const cli = writeFakeCli(`
      const isVersion = process.argv[2] === "--version";
      process.stdout.write(isVersion ? "codex-cli 0.147.0" : "Logged in using ChatGPT");
    `);

    await expect(detect(cli)).resolves.toEqual({
      status: "available",
      provider: "codex",
      version: "0.147.0",
      authMethod: "ChatGPT",
      subscriptionLabel: "ChatGPT subscription",
    });
  });

  it("reports availability for a claude.ai-authenticated Claude CLI", async () => {
    const cli = writeFakeCli(`
      const isVersion = process.argv[2] === "--version";
      if (isVersion) {
        process.stdout.write("2.1.220 (Claude Code)");
      } else {
        process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", subscriptionType: "pro" }));
      }
    `);

    await expect(detect(cli, { provider: "claude" })).resolves.toEqual({
      status: "available",
      provider: "claude",
      version: "2.1.220",
      authMethod: "claude.ai",
      subscriptionLabel: "Claude Pro subscription",
    });
  });

  it("reports unsupported_version when the installed CLI is too old", async () => {
    const cli = writeFakeCli(`
      process.stdout.write("codex-cli 0.1.0");
    `);

    await expect(detect(cli)).resolves.toMatchObject({
      status: "unavailable",
      reason: "unsupported_version",
    });
  });

  it("reports version_unparseable when --version has no version number", async () => {
    const cli = writeFakeCli(`
      process.stdout.write("no version info here");
    `);

    await expect(detect(cli)).resolves.toMatchObject({
      status: "unavailable",
      reason: "version_unparseable",
    });
  });

  it("reports version_command_failed on a non-zero exit from --version", async () => {
    const cli = writeFakeCli(`
      process.stderr.write("boom");
      process.exit(1);
    `);

    await expect(detect(cli)).resolves.toMatchObject({
      status: "unavailable",
      reason: "version_command_failed",
    });
  });

  it("reports not_logged_in when codex login status says logged out", async () => {
    const cli = writeFakeCli(`
      const isVersion = process.argv[2] === "--version";
      process.stdout.write(isVersion ? "codex-cli 0.147.0" : "Not logged in");
    `);

    await expect(detect(cli)).resolves.toMatchObject({
      status: "unavailable",
      reason: "not_logged_in",
    });
  });

  it("reports not_logged_in when claude auth status has loggedIn: false", async () => {
    const cli = writeFakeCli(`
      const isVersion = process.argv[2] === "--version";
      if (isVersion) {
        process.stdout.write("2.1.220 (Claude Code)");
      } else {
        process.stdout.write(JSON.stringify({ loggedIn: false }));
      }
    `);

    await expect(detect(cli, { provider: "claude" })).resolves.toMatchObject({
      status: "unavailable",
      reason: "not_logged_in",
    });
  });

  it("reports subscription_login_required for codex API-key login, never falling back to it", async () => {
    const cli = writeFakeCli(`
      const isVersion = process.argv[2] === "--version";
      process.stdout.write(isVersion ? "codex-cli 0.147.0" : "Logged in using an API key");
    `);

    await expect(detect(cli)).resolves.toMatchObject({
      status: "unavailable",
      reason: "subscription_login_required",
    });
  });

  it("reports subscription_login_required for claude API-key auth, never falling back to it", async () => {
    const cli = writeFakeCli(`
      const isVersion = process.argv[2] === "--version";
      if (isVersion) {
        process.stdout.write("2.1.220 (Claude Code)");
      } else {
        process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: "apiKey" }));
      }
    `);

    await expect(detect(cli, { provider: "claude" })).resolves.toMatchObject({
      status: "unavailable",
      reason: "subscription_login_required",
    });
  });

  it("reports login_status_unrecognized on unparseable login output", async () => {
    const cli = writeFakeCli(`
      const isVersion = process.argv[2] === "--version";
      process.stdout.write(isVersion ? "codex-cli 0.147.0" : "??? mystery output");
    `);

    await expect(detect(cli)).resolves.toMatchObject({
      status: "unavailable",
      reason: "login_status_unrecognized",
    });
  });

  it("reports binary_not_found when the CLI is missing from PATH", async () => {
    await expect(
      detect(join(temporaryRoot, "does-not-exist-cli")),
    ).resolves.toMatchObject({
      status: "unavailable",
      reason: "binary_not_found",
    });
  });

  it("reports version_command_timed_out when --version hangs", async () => {
    const cli = writeFakeCli(`setInterval(() => {}, 1_000);`);

    await expect(detect(cli, { timeoutMs: 50 })).resolves.toMatchObject({
      status: "unavailable",
      reason: "version_command_timed_out",
    });
  });

  it("reports login_command_timed_out when the login check hangs", async () => {
    const cli = writeFakeCli(`
      const isVersion = process.argv[2] === "--version";
      if (isVersion) {
        process.stdout.write("codex-cli 0.147.0");
      } else {
        setInterval(() => {}, 1_000);
      }
    `);

    // Timeout must comfortably exceed a single node-process spawn (the
    // version step) while still bounding the hung login step.
    await expect(detect(cli, { timeoutMs: 6_000 })).resolves.toMatchObject({
      status: "unavailable",
      reason: "login_command_timed_out",
    });
  });

  it("never sends an unallowlisted environment variable to the child process", async () => {
    const cli = writeFakeCli(`
      const isVersion = process.argv[2] === "--version";
      if (isVersion) {
        process.stdout.write("codex-cli 0.147.0");
      } else {
        process.stdout.write(process.env.OPENAI_API_KEY ? "Logged in using an API key" : "Logged in using ChatGPT");
      }
    `);

    await expect(
      detect(cli, {
        environment: { ...process.env, OPENAI_API_KEY: "must-not-leak" },
      }),
    ).resolves.toMatchObject({ status: "available" });
  });
});
