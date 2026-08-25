import type { ClaudeSessionEvent } from "./claude-session/claude-session";
import type { CodexSessionEvent } from "./codex-app-server/codex-session";

export type AgentProvider = "codex" | "claude";

/**
 * Provider-neutral visible-event shape for native conversational sessions.
 * Both `CodexSessionEvent` and `ClaudeSessionEvent` stay CLI-specific (they
 * live under `apps/api/src/agent-runtime/{codex-app-server,claude-session}/`
 * and are never imported by `packages/domain` or `packages/application`);
 * this is the shared surface M3's chat UI can consume regardless of which
 * provider a conversation is bound to. Events with no faithful neutral
 * meaning (Codex's per-item lifecycle noise, Claude's rate-limit pings, ...)
 * fall through to `provider-event` rather than being invented.
 */
export type AgentSessionEvent =
  | { type: "session-started"; provider: AgentProvider; sessionId: string }
  | { type: "turn-started"; provider: AgentProvider; turnId: string }
  | { type: "assistant-text-delta"; provider: AgentProvider; text: string }
  | { type: "assistant-text-final"; provider: AgentProvider; text: string }
  | {
      type: "turn-completed";
      provider: AgentProvider;
      status: "completed" | "interrupted" | "failed";
    }
  | { type: "context-compacted"; provider: AgentProvider }
  | {
      type: "approval-requested";
      provider: AgentProvider;
      method: string;
      params: unknown;
      respond: (result: unknown) => void;
      reject: (code: number, message: string) => void;
    }
  | { type: "provider-event"; provider: AgentProvider; raw: unknown };

/**
 * What a provider's native session can actually do, established by the
 * M1-06/M1-07 live probes rather than assumed. Consumers use this instead of
 * branching on `provider` directly, so a future third provider only needs to
 * supply its own capability record.
 */
export type AgentSessionCapabilities = {
  provider: AgentProvider;
  supportsExplicitCompact: boolean;
  /** Codex's turn/interrupt keeps the session alive; Claude's cancel kills the process. */
  supportsMidTurnCancellationWithoutEndingSession: boolean;
  /** Claude sessions currently run with all tools disabled (M1 scope), so no approval ever fires. */
  supportsApprovalRequests: boolean;
  /** Codex only learns the thread id from thread/start's response; Claude's is client-chosen. */
  sessionIdKnownBeforeStart: boolean;
};

export const CODEX_SESSION_CAPABILITIES: AgentSessionCapabilities = {
  provider: "codex",
  supportsExplicitCompact: true,
  supportsMidTurnCancellationWithoutEndingSession: true,
  supportsApprovalRequests: true,
  sessionIdKnownBeforeStart: false,
};

export const CLAUDE_SESSION_CAPABILITIES: AgentSessionCapabilities = {
  provider: "claude",
  supportsExplicitCompact: true,
  supportsMidTurnCancellationWithoutEndingSession: false,
  supportsApprovalRequests: false,
  sessionIdKnownBeforeStart: true,
};

function normalizedTurnStatus(
  status: string,
): "completed" | "interrupted" | "failed" {
  return status === "completed" || status === "interrupted" ? status : "failed";
}

export function normalizeCodexSessionEvent(
  event: CodexSessionEvent,
): AgentSessionEvent | null {
  switch (event.type) {
    case "thread-started":
      return {
        type: "session-started",
        provider: "codex",
        sessionId: event.threadId,
      };
    case "turn-started":
      return { type: "turn-started", provider: "codex", turnId: event.turnId };
    case "agent-message-delta":
      return {
        type: "assistant-text-delta",
        provider: "codex",
        text: event.delta,
      };
    case "item-completed": {
      const item = event.item as { type?: unknown; text?: unknown } | undefined;
      if (item?.type === "agentMessage" && typeof item.text === "string") {
        return {
          type: "assistant-text-final",
          provider: "codex",
          text: item.text,
        };
      }
      return null;
    }
    case "turn-completed":
      return {
        type: "turn-completed",
        provider: "codex",
        status: normalizedTurnStatus(event.status),
      };
    case "context-compacted":
      return { type: "context-compacted", provider: "codex" };
    case "server-request":
      return {
        type: "approval-requested",
        provider: "codex",
        method: event.method,
        params: event.params,
        respond: event.respond,
        reject: event.reject,
      };
    case "item-started":
    case "status-changed":
    case "notification":
      return { type: "provider-event", provider: "codex", raw: event };
  }
}

export function normalizeClaudeSessionEvent(
  event: ClaudeSessionEvent,
): AgentSessionEvent | null {
  switch (event.type) {
    case "session-ready":
      return {
        type: "session-started",
        provider: "claude",
        sessionId: event.sessionId,
      };
    case "assistant-text":
      return {
        type: "assistant-text-final",
        provider: "claude",
        text: event.text,
      };
    case "turn-completed": {
      const status = event.isError
        ? event.subtype === "error_during_execution"
          ? "interrupted"
          : "failed"
        : "completed";
      return { type: "turn-completed", provider: "claude", status };
    }
    // Codex's own tool-call lifecycle maps to `provider-event` too; this
    // neutral layer has no tool-activity variant to map onto faithfully.
    case "tool-use":
    case "rate-limit":
    case "raw":
      return { type: "provider-event", provider: "claude", raw: event };
  }
}
