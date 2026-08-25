"use client";

import type {
  ChangeProposalDto,
  ChangeProposalItemDto,
} from "@gen-story/shared";
import { useTranslations } from "next-intl";
import { useState } from "react";

import styles from "./AgentChatPanel.module.css";
import { diffLines, humanizeKey, isPlainObject } from "./diff-utils";

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

type ViewMode = "preview" | "raw";

// Values are field-shaped, not string-shaped: tone is a sentence, style preset
// an ID, photo analysis a nested object. This formats a single scalar leaf —
// object values are broken apart per key before reaching here.
function formatScalar(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

// The Preview view for one item: strings and other scalars stay a plain
// before/after pair, but an object value (a scene, photo analysis) is broken
// into its keys so the operator sees exactly what changed instead of two
// slabs of JSON they have to eyeball-diff themselves. Keys whose value is
// identical are named but not spelled out — they're not what changed.
function PreviewDiff({
  before,
  after,
  t,
}: {
  before: unknown;
  after: unknown;
  t: ReturnType<typeof useTranslations>;
}) {
  if (!isPlainObject(before) && !isPlainObject(after)) {
    return (
      <div className={styles.diff}>
        <div className={styles.diffSide}>
          <span className={styles.diffLabel}>{t("before")}</span>
          <pre className={styles.diffValue}>{formatScalar(before)}</pre>
        </div>
        <div className={styles.diffSide}>
          <span className={styles.diffLabel}>{t("after")}</span>
          <pre className={styles.diffValue} data-after="true">
            {formatScalar(after)}
          </pre>
        </div>
      </div>
    );
  }

  const beforeObject = isPlainObject(before) ? before : {};
  const afterObject = isPlainObject(after) ? after : {};
  const keys = Array.from(
    new Set([...Object.keys(beforeObject), ...Object.keys(afterObject)]),
  );
  const changedKeys = keys.filter(
    (key) =>
      JSON.stringify(beforeObject[key]) !== JSON.stringify(afterObject[key]),
  );
  const unchangedKeys = keys.filter((key) => !changedKeys.includes(key));

  return (
    <div className={styles.previewFields}>
      {changedKeys.map((key) => (
        <div key={key} className={styles.previewField}>
          <span className={styles.previewFieldLabel}>{humanizeKey(key)}</span>
          <div className={styles.diff}>
            <div className={styles.diffSide}>
              <span className={styles.diffLabel}>{t("before")}</span>
              <pre className={styles.diffValue}>
                {formatScalar(beforeObject[key])}
              </pre>
            </div>
            <div className={styles.diffSide}>
              <span className={styles.diffLabel}>{t("after")}</span>
              <pre className={styles.diffValue} data-after="true">
                {formatScalar(afterObject[key])}
              </pre>
            </div>
          </div>
        </div>
      ))}
      {unchangedKeys.length > 0 && (
        <p className={styles.previewUnchanged}>
          {t("unchangedFields", {
            count: unchangedKeys.length,
            fields: unchangedKeys.map(humanizeKey).join(t("listSeparator")),
          })}
        </p>
      )}
    </div>
  );
}

// The Raw view: a single git-diff-style listing of the before/after JSON, so
// an operator who wants the literal payload can read it the way they'd read
// a code review instead of comparing two independent panes by eye.
function RawDiff({ before, after }: { before: unknown; after: unknown }) {
  const beforeText = before == null ? "" : JSON.stringify(before, null, 2);
  const afterText = after == null ? "" : JSON.stringify(after, null, 2);
  const lines = diffLines(beforeText, afterText);
  return (
    <pre className={styles.rawDiff}>
      {lines.map((line, index) => (
        <div key={index} className={styles.rawDiffLine} data-type={line.type}>
          <span className={styles.rawDiffMarker} aria-hidden="true">
            {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}
          </span>
          {line.text}
        </div>
      ))}
    </pre>
  );
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
  const [viewMode, setViewMode] = useState<ViewMode>("preview");

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

      <div
        className={styles.viewToggle}
        role="tablist"
        aria-label={t("viewMode")}
      >
        {(["preview", "raw"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            role="tab"
            aria-selected={viewMode === mode}
            data-selected={viewMode === mode}
            onClick={() => setViewMode(mode)}
          >
            {t(`view.${mode}`)}
          </button>
        ))}
      </div>

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

              {viewMode === "preview" ? (
                <PreviewDiff before={item.before} after={item.after} t={t} />
              ) : (
                <RawDiff before={item.before} after={item.after} />
              )}

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
