"use client";

import { useTranslations } from "next-intl";
import { ApiError } from "../lib/api-client";
import styles from "./ErrorAlert.module.css";

const ERROR_CODE_KEYS = new Set([
  "validation_error",
  "not_found",
  "conflict",
  "invalid_state",
]);

export function ErrorAlert({
  message,
  code,
  onRetry,
}: {
  message: string;
  code?: string;
  onRetry?: () => void;
}) {
  const tErrors = useTranslations("errors");
  const tCommon = useTranslations("common");

  const codeKey = code && ERROR_CODE_KEYS.has(code) ? code : null;
  const display = codeKey ? tErrors(codeKey) : message;

  return (
    <div className={styles.alert} role="alert">
      <span className={styles.message}>{display}</span>
      {onRetry && (
        <button className={styles.retryBtn} onClick={onRetry}>
          {tCommon("retry")}
        </button>
      )}
    </div>
  );
}

export function errorMessageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}
