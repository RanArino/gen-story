"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createProject } from "../../lib/api-client";
import { AppShell } from "../AppShell";
import { ErrorAlert } from "../ErrorAlert";
import styles from "./ProjectCreatePage.module.css";

const OCCASIONS = [
  { value: "", label: "None / General" },
  { value: "anniversary", label: "Anniversary" },
  { value: "graduation", label: "Graduation" },
  { value: "birthday", label: "Birthday" },
  { value: "travel", label: "Travel" },
  { value: "wedding", label: "Wedding" },
  { value: "other", label: "Other" },
] as const;

export function ProjectCreatePage() {
  const router = useRouter();
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
      setError(err instanceof Error ? err.message : "Failed to create project");
      setSubmitting(false);
    }
  }

  return (
    <AppShell>
      <div className="screen-header">
        <h2>New project</h2>
        <p>Give your story project a name and occasion</p>
      </div>

      <form onSubmit={handleSubmit} className={`card ${styles.form}`}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="proj-name">
            Project name
          </label>
          <input
            id="proj-name"
            className={styles.input}
            type="text"
            placeholder="e.g. Family reunion 2025"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="proj-occasion">
            Occasion (optional)
          </label>
          <select
            id="proj-occasion"
            className={styles.input}
            value={occasion}
            onChange={(e) => setOccasion(e.target.value)}
          >
            {OCCASIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
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
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting || !name.trim()}
          >
            {submitting ? "Creating…" : "Create project"}
          </button>
        </div>
      </form>
    </AppShell>
  );
}
