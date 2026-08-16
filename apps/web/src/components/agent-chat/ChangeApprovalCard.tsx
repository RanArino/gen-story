"use client";

import type {
  ChangeProposalDto,
  ChangeProposalItemDto,
} from "@gen-story/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";

import styles from "./AgentChatPanel.module.css";

type Props = {
  proposal: ChangeProposalDto;
  fieldLabel: (field: string) => string;
  onDecide: (
    itemId: string,
    approval: "approved" | "rejected",
  ) => Promise<void>;
  onSelectChoice: (itemId: string, optionId: string) => Promise<void>;
  onApply: () => Promise<void>;
  onRevise: (item: ChangeProposalItemDto) => void;
  onContinue: () => void;
};

// Values are field-shaped, not string-shaped: tone is a sentence, style preset
// an ID, photo analysis a nested object. Rendering the object as indented JSON
// is honest about that instead of flattening it into an unreadable line.
function formatValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function ChangeApprovalCard({
  proposal,
  fieldLabel,
  onDecide,
  onSelectChoice,
  onApply,
  onRevise,
  onContinue,
}: Props) {
  const t = useTranslations("agentChat.approval");
  const [busy, setBusy] = useState(false);

  const approvedCount = proposal.items.filter(
    (item) => item.approval === "approved",
  ).length;
  const applied = proposal.status === "applied";
  const conflicted = proposal.status === "conflicted";

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={styles.approvalCard}
      aria-label={t("cardLabel")}
      data-status={proposal.status}
    >
      <header className={styles.approvalHeader}>
        <h3 className={styles.approvalTitle}>{t("title")}</h3>
        <span className={styles.statusPill} data-status={proposal.status}>
          {t(`status.${proposal.status}`)}
        </span>
      </header>
      <p className={styles.approvalRationale}>{proposal.rationale}</p>

      {conflicted && (
        <p className={styles.conflictNotice} role="status">
          {t("conflict")}
        </p>
      )}

      <ul className={styles.itemList}>
        {proposal.items.map((item) => {
          const choice = proposal.choices.find(
            (candidate) => candidate.targetItemId === item.id,
          );
          return (
            <li key={item.id} className={styles.item}>
              <div className={styles.itemHeader}>
                <span className={styles.fieldName}>
                  {fieldLabel(item.target.field)}
                </span>
                <span
                  className={styles.itemApproval}
                  data-approval={item.approval}
                >
                  {t(`itemApproval.${item.approval}`)}
                </span>
              </div>

              <div className={styles.diff}>
                <div className={styles.diffSide}>
                  <span className={styles.diffLabel}>{t("before")}</span>
                  <pre className={styles.diffValue}>
                    {formatValue(item.before)}
                  </pre>
                </div>
                <div className={styles.diffSide}>
                  <span className={styles.diffLabel}>{t("after")}</span>
                  <pre className={styles.diffValue} data-after="true">
                    {formatValue(item.after)}
                  </pre>
                </div>
              </div>

              <p className={styles.itemRationale}>{item.rationale}</p>

              {choice != null && (
                <div
                  className={styles.choices}
                  role="radiogroup"
                  aria-label={t("choiceLabel")}
                >
                  {choice.options.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={choice.selectedOptionId === option.id}
                      className={styles.choiceOption}
                      data-selected={choice.selectedOptionId === option.id}
                      disabled={busy || applied}
                      onClick={() =>
                        void run(() => onSelectChoice(item.id, option.id))
                      }
                    >
                      <span className={styles.choiceOptionLabel}>
                        {option.label}
                      </span>
                      <span className={styles.choiceOptionMeta}>
                        {t("reason")}: {option.reason}
                      </span>
                      <span className={styles.choiceOptionMeta}>
                        {t("impact")}: {option.impact}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {!applied && (
                <div className={styles.itemActions}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(() => onDecide(item.id, "approved"))
                    }
                  >
                    {t("approveItem")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(() => onDecide(item.id, "rejected"))
                    }
                  >
                    {t("rejectItem")}
                  </button>
                  <button type="button" onClick={() => onRevise(item)}>
                    {t("revise")}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <footer className={styles.approvalFooter}>
        <button
          type="button"
          className={styles.primaryButton}
          disabled={busy || applied || approvedCount === 0}
          onClick={() => void run(onApply)}
        >
          {t("apply", { count: approvedCount })}
        </button>
        <button type="button" onClick={onContinue} disabled={busy}>
          {t("continue")}
        </button>
      </footer>
      {!applied && (
        <p className={styles.approvalHint}>{t("nothingChangesYet")}</p>
      )}
    </section>
  );
}
