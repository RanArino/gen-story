import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import {
  createOrganization,
  createProject,
  createProjectPhotoAnalysis,
  createStoryboard,
  createUser,
} from "@gen-story/domain";
import type { ChangeProposalDto } from "@gen-story/shared";

import {
  decideChangeProposalItem,
  upsertStoryboard,
} from "@gen-story/application";

import { LOCAL_ORGANIZATION_ID, LOCAL_USER_ID } from "../auth/local-auth";
import type { ProgressEvent } from "../jobs/local-progress-events";
import { createInMemoryApplicationDependencies } from "../test-support/in-memory-application";
import {
  createProjectMcpServer,
  type ProjectMcpServerOptions,
} from "./project-mcp-server";
import { GEN_STORY_MCP_TOOL_NAMES } from "./tool-registry";

const now = "2026-08-14T00:00:00.000Z";

function seedFixtures() {
  const organization = createOrganization({
    id: LOCAL_ORGANIZATION_ID,
    name: "Gen Story Studio",
    createdAt: now,
    updatedAt: now,
  });
  const user = createUser({
    id: LOCAL_USER_ID,
    organizationId: organization.id,
    displayName: "Operator",
    email: "operator@example.com",
    createdAt: now,
    updatedAt: now,
  });

  const projects = ["project_a", "project_b"].map((id) =>
    createProject({
      id,
      organizationId: organization.id,
      ownerUserId: user.id,
      name: `Story ${id}`,
      status: "active",
      createdAt: now,
      updatedAt: now,
    }),
  );

  const storyboards = projects.map((project) =>
    createStoryboard({
      id: `storyboard_${project.id}`,
      projectId: project.id,
      tone: "warm and nostalgic",
      stylePresetId: null,
      createdAt: now,
      updatedAt: now,
    }),
  );

  const analyses = projects.map((project) =>
    createProjectPhotoAnalysis({
      id: `analysis_${project.id}`,
      projectId: project.id,
      emotionCandidates: [
        {
          value: "joy",
          label: "Joy",
          description: "Bright and celebratory",
          reason: "Everyone is smiling",
        },
      ],
      photoInsights: [
        {
          photoAssetId: `photo_${project.id}`,
          summary: "A family dinner",
          people: "Four adults",
          setting: "A small kitchen",
          event: "Anniversary dinner",
          atmosphere: "Warm",
        },
      ],
      storySummary: "An anniversary dinner at home.",
      model: "test-model",
      createdAt: now,
      updatedAt: now,
    }),
  );

  return { organization, user, projects, storyboards, analyses };
}

function makeDeps() {
  const fixtures = seedFixtures();
  const deps = createInMemoryApplicationDependencies({
    organizations: [fixtures.organization],
    users: [fixtures.user],
    projects: fixtures.projects,
    storyboards: fixtures.storyboards,
    projectPhotoAnalyses: fixtures.analyses,
  });

  return { deps, fixtures };
}

type TestDeps = ReturnType<typeof makeDeps>["deps"];

// Attaches a real MCP client to a real MCP server over an in-process
// transport, so every assertion below goes through actual protocol traffic.
async function connectClient(
  options: Omit<ProjectMcpServerOptions, "audits" | "transport"> & {
    audits?: ProjectMcpServerOptions["audits"];
    transport?: ProjectMcpServerOptions["transport"];
  },
): Promise<Client> {
  const server = createProjectMcpServer({
    ...options,
    transport: options.transport ?? "stdio",
    audits: options.audits ?? options.deps.mcpToolCallAudits,
  });

  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-agent", version: "0.0.0" });

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return client;
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<{ isError: boolean; body: Record<string, unknown> }> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text: string }[];
  };

  return {
    isError: result.isError === true,
    body: JSON.parse(result.content[0]!.text) as Record<string, unknown>,
  };
}

async function connectToProjectA(deps: TestDeps): Promise<Client> {
  return connectClient({ deps, projectId: "project_a", provider: "codex" });
}

function proposeToneArgs(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    clientRequestId: "request_1",
    conversationId: "conversation_1",
    turnId: "turn_1",
    rationale: "The tone should match the quieter photos.",
    items: [
      {
        target: {
          entityType: "storyboard",
          entityId: "storyboard_project_a",
          field: "tone",
        },
        after: "quiet and reflective",
        rationale: "The evening photos are calm rather than celebratory.",
      },
    ],
    ...overrides,
  };
}

