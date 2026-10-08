import type {
  AgentRuntimeSelection,
  ApplicationDependencies,
  ProgressEventPort,
} from "@gen-story/application";

import type { AgentSessionCapabilities } from "../agent-runtime/agent-session-events";
import type { AgentRuntimeAvailability } from "../agent-runtime/runtime-config";
import type {
  ProgressEvent,
  ProgressEventListener,
} from "../jobs/progress-events";
import type { McpToolCallAuditPort } from "../mcp/tool-call-audit";

export type ApiAgentRuntimeInfo = {
  selection: AgentRuntimeSelection;
  wallet: "api_key" | "subscription";
  capabilities: AgentSessionCapabilities | null;
  availability: AgentRuntimeAvailability;
};

export type TextVisionGenerationPorts = Pick<
  ApplicationDependencies,
  | "sceneFillGeneration"
  | "complementSceneProposal"
  | "photoAnalysisGeneration"
  | "storySetupGeneration"
>;

export type SubscribableProgressEventPort = ProgressEventPort & {
  subscribe(projectId: string, listener: ProgressEventListener): () => void;
  publish(event: ProgressEvent): Promise<void>;
};

export type ApiDependencies = ApplicationDependencies & {
  progressEvents: SubscribableProgressEventPort;
  agentRuntime: ApiAgentRuntimeInfo;
  mcpToolCallAudits: McpToolCallAuditPort;
  textVisionGenerationPorts?: (
    selection: AgentRuntimeSelection,
  ) => TextVisionGenerationPorts;
};
