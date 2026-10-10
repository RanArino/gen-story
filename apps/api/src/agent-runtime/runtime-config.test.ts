import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  agentRuntimeCapabilities,
  agentRuntimeWallet,
  assertLocalDeploymentForCliRuntime,
  resolveAgentRuntimeAvailability,
  resolveAgentRuntimeSelection,
  resolveDeployTarget,
  RuntimeConfigError,
} from "./runtime-config";

describe("resolveAgentRuntimeSelection", () => {
  it("defaults to api when unset", () => {
    expect(resolveAgentRuntimeSelection({})).toBe("api");
  });

  it("accepts codex and claude", () => {
    expect(
      resolveAgentRuntimeSelection({ GEN_STORY_AGENT_RUNTIME: "codex" }),
    ).toBe("codex");
    expect(
      resolveAgentRuntimeSelection({ GEN_STORY_AGENT_RUNTIME: "claude" }),
    ).toBe("claude");
  });

  it("rejects an unknown value instead of silently falling back", () => {
    expect(() =>
      resolveAgentRuntimeSelection({ GEN_STORY_AGENT_RUNTIME: "gpt5" }),
    ).toThrow(RuntimeConfigError);
  });
});

describe("resolveDeployTarget", () => {
  it("defaults to local when unset", () => {
    expect(resolveDeployTarget({})).toBe("local");
  });

  it("treats any non-local value as other", () => {
    expect(resolveDeployTarget({ GEN_STORY_DEPLOY_TARGET: "cloud" })).toBe(
      "other",
    );
  });
});

describe("assertLocalDeploymentForCliRuntime", () => {
  it("allows api runtime regardless of deploy target", () => {
    expect(() =>
      assertLocalDeploymentForCliRuntime("api", "other"),
    ).not.toThrow();
  });

  it("allows a CLI runtime on local deployment", () => {
    expect(() =>
      assertLocalDeploymentForCliRuntime("codex", "local"),
    ).not.toThrow();
  });

  it("rejects a CLI runtime on a non-local deployment", () => {
    expect(() => assertLocalDeploymentForCliRuntime("codex", "other")).toThrow(
      RuntimeConfigError,
    );
  });
});

describe("agentRuntimeCapabilities", () => {
  it("returns null for the api runtime", () => {
    expect(agentRuntimeCapabilities("api")).toBeNull();
  });

  it("returns the matching capability record for codex/claude", () => {
    expect(agentRuntimeCapabilities("codex")?.provider).toBe("codex");
    expect(agentRuntimeCapabilities("claude")?.provider).toBe("claude");
  });
});

describe("agentRuntimeWallet", () => {
  it("labels api as api_key and codex/claude as subscription", () => {
    expect(agentRuntimeWallet("api")).toBe("api_key");
    expect(agentRuntimeWallet("codex")).toBe("subscription");
    expect(agentRuntimeWallet("claude")).toBe("subscription");
  });
});

describe("resolveAgentRuntimeAvailability", () => {
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), "gen-story-runtime-config-"),
  );
  const binDir = join(temporaryRoot, "bin");
  mkdirSync(binDir);
  const fakeCliPath = `${binDir}${delimiter}${dirname(process.execPath)}`;

  afterAll(() => {
    rmSync(temporaryRoot, { recursive: true, force: true });
  });

  it("reports not_applicable for the api runtime without touching the filesystem", async () => {
    const result = await resolveAgentRuntimeAvailability("api", {
      workingDirectory: temporaryRoot,
      allowedWorkingDirectoryRoot: temporaryRoot,
    });

    expect(result).toEqual({ status: "not_applicable" });
  });

  it("reports available for a subscription-logged-in codex CLI", async () => {
    writeFileSync(
      join(binDir, "codex"),
      [
        "#!/usr/bin/env node",
        "const args = process.argv.slice(2);",
        "if (args[0] === '--version') { process.stdout.write('codex-cli 0.147.0'); process.exit(0); }",
        "if (args[0] === 'login' && args[1] === 'status') { process.stdout.write('Logged in using ChatGPT'); process.exit(0); }",
      ].join("\n"),
      { mode: 0o755 },
    );

    const result = await resolveAgentRuntimeAvailability("codex", {
      workingDirectory: temporaryRoot,
      allowedWorkingDirectoryRoot: temporaryRoot,
      environment: { PATH: fakeCliPath },
    });

    expect(result).toEqual({
      status: "available",
      version: "0.147.0",
      authMethod: "ChatGPT",
      subscriptionLabel: "ChatGPT subscription",
    });
  });

  it("reports unavailable with the detection reason when the CLI is missing", async () => {
    const result = await resolveAgentRuntimeAvailability("claude", {
      workingDirectory: temporaryRoot,
      allowedWorkingDirectoryRoot: temporaryRoot,
      environment: { PATH: binDir },
    });

    expect(result).toMatchObject({
      status: "unavailable",
      reason: "binary_not_found",
    });
  });
});
