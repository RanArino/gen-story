import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ApplicationDependencies,
  ComplementSceneProposalPort,
  PhotoAnalysisGenerationPort,
  SceneFillGenerationPort,
  StorySetupGenerationPort,
} from "@gen-story/application";

import type { AgentSessionCapabilities } from "../agent-runtime/agent-session-events";
import {
  agentRuntimeCapabilities,
  agentRuntimeWallet,
  assertLocalDeploymentForCliRuntime,
  resolveAgentChatRuntimeSelection,
  resolveAgentRuntimeSelection,
  resolveDeployTarget,
  type AgentRuntimeAvailability,
  type AgentRuntimeSelection,
} from "../agent-runtime/runtime-config";
import { NativeSessionAgentTurnRunner } from "../agent-chat/native-session-runner";
import { LocalAuthContext } from "../auth/local-auth";
import { ClaudeComplementSceneProposalAdapter } from "../complement-scenes/claude-complement-scene-proposal";
import { CodexComplementSceneProposalAdapter } from "../complement-scenes/codex-complement-scene-proposal";
import type { GenStorySqliteClient } from "../db/client";
import { createSqliteRepositories } from "../db/repositories";
import { LocalProgressEvents } from "../jobs/local-progress-events";
import { SqliteJobQueue } from "../jobs/sqlite-job-queue";
import { MockImageGenerationAdapter } from "../generation/mock-image-generation";
import {
  MockCharacterSheetGenerationAdapter,
  OpenAiCharacterSheetGenerationAdapter,
} from "../generation/character-sheet-generation";
import {
  DEFAULT_OPENAI_IMAGE_GENERATION_INTERVAL_MS,
  OpenAiImageGenerationAdapter,
} from "../generation/openai-image-generation";
import { LocalImagePreprocessingAdapter } from "../images/local-image-preprocessing";
import type { McpToolCallAuditPort } from "../mcp/tool-call-audit";
import { ClaudePhotoAnalysisGenerationAdapter } from "../photo-analysis/claude-photo-analysis-generation";
import { CodexPhotoAnalysisGenerationAdapter } from "../photo-analysis/codex-photo-analysis-generation";
import {
  DEFAULT_GEMINI_PHOTO_ANALYSIS_MODEL,
  GeminiPhotoAnalysisGenerationAdapter,
} from "../photo-analysis/gemini-photo-analysis-generation";
import { LocalPhotoAnalysisGenerationAdapter } from "../photo-analysis/local-photo-analysis-generation";
import {
  DEFAULT_GEMINI_COMPLEMENT_SCENE_MODEL,
  GeminiComplementSceneProposalAdapter,
} from "../complement-scenes/gemini-complement-scene-proposal";
import { ClaudeSceneFillGenerationAdapter } from "../scene-fill/claude-scene-fill-generation";
import { CodexSceneFillGenerationAdapter } from "../scene-fill/codex-scene-fill-generation";
import {
  DEFAULT_GEMINI_SCENE_FILL_MODEL,
  GeminiSceneFillGenerationAdapter,
} from "../scene-fill/gemini-scene-fill-generation";
import { LocalObjectStorage } from "../storage/local-object-storage";
import { ClaudeStorySetupGenerationAdapter } from "../story-setup/claude-story-setup-generation";
import { CodexStorySetupGenerationAdapter } from "../story-setup/codex-story-setup-generation";
import {
  DEFAULT_GEMINI_STORY_SETUP_MODEL,
  GeminiStorySetupGenerationAdapter,
} from "../story-setup/gemini-story-setup-generation";
import { LocalStorySetupGenerationAdapter } from "../story-setup/local-story-setup-generation";

export type ApiAgentRuntimeInfo = {
  selection: AgentRuntimeSelection;
  wallet: "api_key" | "subscription";
  capabilities: AgentSessionCapabilities | null;
  // The embedded chat's own runtime, which may differ from the one above.
  chat: {
    selection: AgentRuntimeSelection;
    availability: AgentRuntimeAvailability;
  };
  // Filled in synchronously here as "not_applicable"/"unchecked"; server.ts
  // resolves the real value (a live CLI probe) before the router starts
  // accepting requests, so route handlers always see a checked result.
  availability: AgentRuntimeAvailability;
};

