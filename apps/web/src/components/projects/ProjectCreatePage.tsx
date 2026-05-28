"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { createProject } from "../../lib/api-client";
import { AppShell } from "../AppShell";
import { ErrorAlert } from "../ErrorAlert";
import styles from "./ProjectCreatePage.module.css";

const OCCASIONS = [
  { value: "", labelKey: "general" },
  { value: "anniversary", labelKey: "anniversary" },
  { value: "graduation", labelKey: "graduation" },
  { value: "birthday", labelKey: "birthday" },
  { value: "travel", labelKey: "travel" },
  { value: "wedding", labelKey: "wedding" },
  { value: "other", labelKey: "other" },
] as const;

export function ProjectCreatePage() {
  const router = useRouter();
  const t = useTranslations("projects");
  const tCommon = useTranslations("common");
  const [name, setName] = useState("");
  const [occasion, setOccasion] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const project = await createProject(name.trim(), occasion || undefined);
      router.push(`/projects/${project.id}/photos`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("createFailed"));
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="screen-header">
        <h2>{t("createTitle")}</h2>
        <p>{t("createSubtitle")}</p>
      </div>

      <form onSubmit={handleSubmit} className={`card ${styles.form}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="proj-name">
            {t("nameLabel")}
          </label>
          <input
            id="proj-name"
            className={styles.input}
            type="text"
            placeholder={t("namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="proj-occasion">
            {t("occasionLabel")}
          </label>
          <select
            id="proj-occasion"
            className={styles.input}
            value={occasion}
            onChange={(e) => setOccasion(e.target.value)}
          >
            {OCCASIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {t(`occasions.${o.labelKey}`)}
              </option>
            ))}
          </select>
        </div>

        {error && <ErrorAlert message={error} />}

        <div className={styles.actions}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => router.push("/projects")}
          >
            {tCommon("cancel")}
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || !name.trim()}
          >
            {submitting ? t("creating") : t("createButton")}
          </button>
        </div>
      </form>
    </AppShell>
  );
}
