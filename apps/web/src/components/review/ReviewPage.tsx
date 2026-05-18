"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type {
  GeneratedImageDto,
  GenerationRequestDto,
  PhotoAssetDto,
  SceneDto,
} from "@gen-story/shared";
import {
  adoptGeneratedImage,
  createGenerationRequest,
  exportStoryboardUrl,
  listGeneratedImages,
  listGenerationRequests,
  listPhotoAssets,
  listScenes,
  listStoryboards,
  retryGenerationRequest,
  upsertScenes,
} from "../../lib/api-client";
import { storageKeyToUrl } from "../../lib/image-url";
import { AppShell } from "../AppShell";
import { ErrorAlert } from "../ErrorAlert";
import styles from "./ReviewPage.module.css";

type SceneReview = {
  scene: SceneDto;
  generatedImages: GeneratedImageDto[];
  primaryPhoto: PhotoAssetDto | null;
  requests: GenerationRequestDto[];
};

function latestRequest(r: SceneReview): GenerationRequestDto | null {
  return r.requests.length > 0 ? r.requests[0]! : null;
}

export function ReviewPage({ projectId }: { projectId: string }) {
  const [reviews, setReviews] = useState<SceneReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storyboardId, setStoryboardId] = useState<string | null>(null);
  const [view, setView] = useState<"card" | "timeline" | "table">("card");
  const [filter, setFilter] = useState<"all" | "original" | "generated">("all");
  const [regenSceneId, setRegenSceneId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [storyboards, photoList] = await Promise.all([
      listStoryboards(projectId),
      listPhotoAssets(projectId),
    ]);

    if (storyboards.length === 0) return;
    const sb = storyboards[0]!;
    setStoryboardId(sb.id);
    const scenes = await listScenes(sb.id);

    const reviewData = await Promise.all(
      scenes.map(async (scene) => {
        const [images, requests] = await Promise.all([
          listGeneratedImages(scene.id),
          listGenerationRequests(scene.id),
        ]);

        const primaryPhotoAssetId = scene.photoAssets.find(
          (pa) => pa.role === "primary",
        )?.photoAssetId;

        const primaryPhoto = primaryPhotoAssetId
          ? (photoList.find((p) => p.id === primaryPhotoAssetId) ?? null)
          : null;

        const requestsDesc = [...requests].sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        return {
          scene,
          generatedImages: images,
          primaryPhoto,
          requests: requestsDesc,
        };
      }),
    );
    setReviews(reviewData);
  }, [projectId]);

  useEffect(() => {
    load()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [load]);

  async function handleAdopt(sceneId: string, imageId: string) {
    setError(null);
    try {
      await adoptGeneratedImage(sceneId, imageId);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to adopt image");
    }
  }

  async function handleRetry(requestId: string) {
    setError(null);
    try {
      await retryGenerationRequest(requestId);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to retry");
    }
  }

  async function handleRegen(
    scene: SceneDto,
    overrides: RegenFields,
  ) {
    if (!storyboardId) return;
    setError(null);
    try {
      const base = scene;
      if (
        overrides.imagePrompt !== base.imagePrompt ||
        overrides.emotion !== base.emotion ||
        overrides.cameraDirection !== base.cameraDirection ||
        overrides.lightingDirection !== base.lightingDirection ||
        overrides.motionDirection !== base.motionDirection
      ) {
        await upsertScenes(storyboardId, [
          {
            sceneId: scene.id,
            orderIndex: scene.orderIndex,
            title: scene.title,
            description: scene.description ?? "",
            imagePrompt: overrides.imagePrompt,
            emotion: overrides.emotion,
            cameraDirection: overrides.cameraDirection,
            lightingDirection: overrides.lightingDirection,
            motionDirection: overrides.motionDirection,
            notes: scene.notes ?? "",
          },
        ]);
      }
      await createGenerationRequest(scene.id, {
        sceneId: scene.id,
        storyboardId,
        projectId,
      });
      setRegenSceneId(null);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to queue re-generation");
    }
  }

  const regenReview = regenSceneId
    ? reviews.find((r) => r.scene.id === regenSceneId) ?? null
    : null;

  if (loading) {
    return (
      <AppShell projectId={projectId}>
        <p style={{ color: "#8898aa" }}>Loading…</p>
      </AppShell>
    );
  }

  return (
    <AppShell projectId={projectId}>
      <div className="screen-header">
        <h2>Review</h2>
        <p>
          Compare generated images with source photos. Adopt the ones you want
          to keep.
        </p>
      </div>

      {error && <ErrorAlert message={error} />}

      {reviews.length > 0 && (
        <div className={styles.controls}>
          <div className={styles.controlGroup}>
            <span className={styles.controlLabel}>View</span>
            {(["card", "timeline", "table"] as const).map((v) => (
              <button
                key={v}
                className={`${styles.controlBtn} ${view === v ? styles.controlBtnActive : ""}`}
                onClick={() => setView(v)}
              >
                {v[0]!.toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <div className={styles.controlGroup}>
            <span className={styles.controlLabel}>Show</span>
            {(
              [
                ["all", "All"],
                ["original", "Original only"],
                ["generated", "Generated only"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={`${styles.controlBtn} ${filter === value ? styles.controlBtnActive : ""}`}
                onClick={() => setFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {reviews.length === 0 && (
        <div className="card">
          <p>No scenes found.</p>
          <Link
            href={`/projects/${projectId}/generate`}
            className="btn btn-primary"
            style={{ marginTop: 12 }}
          >
            ← Back to Generate
          </Link>
        </div>
      )}

      {reviews.length > 0 && view === "card" && (
        <div className={styles.sceneList}>
          {reviews.map((r) => (
            <SceneReviewCard
              key={r.scene.id}
              review={r}
              projectId={projectId}
              filter={filter}
              onAdopt={handleAdopt}
              onRetry={handleRetry}
              onRegen={() => setRegenSceneId(r.scene.id)}
            />
          ))}
        </div>
      )}

      {reviews.length > 0 && view === "timeline" && (
        <TimelineView reviews={reviews} filter={filter} />
      )}

      {reviews.length > 0 && view === "table" && (
        <TableView reviews={reviews} filter={filter} />
      )}

      {reviews.length > 0 && (
        <div className={styles.footer}>
          <Link
            href={`/projects/${projectId}/generate`}
            className="btn btn-secondary"
          >
            ← Back to Generate
          </Link>
          {storyboardId && (
            <Link
              href={`/projects/${projectId}/generation-history`}
              className="btn btn-secondary"
              style={{ marginLeft: 8 }}
            >
              Generation history
            </Link>
          )}
          {storyboardId && (
            <a
              href={exportStoryboardUrl(storyboardId)}
              download
              className="btn btn-primary"
              style={{ marginLeft: "auto" }}
            >
              Export Storyboard JSON
            </a>
          )}
        </div>
      )}

      {regenReview && (
        <RegenModal
          scene={regenReview.scene}
          onConfirm={(fields) => handleRegen(regenReview.scene, fields)}
          onClose={() => setRegenSceneId(null)}
        />
      )}
    </AppShell>
  );
}

function SceneReviewCard({
  review,
  projectId,
  filter,
  onAdopt,
  onRetry,
  onRegen,
}: {
  review: SceneReview;
  projectId: string;
  filter: "all" | "original" | "generated";
  onAdopt: (sceneId: string, imageId: string) => void;
  onRetry: (requestId: string) => void;
  onRegen: () => void;
}) {
  const { scene, generatedImages, primaryPhoto, requests } = review;
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const latest = latestRequest(review);
  const latestRequestStatus = latest?.status ?? null;
  const latestErrorMessage = latest?.errorMessage ?? null;
  const latestRequestId = latest?.id ?? null;

  const adoptedImage = generatedImages.find((img) => img.adoptedAt !== null);

  return (
    <div className={`card ${styles.sceneCard}`}>
      <div className={styles.sceneHeader}>
        <h3 className={styles.sceneTitle}>{scene.title}</h3>
        {adoptedImage && <span className={styles.adoptedBadge}>✓ Adopted</span>}
        {latestRequestStatus === "failed" && (
          <span className={styles.failedBadge}>Generation failed</span>
        )}
        <button className={styles.regenBtn} onClick={onRegen}>
          Re-generate
        </button>
      </div>

      {latestErrorMessage && latestRequestStatus === "failed" && (
        <p className={styles.errorMsg}>{latestErrorMessage}</p>
      )}

      <div className={styles.comparisonRow}>
        {/* Source photo */}
        {filter !== "generated" && (
          <div className={styles.comparisonCol}>
            <p className={styles.colLabel}>Source photo</p>
            <div className={styles.imgBox}>
              {primaryPhoto ? (
                <img
                  src={storageKeyToUrl(primaryPhoto.storageKey)}
                  alt={primaryPhoto.name}
                  className={styles.img}
                />
              ) : (
                <div className={styles.imgPlaceholder}>No photo assigned</div>
              )}
            </div>
          </div>
        )}

        {/* Adopted image */}
        {filter !== "original" && (
          <div className={styles.comparisonCol}>
            <p className={styles.colLabel}>Generated image</p>
            <div className={styles.imgBox}>
              {adoptedImage ? (
                <img
                  src={storageKeyToUrl(adoptedImage.storageKey)}
                  alt="Generated"
                  className={styles.img}
                />
              ) : generatedImages.length === 0 ? (
                <div className={styles.imgPlaceholder}>
                  {latestRequestStatus === "failed"
                    ? "Generation failed"
                    : latestRequestStatus === "running" ||
                        latestRequestStatus === "queued"
                      ? "Generating…"
                      : "Not generated yet"}
                </div>
              ) : (
                <div className={styles.imgPlaceholder}>
                  No image adopted yet
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className={styles.actions}>
        {latestRequestStatus === "failed" && latestRequestId && (
          <button
            className="btn btn-secondary"
            onClick={() => onRetry(latestRequestId)}
          >
            Retry generation
          </button>
        )}

        {generatedImages.length === 0 && latestRequestStatus !== "failed" && (
          <Link
            href={`/projects/${projectId}/generate`}
            className="btn btn-secondary"
            style={{ fontSize: 13 }}
          >
            Go to Generate →
          </Link>
        )}
      </div>

      {/* Generation history */}
      {requests.length > 0 && (
        <div className={styles.historySection}>
          <button
            className={styles.historyToggle}
            onClick={() => setHistoryExpanded((v) => !v)}
          >
            Generation history ({requests.length})
            <span className={styles.historyChevron}>
              {historyExpanded ? "▲" : "▼"}
            </span>
          </button>
          {historyExpanded && (
            <div className={styles.historyList}>
              {requests.map((req) => {
                const img = generatedImages.find(
                  (i) => i.generationRequestId === req.id,
                );
                return (
                  <div key={req.id} className={styles.historyItem}>
                    <div className={styles.historyThumbBox}>
                      {img ? (
                        <img
                          src={storageKeyToUrl(img.storageKey)}
                          alt="Generated"
                          className={styles.historyThumb}
                        />
                      ) : (
                        <div className={styles.historyThumbPlaceholder}>—</div>
                      )}
                    </div>
                    <div className={styles.historyMeta}>
                      <StatusChip status={req.status} />
                      <span className={styles.historyTime}>
                        {formatRelativeTime(req.createdAt)}
                      </span>
                      {req.errorMessage && (
                        <span className={styles.historyError}>
                          {req.errorMessage}
                        </span>
                      )}
                    </div>
                    <div className={styles.historyActions}>
                      {img &&
                        (img.adoptedAt ? (
                          <span
                            className={styles.adoptedBadge}
                            style={{ fontSize: 11 }}
                          >
                            Adopted
                          </span>
                        ) : (
                          <button
                            className="btn btn-primary"
                            style={{ fontSize: 12, padding: "4px 10px" }}
                            onClick={() => onAdopt(scene.id, img.id)}
                          >
                            Adopt
                          </button>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string | undefined> = {
    succeeded: styles.chipSucceeded,
    failed: styles.chipFailed,
    running: styles.chipRunning,
    queued: styles.chipQueued,
    canceled: styles.chipCanceled,
  };
  return (
    <span className={`${styles.statusChip} ${map[status] ?? ""}`}>
      {status}
    </span>
  );
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

type RegenFields = {
  imagePrompt: string;
  emotion: string;
  cameraDirection: string;
  lightingDirection: string;
  motionDirection: string;
};

const EMOTION_OPTIONS = [
  "Joy",
  "Nostalgia",
  "Love",
  "Pride",
  "Wonder",
  "Calm",
  "Excitement",
  "Gratitude",
];
const CAMERA_OPTIONS = [
  "Wide",
  "Extreme Wide",
  "Medium",
  "Close-up",
  "Extreme Close-up",
  "Aerial",
  "Overhead",
  "POV",
  "Low Angle",
  "Telephoto",
  "Voyeur",
];
const LIGHTING_OPTIONS = [
  "Golden hour",
  "Natural",
  "Dramatic",
  "Night",
  "Soft",
  "Backlit",
  "Silhouette",
  "Volumetric",
];
const MOTION_OPTIONS = ["Slow pan", "Static", "Zoom in", "Zoom out", "Tracking"];

function RegenModal({
  scene,
  onConfirm,
  onClose,
}: {
  scene: SceneDto;
  onConfirm: (fields: RegenFields) => void;
  onClose: () => void;
}) {
  const [fields, setFields] = useState<RegenFields>({
    imagePrompt: scene.imagePrompt ?? "",
    emotion: scene.emotion ?? "",
    cameraDirection: scene.cameraDirection ?? "",
    lightingDirection: scene.lightingDirection ?? "",
    motionDirection: scene.motionDirection ?? "",
  });
  const [submitting, setSubmitting] = useState(false);

  function set<K extends keyof RegenFields>(key: K, value: RegenFields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit() {
    setSubmitting(true);
    await onConfirm(fields);
    setSubmitting(false);
  }

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div
        className={styles.modalBox}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={styles.modalTitle}>
          Re-generate — {scene.title || "Untitled scene"}
        </h3>
        <p className={styles.modalSubtitle}>
          Adjust settings then confirm to queue a new generation.
          Changes will be saved to the scene.
        </p>

        <div className={styles.modalFields}>
          <label className={styles.modalLabel}>
            Image prompt
            <textarea
              className={styles.modalTextarea}
              rows={3}
              value={fields.imagePrompt}
              onChange={(e) => set("imagePrompt", e.target.value)}
            />
          </label>

          <div className={styles.modalSelects}>
            <label className={styles.modalLabel}>
              Emotion
              <select
                className={styles.modalSelect}
                value={fields.emotion}
                onChange={(e) => set("emotion", e.target.value)}
              >
                <option value="">—</option>
                {EMOTION_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>

            <label className={styles.modalLabel}>
              Camera
              <select
                className={styles.modalSelect}
                value={fields.cameraDirection}
                onChange={(e) => set("cameraDirection", e.target.value)}
              >
                <option value="">—</option>
                {CAMERA_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>

            <label className={styles.modalLabel}>
              Lighting
              <select
                className={styles.modalSelect}
                value={fields.lightingDirection}
                onChange={(e) => set("lightingDirection", e.target.value)}
              >
                <option value="">—</option>
                {LIGHTING_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>

            <label className={styles.modalLabel}>
              Motion
              <select
                className={styles.modalSelect}
                value={fields.motionDirection}
                onChange={(e) => set("motionDirection", e.target.value)}
              >
                <option value="">—</option>
                {MOTION_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? "Queuing…" : "Queue generation"}
          </button>
        </div>
      </div>
    </div>
  );
}

function adoptedOrLatest(
  images: GeneratedImageDto[],
): GeneratedImageDto | null {
  const adopted = images.find((img) => img.adoptedAt !== null);
  if (adopted) return adopted;
  if (images.length === 0) return null;
  return images.reduce((a, b) =>
    new Date(a.createdAt) > new Date(b.createdAt) ? a : b,
  );
}

function TimelineView({
  reviews,
  filter,
}: {
  reviews: SceneReview[];
  filter: "all" | "original" | "generated";
}) {
  return (
    <div className={styles.timeline}>
      {reviews.map((r, index) => {
        const generated = adoptedOrLatest(r.generatedImages);
        return (
          <div key={r.scene.id} className={styles.timelineItem}>
            <div className={styles.timelineMarker}>{index + 1}</div>
            <div className={styles.timelineCard}>
              <p className={styles.colLabel}>{r.scene.title || "Untitled"}</p>
              <div className={styles.timelineImages}>
                {filter !== "generated" && (
                  <div className={styles.imgBox}>
                    {r.primaryPhoto ? (
                      <img
                        src={storageKeyToUrl(r.primaryPhoto.storageKey)}
                        alt={r.primaryPhoto.name}
                        className={styles.img}
                      />
                    ) : (
                      <div className={styles.imgPlaceholder}>
                        {r.scene.kind === "complement"
                          ? "Complement scene"
                          : "No photo"}
                      </div>
                    )}
                  </div>
                )}
                {filter !== "original" && (
                  <div className={styles.imgBox}>
                    {generated ? (
                      <img
                        src={storageKeyToUrl(generated.storageKey)}
                        alt="Generated"
                        className={styles.img}
                      />
                    ) : (
                      <div className={styles.imgPlaceholder}>Not generated</div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TableView({
  reviews,
  filter,
}: {
  reviews: SceneReview[];
  filter: "all" | "original" | "generated";
}) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>#</th>
            <th>Title</th>
            <th>Emotion</th>
            <th>Camera</th>
            {filter !== "generated" && <th>Source photo</th>}
            {filter !== "original" && <th>Generated image</th>}
          </tr>
        </thead>
        <tbody>
          {reviews.map((r, index) => {
            const generated = adoptedOrLatest(r.generatedImages);
            return (
              <tr key={r.scene.id}>
                <td>{index + 1}</td>
                <td>{r.scene.title || "Untitled"}</td>
                <td>{r.scene.emotion || "—"}</td>
                <td>{r.scene.cameraDirection || "—"}</td>
                {filter !== "generated" && (
                  <td>
                    {r.primaryPhoto ? (
                      <img
                        src={storageKeyToUrl(r.primaryPhoto.storageKey)}
                        alt={r.primaryPhoto.name}
                        className={styles.tableThumb}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                )}
                {filter !== "original" && (
                  <td>
                    {generated ? (
                      <img
                        src={storageKeyToUrl(generated.storageKey)}
                        alt="Generated"
                        className={styles.tableThumb}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
