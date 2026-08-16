import { randomUUID } from "node:crypto";

import {
  canSendTurnOnBinding,
  createAgentConversation,
  createAgentConversationMessage,
  createAgentConversationTurn,
  createAgentProviderBinding,
  createSemanticTarget,
  finishAgentConversationTurn,
  markAgentConversationTurnCompacted,
  readProjectPhotoAnalysisSemanticTarget,
  readStoryboardSemanticTarget,
  recordAgentProviderBindingCompaction,
  recordAgentProviderBindingSession,
  recordAgentProviderBindingTurn,
  semanticTargetKey,
  setAgentConversationActiveBinding,
  setAgentProviderBindingStatus,
  shouldCompactAgentSession,
  type AgentConversation,
  type AgentConversationMessage,
  type AgentConversationMessageKind,
  type AgentConversationMessageRole,
  type AgentConversationTurn,
  type AgentProviderBinding,
  type SemanticMention,
  type SemanticTarget,
  type SemanticTargetSnapshot,
} from "@gen-story/domain";

import type {
  AgentTurnEvent,
  AgentTurnReference,
  ApplicationDependencies,
  Language,
  UseCaseResult,
} from "./ports";
import { DEFAULT_LANGUAGE } from "./ports";
import {
  failure,
  isFailure,
  now,
  success,
  validationFailure,
} from "./use-cases";

// The chat answers in the language the operator set for the app, not the one
// the provider infers from the machine's locale.
async function resolveOperatorLanguage(
  deps: ApplicationDependencies,
): Promise<Language> {
  const principal = await deps.authContext.getCurrentPrincipal();
  if (principal == null) return DEFAULT_LANGUAGE;
  const preference = await deps.userPreferences.findByUserId(principal.user.id);
  return preference?.language ?? DEFAULT_LANGUAGE;
}

async function getConversationOrNotFound(
  deps: ApplicationDependencies,
  conversationId: string,
): Promise<AgentConversation | UseCaseResult<never>> {
  const conversation = await deps.agentConversations.findById(conversationId);
  if (conversation == null) {
    return failure("not_found", "Conversation not found.");
  }
  return conversation;
}

// Reads a semantic target's live value and revision. Duplicated deliberately
// from the change-proposal path rather than exported from it: both read the
// same three fields, but this one must never gain proposal-specific behavior.
async function readSemanticTarget(
  deps: ApplicationDependencies,
  target: SemanticTarget,
): Promise<SemanticTargetSnapshot | UseCaseResult<never>> {
  if (target.entityType === "storyboard") {
    const storyboard = await deps.storyboards.findById(target.entityId);
    if (storyboard == null) {
      return failure("not_found", "Storyboard not found.");
    }
    return readStoryboardSemanticTarget(storyboard, target.field);
  }

  const analysis = await deps.projectPhotoAnalyses.findLatestByProjectId(
    target.entityId,
  );
  if (analysis == null) {
    return failure("not_found", "Project photo analysis not found.");
  }
  return readProjectPhotoAnalysisSemanticTarget(analysis);
}

// Project isolation for `@` mentions: the same rule the MCP propose path
// applies, enforced again here because a mention is a separate entry point.
async function assertTargetBelongsToProject(
  deps: ApplicationDependencies,
  projectId: string,
  target: SemanticTarget,
): Promise<UseCaseResult<never> | undefined> {
  if (target.entityType === "project") {
    return target.entityId === projectId
      ? undefined
      : failure(
          "not_found",
          "Referenced field does not belong to this project.",
        );
  }

  const storyboard = await deps.storyboards.findById(target.entityId);
  if (storyboard == null) {
    return failure("not_found", "Storyboard not found.");
  }
  return storyboard.projectId === projectId
    ? undefined
    : failure("not_found", "Referenced field does not belong to this project.");
}

// Everything the UI needs to render one turn's progress live. Routed through
// the project entity so it reaches the project's existing SSE subscribers.
async function publishChatEvent(
  deps: ApplicationDependencies,
  projectId: string,
  event: "message" | "turn" | "binding",
  payload: Record<string, unknown>,
): Promise<void> {
  await deps.progressEvents.publish({
    kind: `agent_chat.${event}`,
    entityType: "project",
    entityId: projectId,
    payload: { projectId, ...payload },
  });
}

