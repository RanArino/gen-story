"use client";

import type {
  AgentConversationDetailDto,
  AgentConversationMessageDto,
  AgentConversationTurnDto,
  AgentProviderBindingDto,
  ChangeProposalDto,
  ChangeProposalItemDto,
  CreativeDirectionDto,
  SemanticMentionDto,
  SemanticTargetDto,
} from "@gen-story/shared";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ApiError,
  applyChangeProposal,
  cancelAgentChatTurn,
  compactAgentChatSession,
  createAgentConversation,
  decideChangeProposalItem,
  forkAgentChatSession,
  getAgentConversation,
  getAiRuntimeInfo,
  getChangeProposal,
  getCreativeDirection,
  listAgentConversations,
  postAgentChatTurn,
  selectChangeProposalChoice,
  subscribeToProjectEvents,
  type ProjectEvent,
} from "../../lib/api-client";
import { ErrorAlert } from "../ErrorAlert";
import styles from "./AgentChatPanel.module.css";
import { ChangeApprovalCard } from "./ChangeApprovalCard";

type Props = { projectId: string };

type MentionOption = {
  id: string;
  label: string;
  target: SemanticTargetDto;
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export function AgentChatPanel({ projectId }: Props) {
  const t = useTranslations("agentChat");
  const [detail, setDetail] = useState<AgentConversationDetailDto | null>(null);
  const [direction, setDirection] = useState<CreativeDirectionDto | null>(null);
  const [runtimeWallet, setRuntimeWallet] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Record<string, ChangeProposalDto>>(
    {},
  );
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<SemanticMentionDto[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const conversationId = detail?.conversation.id ?? null;
  const activeTurn: AgentConversationTurnDto | null =
    detail?.turns.find((turn) => turn.status === "running") ?? null;
  const binding: AgentProviderBindingDto | null = detail?.binding ?? null;

  const fieldLabel = useCallback(
    (field: string) => {
      if (field === "photoAnalysis") return t("fields.photoAnalysis");
      if (field === "tone") return t("fields.tone");
      if (field === "stylePresetId") return t("fields.stylePreset");
      return field;
    },
    [t],
  );

  // The picker offers exactly the fields that exist right now, with the
  // canonical target attached — so a translated label can never change which
  // field the message refers to.
  const mentionOptions: MentionOption[] = useMemo(() => {
    if (direction == null) return [];
    return direction.fields.map((field) => ({
      id: `${field.target.entityType}:${field.target.entityId}#${field.target.field}`,
      label: fieldLabel(field.target.field),
      target: field.target,
    }));
  }, [direction, fieldLabel]);

  // Mirrors `detail` so the event handler can read the latest transcript
  // without re-subscribing to the stream on every message.
  const detailRef = useRef<AgentConversationDetailDto | null>(null);
  useEffect(() => {
    detailRef.current = detail;
  }, [detail]);

  const loadConversation = useCallback(async (id: string) => {
    const next = await getAgentConversation(id);
    setDetail(next);
    return next;
  }, []);

  // Only the messages this client has not rendered are fetched; the rest of
  // the transcript stays exactly as it is on screen.
  const appendNewMessages = useCallback(async () => {
    const current = detailRef.current;
    if (current == null) return;
    const lastSequence = current.messages.at(-1)?.sequence ?? 0;
    const update = await getAgentConversation(
      current.conversation.id,
      lastSequence,
    );
    setDetail({
      conversation: update.conversation,
      binding: update.binding,
      turns: update.turns,
      messages: [...current.messages, ...update.messages],
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const [conversations, runtime, creativeDirection] = await Promise.all([
          listAgentConversations(projectId),
          getAiRuntimeInfo(),
          getCreativeDirection(projectId),
        ]);
        if (cancelled) return;

        setRuntimeWallet(runtime.wallet);
        setDirection(creativeDirection);

        const conversation =
          conversations[0] ?? (await createAgentConversation(projectId));
        if (cancelled) return;
        await loadConversation(conversation.id);
      } catch (err) {
        if (!cancelled) setError(errorMessage(err));
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [projectId, loadConversation]);

  // Proposal cards load their own proposal: the transcript stores only the ID,
  // so an approval decided elsewhere is still reflected here.
  const loadProposal = useCallback(async (changeProposalId: string) => {
    try {
      const proposal = await getChangeProposal(changeProposalId);
      setProposals((current) => ({ ...current, [proposal.id]: proposal }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    for (const message of detail?.messages ?? []) {
      const id = message.data?.changeProposalId;
      if (
        message.kind === "proposal" &&
        typeof id === "string" &&
        !(id in proposals)
      ) {
        void loadProposal(id);
      }
    }
  }, [detail, proposals, loadProposal]);

  useEffect(() => {
    const unsubscribe = subscribeToProjectEvents(
      projectId,
      (event: ProjectEvent) => {
        if (event.kind.startsWith("agent_chat.")) {
          void appendNewMessages();
          return;
        }
        if (event.kind.startsWith("change_proposal.")) {
          const id = event.payload?.changeProposalId;
          if (typeof id === "string") void loadProposal(id);
        }
        // Creative direction is re-read only once a proposal was actually
        // applied: a created or approved proposal has changed nothing yet.
        if (event.kind === "change_proposal.applied") {
          void getCreativeDirection(projectId)
            .then(setDirection)
            .catch(() => {});
        }
      },
    );
    return unsubscribe;
  }, [projectId, appendNewMessages, loadProposal]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: "end" });
  }, [detail?.messages.length]);

  async function send() {
    if (conversationId == null || draft.trim().length === 0) return;
    setSending(true);
    setError(null);
    try {
      await postAgentChatTurn(conversationId, {
        // Identifies this submission so a retry after a dropped response
        // cannot run the same turn twice.
        clientRequestId: crypto.randomUUID(),
        text: draft.trim(),
        mentions,
      });
      setDraft("");
      setMentions([]);
      await appendNewMessages();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  function insertMention(option: MentionOption) {
    setDraft((current) =>
      current.endsWith(" ") || current.length === 0
        ? `${current}${option.label} `
        : `${current} ${option.label} `,
    );
    setMentions((current) =>
      current.some(
        (mention) =>
          mention.target.entityId === option.target.entityId &&
          mention.target.field === option.target.field,
      )
        ? current
        : [...current, { label: option.label, target: option.target }],
    );
    setPickerOpen(false);
  }

  async function guarded(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
      if (conversationId != null) await loadConversation(conversationId);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function reviseHint(item: ChangeProposalItemDto) {
    setDraft(
      t("approval.reviseDraft", { field: fieldLabel(item.target.field) }),
    );
  }

  return (
    <section className={styles.panel} aria-label={t("title")}>
      <header className={styles.header}>
        <div>
          <h2 className={styles.title}>{t("title")}</h2>
          <p className={styles.subtitle}>{t("subtitle")}</p>
        </div>
        <dl className={styles.meta}>
          <div>
            <dt>{t("meta.provider")}</dt>
            <dd>{binding?.provider ?? t("meta.none")}</dd>
          </div>
          <div>
            <dt>{t("meta.model")}</dt>
            <dd>{binding?.model ?? t("meta.providerDefault")}</dd>
          </div>
          <div>
            <dt>{t("meta.wallet")}</dt>
            <dd>
              {runtimeWallet === "subscription"
                ? t("meta.subscription")
                : t("meta.apiKey")}
            </dd>
          </div>
          <div>
            <dt>{t("meta.session")}</dt>
            <dd>
              {binding?.nativeSessionId?.slice(0, 8) ?? t("meta.notStarted")}
              {binding != null && ` · ${t(`meta.status.${binding.status}`)}`}
            </dd>
          </div>
          <div>
            <dt>{t("meta.compactions")}</dt>
            <dd>{binding?.compactCount ?? 0}</dd>
          </div>
        </dl>
      </header>

      <div className={styles.sessionActions}>
        <button
          type="button"
          disabled={conversationId == null || activeTurn != null}
          onClick={() => {
            if (conversationId == null) return;
            void guarded(() => compactAgentChatSession(conversationId));
          }}
        >
          {t("actions.compact")}
        </button>
        <button
          type="button"
          disabled={conversationId == null || activeTurn != null}
          onClick={() => {
            if (conversationId == null) return;
            void guarded(() => forkAgentChatSession(conversationId));
          }}
        >
          {t("actions.fork")}
        </button>
      </div>

      {error != null && <ErrorAlert message={error} />}

      <ol className={styles.transcript} aria-live="polite">
        {(detail?.messages ?? []).map((message) => (
          <li
            key={message.id}
            className={styles.messageRow}
            data-role={message.role}
          >
            <TranscriptMessage
              message={message}
              proposals={proposals}
              fieldLabel={fieldLabel}
              onDecide={(proposalId, itemId, approval) =>
                guarded(async () => {
                  const updated = await decideChangeProposalItem(
                    proposalId,
                    itemId,
                    approval,
                  );
                  setProposals((current) => ({
                    ...current,
                    [updated.id]: updated,
                  }));
                })
              }
              onSelectChoice={(proposalId, itemId, optionId) =>
                guarded(async () => {
                  const updated = await selectChangeProposalChoice(
                    proposalId,
                    itemId,
                    optionId,
                  );
                  setProposals((current) => ({
                    ...current,
                    [updated.id]: updated,
                  }));
                })
              }
              onApply={(proposalId) =>
                guarded(async () => {
                  const updated = await applyChangeProposal(proposalId);
                  setProposals((current) => ({
                    ...current,
                    [updated.id]: updated,
                  }));
                })
              }
              onRevise={reviseHint}
              onContinue={() => inputRef.current?.focus()}
            />
          </li>
        ))}
        <div ref={transcriptEndRef} />
      </ol>

      {activeTurn != null && (
        <div className={styles.runningRow} role="status">
          <span>{t("running")}</span>
          <button
            type="button"
            onClick={() =>
              void guarded(() => cancelAgentChatTurn(activeTurn.id))
            }
          >
            {t("actions.cancel")}
          </button>
        </div>
      )}

      <div className={styles.composer}>
        <div className={styles.mentionRow}>
          <button
            type="button"
            aria-expanded={pickerOpen}
            aria-haspopup="listbox"
            onClick={() => setPickerOpen((open) => !open)}
          >
            {t("actions.mention")}
          </button>
          {pickerOpen && (
            <ul
              className={styles.mentionList}
              role="listbox"
              aria-label={t("actions.mention")}
            >
              {mentionOptions.length === 0 && (
                <li className={styles.mentionEmpty}>{t("noMentionTargets")}</li>
              )}
              {mentionOptions.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => insertMention(option)}
                  >
                    {option.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {mentions.map((mention) => (
            <span
              key={`${mention.target.entityId}#${mention.target.field}`}
              className={styles.mentionChip}
            >
              {mention.label}
            </span>
          ))}
        </div>
        <label className={styles.srOnly} htmlFor="agent-chat-input">
          {t("inputLabel")}
        </label>
        <textarea
          id="agent-chat-input"
          ref={inputRef}
          className={styles.input}
          rows={3}
          value={draft}
          placeholder={t("placeholder")}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="button"
          className={styles.primaryButton}
          disabled={
            sending ||
            activeTurn != null ||
            conversationId == null ||
            draft.trim().length === 0
          }
          onClick={() => void send()}
        >
          {t("actions.send")}
        </button>
      </div>
    </section>
  );
}

type TranscriptMessageProps = {
  message: AgentConversationMessageDto;
  proposals: Record<string, ChangeProposalDto>;
  fieldLabel: (field: string) => string;
  onDecide: (
    proposalId: string,
    itemId: string,
    approval: "approved" | "rejected",
  ) => Promise<void>;
  onSelectChoice: (
    proposalId: string,
    itemId: string,
    optionId: string,
  ) => Promise<void>;
  onApply: (proposalId: string) => Promise<void>;
  onRevise: (item: ChangeProposalItemDto) => void;
  // "Continue without applying" leaves the proposal exactly as it is and puts
  // the operator back in the composer to keep discussing it.
  onContinue: () => void;
};

function TranscriptMessage({
  message,
  proposals,
  fieldLabel,
  onDecide,
  onSelectChoice,
  onApply,
  onRevise,
  onContinue,
}: TranscriptMessageProps) {
  const t = useTranslations("agentChat");

  if (message.kind === "proposal") {
    const proposalId = message.data?.changeProposalId;
    const proposal =
      typeof proposalId === "string" ? proposals[proposalId] : undefined;
    if (proposal == null) {
      return <p className={styles.systemLine}>{t("loadingProposal")}</p>;
    }
    return (
      <ChangeApprovalCard
        proposal={proposal}
        fieldLabel={fieldLabel}
        onDecide={(itemId, approval) => onDecide(proposal.id, itemId, approval)}
        onSelectChoice={(itemId, optionId) =>
          onSelectChoice(proposal.id, itemId, optionId)
        }
        onApply={() => onApply(proposal.id)}
        onRevise={onRevise}
        onContinue={onContinue}
      />
    );
  }

  if (message.kind === "tool_activity") {
    return (
      <p className={styles.systemLine}>
        {t("toolActivity", { tool: message.text })}
      </p>
    );
  }

  if (message.kind === "notice") {
    return <p className={styles.systemLine}>{message.text}</p>;
  }

  return (
    <div className={styles.bubble} data-role={message.role}>
      <p className={styles.bubbleText}>{message.text}</p>
      {message.mentions.length > 0 && (
        <p className={styles.bubbleMentions}>
          {message.mentions
            .map((mention) => fieldLabel(mention.target.field))
            .join(" · ")}
        </p>
      )}
    </div>
  );
}
