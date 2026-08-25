import type { IncomingMessage, ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { AgentProvider } from "@gen-story/domain";

import type { ApiDependencies } from "../app/create-api-context";
import { createProjectMcpServer } from "./project-mcp-server";

// Which agent is attached. The value is provenance only — it never widens the
// tool allowlist — so an unrecognized value falls back to the runtime this API
// is configured for rather than failing the connection.
export function resolveMcpProvider(
  requested: string | null,
  deps: ApiDependencies,
): AgentProvider {
  if (requested === "codex" || requested === "claude") return requested;
  return deps.agentRuntime.selection === "claude" ? "claude" : "codex";
}

// One MCP server and transport per request. Gen Story's tools are stateless
// between calls (all state is in SQLite), so a stateless transport avoids
// holding a session for an agent that may disconnect at any time — the
// pending-proposal durability the operator relies on lives in the database,
// not in this connection.
export async function handleProjectMcpHttpRequest(options: {
  deps: ApiDependencies;
  projectId: string;
  provider: AgentProvider;
  req: IncomingMessage;
  res: ServerResponse;
  body: unknown;
}): Promise<void> {
  const server = createProjectMcpServer({
    deps: options.deps,
    projectId: options.projectId,
    provider: options.provider,
    transport: "http",
    audits: options.deps.mcpToolCallAudits,
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  options.res.on("close", () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(options.req, options.res, options.body);
}
