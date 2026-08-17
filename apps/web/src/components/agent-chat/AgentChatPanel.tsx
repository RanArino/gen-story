"use client";

import type {
  AgentConversationDetailDto,
  AgentConversationDto,
  AgentConversationMessageDto,
  AgentConversationTurnDto,
  AgentProviderBindingDto,
  AiChatRuntimeDto,
  ChangeProposalDto,
  ChangeProposalItemDto,
  CreativeDirectionDto,
  SemanticMentionDto,
  SemanticTargetDto,
} from "@gen-story/shared";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DEFAULT_LANGUAGE, isLanguage } from "../../i18n/config";
import {
  ApiError,
  applyChangeProposal,
  cancelAgentChatTurn,
  createAgentConversation,
  decideChangeProposalItem,
  getAgentConversation,
  getAiRuntimeInfo,
  getChangeProposal,
  getCreativeDirection,
  listAgentConversations,
  postAgentChatTurn,
  selectChangeProposalChoice,
  setUserLanguagePreference,
  subscribeToProjectEvents,
  type ProjectEvent,
} from "../../lib/api-client";
import { ErrorAlert } from "../ErrorAlert";
import styles from "./AgentChatPanel.module.css";
import { ChangeApprovalCard } from "./ChangeApprovalCard";

type Props = { projectId: string };

const RUNTIME_OPTIONS = ["claude", "codex", "api"] as const;
type RuntimeOption = (typeof RUNTIME_OPTIONS)[number];

type MentionOption = {
  id: string;
  label: string;
  target: SemanticTargetDto;
};

// One expandable heading in the reference picker. Choosing the heading itself
// references every option under it.
type MentionGroup = {
  id: string;
  label: string;
  options: MentionOption[];
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : String(error);
}

