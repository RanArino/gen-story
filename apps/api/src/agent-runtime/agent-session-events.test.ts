import { describe, expect, it, vi } from "vitest";

import {
  CLAUDE_SESSION_CAPABILITIES,
  CODEX_SESSION_CAPABILITIES,
  normalizeClaudeSessionEvent,
  normalizeCodexSessionEvent,
} from "./agent-session-events";
import type { ClaudeSessionEvent } from "./claude-session/claude-session";
import type { CodexSessionEvent } from "./codex-app-server/codex-session";

describe("normalizeCodexSessionEvent", () => {
  it("maps thread-started to session-started", () => {
    expect(
      normalizeCodexSessionEvent({
        type: "thread-started",
        threadId: "thread-1",
      }),
    ).toEqual({
      type: "session-started",
      provider: "codex",
      sessionId: "thread-1",
    });
  });

  it("maps turn-started", () => {
    expect(
      normalizeCodexSessionEvent({ type: "turn-started", turnId: "turn-1" }),
    ).toEqual({ type: "turn-started", provider: "codex", turnId: "turn-1" });
  });

  it("maps agent-message-delta to assistant-text-delta", () => {
    expect(
      normalizeCodexSessionEvent({
        type: "agent-message-delta",
        itemId: "item-1",
        delta: "hel",
      }),
    ).toEqual({ type: "assistant-text-delta", provider: "codex", text: "hel" });
  });

  it("maps a completed agentMessage item to assistant-text-final", () => {
    expect(
      normalizeCodexSessionEvent({
        type: "item-completed",
        item: { type: "agentMessage", id: "item-1", text: "hello" },
      }),
    ).toEqual({
      type: "assistant-text-final",
      provider: "codex",
      text: "hello",
    });
  });

  it("drops item-completed for non-agentMessage items", () => {
    expect(
      normalizeCodexSessionEvent({
        type: "item-completed",
        item: { type: "contextCompaction", id: "item-1" },
      }),
    ).toBeNull();
  });

  it("maps turn-completed status, falling back to failed for unknown statuses", () => {
    expect(
      normalizeCodexSessionEvent({
        type: "turn-completed",
        turnId: "turn-1",
        status: "completed",
      }),
    ).toEqual({
      type: "turn-completed",
      provider: "codex",
      status: "completed",
    });
    expect(
      normalizeCodexSessionEvent({
        type: "turn-completed",
        turnId: "turn-1",
        status: "interrupted",
      }),
    ).toEqual({
      type: "turn-completed",
      provider: "codex",
      status: "interrupted",
    });
    expect(
      normalizeCodexSessionEvent({
        type: "turn-completed",
        turnId: "turn-1",
        status: "some-unmodeled-status",
      }),
    ).toEqual({ type: "turn-completed", provider: "codex", status: "failed" });
  });

  it("maps context-compacted", () => {
    expect(normalizeCodexSessionEvent({ type: "context-compacted" })).toEqual({
      type: "context-compacted",
      provider: "codex",
    });
  });

  it("maps server-request to approval-requested, preserving respond/reject", () => {
    const respond = vi.fn();
    const reject = vi.fn();
    const event: CodexSessionEvent = {
      type: "server-request",
      method: "execCommandApproval",
      params: { command: "ls" },
      respond,
      reject,
    };

    const normalized = normalizeCodexSessionEvent(event);

    expect(normalized).toMatchObject({
      type: "approval-requested",
      provider: "codex",
      method: "execCommandApproval",
      params: { command: "ls" },
    });
    if (normalized?.type === "approval-requested") {
      normalized.respond({ decision: "approved" });
      normalized.reject(-32000, "no");
    }
    expect(respond).toHaveBeenCalledWith({ decision: "approved" });
    expect(reject).toHaveBeenCalledWith(-32000, "no");
  });

  it("falls through unmodeled event types to provider-event", () => {
    const raw: CodexSessionEvent = {
      type: "status-changed",
      status: { type: "idle" },
    };
    expect(normalizeCodexSessionEvent(raw)).toEqual({
      type: "provider-event",
      provider: "codex",
      raw,
    });
  });
});

describe("normalizeClaudeSessionEvent", () => {
  it("maps session-ready to session-started", () => {
    expect(
      normalizeClaudeSessionEvent({
        type: "session-ready",
        sessionId: "session-1",
      }),
    ).toEqual({
      type: "session-started",
      provider: "claude",
      sessionId: "session-1",
    });
  });

  it("maps assistant-text to assistant-text-final", () => {
    expect(
      normalizeClaudeSessionEvent({ type: "assistant-text", text: "hi" }),
    ).toEqual({ type: "assistant-text-final", provider: "claude", text: "hi" });
  });

  it("maps a successful turn-completed to status completed", () => {
    expect(
      normalizeClaudeSessionEvent({
        type: "turn-completed",
        isError: false,
        subtype: "success",
        resultText: "ok",
      }),
    ).toEqual({
      type: "turn-completed",
      provider: "claude",
      status: "completed",
    });
  });

  it("maps an interrupted turn-completed (error_during_execution) to interrupted", () => {
    expect(
      normalizeClaudeSessionEvent({
        type: "turn-completed",
        isError: true,
        subtype: "error_during_execution",
        resultText: null,
      }),
    ).toEqual({
      type: "turn-completed",
      provider: "claude",
      status: "interrupted",
    });
  });

  it("maps any other error subtype to failed", () => {
    expect(
      normalizeClaudeSessionEvent({
        type: "turn-completed",
        isError: true,
        subtype: "error_max_turns",
        resultText: null,
      }),
    ).toEqual({ type: "turn-completed", provider: "claude", status: "failed" });
  });

  it("falls through unmodeled event types to provider-event", () => {
    const raw: ClaudeSessionEvent = {
      type: "rate-limit",
      info: { status: "allowed" },
    };
    expect(normalizeClaudeSessionEvent(raw)).toEqual({
      type: "provider-event",
      provider: "claude",
      raw,
    });
  });
});

describe("session capabilities", () => {
  it("reflects the proven Codex/Claude differences", () => {
    expect(CODEX_SESSION_CAPABILITIES).toMatchObject({
      provider: "codex",
      supportsMidTurnCancellationWithoutEndingSession: true,
      supportsApprovalRequests: true,
      sessionIdKnownBeforeStart: false,
    });
    expect(CLAUDE_SESSION_CAPABILITIES).toMatchObject({
      provider: "claude",
      supportsMidTurnCancellationWithoutEndingSession: false,
      supportsApprovalRequests: false,
      sessionIdKnownBeforeStart: true,
    });
    // Both drivers proved explicit compaction works (M1-06/M1-07 Discoveries).
    expect(CODEX_SESSION_CAPABILITIES.supportsExplicitCompact).toBe(true);
    expect(CLAUDE_SESSION_CAPABILITIES.supportsExplicitCompact).toBe(true);
  });
});
