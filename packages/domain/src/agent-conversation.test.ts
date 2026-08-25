import { describe, expect, it } from "vitest";

import {
  AGENT_SESSION_COMPACT_TURN_THRESHOLD,
  canSendTurnOnBinding,
  createAgentConversation,
  createAgentConversationMessage,
  createAgentConversationTurn,
  createAgentProviderBinding,
  finishAgentConversationTurn,
  markAgentConversationTurnCompacted,
  recordAgentProviderBindingCompaction,
  recordAgentProviderBindingSession,
  recordAgentProviderBindingTurn,
  setAgentConversationActiveBinding,
  setAgentProviderBindingStatus,
  shouldCompactAgentSession,
} from "./agent-conversation";

const NOW = "2026-08-16T00:00:00.000Z";
const LATER = "2026-08-16T00:05:00.000Z";

function binding() {
  return createAgentProviderBinding({
    id: "binding-1",
    conversationId: "conversation-1",
    provider: "codex",
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function turn() {
  return createAgentConversationTurn({
    id: "turn-1",
    conversationId: "conversation-1",
    bindingId: "binding-1",
    clientRequestId: "request-1",
    provider: "codex",
    startedAt: NOW,
  });
}

describe("createAgentConversation", () => {
  it("defaults to no active binding", () => {
    const conversation = createAgentConversation({
      id: "conversation-1",
      projectId: "project-1",
      title: "Creative direction",
      createdAt: NOW,
      updatedAt: NOW,
    });

    expect(conversation.activeBindingId).toBeNull();
    expect(conversation.title).toBe("Creative direction");
  });

  it("rejects a blank title", () => {
    expect(() =>
      createAgentConversation({
        id: "conversation-1",
        projectId: "project-1",
        title: "   ",
        createdAt: NOW,
        updatedAt: NOW,
      }),
    ).toThrow(/title is required/i);
  });
});

describe("createAgentProviderBinding", () => {
  it("starts active with no native session and no compactions", () => {
    const created = binding();

    expect(created.status).toBe("active");
    expect(created.nativeSessionId).toBeNull();
    expect(created.compactCount).toBe(0);
    expect(created.lastCompactedAt).toBeNull();
  });

  it("reconstructs a persisted binding as-is", () => {
    const restored = createAgentProviderBinding({
      id: "binding-1",
      conversationId: "conversation-1",
      provider: "claude",
      model: "sonnet",
      nativeSessionId: "session-abc",
      status: "recoverable",
      compactCount: 3,
      lastCompactedAt: LATER,
      lastTurnId: "turn-9",
      createdAt: NOW,
      updatedAt: LATER,
    });

    expect(restored).toMatchObject({
      status: "recoverable",
      compactCount: 3,
      lastCompactedAt: LATER,
      lastTurnId: "turn-9",
      nativeSessionId: "session-abc",
    });
  });
});

describe("provider binding transitions", () => {
  it("records the native session id learned after start", () => {
    const bound = recordAgentProviderBindingSession(
      binding(),
      "thread-123",
      LATER,
    );

    expect(bound.nativeSessionId).toBe("thread-123");
    expect(bound.status).toBe("active");
    expect(bound.updatedAt).toBe(LATER);
  });

  it("counts compactions and returns the binding to active", () => {
    const compacting = setAgentProviderBindingStatus(
      binding(),
      "compacting",
      NOW,
    );
    const compacted = recordAgentProviderBindingCompaction(compacting, LATER);

    expect(compacted.compactCount).toBe(1);
    expect(compacted.lastCompactedAt).toBe(LATER);
    expect(compacted.status).toBe("active");
  });

  it("remembers the last turn", () => {
    expect(
      recordAgentProviderBindingTurn(binding(), "turn-7", LATER),
    ).toMatchObject({ lastTurnId: "turn-7", updatedAt: LATER });
  });

  it("only lets an active binding carry the next turn", () => {
    expect(canSendTurnOnBinding(binding())).toBe(true);
    for (const status of ["compacting", "recoverable", "closed"] as const) {
      expect(
        canSendTurnOnBinding(
          setAgentProviderBindingStatus(binding(), status, LATER),
        ),
      ).toBe(false);
    }
  });

  it("repoints a conversation at a forked binding", () => {
    const conversation = createAgentConversation({
      id: "conversation-1",
      projectId: "project-1",
      title: "Creative direction",
      createdAt: NOW,
      updatedAt: NOW,
    });

    expect(
      setAgentConversationActiveBinding(conversation, "binding-2", LATER),
    ).toMatchObject({ activeBindingId: "binding-2", updatedAt: LATER });
  });
});

describe("createAgentConversationMessage", () => {
  it("keeps the canonical target of a semantic mention alongside its label", () => {
    const message = createAgentConversationMessage({
      id: "message-1",
      conversationId: "conversation-1",
      sequence: 1,
      role: "user",
      kind: "user_text",
      text: "Warm up @tone please",
      mentions: [
        {
          label: "@tone",
          target: {
            entityType: "storyboard",
            entityId: "storyboard-1",
            field: "tone",
          },
        },
      ],
      createdAt: NOW,
    });

    expect(message.mentions).toEqual([
      {
        label: "@tone",
        target: {
          entityType: "storyboard",
          entityId: "storyboard-1",
          field: "tone",
        },
      },
    ]);
  });

  it("requires text for user and assistant messages", () => {
    expect(() =>
      createAgentConversationMessage({
        id: "message-1",
        conversationId: "conversation-1",
        sequence: 1,
        role: "assistant",
        kind: "assistant_text",
        text: "  ",
        createdAt: NOW,
      }),
    ).toThrow(/text is required/i);
  });

  it("allows a structured proposal message with no text", () => {
    const message = createAgentConversationMessage({
      id: "message-1",
      conversationId: "conversation-1",
      sequence: 2,
      role: "system",
      kind: "proposal",
      text: "",
      data: { changeProposalId: "proposal-1" },
      createdAt: NOW,
    });

    expect(message.data).toEqual({ changeProposalId: "proposal-1" });
  });

  it("rejects a non-positive sequence", () => {
    expect(() =>
      createAgentConversationMessage({
        id: "message-1",
        conversationId: "conversation-1",
        sequence: 0,
        role: "user",
        kind: "user_text",
        text: "hello",
        createdAt: NOW,
      }),
    ).toThrow(/sequence/i);
  });
});

describe("conversation turns", () => {
  it("starts running", () => {
    expect(turn()).toMatchObject({ status: "running", completedAt: null });
  });

  it("finishes once and refuses to finish again", () => {
    const cancelled = finishAgentConversationTurn(turn(), {
      status: "cancelled",
      completedAt: LATER,
    });

    expect(cancelled).toMatchObject({
      status: "cancelled",
      completedAt: LATER,
    });
    expect(() =>
      finishAgentConversationTurn(cancelled, {
        status: "completed",
        completedAt: LATER,
      }),
    ).toThrow(/already finished/i);
  });

  it("records a failure message", () => {
    expect(
      finishAgentConversationTurn(turn(), {
        status: "failed",
        completedAt: LATER,
        errorMessage: "The provider session ended.",
      }).errorMessage,
    ).toBe("The provider session ended.");
  });

  it("marks compaction idempotently", () => {
    const compacted = markAgentConversationTurnCompacted(turn());
    expect(compacted.compacted).toBe(true);
    expect(markAgentConversationTurnCompacted(compacted)).toBe(compacted);
  });
});

describe("shouldCompactAgentSession", () => {
  function completedTurns(count: number, startedAt = LATER) {
    return Array.from({ length: count }, (_, index) => ({
      ...createAgentConversationTurn({
        id: `turn-${index}`,
        conversationId: "conversation-1",
        bindingId: "binding-1",
        clientRequestId: `request-${index}`,
        provider: "codex" as const,
        startedAt,
      }),
      status: "completed" as const,
    }));
  }

  it("holds off until the threshold is reached", () => {
    expect(
      shouldCompactAgentSession(
        binding(),
        completedTurns(AGENT_SESSION_COMPACT_TURN_THRESHOLD - 1),
      ),
    ).toBe(false);
    expect(
      shouldCompactAgentSession(
        binding(),
        completedTurns(AGENT_SESSION_COMPACT_TURN_THRESHOLD),
      ),
    ).toBe(true);
  });

  it("counts only the turns since the last compaction", () => {
    const compacted = recordAgentProviderBindingCompaction(binding(), LATER);

    expect(
      shouldCompactAgentSession(
        compacted,
        completedTurns(AGENT_SESSION_COMPACT_TURN_THRESHOLD, NOW),
      ),
    ).toBe(false);
  });

  it("never compacts a binding that is not active", () => {
    expect(
      shouldCompactAgentSession(
        setAgentProviderBindingStatus(binding(), "recoverable", LATER),
        completedTurns(AGENT_SESSION_COMPACT_TURN_THRESHOLD),
      ),
    ).toBe(false);
  });
});
