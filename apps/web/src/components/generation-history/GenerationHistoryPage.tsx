"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import type {
  GenerationRequestWithSceneTitleDto,
  TestGenerationBatchWithVariantsDto,
} from "@gen-story/shared";
import {
  listStoryboardGenerationRequests,
  listStoryboards,
  listTestGenerationBatches,
} from "../../lib/api-client";
import { storageKeyToUrl } from "../../lib/image-url";
import { AppShell } from "../AppShell";
import { ErrorAlert } from "../ErrorAlert";
import styles from "./GenerationHistoryPage.module.css";

type SceneGroup = {
  sceneId: string;
  sceneTitle: string | null;
  requests: GenerationRequestWithSceneTitleDto[];
};

export function GenerationHistoryPage({ projectId }: { projectId: string }) {
  const t = useTranslations("generationHistory");
  const tCommon = useTranslations("common");
  const [groups, setGroups] = useState<SceneGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storyboardId, setStoryboardId] = useState<string | null>(null);
  const [testBatches, setTestBatches] = useState<
    TestGenerationBatchWithVariantsDto[]
  >([]);

  const load = useCallback(async () => {
    const storyboards = await listStoryboards(projectId);
    if (storyboards.length === 0) return;
    const sb = storyboards[0]!;
    setStoryboardId(sb.id);

    const [requests, batches] = await Promise.all([
      listStoryboardGenerationRequests(sb.id),
      listTestGenerationBatches(sb.id),
    ]);
    setTestBatches(batches);

    const groupMap = new Map<string, SceneGroup>();
    for (const req of requests) {
      let group = groupMap.get(req.sceneId);
      if (!group) {
        group = {
          sceneId: req.sceneId,
          sceneTitle: req.sceneTitle,
          requests: [],
        };
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
        <p style={{ color: "#8898aa" }}>{tCommon("loading")}</p>
      </AppShell>
    );
  }

  const total = groups.reduce((sum, g) => sum + g.requests.length, 0);

  return (
    <AppShell projectId={projectId}>
      <div className="screen-header">
        <h2>{t("title")}</h2>
        <p>{t("subtitle")}</p>
      </div>

      {error && <ErrorAlert message={error} />}

      <div className={styles.toolbar}>
        <Link
          href={`/projects/${projectId}/review`}
          className="btn btn-secondary"
        >
          {t("backToReview")}
        </Link>
        <span className={styles.total}>
          {t(total === 1 ? "totalRequest" : "totalRequests", { count: total })}
        </span>
      </div>

      {testBatches.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 className={styles.sceneTitle}>
            {t("testGeneration.heading", { count: testBatches.length })}
          </h3>
          <div style={{ display: "grid", gap: 16 }}>
            {testBatches.map((entry, index) => (
              <div key={entry.batch.id}>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    alignItems: "baseline",
                    marginBottom: 8,
                    fontSize: 13,
                    color: "#8898aa",
                  }}
                >
                  <strong style={{ color: "inherit" }}>
                    {t("testGeneration.runLabel", {
                      number: testBatches.length - index,
                    })}
                  </strong>
                  <span>{formatTimestamp(entry.batch.createdAt)}</span>
                  <span>
                    {entry.batch.status === "completed"
                      ? t("testGeneration.confirmed")
                      : t("testGeneration.notConfirmed")}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {entry.variants.map((variant) => {
                    const isConfirmed =
                      entry.batch.confirmedGenerationRequestId ===
                      variant.request.id;
                    return (
                      <div
                        key={variant.request.id}
                        style={{
                          width: 96,
                          height: 96,
                          borderRadius: 6,
                          overflow: "hidden",
                          border: isConfirmed
                            ? "2px solid #4caf50"
                            : "1px solid #d8dee9",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "#f5f6f8",
                          fontSize: 12,
                          color: "#8898aa",
                        }}
                        title={
                          isConfirmed
                            ? t("testGeneration.confirmed")
                            : variant.request.status
                        }
                      >
                        {variant.generatedImage ? (
                          <img
                            src={storageKeyToUrl(
                              variant.generatedImage.storageKey,
                            )}
                            alt={t("testGeneration.sampleAlt")}
                            style={{
                              width: "100%",
                              height: "100%",
                              objectFit: "cover",
                            }}
                          />
                        ) : (
                          variant.request.status
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <Link
            href={`/projects/${projectId}/storyboard`}
            className="btn btn-secondary"
            style={{ marginTop: 12 }}
          >
            {t("testGeneration.openStoryboard")}
          </Link>
        </div>
      )}

      {groups.length === 0 && (
        <div className="card">
          <p>{t("noRequests")}</p>
          <Link
            href={`/projects/${projectId}/generate`}
            className="btn btn-primary"
            style={{ marginTop: 12 }}
          >
            {t("goToGenerate")}
          </Link>
        </div>
      )}

      <div className={styles.groups}>
        {groups.map((group) => (
          <div key={group.sceneId} className="card">
            <h3 className={styles.sceneTitle}>
              {group.sceneTitle || t("untitledScene")}
            </h3>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("tableHeaders.status")}</th>
                  <th>{t("tableHeaders.created")}</th>
                  <th>{t("tableHeaders.completed")}</th>
                  <th>{t("tableHeaders.error")}</th>
                </tr>
              </thead>
              <tbody>
                {group.requests.map((req) => (
                  <tr key={req.id}>
                    <td>
                      <StatusChip status={req.status} />
                      {/* Only a confirmed sample survives the API's scene
                          filter, so say why this row is not a plain
                          generation. */}
                      {req.testGenerationBatchId !== null && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: 11,
                            color: "#3730a3",
                          }}
                        >
                          {t("testGeneration.sampleRow")}
                        </span>
                      )}
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
            {t("editStoryboard")}
          </Link>
          <Link
            href={`/projects/${projectId}/generate`}
            className="btn btn-primary"
          >
            {t("generateCta")}
          </Link>
        </div>
      )}
    </AppShell>
  );
}

function StatusChip({ status }: { status: string }) {
  const t = useTranslations("generate.status");
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
  const labelKey = [
    "succeeded",
    "failed",
    "running",
    "queued",
    "canceled",
  ].includes(status)
    ? status
    : null;
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
      {labelKey ? t(labelKey) : status}
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
