import { createServer, type Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createChangeProposalUseCase } from "@gen-story/application";
import {
  createOrganization,
  createProject,
  createStoryboard,
  createUser,
} from "@gen-story/domain";
import type {
  ChangeProposalDto,
  CreativeDirectionDto,
} from "@gen-story/shared";

import {
  LOCAL_ORGANIZATION_ID,
  LOCAL_USER_ID,
  seedLocalPrincipal,
} from "../auth/local-auth";
import { createInMemoryApplicationDependencies } from "../test-support/in-memory-application";
import { sendJson } from "./json";
import { buildRouter, handleApiRequest } from "./routes";

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

let server: Server;
let base: string;
let deps: ReturnType<typeof createInMemoryApplicationDependencies>;

async function request(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

// A proposal authored the way an agent's MCP call would author it, so these
// tests exercise the operator half of the same review unit.
async function seedProposal(items: unknown[] = defaultItems()) {
  const result = await createChangeProposalUseCase(deps, {
    projectId: "project_a",
    provider: "codex",
    conversationId: "conversation_1",
    turnId: "turn_1",
    rationale: "Refine the creative direction.",
    clientRequestId: `request_${Math.random()}`,
    items: items as Parameters<typeof createChangeProposalUseCase>[1]["items"],
  });

  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function defaultItems() {
  return [
    {
      target: {
        entityType: "storyboard",
        entityId: "storyboard_project_a",
        field: "tone",
      },
      after: "quiet and reflective",
      rationale: "The evening photos are calm rather than celebratory.",
      choice: {
        options: [
          {
            id: "quiet",
            label: "Quiet",
            value: "quiet and reflective",
            reason: "Matches the evening light",
            impact: "Slower pacing",
          },
          {
            id: "bright",
            label: "Bright",
            value: "bright and celebratory",
            reason: "Matches the group photos",
            impact: "Faster cuts",
          },
        ],
      },
    },
  ];
}

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

  base = await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe("creative direction and change proposal routes", () => {
  it("returns the project's current creative direction", async () => {
    const response = await request(
      "GET",
      "/api/projects/project_a/creative-direction",
    );
    const body = response.body as CreativeDirectionDto;

    expect(response.status).toBe(200);
    expect(body.storyboardId).toBe("storyboard_project_a");
    expect(body.fields.map((field) => field.target.field).sort()).toEqual([
      "characterPolicy",
      "commonPrompt",
      "negativePrompt",
      "story",
      "stylePresetId",
      "tone",
    ]);
  });

  it("refuses another organization's project", async () => {
    const direction = await request(
      "GET",
      "/api/projects/project_foreign/creative-direction",
    );
    const proposals = await request(
      "GET",
      "/api/projects/project_foreign/change-proposals",
    );

    expect(direction.status).toBe(403);
    expect(proposals.status).toBe(403);
  });

  it("lists and reads a project's proposals", async () => {
    const proposal = await seedProposal();

    const list = await request(
      "GET",
      "/api/projects/project_a/change-proposals?status=pending",
    );
    const detail = await request("GET", `/api/change-proposals/${proposal.id}`);

    expect(list.status).toBe(200);
    expect(
      (list.body as { changeProposals: ChangeProposalDto[] }).changeProposals,
    ).toHaveLength(1);
    expect(detail.status).toBe(200);
    expect((detail.body as ChangeProposalDto).id).toBe(proposal.id);
  });

  it("applies only the approved item of a partially approved proposal", async () => {
    const proposal = await seedProposal([
      ...defaultItems(),
      {
        target: {
          entityType: "storyboard",
          entityId: "storyboard_project_a",
          field: "stylePresetId",
        },
        after: "style_cinematic",
        rationale: "A calmer style fits the new tone.",
      },
    ]);

    const approved = await request(
      "POST",
      `/api/change-proposals/${proposal.id}/items/${proposal.items[0]!.id}/decision`,
      { approval: "approved" },
    );
    const rejected = await request(
      "POST",
      `/api/change-proposals/${proposal.id}/items/${proposal.items[1]!.id}/decision`,
      { approval: "rejected" },
    );

    expect(approved.status).toBe(200);
    expect((rejected.body as ChangeProposalDto).status).toBe(
      "partially_approved",
    );

    const applied = await request(
      "POST",
      `/api/change-proposals/${proposal.id}/apply`,
    );

    expect(applied.status).toBe(200);
    expect((applied.body as ChangeProposalDto).status).toBe("applied");

    const storyboard = await deps.storyboards.findById("storyboard_project_a");
    expect(storyboard?.tone).toBe("quiet and reflective");
    expect(storyboard?.stylePresetId).toBeNull();
  });

  it("selects a choice option and applies the selected value", async () => {
    const proposal = await seedProposal();
    const itemId = proposal.items[0]!.id;

    const chosen = await request(
      "POST",
      `/api/change-proposals/${proposal.id}/items/${itemId}/choice`,
      { optionId: "bright" },
    );
    expect(chosen.status).toBe(200);
    expect((chosen.body as ChangeProposalDto).items[0]!.after).toBe(
      "bright and celebratory",
    );

    await request(
      "POST",
      `/api/change-proposals/${proposal.id}/items/${itemId}/decision`,
      { approval: "approved" },
    );
    await request("POST", `/api/change-proposals/${proposal.id}/apply`);

    expect(
      (await deps.storyboards.findById("storyboard_project_a"))?.tone,
    ).toBe("bright and celebratory");
  });

  it("reports a revision conflict and keeps the proposal for revision", async () => {
    const proposal = await seedProposal();
    const itemId = proposal.items[0]!.id;

    await request(
      "POST",
      `/api/change-proposals/${proposal.id}/items/${itemId}/decision`,
      { approval: "approved" },
    );

    // The operator edits the storyboard after reviewing the diff.
    await request("PUT", "/api/storyboards/storyboard_project_a", {
      projectId: "project_a",
      tone: "hand-edited tone",
    });

    const conflicted = await request(
      "POST",
      `/api/change-proposals/${proposal.id}/apply`,
    );
    expect(conflicted.status).toBe(409);

    const detail = await request("GET", `/api/change-proposals/${proposal.id}`);
    expect((detail.body as ChangeProposalDto).status).toBe("conflicted");

    // Revising rebases the item onto the current value and re-opens approval.
    const revised = await request(
      "POST",
      `/api/change-proposals/${proposal.id}/items/${itemId}/revision`,
      { after: "quiet and reflective", rationale: "Rebased after the edit." },
    );
    const revisedBody = revised.body as ChangeProposalDto;

    expect(revised.status).toBe(200);
    expect(revisedBody.status).toBe("pending");
    expect(revisedBody.items[0]!.approval).toBe("pending");

    await request(
      "POST",
      `/api/change-proposals/${proposal.id}/items/${itemId}/decision`,
      { approval: "approved" },
    );
    const applied = await request(
      "POST",
      `/api/change-proposals/${proposal.id}/apply`,
    );

    expect(applied.status).toBe(200);
    expect(
      (await deps.storyboards.findById("storyboard_project_a"))?.tone,
    ).toBe("quiet and reflective");
  });

  it("rejects an unknown decision value", async () => {
    const proposal = await seedProposal();

    const response = await request(
      "POST",
      `/api/change-proposals/${proposal.id}/items/${proposal.items[0]!.id}/decision`,
      { approval: "maybe" },
    );

    expect(response.status).toBe(422);
  });
});
