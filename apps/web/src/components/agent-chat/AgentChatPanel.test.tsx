// @vitest-environment jsdom
import type { AiRuntimeInfoDto } from "@gen-story/shared";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../i18n/messages/en.json";

const getAiRuntimeInfo = vi.fn();
const listAgentConversations = vi.fn();
const createAgentConversation = vi.fn();
const getAgentConversation = vi.fn();
const getCreativeDirection = vi.fn();

vi.mock("../../lib/api-client", () => ({
  ApiError: class ApiError extends Error {},
  getAiRuntimeInfo: () => getAiRuntimeInfo(),
  listAgentConversations: (projectId: string) =>
    listAgentConversations(projectId),
  createAgentConversation: (projectId: string) =>
    createAgentConversation(projectId),
  getAgentConversation: (id: string) => getAgentConversation(id),
  getCreativeDirection: (projectId: string) => getCreativeDirection(projectId),
  getChangeProposal: vi.fn(),
  applyChangeProposal: vi.fn(),
  cancelAgentChatTurn: vi.fn(),
  compactAgentChatSession: vi.fn(),
  decideChangeProposalItem: vi.fn(),
  forkAgentChatSession: vi.fn(),
  postAgentChatTurn: vi.fn(),
  selectChangeProposalChoice: vi.fn(),
  subscribeToProjectEvents: () => () => {},
}));

const { AgentChatPanel } = await import("./AgentChatPanel");

function runtimeInfo(chat: AiRuntimeInfoDto["chat"]): AiRuntimeInfoDto {
  return {
    runtime: chat.runtime,
    wallet: chat.runtime === "api" ? "api_key" : "subscription",
    availability: { status: "not_applicable" },
    capabilities: null,
    chat,
  };
}

function renderPanel() {
  // jsdom implements no layout, so the transcript's auto-scroll needs a stub.
  Element.prototype.scrollIntoView = () => {};
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AgentChatPanel projectId="project_1" />
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AgentChatPanel runtime availability (R2.4)", () => {
  it("explains why the chat is off and disables the composer when no CLI runtime is available", async () => {
    getAiRuntimeInfo.mockResolvedValue(
      runtimeInfo({
        runtime: "api",
        available: false,
        reason: "Agent chat requires a local CLI runtime.",
      }),
    );
    listAgentConversations.mockResolvedValue([]);
    createAgentConversation.mockResolvedValue({ id: "conversation_1" });
    getAgentConversation.mockResolvedValue({
      conversation: { id: "conversation_1" },
      binding: null,
      turns: [],
      messages: [],
    });
    getCreativeDirection.mockResolvedValue({ fields: [] });

    renderPanel();

    // The reason is shown rather than left to a failure on Send.
    await screen.findByText("Agent chat requires a local CLI runtime.");
    expect(screen.getByText(messages.agentChat.disabled.title)).toBeDefined();

    const composer = screen.getByRole("textbox");
    expect((composer as HTMLTextAreaElement).disabled).toBe(true);
    const send = screen.getByRole("button", {
      name: messages.agentChat.actions.send,
    });
    expect((send as HTMLButtonElement).disabled).toBe(true);
  });

  it("leaves the composer usable when a CLI runtime is available", async () => {
    getAiRuntimeInfo.mockResolvedValue(
      runtimeInfo({ runtime: "codex", available: true, reason: null }),
    );
    listAgentConversations.mockResolvedValue([{ id: "conversation_1" }]);
    getAgentConversation.mockResolvedValue({
      conversation: { id: "conversation_1" },
      binding: null,
      turns: [],
      messages: [],
    });
    getCreativeDirection.mockResolvedValue({ fields: [] });

    renderPanel();

    await waitFor(() => {
      expect(
        (screen.getByRole("textbox") as HTMLTextAreaElement).disabled,
      ).toBe(false);
    });
    expect(screen.queryByText(messages.agentChat.disabled.title)).toBeNull();
  });
});
