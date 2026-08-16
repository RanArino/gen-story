"use client";

import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { setUserLanguagePreference } from "../lib/api-client";
import {
  DEFAULT_LANGUAGE,
  LANGUAGE_COOKIE,
  isLanguage,
  type Language,
} from "./config";

export function useLanguage(): {
  language: Language;
  setLanguage: (
    language: Language,
    agentRuntime?: "claude" | "codex" | "api",
  ) => Promise<void>;
} {
  const locale = useLocale();
  const router = useRouter();
  const language: Language = isLanguage(locale) ? locale : DEFAULT_LANGUAGE;

  const setLanguage = useCallback(
    async (next: Language, agentRuntime?: "claude" | "codex" | "api") => {
      await setUserLanguagePreference(next, agentRuntime);
      document.cookie = `${LANGUAGE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
      router.refresh();
    },
    [router],
  );

  return { language, setLanguage };
}
