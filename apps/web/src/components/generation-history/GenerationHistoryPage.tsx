"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { GenerationRequestWithSceneTitleDto } from "@gen-story/shared";
import { listStoryboardGenerationRequests, listStoryboards } from "../../lib/api-client";
import { AppShell } from "../AppShell";
import { ErrorAlert } from "../ErrorAlert";
import styles from "./GenerationHistoryPage.module.css";

type SceneGroup = {
  sceneId: string;
  sceneTitle: string | null;
  requests: GenerationRequestWithSceneTitleDto[];
};

export function GenerationHistoryPage({ projectId }: { projectId: string }) {
  const [groups, setGroups] = useState<SceneGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storyboardId, setStoryboardId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const storyboards = await listStoryboards(projectId);
    if (storyboards.length === 0) return;
    const sb = storyboards[0]!;
    setStoryboardId(sb.id);

    const requests = await listStoryboardGenerationRequests(sb.id);

    const groupMap = new Map<string, SceneGroup>();
    for (const req of requests) {
      let group = groupMap.get(req.sceneId);
      if (!group) {
        group = { sceneId: req.sceneId, sceneTitle: req.sceneTitle, requests: [] };
        groupMap.set(req.sceneId, group);
      }
      group.requests.push(req);
    }

    setGroups([...groupMap.values()]);
  }, [projectId]);

  useEffect(() => {
    load()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [load]);

  if (loading) {
    return (
      <AppShell projectId={projectId}>
        <p style={{ color: "#8898aa" }}>Loading…</p>
      </AppShell>
    );
  }

  const total = groups.reduce((sum, g) => sum + g.requests.length, 0);

  return (
    <AppShell projectId={projectId}>
      <div className="screen-header">
        <h2>Generation History</h2>
        <p>All generation requests for this project, grouped by scene.</p>
      </div>

      {error && <ErrorAlert message={error} />}

      <div className={styles.toolbar}>
        <Link
          href={`/projects/${projectId}/review`}
          className="btn btn-secondary"
        >
          ← Back to Review
        </Link>
        <span className={styles.total}>{total} request{total !== 1 ? "s" : ""}</span>
      </div>

      {groups.length === 0 && (
        <div className="card">
          <p>No generation requests yet.</p>
          <Link
            href={`/projects/${projectId}/generate`}
            className="btn btn-primary"
            style={{ marginTop: 12 }}
          >
            Go to Generate →
          </Link>
        </div>
      )}

      <div className={styles.groups}>
        {groups.map((group) => (
          <div key={group.sceneId} className="card">
            <h3 className={styles.sceneTitle}>
              {group.sceneTitle || "Untitled scene"}
            </h3>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Completed</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {group.requests.map((req) => (
                  <tr key={req.id}>
                    <td>
                      <StatusChip status={req.status} />
                    </td>
                    <td className={styles.timestamp}>
                      {formatTimestamp(req.createdAt)}
                    </td>
                    <td className={styles.timestamp}>
                      {req.completedAt ? formatTimestamp(req.completedAt) : "—"}
                    </td>
                    <td className={styles.errorCell}>
                      {req.errorMessage ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {storyboardId && (
        <div className={styles.footer}>
          <Link
            href={`/projects/${projectId}/storyboard`}
            className="btn btn-secondary"
          >
            Edit Storyboard
          </Link>
          <Link
            href={`/projects/${projectId}/generate`}
            className="btn btn-primary"
          >
            Generate →
          </Link>
        </div>
      )}
    </AppShell>
  );
}

function StatusChip({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    succeeded: "#166534",
    failed: "#b91c1c",
    running: "#1e40af",
    queued: "#854d0e",
    canceled: "#6b7280",
  };
  const bgMap: Record<string, string> = {
    succeeded: "#dcfce7",
    failed: "#fee2e2",
    running: "#dbeafe",
    queued: "#fef9c3",
    canceled: "#f3f4f6",
  };
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 600,
        background: bgMap[status] ?? "#e5e9f0",
        color: colorMap[status] ?? "#4a5568",
      }}
    >
      {status}
    </span>
  );
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
