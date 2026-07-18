"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import type {
  GenerationRequestDto,
  TestGenerationBatchDto,
} from "@gen-story/shared";
import {
  confirmTestGenerationBatch,
  listGeneratedImages,
  listGenerationRequests,
  requestTestGenerationBatch,
  resetTestGenerationBatch,
} from "../../lib/api-client";
import { storageKeyToUrl } from "../../lib/image-url";

type Props = {
  storyboardId: string;
  sceneId: string;
  existingBatch: TestGenerationBatchDto | null;
  onConfirmed: () => void;
  onClose: () => void;
};

type GeneratedImageEntry = {
  requestId: string;
  imageUrl: string | null;
  status: string;
};

export function TestGenerationModal({
  storyboardId,
  sceneId,
  existingBatch,
  onConfirmed,
  onClose,
}: Props) {
  const t = useTranslations("testGeneration");
  const [batch, setBatch] = useState<TestGenerationBatchDto | null>(
    existingBatch,
  );
  const [requests, setRequests] = useState<GenerationRequestDto[]>([]);
  const [images, setImages] = useState<GeneratedImageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshRequests = useCallback(async () => {
    if (!sceneId) return;
    const reqs = await listGenerationRequests(sceneId);
    const testReqs = batch
      ? reqs.filter(
          (r) =>
            r.inputJson &&
            typeof r.inputJson === "object" &&
            "testBatchId" in r.inputJson &&
            r.inputJson.testBatchId === batch.id,
        )
      : [];
    setRequests(testReqs);

    const imageEntries: GeneratedImageEntry[] = await Promise.all(
      testReqs.map(async (req) => {
        if (req.status !== "succeeded") {
          return { requestId: req.id, imageUrl: null, status: req.status };
        }
        const imgs = await listGeneratedImages(sceneId);
        const img = imgs.find((i) => i.generationRequestId === req.id);
        return {
          requestId: req.id,
          imageUrl: img ? storageKeyToUrl(img.storageKey) : null,
          status: req.status,
        };
      }),
    );
    setImages(imageEntries);
  }, [sceneId, batch]);

  useEffect(() => {
    if (batch) {
      refreshRequests();
      if (batch.status === "pending") {
        const interval = setInterval(refreshRequests, 2000);
        return () => clearInterval(interval);
      }
    }
  }, [batch, refreshRequests]);

  async function handleStartTest() {
    setLoading(true);
    setError(null);
    try {
      const result = await requestTestGenerationBatch(storyboardId, sceneId);
      setBatch(result.batch);
      setRequests(result.generationRequests);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.start"));
    } finally {
      setLoading(false);
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

  async function handleReset() {
    setError(null);
    try {
      const reset = await resetTestGenerationBatch(storyboardId);
      setBatch(reset);
      setRequests([]);
      setImages([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.reset"));
    }
  }

  const succeededCount = requests.filter(
    (r) => r.status === "succeeded",
  ).length;
  const totalCount = requests.length;

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

        {!batch && (
          <div style={{ textAlign: "center", padding: 32 }}>
            <button
              className="btn btn-primary"
              onClick={handleStartTest}
              disabled={loading}
              style={{ fontSize: 16, padding: "12px 32px" }}
            >
              {loading ? t("starting") : t("startCta")}
            </button>
          </div>
        )}

        {batch && batch.status === "completed" && (
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

        {batch && requests.length > 0 && (
          <>
            <p style={{ color: "#666", marginBottom: 16 }}>
              {t("progress", { done: succeededCount, total: totalCount })}
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 16,
                marginBottom: 24,
              }}
            >
              {requests.map((req, i) => {
                const entry = images.find((img) => img.requestId === req.id);
                const isConfirmed =
                  batch.confirmedGenerationRequestId === req.id;
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
                    {entry?.imageUrl ? (
                      <img
                        src={entry.imageUrl}
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
                    {batch.status !== "completed" &&
                      req.status === "succeeded" && (
                        <button
                          className="btn btn-primary"
                          style={{ width: "100%", fontSize: 13 }}
                          onClick={() => handleConfirm(req.id)}
                          disabled={confirming !== null}
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

            {batch.status !== "completed" && (
              <div style={{ textAlign: "right" }}>
                <button
                  className="btn btn-secondary"
                  onClick={handleReset}
                  style={{ fontSize: 13 }}
                >
                  {t("regenerate")}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
