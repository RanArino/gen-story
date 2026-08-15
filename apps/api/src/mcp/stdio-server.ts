import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";

import type { AgentProvider } from "@gen-story/domain";

import { createApiContext } from "../app/create-api-context";
import { migrateDatabase, openDatabase } from "../db";
import { loadEnvFile } from "../server";
import { createProjectMcpServer } from "./project-mcp-server";

// The external agent (Codex or Claude Code) attaches to one project, exactly
// like the embedded client: `--project <id>`, or GEN_STORY_MCP_PROJECT_ID.
export function resolveStdioProjectId(
  argv: string[],
  env: NodeJS.ProcessEnv,
): string {
  const flagIndex = argv.indexOf("--project");
  const fromFlag = flagIndex === -1 ? undefined : argv[flagIndex + 1];
  const projectId = (fromFlag ?? env.GEN_STORY_MCP_PROJECT_ID ?? "").trim();

  if (projectId.length === 0) {
    throw new Error(
      "A project ID is required: pass --project <projectId> or set GEN_STORY_MCP_PROJECT_ID.",
    );
  }

  return projectId;
}

export function resolveStdioProvider(env: NodeJS.ProcessEnv): AgentProvider {
  return env.GEN_STORY_MCP_PROVIDER === "claude" ? "claude" : "codex";
}

export async function startStdioMcpServer(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const projectId = resolveStdioProjectId(argv, env);

  const client = openDatabase();
  migrateDatabase(client.db);
  const deps = createApiContext(client, env);

  const project = await deps.projects.findById(projectId);
  if (project == null) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const server = createProjectMcpServer({
    deps,
    projectId,
    provider: resolveStdioProvider(env),
    transport: "stdio",
    audits: deps.mcpToolCallAudits,
  });

  // stdout is the protocol channel; anything human-readable goes to stderr.
  console.error(`[mcp] gen-story stdio server ready for project ${projectId}`);
  await server.connect(new StdioServerTransport());
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  loadEnvFile();
  startStdioMcpServer().catch((error: unknown) => {
    console.error("[mcp] failed to start:", error);
    process.exit(1);
  });
}