describe("Gen Story MCP tool surface", () => {
  it("exposes exactly the allowlisted tools and nothing that writes directly", async () => {
    const { deps } = makeDeps();
    const client = await connectToProjectA(deps);

    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    expect(names).toEqual([...GEN_STORY_MCP_TOOL_NAMES].sort());
    expect(names).toEqual([
      "apply_approved_change_proposal",
      "get_change_proposal",
      "get_creative_direction",
      "list_change_proposals",
      "propose_creative_direction_changes",
    ]);
    // No general mutation, SQL, shell, or approval tool exists.
    for (const forbidden of [
      "update_project",
      "run_sql",
      "run_shell",
      "approve_change_proposal",
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it("reads only the session project's creative direction", async () => {
    const { deps } = makeDeps();
    const client = await connectToProjectA(deps);

    const { isError, body } = await callTool(client, "get_creative_direction");

    expect(isError).toBe(false);
    expect(body.projectId).toBe("project_a");
    expect(body.storyboardId).toBe("storyboard_project_a");

    const fields = body.fields as { target: { field: string } }[];
    expect(fields.map((field) => field.target.field).sort()).toEqual([
      "photoAnalysis",
      "stylePresetId",
      "tone",
    ]);
    // Nothing addresses another project's entities.
    for (const field of body.fields as { target: { entityId: string } }[]) {
      expect(field.target.entityId).not.toContain("project_b");
    }
  });

  it("refuses a proposal that targets another project's entity", async () => {
    const { deps } = makeDeps();
    const client = await connectToProjectA(deps);

    const { isError, body } = await callTool(
      client,
      "propose_creative_direction_changes",
      proposeToneArgs({
        items: [
          {
            target: {
              entityType: "storyboard",
              entityId: "storyboard_project_b",
              field: "tone",
            },
            after: "borrowed tone",
            rationale: "Cross-project write attempt.",
          },
        ],
      }),
    );

    expect(isError).toBe(true);
    expect((body.error as { code: string }).code).toBe("not_found");
    expect(
      await deps.changeProposals.findByProjectId("project_b"),
    ).toHaveLength(0);
  });

  it("cannot read or apply another project's proposal", async () => {
    const { deps } = makeDeps();
    const clientB = await connectClient({
      deps,
      projectId: "project_b",
      provider: "codex",
    });
    const created = await callTool(
      clientB,
      "propose_creative_direction_changes",
      proposeToneArgs({
        items: [
          {
            target: {
              entityType: "storyboard",
              entityId: "storyboard_project_b",
              field: "tone",
            },
            after: "quiet and reflective",
            rationale: "Project B's own proposal.",
          },
        ],
      }),
    );
    const proposalId = (created.body as unknown as ChangeProposalDto).id;

    const clientA = await connectToProjectA(deps);
    const read = await callTool(clientA, "get_change_proposal", {
      changeProposalId: proposalId,
    });
    const applied = await callTool(clientA, "apply_approved_change_proposal", {
      changeProposalId: proposalId,
    });

    expect(read.isError).toBe(true);
    expect((read.body.error as { code: string }).code).toBe("not_found");
    expect(applied.isError).toBe(true);
    expect((applied.body.error as { code: string }).code).toBe("not_found");
  });

  it("creates a persisted proposal without changing current project data", async () => {
    const { deps } = makeDeps();
    const client = await connectToProjectA(deps);

    const { isError, body } = await callTool(
      client,
      "propose_creative_direction_changes",
      proposeToneArgs(),
    );
    const proposal = body as unknown as ChangeProposalDto;

    expect(isError).toBe(false);
    expect(proposal.status).toBe("pending");
    expect(proposal.provider).toBe("codex");
    expect(proposal.items).toHaveLength(1);
    expect(proposal.items[0]!.before).toBe("warm and nostalgic");
    expect(proposal.items[0]!.after).toBe("quiet and reflective");
    expect(proposal.items[0]!.approval).toBe("pending");

    const storyboard = await deps.storyboards.findById("storyboard_project_a");
    expect(storyboard?.tone).toBe("warm and nostalgic");

    const stored = await deps.changeProposals.findById(proposal.id);
    expect(stored?.status).toBe("pending");
  });

  it("returns the same proposal when a create call is retried", async () => {
    const { deps } = makeDeps();
    const client = await connectToProjectA(deps);

    const first = await callTool(
      client,
      "propose_creative_direction_changes",
      proposeToneArgs(),
    );
    const second = await callTool(
      client,
      "propose_creative_direction_changes",
      proposeToneArgs(),
    );

    expect((first.body as unknown as ChangeProposalDto).id).toBe(
      (second.body as unknown as ChangeProposalDto).id,
    );
    expect(
      await deps.changeProposals.findByProjectId("project_a"),
    ).toHaveLength(1);
  });

  it("records choice cards with two or three reasoned options", async () => {
    const { deps } = makeDeps();
    const client = await connectToProjectA(deps);

    const { body } = await callTool(
      client,
      "propose_creative_direction_changes",
      proposeToneArgs({
        items: [
          {
            target: {
              entityType: "storyboard",
              entityId: "storyboard_project_a",
              field: "tone",
            },
            after: "quiet and reflective",
            rationale: "Two credible directions for this set.",
            choice: {
              options: [
                {
                  id: "quiet",
                  label: "Quiet and reflective",
                  value: "quiet and reflective",
                  reason: "Matches the evening light",
                  impact: "Slower pacing across every scene",
                },
                {
                  id: "celebratory",
                  label: "Celebratory",
                  value: "bright and celebratory",
                  reason: "Matches the group photos",
                  impact: "Brighter palette, faster cuts",
                },
              ],
            },
          },
        ],
      }),
    );

    const proposal = body as unknown as ChangeProposalDto;
    expect(proposal.choices).toHaveLength(1);
    expect(proposal.choices[0]!.options).toHaveLength(2);
    expect(proposal.choices[0]!.selectedOptionId).toBeNull();
    expect(proposal.choices[0]!.targetItemId).toBe(proposal.items[0]!.id);
  });

  it("applies only the approved items of a partially approved proposal", async () => {
    const { deps } = makeDeps();
    const client = await connectToProjectA(deps);

    const { body } = await callTool(
      client,
      "propose_creative_direction_changes",
      proposeToneArgs({
        items: [
          {
            target: {
              entityType: "storyboard",
              entityId: "storyboard_project_a",
              field: "tone",
            },
            after: "quiet and reflective",
            rationale: "Approved half.",
          },
          {
            target: {
              entityType: "project",
              entityId: "project_a",
              field: "photoAnalysis",
            },
            after: {
              emotionCandidates: [
                {
                  value: "calm",
                  label: "Calm",
                  description: "Still and warm",
                  reason: "Soft light",
                },
              ],
              photoInsights: [
                {
                  photoAssetId: "photo_project_a",
                  summary: "Rewritten summary",
                  people: "Four adults",
                  setting: "A small kitchen",
                  event: "Anniversary dinner",
                  atmosphere: "Warm",
                },
              ],
              storySummary: "A rewritten story summary.",
            },
            rationale: "Rejected half.",
          },
        ],
      }),
    );
    const proposal = body as unknown as ChangeProposalDto;

    // Approval is a first-party operator action, never an MCP tool.
    const approved = await decideChangeProposalItem(deps, {
      changeProposalId: proposal.id,
      itemId: proposal.items[0]!.id,
      approval: "approved",
    });
    const rejected = await decideChangeProposalItem(deps, {
      changeProposalId: proposal.id,
      itemId: proposal.items[1]!.id,
      approval: "rejected",
    });
    expect(approved.ok && rejected.ok).toBe(true);

    const applied = await callTool(client, "apply_approved_change_proposal", {
      changeProposalId: proposal.id,
    });

    expect(applied.isError).toBe(false);
    expect((applied.body as unknown as ChangeProposalDto).status).toBe(
      "applied",
    );

    const storyboard = await deps.storyboards.findById("storyboard_project_a");
    expect(storyboard?.tone).toBe("quiet and reflective");

    const analysis =
      await deps.projectPhotoAnalyses.findLatestByProjectId("project_a");
    expect(analysis?.storySummary).toBe("An anniversary dinner at home.");
  });

  it("fails apply with a visible conflict when the target changed after the proposal", async () => {
    const { deps } = makeDeps();
    const client = await connectToProjectA(deps);

    const { body } = await callTool(
      client,
      "propose_creative_direction_changes",
      proposeToneArgs(),
    );
    const proposal = body as unknown as ChangeProposalDto;

    await decideChangeProposalItem(deps, {
      changeProposalId: proposal.id,
      itemId: proposal.items[0]!.id,
      approval: "approved",
    });

    // The operator edits the same storyboard after reviewing the diff.
    const edited = await upsertStoryboard(deps, {
      storyboardId: "storyboard_project_a",
      projectId: "project_a",
      tone: "hand-edited tone",
    });
    expect(edited.ok).toBe(true);

    const applied = await callTool(client, "apply_approved_change_proposal", {
      changeProposalId: proposal.id,
    });

    expect(applied.isError).toBe(true);
    expect((applied.body.error as { code: string }).code).toBe("conflict");

    const storyboard = await deps.storyboards.findById("storyboard_project_a");
    expect(storyboard?.tone).toBe("hand-edited tone");

    // The proposal is preserved for revision, not discarded.
    const stored = await deps.changeProposals.findById(proposal.id);
    expect(stored?.status).toBe("conflicted");
    expect(stored?.items[0]?.approval).toBe("approved");
  });

  it("refuses to apply a proposal with no approved items", async () => {
    const { deps } = makeDeps();
    const client = await connectToProjectA(deps);

    const { body } = await callTool(
      client,
      "propose_creative_direction_changes",
      proposeToneArgs(),
    );
    const proposal = body as unknown as ChangeProposalDto;

    const applied = await callTool(client, "apply_approved_change_proposal", {
      changeProposalId: proposal.id,
    });

    expect(applied.isError).toBe(true);
    expect((applied.body.error as { code: string }).code).toBe("invalid_state");
    expect(
      (await deps.storyboards.findById("storyboard_project_a"))?.tone,
    ).toBe("warm and nostalgic");
  });

  it("streams proposal lifecycle events for the project", async () => {
    const { deps } = makeDeps();
    const client = await connectToProjectA(deps);

    const events: ProgressEvent[] = [];
    deps.progressEvents.subscribe("project_a", (event) => events.push(event));

    const { body } = await callTool(
      client,
      "propose_creative_direction_changes",
      proposeToneArgs(),
    );
    const proposal = body as unknown as ChangeProposalDto;

    await decideChangeProposalItem(deps, {
      changeProposalId: proposal.id,
      itemId: proposal.items[0]!.id,
      approval: "approved",
    });
    await callTool(client, "apply_approved_change_proposal", {
      changeProposalId: proposal.id,
    });

    expect(events.map((event) => event.kind)).toEqual([
      "change_proposal.created",
      "change_proposal.resolved",
      "change_proposal.applied",
    ]);
    for (const event of events) {
      expect(event.payload?.changeProposalId).toBe(proposal.id);
      expect(event.payload?.projectId).toBe("project_a");
    }
  });

  it("audits every tool call, including rejected ones", async () => {
    const { deps } = makeDeps();
    const client = await connectToProjectA(deps);

    await callTool(client, "get_creative_direction");
    await callTool(client, "get_change_proposal", {
      changeProposalId: "missing_proposal",
    });

    const audits = await deps.mcpToolCallAudits.listByProjectId("project_a");
    expect(audits.map((audit) => audit.toolName)).toEqual([
      "get_creative_direction",
      "get_change_proposal",
    ]);
    expect(audits[0]!.outcome).toBe("ok");
    expect(audits[1]!.outcome).toBe("error");
    expect(audits[1]!.errorCode).toBe("not_found");
    expect(audits[1]!.transport).toBe("stdio");
    expect(audits[1]!.arguments).toEqual({
      changeProposalId: "missing_proposal",
    });
  });

  it("rejects an input that fails the tool schema before it reaches the handler", async () => {
    const { deps } = makeDeps();
    const client = await connectToProjectA(deps);

    // Schema rejection happens in the protocol layer, so the call never
    // becomes a tool invocation — and never a proposal.
    const result = (await client.callTool({
      name: "propose_creative_direction_changes",
      arguments: proposeToneArgs({ items: [] }),
    })) as { isError?: boolean; content: { text: string }[] };

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/validation error/i);
    expect(
      await deps.changeProposals.findByProjectId("project_a"),
    ).toHaveLength(0);
  });
});
