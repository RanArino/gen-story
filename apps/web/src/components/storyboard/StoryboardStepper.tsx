"use client";

import { useTranslations } from "next-intl";
import type { StoryboardSetupStepDto } from "@gen-story/shared";

import styles from "./StoryboardStepper.module.css";

// The five steps in the order they must be completed. The server derives which
// one is current; this list only decides how they are drawn.
export const SETUP_STEP_ORDER = [
  "photos",
  "tone",
  "style",
  "story",
  "scenes",
] as const;

export type SetupStep = (typeof SETUP_STEP_ORDER)[number];

export function stepIndex(step: StoryboardSetupStepDto): number {
  // "complete" sits past the last step, so every step compares as done.
  return step === "complete"
    ? SETUP_STEP_ORDER.length
    : SETUP_STEP_ORDER.indexOf(step);
}

export type StepState = "done" | "current" | "locked";

export function stepState(
  step: SetupStep,
  currentStep: StoryboardSetupStepDto,
): StepState {
  const current = stepIndex(currentStep);
  const index = SETUP_STEP_ORDER.indexOf(step);
  if (index < current) return "done";
  if (index === current) return "current";
  return "locked";
}

export function StoryboardStepper({
  currentStep,
}: {
  currentStep: StoryboardSetupStepDto;
}) {
  const t = useTranslations("storyboard.setup");
  const current = stepIndex(currentStep);
  const completedCount = Math.min(current, SETUP_STEP_ORDER.length);
  const progressPercent = (completedCount / SETUP_STEP_ORDER.length) * 100;

  return (
    <section className={styles.stepper} aria-label={t("progressLabel")}>
      <div className={styles.header}>
        <h3 className={styles.title}>{t("title")}</h3>
        <span className={styles.count}>
          {t("progressCount", {
            done: completedCount,
            total: SETUP_STEP_ORDER.length,
          })}
        </span>
      </div>

      <div
        className={styles.track}
        role="progressbar"
        aria-valuenow={completedCount}
        aria-valuemin={0}
        aria-valuemax={SETUP_STEP_ORDER.length}
      >
        <div className={styles.fill} style={{ width: `${progressPercent}%` }} />
      </div>

      <ol className={styles.steps}>
        {SETUP_STEP_ORDER.map((step, index) => {
          const state = stepState(step, currentStep);
          return (
            <li
              key={step}
              className={`${styles.step} ${styles[state]}`}
              aria-current={state === "current" ? "step" : undefined}
            >
              <span className={styles.marker} aria-hidden>
                {state === "done" ? "✓" : index + 1}
              </span>
              <span className={styles.stepText}>
                <strong className={styles.stepTitle}>
                  {t(`steps.${step}.title`)}
                </strong>
                <span className={styles.stepHint}>
                  {state === "locked"
                    ? t(`steps.${step}.locked`)
                    : t(`steps.${step}.hint`)}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
