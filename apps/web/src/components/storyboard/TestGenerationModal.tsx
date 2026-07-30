"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import type {
  TestAdjustmentId,
  TestGenerationBatchWithVariantsDto,
} from "@gen-story/shared";
import {
  applyTestVariantAdjustments,
  confirmTestGenerationBatch,
  listTestGenerationBatches,
  requestTestGenerationBatch,
} from "../../lib/api-client";
import { storageKeyToUrl } from "../../lib/image-url";
import { AdjustmentChips } from "./AdjustmentChips";

type Props = {
  storyboardId: string;
  sceneId: string;
  onConfirmed: () => void;
  onClose: () => void;
};

const IN_FLIGHT_STATUSES = ["queued", "running"];

function isInFlight(entry: TestGenerationBatchWithVariantsDto): boolean {
  return entry.variants.some((variant) =>
    IN_FLIGHT_STATUSES.includes(variant.request.status),
  );
}

function formatBatchTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TestGenerationModal({
  storyboardId,
  sceneId,
  onConfirmed,
  onClose,
}: Props) {
  const t = useTranslations("testGeneration");
  const [batches, setBatches] = useState<TestGenerationBatchWithVariantsDto[]>(
    [],
  );
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingAdjustments, setPendingAdjustments] = useState<
    Record<string, TestAdjustmentId[]>
  >({});
  const [applyingVariantId, setApplyingVariantId] = useState<string | null>(
    null,
  );

  // One request returns the whole history with images already attached, so
  // there is nothing to stitch together here.
  const refresh = useCallback(async () => {
    const next = await listTestGenerationBatches(storyboardId);
    setBatches(next);
    setSelectedBatchId((current) =>
      current != null && next.some((entry) => entry.batch.id === current)
        ? current
        : (next[0]?.batch.id ?? null),
    );
    return next;
  }, [storyboardId]);

  useEffect(() => {
    refresh()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refresh]);

  // Only poll while something is actually generating.
  const anyInFlight = batches.some(isInFlight);
  useEffect(() => {
    if (!anyInFlight) return;
    const interval = setInterval(() => {
      refresh().catch(() => undefined);
    }, 2000);
    return () => clearInterval(interval);
  }, [anyInFlight, refresh]);

  async function handleStartBatch() {
    setStarting(true);
    setError(null);
    try {
      const result = await requestTestGenerationBatch(storyboardId, sceneId);
      const next = await refresh();
      setSelectedBatchId(
        next.some((entry) => entry.batch.id === result.batch.id)
          ? result.batch.id
          : (next[0]?.batch.id ?? null),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.start"));
    } finally {
      setStarting(false);
    }
  }

  async function handleConfirm(requestId: string) {
    setConfirming(requestId);
    setError(null);
    try {
      await confirmTestGenerationBatch(storyboardId, requestId);
      onConfirmed();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.confirm"));
      setConfirming(null);
    }
  }

  async function handleApplyAdjustments(variantId: string) {
    const ids = pendingAdjustments[variantId] ?? [];
    setApplyingVariantId(variantId);
    setError(null);
    try {
      const newReq = await applyTestVariantAdjustments(
        storyboardId,
        variantId,
        ids,
      );
      setPendingAdjustments((prev) => {
        const next = { ...prev };
        delete next[variantId];
        next[newReq.id] = newReq.appliedAdjustments;
        return next;
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.apply"));
    } finally {
      setApplyingVariantId(null);
    }
  }

  const selected =
    batches.find((entry) => entry.batch.id === selectedBatchId) ?? null;
  // Adjustments rewrite the newest batch in place, so the API only allows them
  // there. Older batches stay readable and confirmable.
  const isNewestBatch =
    selected != null && selected.batch.id === batches[0]?.batch.id;
  const canAdjustBatch =
    isNewestBatch && selected != null && selected.batch.status !== "completed";
  const succeededCount =
    selected?.variants.filter((v) => v.request.status === "succeeded").length ??
    0;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 32,
          maxWidth: 900,
          width: "90%",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 24,
          }}
        >
          <h2 style={{ margin: 0 }}>{t("title")}</h2>
          <button
            onClick={onClose}
            style={{
              fontSize: 20,
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        <p style={{ color: "#666", marginTop: 0, marginBottom: 24 }}>
          {t("intro")}
        </p>

        {error && (
          <div
            style={{
              color: "red",
              marginBottom: 16,
              padding: 8,
              background: "#fff0f0",
              borderRadius: 4,
            }}
          >
            {error}
          </div>
        )}

        {loading && <p style={{ color: "#888" }}>{t("loadingHistory")}</p>}

        {!loading && batches.length === 0 && (
          <div style={{ textAlign: "center", padding: 32 }}>
            <button
              className="btn btn-primary"
              onClick={handleStartBatch}
              disabled={starting}
              style={{ fontSize: 16, padding: "12px 32px" }}
            >
              {starting ? t("starting") : t("startCta")}
            </button>
          </div>
        )}

        {batches.length > 0 && (
          <>
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
                marginBottom: 16,
                paddingBottom: 16,
                borderBottom: "1px solid #eee",
              }}
              role="tablist"
              aria-label={t("historyHeading")}
            >
              <span style={{ fontSize: 13, color: "#888", marginRight: 4 }}>
                {t("historyHeading")}
              </span>
              {batches.map((entry, index) => {
                const isSelected = entry.batch.id === selectedBatchId;
                const isConfirmed = entry.batch.status === "completed";
                return (
                  <button
                    key={entry.batch.id}
                    role="tab"
                    aria-selected={isSelected}
                    onClick={() => setSelectedBatchId(entry.batch.id)}
                    style={{
                      fontSize: 13,
                      padding: "6px 12px",
                      borderRadius: 999,
                      cursor: "pointer",
                      border: isSelected
                        ? "1px solid #3b5bfd"
                        : "1px solid #ddd",
                      background: isSelected ? "#eef1ff" : "#fff",
                      color: isSelected ? "#3b5bfd" : "#555",
                      fontWeight: isSelected ? 600 : 400,
                    }}
                  >
                    {t("batchTab", {
                      number: batches.length - index,
                      time: formatBatchTime(entry.batch.createdAt),
                    })}
                    {isConfirmed ? ` ${t("batchConfirmedMark")}` : ""}
                  </button>
                );
              })}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 16,
              }}
            >
              <span style={{ color: "#666", fontSize: 14 }}>
                {t("progress", {
                  done: succeededCount,
                  total: selected?.variants.length ?? 0,
                })}
              </span>
              <button
                className="btn btn-secondary"
                onClick={handleStartBatch}
                disabled={starting || anyInFlight}
                style={{ fontSize: 13 }}
                title={anyInFlight ? t("batchInFlight") : undefined}
              >
                {starting ? t("starting") : t("newBatchCta")}
              </button>
            </div>

            {selected?.batch.status === "completed" && (
              <div
                style={{
                  background: "#f0fff4",
                  padding: 12,
                  borderRadius: 6,
                  marginBottom: 16,
                  color: "#2d6a4f",
                }}
              >
                {t("confirmedNotice")}
              </div>
            )}

            {selected != null && !canAdjustBatch && !isNewestBatch && (
              <div
                style={{
                  background: "#f7f7f7",
                  padding: 12,
                  borderRadius: 6,
                  marginBottom: 16,
                  color: "#666",
                  fontSize: 13,
                }}
              >
                {t("olderBatchNotice")}
              </div>
            )}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 16,
              }}
            >
              {(selected?.variants ?? []).map((variant, i) => {
                const req = variant.request;
                const isConfirmed =
                  selected?.batch.confirmedGenerationRequestId === req.id;
                const chipSelection =
                  pendingAdjustments[req.id] ?? req.appliedAdjustments;
                const isApplying = applyingVariantId === req.id;
                const variantInFlight = IN_FLIGHT_STATUSES.includes(req.status);
                const canAdjust = canAdjustBatch && !isConfirmed && !isApplying;
                const imageUrl =
                  variant.generatedImage != null
                    ? storageKeyToUrl(variant.generatedImage.storageKey)
                    : null;
                return (
                  <div
                    key={req.id}
                    style={{
                      border: isConfirmed
                        ? "2px solid #4caf50"
                        : "1px solid #ddd",
                      borderRadius: 8,
                      padding: 12,
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{ fontSize: 13, color: "#888", marginBottom: 8 }}
                    >
                      {t("variantHeader", {
                        index: i + 1,
                        status: req.status,
                      })}
                    </div>
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={t("variantAlt", { index: i + 1 })}
                        style={{
                          width: "100%",
                          borderRadius: 4,
                          marginBottom: 8,
                          aspectRatio: "1",
                          objectFit: "cover",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: "100%",
                          aspectRatio: "1",
                          background: "#f5f5f5",
                          borderRadius: 4,
                          marginBottom: 8,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#bbb",
                          fontSize: 13,
                        }}
                      >
                        {req.status === "failed"
                          ? t("stateFailed")
                          : t("stateGenerating")}
                      </div>
                    )}
                    {canAdjustBatch && (
                      <div style={{ marginTop: 8 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#555",
                          }}
                        >
                          {t("adjustments.heading")}
                        </div>
                        <AdjustmentChips
                          selected={chipSelection}
                          disabled={!canAdjust || variantInFlight}
                          onChange={(next) =>
                            setPendingAdjustments((prev) => ({
                              ...prev,
                              [req.id]: next,
                            }))
                          }
                        />
                        <button
                          className="btn btn-secondary"
                          style={{
                            width: "100%",
                            fontSize: 12,
                            marginTop: 8,
                          }}
                          onClick={() => handleApplyAdjustments(req.id)}
                          disabled={
                            !canAdjust ||
                            variantInFlight ||
                            (pendingAdjustments[req.id] === undefined &&
                              chipSelection.length === 0)
                          }
                        >
                          {isApplying
                            ? t("adjustments.applying")
                            : t("adjustments.apply")}
                        </button>
                        <div
                          style={{
                            fontSize: 11,
                            color: "#888",
                            marginTop: 4,
                          }}
                        >
                          {t("adjustments.saveHint")}
                        </div>
                      </div>
                    )}
                    {!isConfirmed && req.status === "succeeded" && (
                      <button
                        className="btn btn-primary"
                        style={{
                          width: "100%",
                          fontSize: 13,
                          marginTop: 8,
                        }}
                        onClick={() => handleConfirm(req.id)}
                        disabled={confirming !== null || isApplying}
                      >
                        {confirming === req.id
                          ? t("confirming")
                          : t("confirmStyle")}
                      </button>
                    )}
                    {isConfirmed && (
                      <div style={{ color: "#4caf50", fontWeight: 600 }}>
                        {t("confirmedBadge")}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