async function appendMessage(
  deps: ApplicationDependencies,
  conversation: AgentConversation,
  input: {
    turnId: string | null;
    role: AgentConversationMessageRole;
    kind: AgentConversationMessageKind;
    text: string;
    mentions?: SemanticMention[];
    data?: Record<string, unknown> | null;
  },
): Promise<AgentConversationMessage> {
  const message = createAgentConversationMessage({
    id: randomUUID(),
    conversationId: conversation.id,
    turnId: input.turnId,
    sequence: await deps.agentConversations.nextMessageSequence(
      conversation.id,
    ),
    role: input.role,
    kind: input.kind,
    text: input.text,
    mentions: input.mentions,
    data: input.data,
    createdAt: now(),
  });

  await deps.agentConversations.saveMessage(message);
  await publishChatEvent(deps, conversation.projectId, "message", {
    conversationId: conversation.id,
    messageId: message.id,
    sequence: message.sequence,
    kind: message.kind,
  });
  return message;
}

export type CreateAgentChatConversationInput = {
  projectId: string;
  title?: string;
};

export async function createAgentChatConversation(
  deps: ApplicationDependencies,
  input: CreateAgentChatConversationInput,
): Promise<UseCaseResult<AgentConversation>> {
  try {
    const project = await deps.projects.findById(input.projectId);
    if (project == null) return failure("not_found", "Project not found.");

    const timestamp = now();
    const conversation = createAgentConversation({
      id: randomUUID(),
      projectId: project.id,
      title: input.title?.trim() || "Creative direction",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await deps.agentConversations.save(conversation);
    return success(conversation);
  } catch (error) {
    return validationFailure(error);
  }
}

export async function listAgentChatConversations(
  deps: ApplicationDependencies,
  input: { projectId: string },
): Promise<UseCaseResult<AgentConversation[]>> {
  const project = await deps.projects.findById(input.projectId);
  if (project == null) return failure("not_found", "Project not found.");
  return success(await deps.agentConversations.findByProjectId(project.id));
}

export type AgentChatConversationDetail = {
  conversation: AgentConversation;
  binding: AgentProviderBinding | null;
  turns: AgentConversationTurn[];
  messages: AgentConversationMessage[];
};

export async function getAgentChatConversation(
  deps: ApplicationDependencies,
  input: { conversationId: string; afterSequence?: number },
): Promise<UseCaseResult<AgentChatConversationDetail>> {
  const conversation = await getConversationOrNotFound(
    deps,
    input.conversationId,
  );
  if (isFailure(conversation)) return conversation;

  const binding =
    conversation.activeBindingId == null
      ? null
      : await deps.agentConversations.findBindingById(
          conversation.activeBindingId,
        );

  return success({
    conversation,
    binding,
    turns: await deps.agentConversations.listTurns(conversation.id),
    messages: await deps.agentConversations.listMessages(
      conversation.id,
      input.afterSequence,
    ),
  });
}

// Creates the binding for a conversation that has none, or reuses the active
// one. A binding whose provider no longer matches the configured runtime is
// not silently reused: the operator forks explicitly instead.
async function resolveBindingForTurn(
  deps: ApplicationDependencies,
  conversation: AgentConversation,
): Promise<AgentProviderBinding | UseCaseResult<never>> {
  const availability = deps.agentTurnRunner.availability();
  if (!availability.available) {
    return failure("invalid_state", availability.reason);
  }

  if (conversation.activeBindingId != null) {
    const existing = await deps.agentConversations.findBindingById(
      conversation.activeBindingId,
    );
    if (existing != null) {
      if (existing.provider !== availability.provider) {
        return failure(
          "conflict",
          `This conversation is bound to ${existing.provider}, but the configured runtime is ${availability.provider}. Fork the conversation to switch providers.`,
        );
      }
      if (!canSendTurnOnBinding(existing)) {
        return failure(
          "conflict",
          `This conversation's provider session is ${existing.status}. Fork it to continue.`,
        );
      }
      return existing;
    }
  }

  const timestamp = now();
  const binding = createAgentProviderBinding({
    id: randomUUID(),
    conversationId: conversation.id,
    provider: availability.provider,
    model: availability.model,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await deps.agentConversations.saveBinding(binding);
  await deps.agentConversations.save(
    setAgentConversationActiveBinding(conversation, binding.id, timestamp),
  );
  return binding;
}

export type PostAgentChatTurnInput = {
  conversationId: string;
  clientRequestId: string;
  text: string;
  // Untrusted tuples from the client, validated into SemanticTargets here —
  // the same posture the MCP propose path takes with agent input.
  mentions?: {
    label: string;
    target: { entityType: string; entityId: string; field: string };
  }[];
};

export type PostAgentChatTurnOutput = {
  turn: AgentConversationTurn;
  message: AgentConversationMessage;
};

/**
 * Persists the operator's message and opens a turn. It deliberately does not
 * run the provider: `runAgentChatTurn` does that, so the HTTP request returns
 * as soon as the turn is durable and the UI can follow it over the event
 * stream. Retrying with the same client request ID returns the existing turn
 * rather than sending the message twice.
 */
export async function postAgentChatTurn(
  deps: ApplicationDependencies,
  input: PostAgentChatTurnInput,
): Promise<UseCaseResult<PostAgentChatTurnOutput>> {
  try {
    const conversation = await getConversationOrNotFound(
      deps,
      input.conversationId,
    );
    if (isFailure(conversation)) return conversation;

    const existingTurn =
      await deps.agentConversations.findTurnByClientRequestId(
        conversation.id,
        input.clientRequestId,
      );
    if (existingTurn != null) {
      const messages = await deps.agentConversations.listMessages(
        conversation.id,
      );
      const message = messages.find(
        (candidate) =>
          candidate.turnId === existingTurn.id &&
          candidate.kind === "user_text",
      );
      if (message != null) {
        return success({ turn: existingTurn, message });
      }
    }

    const running = (
      await deps.agentConversations.listTurns(conversation.id)
    ).find((turn) => turn.status === "running");
    if (running != null) {
      return failure(
        "conflict",
        "This conversation already has a turn in progress.",
      );
    }

    const mentions: SemanticMention[] = [];
    for (const mention of input.mentions ?? []) {
      const target = createSemanticTarget({
        entityType: mention.target.entityType,
        entityId: mention.target.entityId,
        field: mention.target.field,
      });
      const scopeFailure = await assertTargetBelongsToProject(
        deps,
        conversation.projectId,
        target,
      );
      if (scopeFailure != null) return scopeFailure;
      mentions.push({ label: mention.label, target });
    }

    const binding = await resolveBindingForTurn(deps, conversation);
    if (isFailure(binding)) return binding;

    const timestamp = now();
    const turn = createAgentConversationTurn({
      id: randomUUID(),
      conversationId: conversation.id,
      bindingId: binding.id,
      clientRequestId: input.clientRequestId,
      provider: binding.provider,
      model: binding.model,
      startedAt: timestamp,
    });
    await deps.agentConversations.saveTurn(turn);
    await deps.agentConversations.saveBinding(
      recordAgentProviderBindingTurn(binding, turn.id, timestamp),
    );

    const message = await appendMessage(deps, conversation, {
      turnId: turn.id,
      role: "user",
      kind: "user_text",
      text: input.text,
      mentions,
    });

    await publishChatEvent(deps, conversation.projectId, "turn", {
      conversationId: conversation.id,
      turnId: turn.id,
      status: turn.status,
    });

    return success({ turn, message });
  } catch (error) {
    return validationFailure(error);
  }
}

// Proposals reach the transcript by reconciliation, not by trusting the agent
// to report them: the MCP tool takes the conversation/turn id as *input*, so a
// wrong value there must not hide a proposal from the operator.
//
// The window is what keeps this precise. Only proposals created since this
// turn started belong to it — an earlier conversation's proposals are already
// shown in that conversation, and re-listing them here would put another
// conversation's pending decision in front of the operator out of context.
async function appendNewProposalMessages(
  deps: ApplicationDependencies,
  conversation: AgentConversation,
  turn: AgentConversationTurn,
): Promise<void> {
  const proposals = (
    await deps.changeProposals.findByProjectId(conversation.projectId)
  ).filter((proposal) => proposal.createdAt >= turn.startedAt);
  if (proposals.length === 0) return;

  const messages = await deps.agentConversations.listMessages(conversation.id);
  const referenced = new Set(
    messages
      .filter((message) => message.kind === "proposal")
      .map((message) => String(message.data?.changeProposalId ?? "")),
  );

  for (const proposal of proposals) {
    if (referenced.has(proposal.id)) continue;
    await appendMessage(deps, conversation, {
      turnId: turn.id,
      role: "system",
      kind: "proposal",
      text: proposal.rationale,
      data: { changeProposalId: proposal.id },
    });
  }
}

/**
 * Drives one turn against the provider and persists everything visible as it
 * happens, so a refresh or reconnect mid-turn loses nothing. Never throws:
 * a provider failure ends the turn as "failed" with the reason in the
 * transcript, because a half-recorded turn is worse than a recorded failure.
 */
export async function runAgentChatTurn(
  deps: ApplicationDependencies,
  input: { turnId: string },
): Promise<UseCaseResult<AgentConversationTurn>> {
  const turn = await deps.agentConversations.findTurnById(input.turnId);
  if (turn == null) return failure("not_found", "Conversation turn not found.");
  if (turn.status !== "running") {
    return failure("invalid_state", "This turn already finished.");
  }

  const conversation = await getConversationOrNotFound(
    deps,
    turn.conversationId,
  );
  if (isFailure(conversation)) return conversation;

  const binding = await deps.agentConversations.findBindingById(turn.bindingId);
  if (binding == null) {
    return failure("not_found", "Provider binding not found.");
  }

  const messages = await deps.agentConversations.listMessages(conversation.id);
  const userMessage = messages.find(
    (message) => message.turnId === turn.id && message.kind === "user_text",
  );

  const references: AgentTurnReference[] = [];
  for (const mention of userMessage?.mentions ?? []) {
    const snapshot = await readSemanticTarget(deps, mention.target);
    if (isFailure(snapshot)) return snapshot;
    references.push({
      label: mention.label,
      targetKey: semanticTargetKey(mention.target),
      value: snapshot.value,
      revision: snapshot.revision,
    });
  }

  // Collected during the run and written after it: the events arrive on the
  // provider's callback, which cannot be awaited from inside.
  const pending: AgentTurnEvent[] = [];
  let outcome: Extract<AgentTurnEvent, { type: "turn-completed" }> = {
    type: "turn-completed",
    status: "failed",
    errorMessage: "The provider produced no result.",
  };

  await deps.agentTurnRunner.startTurn(
    {
      projectId: conversation.projectId,
      conversationId: conversation.id,
      turnId: turn.id,
      provider: turn.provider,
      model: turn.model,
      nativeSessionId: binding.nativeSessionId,
      language: await resolveOperatorLanguage(deps),
      text: userMessage?.text ?? "",
      mentions: userMessage?.mentions ?? [],
      references,
    },
    (event) => {
      if (event.type === "turn-completed") {
        outcome = event;
        return;
      }
      pending.push(event);
    },
  );

  let currentBinding = binding;
  let currentTurn = turn;

  for (const event of pending) {
    switch (event.type) {
      case "session-started":
        currentBinding = recordAgentProviderBindingSession(
          currentBinding,
          event.nativeSessionId,
          now(),
        );
        await deps.agentConversations.saveBinding(currentBinding);
        await publishChatEvent(deps, conversation.projectId, "binding", {
          conversationId: conversation.id,
          bindingId: currentBinding.id,
          status: currentBinding.status,
          nativeSessionId: currentBinding.nativeSessionId,
        });
        break;
      case "assistant-text":
        await appendMessage(deps, conversation, {
          turnId: turn.id,
          role: "assistant",
          kind: "assistant_text",
          text: event.text,
        });
        break;
      case "tool-activity":
        await appendMessage(deps, conversation, {
          turnId: turn.id,
          role: "system",
          kind: "tool_activity",
          text: event.toolName,
          data: {
            toolName: event.toolName,
            ...(event.changeProposalId
              ? { changeProposalId: event.changeProposalId }
              : {}),
          },
        });
        break;
      case "compacted": {
        currentBinding = recordAgentProviderBindingCompaction(
          currentBinding,
          now(),
        );
        await deps.agentConversations.saveBinding(currentBinding);
        currentTurn = markAgentConversationTurnCompacted(currentTurn);
        await appendMessage(deps, conversation, {
          turnId: turn.id,
          role: "system",
          kind: "notice",
          text: "The provider compacted its context.",
          data: { compactCount: currentBinding.compactCount },
        });
        break;
      }
    }
  }

  await appendNewProposalMessages(deps, conversation, turn);

  const timestamp = now();
  const finished: AgentConversationTurn = {
    ...finishAgentConversationTurn(currentTurn, {
      status:
        outcome.status === "completed"
          ? "completed"
          : outcome.status === "interrupted"
            ? "cancelled"
            : "failed",
      completedAt: timestamp,
      errorMessage: outcome.errorMessage ?? null,
    }),
    providerTurnId: outcome.providerTurnId ?? currentTurn.providerTurnId,
  };
  await deps.agentConversations.saveTurn(finished);

  if (finished.status === "failed") {
    // The transcript survives; only the provider link is in doubt. Marking it
    // recoverable is what forces a deliberate fork instead of a silent
    // new session with none of the context the operator can still read.
    currentBinding = setAgentProviderBindingStatus(
      currentBinding,
      currentBinding.nativeSessionId == null ? "recoverable" : "active",
      timestamp,
    );
    await deps.agentConversations.saveBinding(currentBinding);
    await appendMessage(deps, conversation, {
      turnId: turn.id,
      role: "system",
      kind: "notice",
      text: outcome.errorMessage ?? "The turn failed.",
      data: { failed: true },
    });
  }

  await publishChatEvent(deps, conversation.projectId, "turn", {
    conversationId: conversation.id,
    turnId: finished.id,
    status: finished.status,
    compacted: finished.compacted,
  });

  await compactIfDue(deps, conversation, currentBinding);

  return success(finished);
}

// Long sessions eventually exhaust the provider's context. Compacting between
// turns (never during one) keeps the next turn from failing for a reason the
// operator cannot see or act on, and it is recorded in the transcript exactly
// like a manual compaction.
async function compactIfDue(
  deps: ApplicationDependencies,
  conversation: AgentConversation,
  binding: AgentProviderBinding,
): Promise<void> {
  const turns = await deps.agentConversations.listTurns(conversation.id);
  if (!shouldCompactAgentSession(binding, turns)) return;

  const compacted = await deps.agentTurnRunner.compact({
    conversationId: conversation.id,
  });
  if (!compacted) return;

  const updated = recordAgentProviderBindingCompaction(binding, now());
  await deps.agentConversations.saveBinding(updated);
  await appendMessage(deps, conversation, {
    turnId: null,
    role: "system",
    kind: "notice",
    text: "The context was compacted automatically to keep this session going.",
    data: { compactCount: updated.compactCount, automatic: true },
  });
  await publishChatEvent(deps, conversation.projectId, "binding", {
    conversationId: conversation.id,
    bindingId: updated.id,
    status: updated.status,
    compactCount: updated.compactCount,
  });
}

export async function cancelAgentChatTurn(
  deps: ApplicationDependencies,
  input: { turnId: string },
): Promise<UseCaseResult<AgentConversationTurn>> {
  const turn = await deps.agentConversations.findTurnById(input.turnId);
  if (turn == null) return failure("not_found", "Conversation turn not found.");
  if (turn.status !== "running") {
    return failure("invalid_state", "This turn already finished.");
  }

  const conversation = await getConversationOrNotFound(
    deps,
    turn.conversationId,
  );
  if (isFailure(conversation)) return conversation;

  await deps.agentTurnRunner.cancelTurn({
    conversationId: turn.conversationId,
    turnId: turn.id,
  });

  // Messages already persisted stay; only the turn ends. `runAgentChatTurn`
  // sees a finished turn and will not re-finish it.
  const cancelled = finishAgentConversationTurn(turn, {
    status: "cancelled",
    completedAt: now(),
  });
  await deps.agentConversations.saveTurn(cancelled);
  await appendMessage(deps, conversation, {
    turnId: turn.id,
    role: "system",
    kind: "notice",
    text: "You cancelled this turn.",
    data: { cancelled: true },
  });
  await publishChatEvent(deps, conversation.projectId, "turn", {
    conversationId: conversation.id,
    turnId: cancelled.id,
    status: cancelled.status,
  });

  return success(cancelled);
}

/**
 * Closes the current provider session and binds a fresh one. This is the only
 * way to switch providers or recover a dead session, and it is deliberately
 * explicit: the new session starts with no context, which the operator must
 * choose rather than discover.
 */
export async function forkAgentChatProviderSession(
  deps: ApplicationDependencies,
  input: { conversationId: string },
): Promise<UseCaseResult<AgentProviderBinding>> {
  const conversation = await getConversationOrNotFound(
    deps,
    input.conversationId,
  );
  if (isFailure(conversation)) return conversation;

  const availability = deps.agentTurnRunner.availability();
  if (!availability.available) {
    return failure("invalid_state", availability.reason);
  }

  const running = (
    await deps.agentConversations.listTurns(conversation.id)
  ).find((turn) => turn.status === "running");
  if (running != null) {
    return failure("conflict", "Cancel the turn in progress before forking.");
  }

  const timestamp = now();
  if (conversation.activeBindingId != null) {
    const previous = await deps.agentConversations.findBindingById(
      conversation.activeBindingId,
    );
    if (previous != null) {
      await deps.agentConversations.saveBinding(
        setAgentProviderBindingStatus(previous, "closed", timestamp),
      );
    }
  }
  await deps.agentTurnRunner.release({ conversationId: conversation.id });

  const binding = createAgentProviderBinding({
    id: randomUUID(),
    conversationId: conversation.id,
    provider: availability.provider,
    model: availability.model,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await deps.agentConversations.saveBinding(binding);
  await deps.agentConversations.save(
    setAgentConversationActiveBinding(conversation, binding.id, timestamp),
  );
  await appendMessage(deps, conversation, {
    turnId: null,
    role: "system",
    kind: "notice",
    text: `Started a new ${binding.provider} session. Earlier context is in this transcript but not in the new session.`,
    data: { bindingId: binding.id, provider: binding.provider },
  });
  await publishChatEvent(deps, conversation.projectId, "binding", {
    conversationId: conversation.id,
    bindingId: binding.id,
    status: binding.status,
  });

  return success(binding);
}

export async function compactAgentChatConversation(
  deps: ApplicationDependencies,
  input: { conversationId: string },
): Promise<UseCaseResult<AgentProviderBinding>> {
  const conversation = await getConversationOrNotFound(
    deps,
    input.conversationId,
  );
  if (isFailure(conversation)) return conversation;

  if (conversation.activeBindingId == null) {
    return failure("invalid_state", "This conversation has no live session.");
  }
  const binding = await deps.agentConversations.findBindingById(
    conversation.activeBindingId,
  );
  if (binding == null) {
    return failure("not_found", "Provider binding not found.");
  }

  const compacted = await deps.agentTurnRunner.compact({
    conversationId: conversation.id,
  });
  if (!compacted) {
    return failure(
      "invalid_state",
      "This conversation has no live provider session to compact.",
    );
  }

  const updated = recordAgentProviderBindingCompaction(binding, now());
  await deps.agentConversations.saveBinding(updated);
  await appendMessage(deps, conversation, {
    turnId: null,
    role: "system",
    kind: "notice",
    text: "You compacted the provider's context.",
    data: { compactCount: updated.compactCount },
  });
  await publishChatEvent(deps, conversation.projectId, "binding", {
    conversationId: conversation.id,
    bindingId: updated.id,
    status: updated.status,
    compactCount: updated.compactCount,
  });

  return success(updated);
}