export function AgentChatPanel({ projectId }: Props) {
  const t = useTranslations("agentChat");
  const locale = useLocale();
  const language = isLanguage(locale) ? locale : DEFAULT_LANGUAGE;
  const [detail, setDetail] = useState<AgentConversationDetailDto | null>(null);
  const [direction, setDirection] = useState<CreativeDirectionDto | null>(null);

  // Why the chat is off, if it is. Read once at load so the panel can say so
  // up front instead of looking usable and failing on Send.
  const [chatRuntime, setChatRuntime] = useState<AiChatRuntimeDto | null>(null);
  const [proposals, setProposals] = useState<Record<string, ChangeProposalDto>>(
    {},
  );
  const [draft, setDraft] = useState("");
  const [mentions, setMentions] = useState<SemanticMentionDto[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [changingRuntime, setChangingRuntime] = useState(false);
  // Every past conversation for this project, newest first — the session
  // switcher Codex and Claude Code both offer natively, so an operator can
  // reopen and continue something they started days ago instead of only
  // ever seeing the one conversation this panel happened to load.
  const [history, setHistory] = useState<AgentConversationDto[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const chatDisabled = chatRuntime != null && !chatRuntime.available;
  const conversationId = detail?.conversation.id ?? null;
  const activeTurn: AgentConversationTurnDto | null =
    detail?.turns.find((turn) => turn.status === "running") ?? null;
  const binding: AgentProviderBindingDto | null = detail?.binding ?? null;

  // What to show next to the spinner while a turn is running. The most
  // recent assistant text or tool call for this turn stands in for the
  // "thinking…" trace Codex and Claude Code print to their own terminals —
  // there is no separate reasoning channel here, but the same events already
  // land in the transcript as they stream, so the running row just points at
  // the latest one instead of sitting on a static "working…" label.
  const latestActivityText = useMemo(() => {
    if (activeTurn == null) return null;
    const turnMessages = (detail?.messages ?? []).filter(
      (message) =>
        message.turnId === activeTurn.id &&
        (message.kind === "tool_activity" || message.kind === "assistant_text"),
    );
    const last = turnMessages.at(-1);
    if (last == null) return null;
    return last.kind === "tool_activity"
      ? t("toolActivity", { tool: last.text })
      : last.text;
  }, [activeTurn, detail?.messages, t]);

  const isReferenced = useCallback(
    (target: SemanticTargetDto) =>
      mentions.some(
        (mention) =>
          mention.target.entityId === target.entityId &&
          mention.target.field === target.field,
      ),
    [mentions],
  );

  const fieldLabel = useCallback(
    (field: string) => {
      if (field === "photoAnalysis") return t("fields.photoAnalysis");
      if (field === "tone") return t("fields.tone");
      if (field === "stylePresetId") return t("fields.stylePreset");
      if (field === "commonPrompt") return t("fields.commonPrompt");
      if (field === "story") return t("fields.story");
      if (field === "negativePrompt") return t("fields.negativePrompt");
      if (field === "characterPolicy") return t("fields.characterPolicy");
      if (field === "scene") return t("fields.scene");
      return field;
    },
    [t],
  );

  // The picker offers exactly the fields that exist right now, with the
  // canonical target attached — so a translated label can never change which
  // field the message refers to.
  //
  // A scene is labelled by its storyboard position and title rather than the
  // bare field name, because "scene" repeated N times would be unusable.
  const mentionOptions: MentionOption[] = useMemo(() => {
    if (direction == null) return [];
    return direction.fields.map((field) => {
      const value = field.value as {
        orderIndex?: number;
        title?: string;
      } | null;
      const label =
        field.target.field === "scene"
          ? t("fields.sceneNumbered", {
              number: (value?.orderIndex ?? 0) + 1,
              title: value?.title?.trim() || t("untitledScene"),
            })
          : fieldLabel(field.target.field);
      return {
        id: `${field.target.entityType}:${field.target.entityId}#${field.target.field}`,
        label,
        target: field.target,
      };
    });
  }, [direction, fieldLabel, t]);

  // Three groups the operator already recognises from the storyboard screen,
  // rather than one flat list that grows with every scene. Picking a group
  // references everything inside it, so "review the story setup" is one click
  // and the proposal that comes back covers exactly those fields.
  const mentionGroups: MentionGroup[] = useMemo(() => {
    const byField = (field: string) =>
      mentionOptions.filter((option) => option.target.field === field);
    const groups: MentionGroup[] = [
      {
        id: "analysis",
        label: t("groups.analysis"),
        options: [
          ...byField("photoAnalysis"),
          ...byField("tone"),
          ...byField("stylePresetId"),
        ],
      },
      {
        id: "storySetup",
        label: t("groups.storySetup"),
        options: [
          ...byField("commonPrompt"),
          ...byField("story"),
          ...byField("negativePrompt"),
          ...byField("characterPolicy"),
        ],
      },
      {
        id: "scenes",
        label: t("groups.scenes"),
        options: byField("scene"),
      },
    ];
    return groups.filter((group) => group.options.length > 0);
  }, [mentionOptions, t]);

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

        setChatRuntime(runtime.chat);
        setDirection(creativeDirection);
        setHistory(conversations);

        const conversation =
          conversations[0] ?? (await createAgentConversation(projectId));
        if (cancelled) return;
        if (conversations[0] == null) setHistory([conversation]);
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

  // Starts a genuinely empty chat rather than rebinding the current one: the
  // earlier conversation is left intact in the project's history, but the
  // panel now shows a clean transcript, which is what "new session" says.
  // The new conversation has no binding yet, so its first turn binds to
  // whichever runtime is configured at that moment.
  async function startNewSession() {
    setError(null);
    try {
      const conversation = await createAgentConversation(projectId);
      setHistory((current) => [conversation, ...current]);
      setProposals({});
      setDraft("");
      setMentions([]);
      await loadConversation(conversation.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // Refetches on every open rather than trusting the in-memory list: a turn
  // just completed elsewhere (or by this same operator, earlier) touches
  // `updatedAt`, and the picker should reflect that without a page reload.
  async function openHistory() {
    setHistoryOpen((open) => !open);
    if (historyOpen) return;
    setHistoryLoading(true);
    try {
      setHistory(await listAgentConversations(projectId));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setHistoryLoading(false);
    }
  }

  async function selectConversation(id: string) {
    setHistoryOpen(false);
    if (id === conversationId) return;
    setError(null);
    setProposals({});
    setDraft("");
    setMentions([]);
    try {
      await loadConversation(id);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // Switches which runtime handles new turns. A conversation is bound to the
  // provider-native session it started, so one bound to the old provider would
  // reject every later turn with "bound to X, but the configured runtime is Y"
  // and leave the operator no way forward from the UI. Switching therefore
  // starts a new session, which is what changing provider means anyway.
  async function changeRuntime(next: RuntimeOption) {
    setProviderMenuOpen(false);
    if (chatRuntime != null && chatRuntime.runtime === next) return;
    setChangingRuntime(true);
    setError(null);
    try {
      await setUserLanguagePreference(language, next);
      const runtime = await getAiRuntimeInfo();
      setChatRuntime(runtime.chat);

      const staleBinding =
        binding != null && binding.provider !== runtime.chat.runtime;
      if (staleBinding) {
        await startNewSession();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setChangingRuntime(false);
    }
  }

  // Clicking a reference toggles it: a second click takes it back out, a third
  // puts it back. The draft text and the reference list are updated together,
  // so a label can never appear twice in the message while the list holds one
  // copy of it. A group toggles as a unit — all in, or all out.
  function toggleMentions(options: MentionOption[]) {
    if (options.length === 0) return;
    const removing = options.every((option) => isReferenced(option.target));
    const changing = removing
      ? options
      : options.filter((option) => !isReferenced(option.target));

    setDraft((current) => {
      let next = current;
      for (const option of changing) {
        next = removing
          ? next.split(option.label).join(" ")
          : `${next}${next.length === 0 || next.endsWith(" ") ? "" : " "}${option.label} `;
      }
      // Removing a label from mid-sentence leaves the gaps behind it.
      return removing ? `${next.replace(/[ \t]{2,}/g, " ").trimStart()}` : next;
    });

    setMentions((current) =>
      removing
        ? current.filter(
            (mention) =>
              !changing.some(
                (option) =>
                  option.target.entityId === mention.target.entityId &&
                  option.target.field === mention.target.field,
              ),
          )
        : [
            ...current,
            ...changing.map((option) => ({
              label: option.label,
              target: option.target,
            })),
          ],
    );
    // The picker stays open: toggling several references in a row is the
    // normal case, and reopening it for each one was pure friction.
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
          <div className={styles.providerCell}>
            <dt>{t("meta.provider")}</dt>
            <dd>
              <button
                type="button"
                className={styles.providerButton}
                aria-haspopup="listbox"
                aria-expanded={providerMenuOpen}
                disabled={
                  changingRuntime || chatRuntime == null || activeTurn != null
                }
                onClick={() => setProviderMenuOpen((open) => !open)}
              >
                {chatRuntime != null
                  ? t(`meta.providers.${chatRuntime.runtime}`)
                  : t("meta.none")}
              </button>
              {providerMenuOpen && (
                <ul
                  className={styles.providerList}
                  role="listbox"
                  aria-label={t("meta.provider")}
                >
                  {RUNTIME_OPTIONS.map((option) => (
                    <li key={option}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={chatRuntime?.runtime === option}
                        onClick={() => void changeRuntime(option)}
                      >
                        {t(`meta.providers.${option}`)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
          <div>
            <dt>{t("meta.model")}</dt>
            <dd>{binding?.model ?? t("meta.providerDefault")}</dd>
          </div>
          <div>
            <dt>{t("meta.wallet")}</dt>
            {/* On a CLI runtime the turn is paid for by the operator's
                existing subscription, not by an API key. */}
            <dd>
              {chatRuntime != null && chatRuntime.runtime !== "api"
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
        </dl>
      </header>

      <div className={styles.sessionActions}>
        <button
          type="button"
          disabled={chatDisabled || activeTurn != null}
          onClick={() => void startNewSession()}
        >
          {t("actions.fork")}
        </button>
        <div className={styles.historyCell}>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={historyOpen}
            disabled={chatDisabled}
            onClick={() => void openHistory()}
          >
            {t("actions.history")}
          </button>
          {historyOpen && (
            <ul
              className={styles.historyList}
              role="listbox"
              aria-label={t("actions.history")}
            >
              {historyLoading && (
                <li className={styles.historyEmpty}>{t("history.loading")}</li>
              )}
              {!historyLoading && history.length === 0 && (
                <li className={styles.historyEmpty}>{t("history.empty")}</li>
              )}
              {!historyLoading &&
                history.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={item.id === conversationId}
                      data-selected={item.id === conversationId}
                      onClick={() => void selectConversation(item.id)}
                    >
                      <span className={styles.historyTitle}>
                        {item.title.trim().length > 0
                          ? item.title
                          : t("history.untitled")}
                      </span>
                      <span className={styles.historyMeta}>
                        {new Date(item.updatedAt).toLocaleString(locale)}
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>

      {chatRuntime != null && !chatRuntime.available && (
        <div className={styles.disabledNotice} role="status">
          <p className={styles.disabledTitle}>{t("disabled.title")}</p>
          <p className={styles.disabledReason}>{chatRuntime.reason}</p>
          <p className={styles.disabledHint}>{t("disabled.hint")}</p>
        </div>
      )}

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
          <span className={styles.spinner} aria-hidden="true" />
          <span className={styles.runningLabel}>
            {latestActivityText ?? t("running")}
          </span>
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
            <div className={styles.mentionList}>
              {mentionGroups.length === 0 && (
                <p className={styles.mentionEmpty}>{t("noMentionTargets")}</p>
              )}
              {mentionGroups.map((group) => {
                const expanded = expandedGroups.includes(group.id);
                const selectedCount = group.options.filter((option) =>
                  isReferenced(option.target),
                ).length;
                const allSelected = selectedCount === group.options.length;
                return (
                  <div key={group.id} className={styles.mentionGroup}>
                    <div className={styles.mentionGroupHeader}>
                      {/* Choosing the group is the whole point of grouping, so
                          it is the primary action; the caret only expands. */}
                      <button
                        type="button"
                        className={styles.mentionGroupSelect}
                        aria-pressed={allSelected}
                        data-selected={allSelected}
                        onClick={() => toggleMentions(group.options)}
                      >
                        <span
                          className={styles.mentionCheck}
                          aria-hidden="true"
                        >
                          {allSelected ? "✓" : ""}
                        </span>
                        {group.label}
                        <span className={styles.mentionGroupCount}>
                          {selectedCount > 0
                            ? `${selectedCount}/${group.options.length}`
                            : group.options.length}
                        </span>
                      </button>
                      <button
                        type="button"
                        className={styles.mentionGroupToggle}
                        aria-expanded={expanded}
                        aria-label={t("actions.expandGroup", {
                          group: group.label,
                        })}
                        onClick={() =>
                          setExpandedGroups((current) =>
                            current.includes(group.id)
                              ? current.filter((id) => id !== group.id)
                              : [...current, group.id],
                          )
                        }
                      >
                        {expanded ? "▾" : "▸"}
                      </button>
                    </div>
                    {expanded && (
                      <ul
                        className={styles.mentionSubList}
                        role="listbox"
                        aria-label={group.label}
                      >
                        {group.options.map((option) => {
                          const selected = isReferenced(option.target);
                          return (
                            <li key={option.id}>
                              <button
                                type="button"
                                role="option"
                                aria-selected={selected}
                                data-selected={selected}
                                onClick={() => toggleMentions([option])}
                              >
                                <span
                                  className={styles.mentionCheck}
                                  aria-hidden="true"
                                >
                                  {selected ? "✓" : ""}
                                </span>
                                {option.label}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {/* The chip is also the way out: clicking it removes the reference,
              the same toggle the picker performs. */}
          {mentions.map((mention) => (
            <button
              type="button"
              key={`${mention.target.entityId}#${mention.target.field}`}
              className={styles.mentionChip}
              aria-label={t("actions.removeMention", { field: mention.label })}
              onClick={() =>
                toggleMentions([
                  {
                    id: `${mention.target.entityType}:${mention.target.entityId}#${mention.target.field}`,
                    label: mention.label,
                    target: mention.target,
                  },
                ])
              }
            >
              {mention.label} ×
            </button>
          ))}
        </div>
        <label className={styles.srOnly} htmlFor="agent-chat-input">
          {t("inputLabel")}
        </label>
        <textarea
          id="agent-chat-input"
          ref={inputRef}
          disabled={chatDisabled}
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
            chatDisabled ||
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
