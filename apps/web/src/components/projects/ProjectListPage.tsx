"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ProjectDto } from "@gen-story/shared";
import { listProjects } from "../../lib/api-client";
import { AppShell } from "../AppShell";
import styles from "./ProjectListPage.module.css";

export function ProjectListPage() {
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listProjects()
      .then(setProjects)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

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
      {error && <p className="error-msg">{error}</p>}

      {!loading && projects.length === 0 && (
        <div className={`card ${styles.empty}`}>
          <p>No projects yet. Create your first project to get started.</p>
          <Link href="/projects/new" className="btn btn-primary">
            + New project
          </Link>
        </div>
      )}

      <div className={styles.grid}>
        {projects.map((p) => (
          <Link
            key={p.id}
            href={`/projects/${p.id}/photos`}
            className={`card ${styles.projectCard}`}
          >
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
        ))}
      </div>
    </AppShell>
  );
}
