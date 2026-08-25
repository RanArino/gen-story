import type { ProjectId, Timestamp } from "./model";
import type { SemanticTarget } from "./semantic-target";

// Duplicated for the same reason as change-proposal.ts's copy: the domain
// must not depend on apps/api, where the CLI-backed runtime adapters live.
export type AgentProvider = "codex" | "claude";

export type AgentConversationId = string;
export type AgentProviderBindingId = string;
export type AgentConversationTurnId = string;
export type AgentConversationMessageId = string;

// Gen Story keeps the complete, immutable transcript; the provider keeps its
// own compactable working context. These two histories are deliberately
// separate — a binding is the join between them, not a copy of either.
export type AgentProviderBindingStatus =
  | "active"
  | "compacting"
  // A resume attempt failed (provider session gone, CLI reinstalled, ...).
  // The transcript is intact; continuing requires a deliberate fork rather
  // than silently inventing provider context.
  | "recoverable"
  | "closed";

export type AgentProviderBinding = {
  id: AgentProviderBindingId;
  conversationId: AgentConversationId;
  provider: AgentProvider;
  model: string | null;
  // Codex only learns its thread id from `thread/start`'s response, so a
  // binding exists briefly before its native session id is known.
  nativeSessionId: string | null;
  status: AgentProviderBindingStatus;
  compactCount: number;
  lastCompactedAt: Timestamp | null;
  lastTurnId: AgentConversationTurnId | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type AgentConversation = {
  id: AgentConversationId;
  projectId: ProjectId;
  title: string;
  // Switching providers forks a new binding and repoints this; the transcript
  // below is never forked with it.
  activeBindingId: AgentProviderBindingId | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

// A GUI `@` mention. `label` is what the operator saw (and is localized);
// `target` is the canonical meaning, so relabelling or translating the UI can
// never change which field a message referred to.
export type SemanticMention = {
  label: string;
  target: SemanticTarget;
};

export type AgentConversationMessageRole = "user" | "assistant" | "system";

export type AgentConversationMessageKind =
  | "user_text"
  | "assistant_text"
  // Visible tool activity ("read creative direction"), not raw tool output.
  | "tool_activity"
  // Points at a durable M2 change proposal rendered as an approval card.
  | "proposal"
  // Product-authored status the operator must see: compaction, cancellation,
  // a failed resume, a recoverable binding.
  | "notice";

export type AgentConversationMessage = {
  id: AgentConversationMessageId;
  conversationId: AgentConversationId;
  turnId: AgentConversationTurnId | null;
  // Monotonic per conversation. Reconnecting clients ask for everything after
  // the last sequence they rendered, so no event is replayed or skipped.
  sequence: number;
  role: AgentConversationMessageRole;
  kind: AgentConversationMessageKind;
  text: string;
  mentions: SemanticMention[];
  // Kind-specific structured payload: `{ changeProposalId }` for a proposal,
  // `{ toolName }` for tool activity. Never raw provider chain-of-thought.
  data: Record<string, unknown> | null;
  createdAt: Timestamp;
};

export type AgentConversationTurnStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentConversationTurn = {
  id: AgentConversationTurnId;
  conversationId: AgentConversationId;
  bindingId: AgentProviderBindingId;
  // Lets a submitted turn be retried safely without running it twice.
  clientRequestId: string;
  status: AgentConversationTurnStatus;
  provider: AgentProvider;
  model: string | null;
  // The provider's own id for this turn, when it exposes one (Codex does).
  providerTurnId: string | null;
  // True when the provider compacted its context during this turn.
  compacted: boolean;
  errorMessage: string | null;
  startedAt: Timestamp;
  completedAt: Timestamp | null;
};

function trimRequired(value: string, fieldName: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${fieldName} is required.`);
  }
  return trimmed;
}

export type CreateAgentConversationInput = {
  id: AgentConversationId;
  projectId: ProjectId;
  title: string;
  activeBindingId?: AgentProviderBindingId | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export function createAgentConversation(
  input: CreateAgentConversationInput,
): AgentConversation {
  return {
    id: input.id,
    projectId: trimRequired(input.projectId, "Conversation project ID"),
    title: trimRequired(input.title, "Conversation title"),
    activeBindingId: input.activeBindingId ?? null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export type CreateAgentProviderBindingInput = {
  id: AgentProviderBindingId;
  conversationId: AgentConversationId;
  provider: AgentProvider;
  model?: string | null;
  nativeSessionId?: string | null;
  status?: AgentProviderBindingStatus;
  compactCount?: number;
  lastCompactedAt?: Timestamp | null;
  lastTurnId?: AgentConversationTurnId | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export function createAgentProviderBinding(
  input: CreateAgentProviderBindingInput,
): AgentProviderBinding {
  return {
    id: input.id,
    conversationId: trimRequired(
      input.conversationId,
      "Provider binding conversation ID",
    ),
    provider: input.provider,
    model: input.model ?? null,
    nativeSessionId: input.nativeSessionId ?? null,
    status: input.status ?? "active",
    compactCount: input.compactCount ?? 0,
    lastCompactedAt: input.lastCompactedAt ?? null,
    lastTurnId: input.lastTurnId ?? null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export type CreateAgentConversationMessageInput = {
  id: AgentConversationMessageId;
  conversationId: AgentConversationId;
  turnId?: AgentConversationTurnId | null;
  sequence: number;
  role: AgentConversationMessageRole;
  kind: AgentConversationMessageKind;
  text: string;
  mentions?: SemanticMention[];
  data?: Record<string, unknown> | null;
  createdAt: Timestamp;
};

export function createAgentConversationMessage(
  input: CreateAgentConversationMessageInput,
): AgentConversationMessage {
  if (!Number.isInteger(input.sequence) || input.sequence < 1) {
    throw new Error(
      "Conversation message sequence must be a positive integer.",
    );
  }

  // A tool_activity or notice line can be meaningful with structured data
  // alone, but a user/assistant message with no text is nothing to display.
  const text = input.text.trim();
  if (
    text.length === 0 &&
    (input.kind === "user_text" || input.kind === "assistant_text")
  ) {
    throw new Error("Conversation message text is required.");
  }

  return {
    id: input.id,
    conversationId: trimRequired(
      input.conversationId,
      "Conversation message conversation ID",
    ),
    turnId: input.turnId ?? null,
    sequence: input.sequence,
    role: input.role,
    kind: input.kind,
    text,
    mentions: (input.mentions ?? []).map((mention) => ({
      label: trimRequired(mention.label, "Semantic mention label"),
      target: mention.target,
    })),
    data: input.data ?? null,
    createdAt: input.createdAt,
  };
}

export type CreateAgentConversationTurnInput = {
  id: AgentConversationTurnId;
  conversationId: AgentConversationId;
  bindingId: AgentProviderBindingId;
  clientRequestId: string;
  provider: AgentProvider;
  model?: string | null;
  status?: AgentConversationTurnStatus;
  providerTurnId?: string | null;
  compacted?: boolean;
  errorMessage?: string | null;
  startedAt: Timestamp;
  completedAt?: Timestamp | null;
};

export function createAgentConversationTurn(
  input: CreateAgentConversationTurnInput,
): AgentConversationTurn {
  return {
    id: input.id,
    conversationId: trimRequired(
      input.conversationId,
      "Conversation turn conversation ID",
    ),
    bindingId: trimRequired(input.bindingId, "Conversation turn binding ID"),
    clientRequestId: trimRequired(
      input.clientRequestId,
      "Conversation turn client request ID",
    ),
    status: input.status ?? "running",
    provider: input.provider,
    model: input.model ?? null,
    providerTurnId: input.providerTurnId ?? null,
    compacted: input.compacted ?? false,
    errorMessage: input.errorMessage ?? null,
    startedAt: input.startedAt,
    completedAt: input.completedAt ?? null,
  };
}

// Terminal transition for a turn. Re-finishing an already-finished turn is
// refused rather than silently rewriting history, so a late provider event
// cannot overwrite a cancellation the operator already saw.
export function finishAgentConversationTurn(
  turn: AgentConversationTurn,
  outcome: {
    status: Exclude<AgentConversationTurnStatus, "running">;
    completedAt: Timestamp;
    errorMessage?: string | null;
  },
): AgentConversationTurn {
  if (turn.status !== "running") {
    throw new Error(
      `Cannot finish a turn with status "${turn.status}": it already finished.`,
    );
  }

  return {
    ...turn,
    status: outcome.status,
    errorMessage: outcome.errorMessage ?? null,
    completedAt: outcome.completedAt,
  };
}

export function markAgentConversationTurnCompacted(
  turn: AgentConversationTurn,
): AgentConversationTurn {
  return turn.compacted ? turn : { ...turn, compacted: true };
}

export function recordAgentProviderBindingSession(
  binding: AgentProviderBinding,
  nativeSessionId: string,
  updatedAt: Timestamp,
): AgentProviderBinding {
  return {
    ...binding,
    nativeSessionId: trimRequired(
      nativeSessionId,
      "Provider binding native session ID",
    ),
    status: "active",
    updatedAt,
  };
}

export function recordAgentProviderBindingCompaction(
  binding: AgentProviderBinding,
  compactedAt: Timestamp,
): AgentProviderBinding {
  return {
    ...binding,
    compactCount: binding.compactCount + 1,
    lastCompactedAt: compactedAt,
    status: "active",
    updatedAt: compactedAt,
  };
}

export function setAgentProviderBindingStatus(
  binding: AgentProviderBinding,
  status: AgentProviderBindingStatus,
  updatedAt: Timestamp,
): AgentProviderBinding {
  return { ...binding, status, updatedAt };
}

export function recordAgentProviderBindingTurn(
  binding: AgentProviderBinding,
  turnId: AgentConversationTurnId,
  updatedAt: Timestamp,
): AgentProviderBinding {
  return { ...binding, lastTurnId: turnId, updatedAt };
}

export function setAgentConversationActiveBinding(
  conversation: AgentConversation,
  bindingId: AgentProviderBindingId,
  updatedAt: Timestamp,
): AgentConversation {
  return { ...conversation, activeBindingId: bindingId, updatedAt };
}

// Long sessions must compact or the provider eventually refuses the next
// turn. Gen Story does not track provider token usage, so the policy is a
// turn count — coarse, but observable to the operator and never silently
// dependent on a number only the provider knows.
export const AGENT_SESSION_COMPACT_TURN_THRESHOLD = 20;

export function shouldCompactAgentSession(
  binding: AgentProviderBinding,
  turns: AgentConversationTurn[],
): boolean {
  if (binding.status !== "active") return false;

  const since = turns.filter(
    (turn) =>
      turn.bindingId === binding.id &&
      turn.status === "completed" &&
      (binding.lastCompactedAt == null ||
        turn.startedAt > binding.lastCompactedAt),
  );
  return since.length >= AGENT_SESSION_COMPACT_TURN_THRESHOLD;
}

// A binding can carry the next turn only while it is genuinely usable.
// "recoverable" deliberately fails this: the operator must fork a new
// session instead of the runner pretending the provider still has context.
export function canSendTurnOnBinding(binding: AgentProviderBinding): boolean {
  return binding.status === "active";
}