// The router needs the concrete emitter, not just the port, because the SSE
// route subscribes to it.
export type ApiDependencies = ApplicationDependencies & {
  progressEvents: LocalProgressEvents;
  agentRuntime: ApiAgentRuntimeInfo;
  // MCP tool-call audit. Not an application port: the MCP layer records calls
  // the application layer never sees, including rejected ones.
  mcpToolCallAudits: McpToolCallAuditPort;
};

function createTextVisionGenerationPorts(
  selection: AgentRuntimeSelection,
  objectStorage: LocalObjectStorage,
  env: NodeJS.ProcessEnv,
): {
  sceneFillGeneration: SceneFillGenerationPort;
  complementSceneProposal: ComplementSceneProposalPort;
  photoAnalysisGeneration: PhotoAnalysisGenerationPort;
  storySetupGeneration: StorySetupGenerationPort;
} {
  if (selection === "codex") {
    return {
      sceneFillGeneration: new CodexSceneFillGenerationAdapter(objectStorage),
      complementSceneProposal: new CodexComplementSceneProposalAdapter(
        objectStorage,
      ),
      photoAnalysisGeneration: new CodexPhotoAnalysisGenerationAdapter(
        objectStorage,
      ),
      storySetupGeneration: new CodexStorySetupGenerationAdapter(),
    };
  }
  if (selection === "claude") {
    return {
      sceneFillGeneration: new ClaudeSceneFillGenerationAdapter(objectStorage),
      complementSceneProposal: new ClaudeComplementSceneProposalAdapter(
        objectStorage,
      ),
      photoAnalysisGeneration: new ClaudePhotoAnalysisGenerationAdapter(
        objectStorage,
      ),
      storySetupGeneration: new ClaudeStorySetupGenerationAdapter(),
    };
  }

  const geminiApiKey = env.GEMINI_API_KEY;
  // Photo-aware AI requires Gemini at runtime; the adapter throws a clear
  // error if GEMINI_API_KEY is unset. Tests inject mock ports instead.
  const sceneFillGeneration = new GeminiSceneFillGenerationAdapter(
    objectStorage,
    geminiApiKey,
    env.GEMINI_SCENE_FILL_MODEL ?? DEFAULT_GEMINI_SCENE_FILL_MODEL,
  );
  const complementSceneProposal = new GeminiComplementSceneProposalAdapter(
    objectStorage,
    geminiApiKey,
    env.GEMINI_COMPLEMENT_SCENE_MODEL ?? DEFAULT_GEMINI_COMPLEMENT_SCENE_MODEL,
  );
  const photoAnalysisGeneration = geminiApiKey
    ? new GeminiPhotoAnalysisGenerationAdapter(
        objectStorage,
        geminiApiKey,
        env.GEMINI_PHOTO_ANALYSIS_MODEL ?? DEFAULT_GEMINI_PHOTO_ANALYSIS_MODEL,
      )
    : new LocalPhotoAnalysisGenerationAdapter();
  // Step 4 falls back to the deterministic template rather than failing, so a
  // setup without a Gemini key still walks all five steps.
  const storySetupGeneration = geminiApiKey
    ? new GeminiStorySetupGenerationAdapter(
        geminiApiKey,
        env.GEMINI_STORY_SETUP_MODEL ?? DEFAULT_GEMINI_STORY_SETUP_MODEL,
      )
    : new LocalStorySetupGenerationAdapter();

  return {
    sceneFillGeneration,
    complementSceneProposal,
    photoAnalysisGeneration,
    storySetupGeneration,
  };
}

