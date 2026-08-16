import type { AgentSessionCapabilities } from "./agent-session-events";
import {
  CLAUDE_SESSION_CAPABILITIES,
  CODEX_SESSION_CAPABILITIES,
} from "./agent-session-events";
import { detectAgentRuntime } from "./runtime-detection";

export type AgentRuntimeSelection = "api" | "codex" | "claude";

const VALID_SELECTIONS: readonly AgentRuntimeSelection[] = [
  "api",
  "codex",
  "claude",
];

export class RuntimeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuntimeConfigError";
  }
}

// R1.1/R1.2: a single env var selects the runtime for every text/vision
// capability; an unknown value fails fast rather than silently falling back.
export function resolveAgentRuntimeSelection(
  env: NodeJS.ProcessEnv = process.env,
): AgentRuntimeSelection {
  const raw = env.GEN_STORY_AGENT_RUNTIME?.trim();
  if (raw == null || raw.length === 0) {
    return "api";
  }
  if (!VALID_SELECTIONS.includes(raw as AgentRuntimeSelection)) {
    throw new RuntimeConfigError(
      `Unknown GEN_STORY_AGENT_RUNTIME value "${raw}". Supported values: ${VALID_SELECTIONS.join(", ")}.`,
    );
  }
  return raw as AgentRuntimeSelection;
}

/**
 * Which runtime powers the embedded chat. It defaults to
 * `GEN_STORY_AGENT_RUNTIME`, but can be set on its own so the chat runs on a
 * subscription CLI while photo analysis, story setup, and scene fill stay on
 * whatever they use today — turning the chat on should not silently re-route
 * every other AI capability in the app.
 */
export function resolveAgentChatRuntimeSelection(
  env: NodeJS.ProcessEnv = process.env,
  fallback: AgentRuntimeSelection = resolveAgentRuntimeSelection(env),
): AgentRuntimeSelection {
  const raw = env.GEN_STORY_AGENT_CHAT_RUNTIME?.trim();
  if (raw == null || raw.length === 0) {
    return fallback;
  }
  if (!VALID_SELECTIONS.includes(raw as AgentRuntimeSelection)) {
    throw new RuntimeConfigError(
      `Unknown GEN_STORY_AGENT_CHAT_RUNTIME value "${raw}". Supported values: ${VALID_SELECTIONS.join(", ")}.`,
    );
  }
  return raw as AgentRuntimeSelection;
}

export type DeployTarget = "local" | "other";

export function resolveDeployTarget(
  env: NodeJS.ProcessEnv = process.env,
): DeployTarget {
  const raw = env.GEN_STORY_DEPLOY_TARGET?.trim();
  return raw == null || raw.length === 0 || raw === "local" ? "local" : "other";
}

// R2.1: CLI runtimes are local-only, enforced at startup rather than by
// trusting the operator not to select one on a hosted deployment.
export function assertLocalDeploymentForCliRuntime(
  selection: AgentRuntimeSelection,
  deployTarget: DeployTarget,
): void {
  if (selection !== "api" && deployTarget !== "local") {
    throw new RuntimeConfigError(
      `GEN_STORY_AGENT_RUNTIME="${selection}" requires local deployment (GEN_STORY_DEPLOY_TARGET=local or unset). CLI runtimes never run on a hosted deployment.`,
    );
  }
}

export type AgentRuntimeAvailability =
  // runtime === "api": no CLI to check.
  | { status: "not_applicable" }
  // runtime is codex/claude but resolveAgentRuntimeAvailability has not run
  // yet; only ever set synchronously as a placeholder before the async
  // startup check, never returned by resolveAgentRuntimeAvailability itself.
  | { status: "unchecked" }
  | {
      status: "available";
      version: string;
      authMethod: string;
      subscriptionLabel: string;
    }
  | { status: "unavailable"; reason: string; message: string };

// R2.2/R4.7 combined: detectAgentRuntime already distinguishes "binary not
// on PATH" from "installed but not logged in with a subscription account",
// so one call covers both the startup binary check and the login check
// rather than treating them as two separate mechanisms.
export async function resolveAgentRuntimeAvailability(
  selection: AgentRuntimeSelection,
  input: {
    workingDirectory: string;
    allowedWorkingDirectoryRoot: string;
    environment?: NodeJS.ProcessEnv;
  },
): Promise<AgentRuntimeAvailability> {
  if (selection === "api") {
    return { status: "not_applicable" };
  }

  const result = await detectAgentRuntime({
    provider: selection,
    workingDirectory: input.workingDirectory,
    allowedWorkingDirectoryRoot: input.allowedWorkingDirectoryRoot,
    environment: input.environment,
  });

  if (result.status === "available") {
    return {
      status: "available",
      version: result.version,
      authMethod: result.authMethod,
      subscriptionLabel: result.subscriptionLabel,
    };
  }
  return {
    status: "unavailable",
    reason: result.reason,
    message: result.message,
  };
}

export function agentRuntimeCapabilities(
  selection: AgentRuntimeSelection,
): AgentSessionCapabilities | null {
  if (selection === "codex") return CODEX_SESSION_CAPABILITIES;
  if (selection === "claude") return CLAUDE_SESSION_CAPABILITIES;
  return null;
}

export function agentRuntimeWallet(
  selection: AgentRuntimeSelection,
): "api_key" | "subscription" {
  return selection === "api" ? "api_key" : "subscription";
}
