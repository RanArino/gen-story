// @vitest-environment jsdom
import type { AiRuntimeInfoDto } from "@gen-story/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "../../i18n/messages/en.json";

const getAiRuntimeInfo = vi.fn();
const listAgentConversations = vi.fn();
const createAgentConversation = vi.fn();
const getAgentConversation = vi.fn();
const getCreativeDirection = vi.fn();
const setUserLanguagePreference = vi.fn();

vi.mock("../../lib/api-client", () => ({
  ApiError: class ApiError extends Error {},
  getAiRuntimeInfo: () => getAiRuntimeInfo(),
  listAgentConversations: (projectId: string) =>
    listAgentConversations(projectId),
  createAgentConversation: (projectId: string) =>
    createAgentConversation(projectId),
  getAgentConversation: (id: string) => getAgentConversation(id),
  getCreativeDirection: (projectId: string) => getCreativeDirection(projectId),
  setUserLanguagePreference: (language: string, agentRuntime?: string) =>
    setUserLanguagePreference(language, agentRuntime),
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

  it("shows the latest tool activity next to the spinner instead of a static label", async () => {
    getAiRuntimeInfo.mockResolvedValue(
      runtimeInfo({ runtime: "claude", available: true, reason: null }),
    );
    listAgentConversations.mockResolvedValue([{ id: "conversation_1" }]);
    getAgentConversation.mockResolvedValue({
      conversation: { id: "conversation_1" },
      binding: null,
      turns: [
        {
          id: "turn_1",
          conversationId: "conversation_1",
          bindingId: "binding_1",
          status: "running",
          provider: "claude",
          model: null,
          providerTurnId: null,
          compacted: false,
          errorMessage: null,
          startedAt: new Date().toISOString(),
          completedAt: null,
        },
      ],
      messages: [
        {
          id: "message_1",
          conversationId: "conversation_1",
          turnId: "turn_1",
          sequence: 1,
          role: "system",
          kind: "tool_activity",
          text: "get_scene",
          mentions: [],
          data: null,
          createdAt: new Date().toISOString(),
        },
      ],
    });
    getCreativeDirection.mockResolvedValue({ fields: [] });

    renderPanel();

    const runningRow = await screen.findByRole("status");
    expect(runningRow.textContent).toContain(
      messages.agentChat.toolActivity.replace("{tool}", "get_scene"),
    );
    expect(runningRow.textContent).not.toContain(messages.agentChat.running);
  });
});

describe("AgentChatPanel reference picker", () => {
  function seedDirection() {
    getAiRuntimeInfo.mockResolvedValue(
      runtimeInfo({ runtime: "claude", available: true, reason: null }),
    );
    listAgentConversations.mockResolvedValue([{ id: "conversation_1" }]);
    getAgentConversation.mockResolvedValue({
      conversation: { id: "conversation_1" },
      binding: null,
      turns: [],
      messages: [],
    });
    getCreativeDirection.mockResolvedValue({
      fields: [
        {
          target: {
            entityType: "project",
            entityId: "project_1",
            field: "photoAnalysis",
          },
          value: {},
          revision: "r1",
        },
        {
          target: {
            entityType: "storyboard",
            entityId: "storyboard_1",
            field: "tone",
          },
          value: "Serenity",
          revision: "r2",
        },
      ],
    });
  }

  it("toggles a reference off on a second click instead of repeating it", async () => {
    seedDirection();
    renderPanel();

    fireEvent.click(
      await screen.findByRole("button", {
        name: messages.agentChat.actions.mention,
      }),
    );
    // Expand the group holding the field.
    fireEvent.click(
      screen.getByRole("button", {
        name: messages.agentChat.actions.expandGroup.replace(
          "{group}",
          messages.agentChat.groups.analysis,
        ),
      }),
    );

    const option = () =>
      screen.getByRole("option", {
        name: new RegExp(messages.agentChat.fields.photoAnalysis),
      });
    const draft = () => screen.getByRole("textbox") as HTMLTextAreaElement;
    const occurrences = () =>
      draft().value.split(messages.agentChat.fields.photoAnalysis).length - 1;

    fireEvent.click(option());
    expect(occurrences()).toBe(1);
    expect(option().getAttribute("aria-selected")).toBe("true");

    // Second click removes it — the reported bug appended a duplicate here.
    fireEvent.click(option());
    expect(occurrences()).toBe(0);
    expect(option().getAttribute("aria-selected")).toBe("false");

    // Third click puts it back, exactly once.
    fireEvent.click(option());
    expect(occurrences()).toBe(1);
  });

  it("toggles a whole group in and back out", async () => {
    seedDirection();
    renderPanel();

    fireEvent.click(
      await screen.findByRole("button", {
        name: messages.agentChat.actions.mention,
      }),
    );
    // Anchored: the expand caret's label also contains the group name.
    const group = () =>
      screen.getByRole("button", {
        name: new RegExp(`^${messages.agentChat.groups.analysis}`),
      });
    const draft = () => screen.getByRole("textbox") as HTMLTextAreaElement;

    fireEvent.click(group());
    expect(draft().value).toContain(messages.agentChat.fields.photoAnalysis);
    expect(draft().value).toContain(messages.agentChat.fields.tone);
    expect(group().getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(group());
    expect(draft().value).not.toContain(
      messages.agentChat.fields.photoAnalysis,
    );
    expect(draft().value).not.toContain(messages.agentChat.fields.tone);
    expect(group().getAttribute("aria-pressed")).toBe("false");
  });
});

describe("AgentChatPanel provider picker", () => {
  it("lets the operator switch the runtime and applies it without a page reload", async () => {
    getAiRuntimeInfo
      .mockResolvedValueOnce(
        runtimeInfo({ runtime: "claude", available: true, reason: null }),
      )
      .mockResolvedValueOnce(
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
    setUserLanguagePreference.mockResolvedValue({
      userId: "user_1",
      language: "en",
      agentRuntime: "codex",
      updatedAt: new Date().toISOString(),
    });

    renderPanel();

    const providerButton = await screen.findByRole("button", {
      name: messages.agentChat.meta.providers.claude,
    });
    fireEvent.click(providerButton);
    fireEvent.click(
      screen.getByRole("option", {
        name: messages.agentChat.meta.providers.codex,
      }),
    );

    expect(setUserLanguagePreference).toHaveBeenCalledWith("en", "codex");
    await screen.findByRole("button", {
      name: messages.agentChat.meta.providers.codex,
    });
    expect(getAiRuntimeInfo).toHaveBeenCalledTimes(2);
  });
});

describe("AgentChatPanel session history", () => {
  it("lists past sessions and loads the one the operator picks", async () => {
    getAiRuntimeInfo.mockResolvedValue(
      runtimeInfo({ runtime: "claude", available: true, reason: null }),
    );
    listAgentConversations.mockResolvedValue([
      {
        id: "conversation_1",
        projectId: "project_1",
        title: "Current chat",
        activeBindingId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "conversation_2",
        projectId: "project_1",
        title: "Tone discussion",
        activeBindingId: null,
        createdAt: new Date(Date.now() - 86_400_000).toISOString(),
        updatedAt: new Date(Date.now() - 86_400_000).toISOString(),
      },
    ]);
    getAgentConversation.mockImplementation((id: string) =>
      Promise.resolve({
        conversation: { id },
        binding: null,
        turns: [],
        messages: [],
      }),
    );
    getCreativeDirection.mockResolvedValue({ fields: [] });

    renderPanel();

    fireEvent.click(
      await screen.findByRole("button", {
        name: messages.agentChat.actions.history,
      }),
    );

    fireEvent.click(
      await screen.findByRole("option", { name: /Tone discussion/ }),
    );

    await waitFor(() => {
      expect(getAgentConversation).toHaveBeenCalledWith("conversation_2");
    });
  });
});
