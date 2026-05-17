"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GenerationRequestDto, SceneDto } from "@gen-story/shared";
import {
  cancelGenerationRequest,
  createGenerationRequest,
  listGenerationRequests,
  listScenes,
  listStoryboards,
  retryGenerationRequest,
} from "../../lib/api-client";
import { AppShell } from "../AppShell";
import { ErrorAlert } from "../ErrorAlert";
import styles from "./GeneratePage.module.css";

type GenStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled"
  | "none";

type SceneProgress = {
  scene: SceneDto;
  latestRequest: GenerationRequestDto | null;
  status: GenStatus;
};

function latestRequest(
  requests: GenerationRequestDto[],
): GenerationRequestDto | null {
  if (requests.length === 0) return null;
  return requests.reduce((latest, r) =>
    new Date(r.createdAt) > new Date(latest.createdAt) ? r : latest,
  );
}

function getStatus(req: GenerationRequestDto | null): GenStatus {
  if (!req) return "none";
  return req.status as GenStatus;
}

function isActive(status: GenStatus) {
  return status === "queued" || status === "running";
}

function isTerminal(status: GenStatus) {
  return status === "succeeded" || status === "failed" || status === "canceled";
}

export function GeneratePage({ projectId }: { projectId: string }) {
  const [progress, setProgress] = useState<SceneProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, []);

  const pollAll = useCallback(
    async (scenes: SceneDto[]) => {
      const updated = await Promise.all(
        scenes.map(async (scene) => {
          const requests = await listGenerationRequests(scene.id);
          const req = latestRequest(requests);
          return { scene, latestRequest: req, status: getStatus(req) };
        }),
      );
      setProgress(updated);
      const allDone = updated.every(
        (p) => isTerminal(p.status) || p.status === "none",
      );
      if (allDone) stopPolling();
      return updated;
    },
    [stopPolling],
  );

  const loadAndPoll = useCallback(async () => {
    const storyboards = await listStoryboards(projectId);
    if (storyboards.length === 0) return;
    const sb = storyboards[0]!;
    const scenes = await listScenes(sb.id);
    if (scenes.length === 0) return;

    const initial = await pollAll(scenes);
    const hasActive = initial.some((p) => isActive(p.status));
    if (hasActive) {
      pollIntervalRef.current = setInterval(() => {
        pollAll(scenes).catch(() => stopPolling());
      }, 2000);
    }
  }, [projectId, pollAll, stopPolling]);

  useEffect(() => {
    loadAndPoll()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    return stopPolling;
  }, [loadAndPoll, stopPolling]);

  async function startGeneration() {
    setLaunching(true);
    setError(null);
    try {
      const scenes = progress.map((p) => p.scene);
      const scenesToQueue = progress.filter(
        (p) =>
          p.status === "none" ||
          p.status === "failed" ||
          p.status === "canceled",
      );

      for (const { scene } of scenesToQueue) {
        await createGenerationRequest(scene.id, {
          sceneId: scene.id,
          storyboardId: scene.storyboardId,
          projectId: scene.projectId,
        });
      }

      stopPolling();
      const updated = await pollAll(scenes);
      const hasActive = updated.some((p) => isActive(p.status));
      if (hasActive) {
        pollIntervalRef.current = setInterval(() => {
          pollAll(scenes).catch(() => stopPolling());
        }, 2000);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to start generation");
    } finally {
      setLaunching(false);
    }
  }

  async function retryScene(sceneProgress: SceneProgress) {
    if (!sceneProgress.latestRequest) return;
    setError(null);
    try {
      await retryGenerationRequest(sceneProgress.latestRequest.id);
      const scenes = progress.map((p) => p.scene);
      const updated = await pollAll(scenes);
      const hasActive = updated.some((p) => isActive(p.status));
      if (hasActive && !pollIntervalRef.current) {
        pollIntervalRef.current = setInterval(() => {
          pollAll(scenes).catch(() => stopPolling());
        }, 2000);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to retry");
    }
  }

  async function cancelScene(sceneProgress: SceneProgress) {
    if (!sceneProgress.latestRequest) return;
    setError(null);
    try {
      await cancelGenerationRequest(sceneProgress.latestRequest.id);
      const scenes = progress.map((p) => p.scene);
      await pollAll(scenes);
      setProgress((prev) =>
        prev.map((p) =>
          p.scene.id === sceneProgress.scene.id
            ? { ...p, status: "canceled" as GenStatus }
            : p,
        ),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to cancel");
    }
  }

  const succeeded = progress.filter((p) => p.status === "succeeded").length;
  const failed = progress.filter((p) => p.status === "failed").length;
  const total = progress.length;
  const allDone =
    total > 0 &&
    progress.every((p) => isTerminal(p.status) || p.status === "none");
  const anyActive = progress.some((p) => isActive(p.status));
  const noneStarted = progress.every((p) => p.status === "none");

  if (loading) {
    return (
      <AppShell projectId={projectId}>
        <p style={{ color: "#8898aa" }}>Loading…</p>
      </AppShell>
    );
  }

  if (progress.length === 0) {
    return (
      <AppShell projectId={projectId}>
        <div className="screen-header">
          <h2>Generate</h2>
        </div>
        <div className="card">
          <p>
            No scenes found. Please add scenes in the Storyboard step first.
          </p>
          <Link
            href={`/projects/${projectId}/storyboard`}
            className="btn btn-primary"
            style={{ marginTop: 12 }}
          >
            Go to Storyboard →
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell projectId={projectId}>
      <div className="screen-header">
        <h2>Generate</h2>
        <p>Generate AI images for each scene in your storyboard.</p>
      </div>

      {error && <ErrorAlert message={error} />}

      {/* Progress summary */}
      <div className={`card ${styles.progressCard}`}>
        <div className={styles.progressHeader}>
          <div>
            <span className={styles.progressCount}>
              {succeeded} / {total} completed
            </span>
            {failed > 0 && (
              <span className={styles.failedCount}>{failed} failed</span>
            )}
          </div>
          {anyActive && <div className={styles.spinner} title="Generating…" />}
        </div>
        {total > 0 && (
          <div className={styles.progressBar}>
            <div
              className={styles.progressFill}
              style={{ width: `${(succeeded / total) * 100}%` }}
            />
          </div>
        )}
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        {(noneStarted || progress.some((p) => p.status === "failed")) && (
          <button
            className="btn btn-primary"
            onClick={startGeneration}
            disabled={launching || anyActive}
          >
            {launching
              ? "Starting…"
              : noneStarted
                ? "Start generation"
                : "Retry failed scenes"}
          </button>
        )}
        {allDone && succeeded > 0 && (
          <Link
            href={`/projects/${projectId}/review`}
            className="btn btn-primary"
          >
            Review images →
          </Link>
        )}
      </div>

      {/* Per-scene list */}
      <div className={styles.sceneList}>
        {progress.map((p) => (
          <div key={p.scene.id} className={`card ${styles.sceneRow}`}>
            <div className={styles.sceneInfo}>
              <span className={styles.sceneName}>{p.scene.title}</span>
              {p.latestRequest?.errorMessage && (
                <span className={styles.errorReason}>
                  {p.latestRequest.errorMessage}
                </span>
              )}
            </div>
            <div className={styles.sceneRight}>
              <StatusBadge status={p.status} />
              {p.status === "failed" && (
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  onClick={() => retryScene(p)}
                >
                  Retry
                </button>
              )}
              {(p.status === "queued" || p.status === "running") && (
                <button
                  className="btn btn-secondary"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  onClick={() => cancelScene(p)}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}

function StatusBadge({ status }: { status: GenStatus }) {
  const label: Record<GenStatus, string> = {
    none: "Not started",
    queued: "Waiting",
    running: "Generating…",
    succeeded: "Done",
    failed: "Failed",
    canceled: "Canceled",
  };
  return (
    <span className={`${styles.badge} ${styles[`badge_${status}`]}`}>
      {label[status]}
    </span>
  );
}