export function createApiContext(
  client: GenStorySqliteClient,
  env: NodeJS.ProcessEnv = process.env,
): ApiDependencies {
  const repos = createSqliteRepositories(client.db);
  const objectStorage = new LocalObjectStorage();
  const imagePreprocessing = new LocalImagePreprocessingAdapter({
    scenes: repos.scenes,
    photoAssets: repos.photoAssets,
    objectStorage,
    storyboards: repos.storyboards,
    stylePresets: repos.stylePresets,
    aiJobs: repos.aiJobs,
  });

  const openaiApiKey = env.OPENAI_API_KEY;
  const configuredImageGenerationIntervalMs = Number(
    env.OPENAI_IMAGE_GENERATION_INTERVAL_MS,
  );
  const imageGenerationIntervalMs =
    Number.isFinite(configuredImageGenerationIntervalMs) &&
    configuredImageGenerationIntervalMs > 0
      ? configuredImageGenerationIntervalMs
      : DEFAULT_OPENAI_IMAGE_GENERATION_INTERVAL_MS;
  const imageGeneration = openaiApiKey
    ? new OpenAiImageGenerationAdapter(objectStorage, openaiApiKey, {
        requestIntervalMs: imageGenerationIntervalMs,
      })
    : new MockImageGenerationAdapter(objectStorage);

  // R1.1/R1.2/R2.1: a single env var selects the runtime for every
  // text/vision capability; unknown values and non-local CLI selection fail
  // fast here rather than falling back silently.
  const agentRuntimeSelection = resolveAgentRuntimeSelection(env);
  const deployTarget = resolveDeployTarget(env);
  assertLocalDeploymentForCliRuntime(agentRuntimeSelection, deployTarget);

  const agentChatSelection = resolveAgentChatRuntimeSelection(
    env,
    agentRuntimeSelection,
  );
  assertLocalDeploymentForCliRuntime(agentChatSelection, deployTarget);

  const characterSheetGeneration = openaiApiKey
    ? new OpenAiCharacterSheetGenerationAdapter(objectStorage, openaiApiKey)
    : new MockCharacterSheetGenerationAdapter(objectStorage);

  const {
    sceneFillGeneration,
    complementSceneProposal,
    photoAnalysisGeneration,
    storySetupGeneration,
  } = createTextVisionGenerationPorts(
    agentRuntimeSelection,
    objectStorage,
    env,
  );

  const progressEvents = new LocalProgressEvents();

  const agentRuntime = {
    selection: agentRuntimeSelection,
    wallet: agentRuntimeWallet(agentRuntimeSelection),
    capabilities: agentRuntimeCapabilities(agentRuntimeSelection),
    availability:
      agentRuntimeSelection === "api"
        ? ({ status: "not_applicable" } as AgentRuntimeAvailability)
        : ({ status: "unchecked" } as AgentRuntimeAvailability),
    chat: {
      selection: agentChatSelection,
      availability:
        agentChatSelection === "api"
          ? ({ status: "not_applicable" } as AgentRuntimeAvailability)
          : ({ status: "unchecked" } as AgentRuntimeAvailability),
    },
  };

  // A dedicated empty directory outside the repository, because a CLI session
  // adopts its working directory's project context: started in the repo, Codex
  // ingested this project's AGENTS.md and began running shell commands to
  // explore the source tree. A chat about tone and style needs none of that —
  // everything it may touch comes through the MCP endpoint over HTTP.
  const agentChatWorkingDirectory = join(tmpdir(), "gen-story-agent-chat");
  mkdirSync(agentChatWorkingDirectory, { recursive: true });

  // Reads `agentRuntime.availability` through the object, not a copy, so the
  // runner sees the real result once server.ts finishes its startup probe.
  const agentTurnRunner = new NativeSessionAgentTurnRunner({
    selection: agentChatSelection,
    availability: () => agentRuntime.chat.availability,
    model: env.GEN_STORY_AGENT_CHAT_MODEL?.trim() || null,
    workingDirectory: agentChatWorkingDirectory,
    allowedWorkingDirectoryRoot: agentChatWorkingDirectory,
    apiBaseUrl:
      env.GEN_STORY_API_BASE_URL?.trim() ||
      `http://127.0.0.1:${env.API_PORT ?? 4000}`,
    environment: env,
  });

  return {
    ...repos,
    objectStorage,
    imagePreprocessing,
    imageGeneration,
    characterSheetGeneration,
    sceneFillGeneration,
    complementSceneProposal,
    photoAnalysisGeneration,
    storySetupGeneration,
    jobQueue: new SqliteJobQueue(repos.aiJobs, progressEvents),
    progressEvents,
    authContext: new LocalAuthContext(repos),
    agentTurnRunner,
    agentRuntime,
  };
}
