import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createOrganization,
  createProject,
  createStoryboard,
  createUser,
} from "@gen-story/domain";
import type { ChangeProposalDto } from "@gen-story/shared";

import { createApiContext } from "../app/create-api-context";
import {
  LOCAL_ORGANIZATION_ID,
  LOCAL_USER_ID,
  seedLocalPrincipal,
} from "../auth/local-auth";
import type { GenStorySqliteClient } from "../db/client";
import { migrateDatabase, openDatabase } from "../db";
import { buildRouter, handleApiRequest } from "../http/routes";
import { sendJson } from "../http/json";
import { createInMemoryApplicationDependencies } from "../test-support/in-memory-application";
import { createProjectMcpServer } from "./project-mcp-server";
import { GEN_STORY_MCP_TOOL_NAMES } from "./tool-registry";

const now = "2026-08-14T00:00:00.000Z";

function buildFixtures(organizationId: string, projectId: string) {
  const organization = createOrganization({
    id: organizationId,
    name: "Gen Story Studio",
    createdAt: now,
    updatedAt: now,
  });
  const user = createUser({
    id: organizationId === LOCAL_ORGANIZATION_ID ? LOCAL_USER_ID : "other_user",
    organizationId,
    displayName: "Operator",
    email: null,
    createdAt: now,
    updatedAt: now,
  });
  const project = createProject({
    id: projectId,
    organizationId,
    ownerUserId: user.id,
    name: "Anniversary Story",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  const storyboard = createStoryboard({
    id: `storyboard_${projectId}`,
    projectId,
    tone: "warm and nostalgic",
    stylePresetId: null,
    createdAt: now,
    updatedAt: now,
  });

  return { organization, user, project, storyboard };
}

function proposeArgs(storyboardId: string): Record<string, unknown> {
  return {
    clientRequestId: "request_1",
    conversationId: "conversation_1",
    turnId: "turn_1",
    rationale: "The tone should match the quieter photos.",
    items: [
      {
        target: {
          entityType: "storyboard",
          entityId: storyboardId,
          field: "tone",
        },
        after: "quiet and reflective",
        rationale: "The evening photos are calm rather than celebratory.",
      },
    ],
  };
}

async function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

describe("MCP transports", () => {
  let server: Server;
  let base: string;
  let deps: ReturnType<typeof createInMemoryApplicationDependencies>;

  beforeEach(async () => {
    const own = buildFixtures(LOCAL_ORGANIZATION_ID, "project_a");
    const foreign = buildFixtures("other_org", "project_foreign");

    deps = createInMemoryApplicationDependencies({
      organizations: [own.organization, foreign.organization],
      users: [own.user, foreign.user],
      projects: [own.project, foreign.project],
      storyboards: [own.storyboard, foreign.storyboard],
    });
    await seedLocalPrincipal(deps);

    const router = buildRouter(deps);
    server = createServer(async (req, res) => {
      const handled = await handleApiRequest(req, res, router);
      if (!handled) {
        sendJson(res, 404, {
          error: { code: "not_found", message: "Not found." },
        });
      }
    });
    base = await listen(server);
  });

  afterEach(async () => {
    await close(server);
  });

  async function connectHttpClient(projectId = "project_a"): Promise<Client> {
    const client = new Client({ name: "test-agent", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL(`${base}/api/mcp/projects/${projectId}?provider=claude`),
      ),
    );
    return client;
  }

  it("serves the same tool allowlist over HTTP as over an in-process transport", async () => {
    const httpClient = await connectHttpClient();
    const httpTools = (await httpClient.listTools()).tools
      .map((tool) => tool.name)
      .sort();

    // The stdio entry point builds its server through the same factory, so
    // this in-process pair is the same registry an external CLI would attach
    // to over stdio.
    const stdioLikeServer = createProjectMcpServer({
      deps,
      projectId: "project_a",
      provider: "codex",
      transport: "stdio",
      audits: deps.mcpToolCallAudits,
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const stdioLikeClient = new Client({ name: "cli-agent", version: "0.0.0" });
    await Promise.all([
      stdioLikeServer.connect(serverTransport),
      stdioLikeClient.connect(clientTransport),
    ]);
    const stdioTools = (await stdioLikeClient.listTools()).tools
      .map((tool) => tool.name)
      .sort();

    expect(httpTools).toEqual([...GEN_STORY_MCP_TOOL_NAMES].sort());
    expect(httpTools).toEqual(stdioTools);
  });

  it("proposes over HTTP and records the transport in the audit", async () => {
    const client = await connectHttpClient();

    const result = (await client.callTool({
      name: "propose_creative_direction_changes",
      arguments: proposeArgs("storyboard_project_a"),
    })) as { isError?: boolean; content: { text: string }[] };
    const proposal = JSON.parse(result.content[0]!.text) as ChangeProposalDto;

    expect(result.isError).toBeFalsy();
    expect(proposal.status).toBe("pending");
    // The provider comes from the session's query parameter, not the payload.
    expect(proposal.provider).toBe("claude");
    expect(
      (await deps.storyboards.findById("storyboard_project_a"))?.tone,
    ).toBe("warm and nostalgic");

    const audits = await deps.mcpToolCallAudits.listByProjectId("project_a");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.transport).toBe("http");
    expect(audits[0]!.toolName).toBe("propose_creative_direction_changes");
    expect(audits[0]!.changeProposalId).toBe(proposal.id);
  });

  it("refuses an MCP session for a project the caller does not own", async () => {
    const response = await fetch(`${base}/api/mcp/projects/project_foreign`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    expect(response.status).toBe(403);
  });

  it("returns 404 for an MCP session on an unknown project", async () => {
    const response = await fetch(`${base}/api/mcp/projects/project_missing`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });

    expect(response.status).toBe(404);
  });

  it("rejects non-POST methods on the MCP endpoint", async () => {
    const response = await fetch(`${base}/api/mcp/projects/project_a`);
    expect(response.status).toBe(405);
  });
});

describe("proposal durability across a restart", () => {
  let directory: string | null = null;
  let client: GenStorySqliteClient | null = null;

  afterEach(() => {
    client?.close();
    if (directory) rmSync(directory, { force: true, recursive: true });
    client = null;
    directory = null;
  });

  it("keeps a pending proposal after the API process restarts", async () => {
    directory = mkdtempSync(join(tmpdir(), "gen-story-mcp-"));
    const databasePath = join(directory, "test.sqlite");

    client = openDatabase(databasePath);
    migrateDatabase(client.db);
    const deps = createApiContext(client, {});
    await seedLocalPrincipal(deps);

    const fixtures = buildFixtures(LOCAL_ORGANIZATION_ID, "project_a");
    await deps.projects.save(fixtures.project);
    await deps.storyboards.save(fixtures.storyboard);

    const server = createProjectMcpServer({
      deps,
      projectId: "project_a",
      provider: "codex",
      transport: "stdio",
      audits: deps.mcpToolCallAudits,
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const agent = new Client({ name: "cli-agent", version: "0.0.0" });
    await Promise.all([
      server.connect(serverTransport),
      agent.connect(clientTransport),
    ]);

    const result = (await agent.callTool({
      name: "propose_creative_direction_changes",
      arguments: proposeArgs("storyboard_project_a"),
    })) as { content: { text: string }[] };
    const proposal = JSON.parse(result.content[0]!.text) as ChangeProposalDto;

    // The API process goes away with the proposal still awaiting approval.
    await agent.close();
    client.close();

    client = openDatabase(databasePath);
    migrateDatabase(client.db);
    const restarted = createApiContext(client, {});

    const stored = await restarted.changeProposals.findById(proposal.id);
    expect(stored?.status).toBe("pending");
    expect(stored?.items[0]?.after).toBe("quiet and reflective");

    const audits =
      await restarted.mcpToolCallAudits.listByProjectId("project_a");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.toolName).toBe("propose_creative_direction_changes");
  });
});
