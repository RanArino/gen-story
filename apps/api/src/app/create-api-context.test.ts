import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { migrateDatabase, openDatabase } from "../db";
import type { GenStorySqliteClient } from "../db/client";
import { GeminiPhotoAnalysisGenerationAdapter } from "../photo-analysis/gemini-photo-analysis-generation";
import { LocalPhotoAnalysisGenerationAdapter } from "../photo-analysis/local-photo-analysis-generation";
import { CodexPhotoAnalysisGenerationAdapter } from "../photo-analysis/codex-photo-analysis-generation";
import { ClaudePhotoAnalysisGenerationAdapter } from "../photo-analysis/claude-photo-analysis-generation";
import { GeminiStorySetupGenerationAdapter } from "../story-setup/gemini-story-setup-generation";
import { LocalStorySetupGenerationAdapter } from "../story-setup/local-story-setup-generation";
import { CodexStorySetupGenerationAdapter } from "../story-setup/codex-story-setup-generation";
import { ClaudeStorySetupGenerationAdapter } from "../story-setup/claude-story-setup-generation";
import { GeminiSceneFillGenerationAdapter } from "../scene-fill/gemini-scene-fill-generation";
import { CodexSceneFillGenerationAdapter } from "../scene-fill/codex-scene-fill-generation";
import { ClaudeSceneFillGenerationAdapter } from "../scene-fill/claude-scene-fill-generation";
import { GeminiComplementSceneProposalAdapter } from "../complement-scenes/gemini-complement-scene-proposal";
import { CodexComplementSceneProposalAdapter } from "../complement-scenes/codex-complement-scene-proposal";
import { ClaudeComplementSceneProposalAdapter } from "../complement-scenes/claude-complement-scene-proposal";

import { createApiContext } from "./create-api-context";

let directory: string | null = null;
let client: GenStorySqliteClient | null = null;

function withClient(): GenStorySqliteClient {
  directory = mkdtempSync(join(tmpdir(), "gen-story-api-context-"));
  client = openDatabase(join(directory, "test.sqlite"));
  migrateDatabase(client.db);
  return client;
}

afterEach(() => {
  client?.close();
  if (directory) rmSync(directory, { force: true, recursive: true });
  client = null;
  directory = null;
});

describe("createApiContext runtime selection", () => {
  it("runs the chat on a CLI while the capabilities stay on the API runtime", () => {
    const deps = createApiContext(withClient(), {
      GEN_STORY_AGENT_CHAT_RUNTIME: "codex",
    });

    // Turning the chat on must not re-route photo analysis, story setup, or
    // scene fill onto the CLI.
    expect(deps.agentRuntime.selection).toBe("api");
    expect(deps.agentRuntime.chat).toEqual({
      selection: "codex",
      availability: { status: "unchecked" },
    });
    expect(deps.photoAnalysisGeneration).toBeInstanceOf(
      LocalPhotoAnalysisGenerationAdapter,
    );
  });

  it("defaults to the Gemini/local adapter graph when unset", () => {
    const deps = createApiContext(withClient(), {});

    expect(deps.agentRuntime).toEqual({
      selection: "api",
      wallet: "api_key",
      capabilities: null,
      availability: { status: "not_applicable" },
      chat: { selection: "api", availability: { status: "not_applicable" } },
    });
    // No GEMINI_API_KEY in the test env, so photo analysis/story setup fall
    // back to their deterministic local adapters (unchanged existing
    // behavior), while scene fill/complement scenes remain Gemini adapters
    // that throw only when actually called without a key.
    expect(deps.photoAnalysisGeneration).toBeInstanceOf(
      LocalPhotoAnalysisGenerationAdapter,
    );
    expect(deps.storySetupGeneration).toBeInstanceOf(
      LocalStorySetupGenerationAdapter,
    );
    expect(deps.sceneFillGeneration).toBeInstanceOf(
      GeminiSceneFillGenerationAdapter,
    );
    expect(deps.complementSceneProposal).toBeInstanceOf(
      GeminiComplementSceneProposalAdapter,
    );
  });

  it("uses the Gemini adapter graph when GEMINI_API_KEY is set", () => {
    const deps = createApiContext(withClient(), {
      GEMINI_API_KEY: "test-key",
    });

    expect(deps.agentRuntime.selection).toBe("api");
    expect(deps.photoAnalysisGeneration).toBeInstanceOf(
      GeminiPhotoAnalysisGenerationAdapter,
    );
    expect(deps.storySetupGeneration).toBeInstanceOf(
      GeminiStorySetupGenerationAdapter,
    );
  });

  it("selects the Codex adapter graph for GEN_STORY_AGENT_RUNTIME=codex", () => {
    const deps = createApiContext(withClient(), {
      GEN_STORY_AGENT_RUNTIME: "codex",
    });

    expect(deps.agentRuntime).toEqual({
      selection: "codex",
      wallet: "subscription",
      capabilities: expect.objectContaining({ provider: "codex" }),
      availability: { status: "unchecked" },
      // The chat follows the capability runtime unless it is set on its own.
      chat: { selection: "codex", availability: { status: "unchecked" } },
    });
    expect(deps.photoAnalysisGeneration).toBeInstanceOf(
      CodexPhotoAnalysisGenerationAdapter,
    );
    expect(deps.storySetupGeneration).toBeInstanceOf(
      CodexStorySetupGenerationAdapter,
    );
    expect(deps.sceneFillGeneration).toBeInstanceOf(
      CodexSceneFillGenerationAdapter,
    );
    expect(deps.complementSceneProposal).toBeInstanceOf(
      CodexComplementSceneProposalAdapter,
    );
  });

  it("selects the Claude adapter graph for GEN_STORY_AGENT_RUNTIME=claude", () => {
    const deps = createApiContext(withClient(), {
      GEN_STORY_AGENT_RUNTIME: "claude",
    });

    expect(deps.agentRuntime).toEqual({
      selection: "claude",
      wallet: "subscription",
      capabilities: expect.objectContaining({ provider: "claude" }),
      availability: { status: "unchecked" },
      chat: { selection: "claude", availability: { status: "unchecked" } },
    });
    expect(deps.photoAnalysisGeneration).toBeInstanceOf(
      ClaudePhotoAnalysisGenerationAdapter,
    );
    expect(deps.storySetupGeneration).toBeInstanceOf(
      ClaudeStorySetupGenerationAdapter,
    );
    expect(deps.sceneFillGeneration).toBeInstanceOf(
      ClaudeSceneFillGenerationAdapter,
    );
    expect(deps.complementSceneProposal).toBeInstanceOf(
      ClaudeComplementSceneProposalAdapter,
    );
  });

  it("fails fast on an unknown GEN_STORY_AGENT_RUNTIME value", () => {
    expect(() =>
      createApiContext(withClient(), { GEN_STORY_AGENT_RUNTIME: "gpt5" }),
    ).toThrow(/Unknown GEN_STORY_AGENT_RUNTIME/);
  });

  it("rejects a CLI runtime on a non-local deployment", () => {
    expect(() =>
      createApiContext(withClient(), {
        GEN_STORY_AGENT_RUNTIME: "codex",
        GEN_STORY_DEPLOY_TARGET: "cloud",
      }),
    ).toThrow(/local deployment/);
  });
});
