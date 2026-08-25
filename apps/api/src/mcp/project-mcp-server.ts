import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AgentProvider } from "@gen-story/domain";

import type { ApiDependencies } from "../app/create-api-context";
import type { McpToolCallAuditPort, McpTransportKind } from "./tool-call-audit";
import {
  GEN_STORY_MCP_TOOLS,
  type McpToolContext,
  type McpToolDefinition,
  type McpToolOutcome,
} from "./tool-registry";

export const MCP_SERVER_NAME = "gen-story";
export const MCP_SERVER_VERSION = "0.1.0";

export type ProjectMcpServerOptions = {
  deps: ApiDependencies;
  projectId: string;
  provider: AgentProvider;
  transport: McpTransportKind;
  audits: McpToolCallAuditPort;
  // Defaults to the full allowlist. Overridden only by tests; there is no
  // runtime path that widens it.
  tools?: McpToolDefinition[];
};

function toCallToolResult(outcome: McpToolOutcome): CallToolResult {
  const body = outcome.ok
    ? outcome.data
    : { error: { code: outcome.code, message: outcome.message } };

  return {
    content: [{ type: "text", text: JSON.stringify(body, null, 2) }],
    ...(outcome.ok ? {} : { isError: true }),
  };
}

// Builds the one MCP surface Gen Story exposes, bound to a single project.
// Both transports call this, so an embedded client and an external CLI client
// get byte-identical capabilities. Every call — including failures — is
// audited before the result goes back to the agent.
export function createProjectMcpServer(
  options: ProjectMcpServerOptions,
): McpServer {
  const tools = options.tools ?? GEN_STORY_MCP_TOOLS;
  const context: McpToolContext = {
    deps: options.deps,
    projectId: options.projectId,
    provider: options.provider,
  };

  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    {
      instructions:
        "Gen Story creative refinement. Read the project's creative direction, propose field-level changes with rationale, then apply only what the operator approved. There is no direct-write tool and no database access.",
    },
  );

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputShape,
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: false,
          openWorldHint: false,
        },
      },
      async (rawInput: Record<string, unknown>): Promise<CallToolResult> => {
        const startedMs = Date.now();
        let outcome: McpToolOutcome;

        try {
          outcome = await tool.handler(context, rawInput ?? {});
        } catch (error) {
          // Includes input-schema rejections. An agent must never see a stack
          // trace, and a thrown tool must still be audited.
          outcome = {
            ok: false,
            code: "invalid_request",
            message:
              error instanceof Error ? error.message : "Tool call failed.",
          };
        }

        await options.audits.record({
          projectId: options.projectId,
          transport: options.transport,
          toolName: tool.name,
          arguments: rawInput ?? {},
          outcome: outcome.ok ? "ok" : "error",
          errorCode: outcome.ok ? null : outcome.code,
          errorMessage: outcome.ok ? null : outcome.message,
          changeProposalId:
            "changeProposalId" in outcome
              ? (outcome.changeProposalId ?? null)
              : null,
          durationMs: Date.now() - startedMs,
        });

        return toCallToolResult(outcome);
      },
    );
  }

  return server;
}
