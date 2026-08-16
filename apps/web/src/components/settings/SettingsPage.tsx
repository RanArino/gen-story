"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { SUPPORTED_LANGUAGES, type Language } from "../../i18n/config";
import { useLanguage } from "../../i18n/use-language";
import { getUserLanguagePreference } from "../../lib/api-client";
import { AppShell } from "../AppShell";
import { ErrorAlert } from "../ErrorAlert";
import styles from "./SettingsPage.module.css";

export function SettingsPage() {
  const t = useTranslations("settings");
  const { language, setLanguage } = useLanguage();
  const [selected, setSelected] = useState<Language>(language);
  const [agentRuntime, setAgentRuntime] = useState<"claude" | "codex" | "api">("claude");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getUserLanguagePreference()
      .then((preference) => setAgentRuntime(preference.agentRuntime))
      .catch(() => undefined);
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await setLanguage(selected, agentRuntime);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell>
      <div className="screen-header">
        <h2>{t("title")}</h2>
        <p>{t("subtitle")}</p>
      </div>

      {error && <ErrorAlert message={error} />}

      <div className={styles.form}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="language-select">
            {t("languageLabel")}
          </label>
          <select
            id="language-select"
            className={styles.select}
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value as Language);
              setSaved(false);
            }}
          >
            {SUPPORTED_LANGUAGES.map((lng) => (
              <option key={lng} value={lng}>
                {t(`language.${lng}`)}
              </option>
            ))}
          </select>
          <p className={styles.help}>{t("languageHelp")}</p>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="agent-runtime-select">
            {t("agentRuntimeLabel")}
          </label>
          <select
            id="agent-runtime-select"
            className={styles.select}
            value={agentRuntime}
            onChange={(e) => {
              setAgentRuntime(e.target.value as "claude" | "codex" | "api");
              setSaved(false);
            }}
          >
            <option value="claude">{t("agentRuntime.claude")}</option>
            <option value="codex">{t("agentRuntime.codex")}</option>
            <option value="api">{t("agentRuntime.api")}</option>
          </select>
          <p className={styles.help}>{t("agentRuntimeHelp")}</p>
        </div>

        <div className={styles.actions}>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? t("saving") : t("save")}
          </button>
          {saved && <span className={styles.saved}>{t("saved")}</span>}
        </div>
      </div>
    </AppShell>
  );
}
