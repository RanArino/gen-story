import { createServer, type Server } from "node:http";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createOrganization,
  createProject,
  createStoryboard,
  createUser,
} from "@gen-story/domain";
import type {
  AgentConversationDetailDto,
  AgentConversationDto,
  AgentConversationMessageDto,
  AgentConversationTurnDto,
  AgentProviderBindingDto,
} from "@gen-story/shared";

import {
  LOCAL_ORGANIZATION_ID,
  LOCAL_USER_ID,
  seedLocalPrincipal,
} from "../auth/local-auth";
import type { StubAgentTurnRunner } from "../test-support/in-memory-application";
import { createInMemoryApplicationDependencies } from "../test-support/in-memory-application";
import { sendJson } from "./json";
import { buildRouter, handleApiRequest } from "./routes";

const now = "2026-08-16T00:00:00.000Z";

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
let runner: StubAgentTurnRunner;

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

async function startConversation(projectId = "project_a") {
  const response = await request(
    "POST",
    `/api/projects/${projectId}/agent-conversations`,
    {},
  );
  expect(response.status).toBe(201);
  return response.body as AgentConversationDto;
}

// The turn runs after the response is sent, so tests wait for the transcript
// to settle rather than assuming the provider finished synchronously.
async function waitForTurnToFinish(conversationId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await request(
      "GET",
      `/api/agent-conversations/${conversationId}`,
    );
    const detail = response.body as AgentConversationDetailDto;
    if (
      detail.turns.length > 0 &&
      detail.turns.every((turn) => turn.status !== "running")
    ) {
      return detail;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("the turn never finished");
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
  runner = deps.agentTurnRunner as StubAgentTurnRunner;

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

describe("agent chat routes", () => {
  it("creates and lists a project's conversations", async () => {
    const conversation = await startConversation();
    expect(conversation.projectId).toBe("project_a");

    const listed = await request(
      "GET",
      "/api/projects/project_a/agent-conversations",
    );
    expect(listed.status).toBe(200);
    expect(
      (listed.body as { conversations: AgentConversationDto[] }).conversations,
    ).toHaveLength(1);
  });

  it("accepts a turn, runs it in the background, and records the transcript", async () => {
    const conversation = await startConversation();

    const posted = await request(
      "POST",
      `/api/agent-conversations/${conversation.id}/turns`,
      {
        clientRequestId: "request_1",
        text: "Should the tone be warmer?",
        mentions: [
          {
            label: "@tone",
            target: {
              entityType: "storyboard",
              entityId: "storyboard_project_a",
              field: "tone",
            },
          },
        ],
      },
    );

    expect(posted.status).toBe(202);
    const body = posted.body as {
      turn: AgentConversationTurnDto;
      message: AgentConversationMessageDto;
    };
    expect(body.turn.status).toBe("running");
    expect(body.message.mentions[0]?.target.field).toBe("tone");

    const detail = await waitForTurnToFinish(conversation.id);
    expect(detail.turns[0]?.status).toBe("completed");
    expect(detail.binding?.nativeSessionId).toBe("session-1");
    expect(detail.messages.map((message) => message.kind)).toEqual([
      "user_text",
      "assistant_text",
    ]);

    // The provider received the new turn and the referenced field's live
    // value — not the transcript.
    expect(runner.requests[0]?.references).toEqual([
      {
        label: "@tone",
        targetKey: "storyboard:storyboard_project_a#tone",
        value: "warm and nostalgic",
        revision: now,
      },
    ]);
  });

  it("replays only what a reconnecting client missed", async () => {
    const conversation = await startConversation();
    await request("POST", `/api/agent-conversations/${conversation.id}/turns`, {
      clientRequestId: "request_1",
      text: "Warmer?",
    });
    await waitForTurnToFinish(conversation.id);

    const resumed = await request(
      "GET",
      `/api/agent-conversations/${conversation.id}?afterSequence=1`,
    );
    const detail = resumed.body as AgentConversationDetailDto;

    expect(resumed.status).toBe(200);
    expect(detail.messages.map((message) => message.sequence)).toEqual([2]);
  });

  it("rejects a malformed afterSequence", async () => {
    const conversation = await startConversation();

    const response = await request(
      "GET",
      `/api/agent-conversations/${conversation.id}?afterSequence=-2`,
    );

    expect(response.status).toBe(422);
  });

  it("cancels a running turn", async () => {
    const conversation = await startConversation();
    // Held open so the turn is genuinely in flight when the cancel arrives.
    let release = () => {};
    runner.hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    const posted = await request(
      "POST",
      `/api/agent-conversations/${conversation.id}/turns`,
      { clientRequestId: "request_1", text: "Warmer?" },
    );
    const turn = (posted.body as { turn: AgentConversationTurnDto }).turn;

    const cancelled = await request(
      "POST",
      `/api/agent-conversation-turns/${turn.id}/cancel`,
    );

    expect(cancelled.status).toBe(200);
    expect((cancelled.body as AgentConversationTurnDto).status).toBe(
      "cancelled",
    );
    release();
  });

  it("forks a new provider session and keeps the transcript", async () => {
    const conversation = await startConversation();
    await request("POST", `/api/agent-conversations/${conversation.id}/turns`, {
      clientRequestId: "request_1",
      text: "Warmer?",
    });
    await waitForTurnToFinish(conversation.id);

    const forked = await request(
      "POST",
      `/api/agent-conversations/${conversation.id}/fork`,
    );

    expect(forked.status).toBe(201);
    const binding = forked.body as AgentProviderBindingDto;
    expect(binding.nativeSessionId).toBeNull();
    expect(binding.status).toBe("active");

    const detail = await request(
      "GET",
      `/api/agent-conversations/${conversation.id}`,
    );
    const body = detail.body as AgentConversationDetailDto;
    expect(body.binding?.id).toBe(binding.id);
    expect(body.messages.some((message) => message.kind === "user_text")).toBe(
      true,
    );
  });

  it("compacts the provider context on request", async () => {
    const conversation = await startConversation();
    await request("POST", `/api/agent-conversations/${conversation.id}/turns`, {
      clientRequestId: "request_1",
      text: "Warmer?",
    });
    await waitForTurnToFinish(conversation.id);

    const compacted = await request(
      "POST",
      `/api/agent-conversations/${conversation.id}/compact`,
    );

    expect(compacted.status).toBe(200);
    expect((compacted.body as AgentProviderBindingDto).compactCount).toBe(1);
  });

  it("hides another organization's conversation", async () => {
    const foreign = await request(
      "POST",
      "/api/projects/project_foreign/agent-conversations",
      {},
    );

    expect(foreign.status).toBe(403);
  });

  it("refuses a turn when no CLI runtime is available", async () => {
    const conversation = await startConversation();
    runner.available = {
      available: false,
      reason: "The codex CLI is not logged in.",
    };

    const posted = await request(
      "POST",
      `/api/agent-conversations/${conversation.id}/turns`,
      { clientRequestId: "request_1", text: "Warmer?" },
    );

    // invalid_state: the request is well-formed, the runtime just cannot run it.
    expect(posted.status).toBe(422);
    expect(posted.body).toMatchObject({
      error: { message: "The codex CLI is not logged in." },
    });
  });
});
