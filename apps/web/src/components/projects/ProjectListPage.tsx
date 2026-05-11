"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ProjectDto } from "@gen-story/shared";
import { deleteProject, listProjects, restoreProject } from "../../lib/api-client";
import { AppShell } from "../AppShell";
import { ErrorAlert } from "../ErrorAlert";
import styles from "./ProjectListPage.module.css";

export function ProjectListPage() {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listProjects(true)
      .then(setProjects)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleDelete(projectId: string) {
    try {
      await deleteProject(projectId);
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function handleRestore(projectId: string) {
    try {
      await restoreProject(projectId);
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Restore failed");
    }
  }

  const activeProjects = projects.filter((p) => p.deletedAt === null);
  const deletedProjects = projects.filter((p) => p.deletedAt !== null);

  return (
    <AppShell>
      <div className="screen-header">
        <h2>Projects</h2>
        <p>Your story projects</p>
      </div>

      <div className={styles.toolbar}>
        <Link href="/projects/new" className="btn btn-primary">
          + New project
        </Link>
      </div>

      {loading && <p className={styles.hint}>Loading…</p>}
      {error && <ErrorAlert message={error} onRetry={load} />}

      {!loading && activeProjects.length === 0 && deletedProjects.length === 0 && (
        <div className={`card ${styles.empty}`}>
          <p>No projects yet. Create your first project to get started.</p>
          <Link href="/projects/new" className="btn btn-primary">
            + New project
          </Link>
        </div>
      )}

      <div className={styles.grid}>
        {activeProjects.map((p) => (
          <div key={p.id} className={`card ${styles.projectCard}`}>
            <Link href={`/projects/${p.id}/photos`} className={styles.cardLink}>
              <div className={styles.cardHeader}>
                <h3>{p.name}</h3>
                <span className={`${styles.badge} ${styles[`status_${p.status}`] ?? styles.badge}`}>
                  {p.status}
                </span>
              </div>
              <p className={styles.meta}>
                Updated {new Date(p.updatedAt).toLocaleDateString()}
              </p>
            </Link>
            <button
              className={styles.deleteBtn}
              onClick={() => handleDelete(p.id)}
              title="Delete project"
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      {deletedProjects.length > 0 && (
        <section className={styles.deletedSection}>
          <h3 className={styles.deletedTitle}>Recently deleted</h3>
          <p className={styles.deletedHint}>Deleted projects are kept for 7 days.</p>
          <div className={styles.grid}>
            {deletedProjects.map((p) => (
              <div key={p.id} className={`card ${styles.projectCard} ${styles.projectCardDeleted}`}>
                <div className={styles.cardHeader}>
                  <h3>{p.name}</h3>
                </div>
                <p className={styles.meta}>
                  Deleted {new Date(p.deletedAt!).toLocaleDateString()}
                </p>
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: "4px 10px", marginTop: 4 }}
                  onClick={() => handleRestore(p.id)}
                >
                  Restore
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </AppShell>
  );
}
