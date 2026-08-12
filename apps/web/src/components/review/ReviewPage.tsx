"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
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
  exportStoryboardAssetBundle,
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
import { ComposedPromptPreview } from "../common/ComposedPromptPreview";
import { ErrorAlert } from "../ErrorAlert";
import styles from "./ReviewPage.module.css";

type SceneReview = {
  scene: SceneDto;
  generatedImages: GeneratedImageDto[];
  primaryPhoto: PhotoAssetDto | null;
  requests: GenerationRequestDto[];
};

type AssetSelection = "both" | "original_only" | "generated_only";

function latestRequest(r: SceneReview): GenerationRequestDto | null {
  return r.requests.length > 0 ? r.requests[0]! : null;
}

export function ReviewPage({ projectId }: { projectId: string }) {
  const t = useTranslations("review");
  const tCommon = useTranslations("common");
  const [reviews, setReviews] = useState<SceneReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storyboardId, setStoryboardId] = useState<string | null>(null);
  const [view, setView] = useState<"card" | "timeline" | "table">("card");
  const [filter, setFilter] = useState<"all" | "original" | "generated">("all");
  const [regenSceneId, setRegenSceneId] = useState<string | null>(null);
  const [assetExportPath, setAssetExportPath] = useState<string | null>(null);
  const [assetSelection, setAssetSelection] =
    useState<AssetSelection | null>(null);

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

  // A generation runs in the API worker after this page has loaded. Refresh
  // only while work is active so its completed (and automatically adopted)
  // image replaces the placeholder without requiring a manual page reload.
  useEffect(() => {
    const hasActiveGeneration = reviews.some((review) =>
      review.requests.some(
        (request) =>
          request.status === "queued" || request.status === "running",
      ),
    );
    if (!hasActiveGeneration) return;

    const interval = window.setInterval(() => {
      load().catch((e: Error) => setError(e.message));
    }, 2_000);

    return () => window.clearInterval(interval);
  }, [load, reviews]);

  async function handleAdopt(sceneId: string, imageId: string) {
    setError(null);
    try {
      await adoptGeneratedImage(sceneId, imageId);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("errors.adopt"));
    }
  }

  async function handleAssetExport() {
    if (!storyboardId || assetSelection == null) return;
    setError(null);
    try {
      const result = await exportStoryboardAssetBundle(
        storyboardId,
        assetSelection,
      );
      setAssetExportPath(result.exportPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("assetExportFailed"));
    }
  }

  async function handleRetry(requestId: string) {
    setError(null);
    try {
      await retryGenerationRequest(requestId);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("errors.retry"));
    }
  }

  async function handleRegen(scene: SceneDto, overrides: RegenFields) {
    if (!storyboardId) return;
    setError(null);
    try {
      const base = scene;
      if (
        overrides.imagePrompt !== base.imagePrompt ||
        overrides.emotion !== base.emotion ||
        overrides.cameraDirection !== base.cameraDirection ||
        overrides.lightingDirection !== base.lightingDirection ||
        overrides.motionDirection !== base.motionDirection ||
        overrides.photoFidelity !== base.photoFidelity
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
            photoFidelity: overrides.photoFidelity,
          },
        ]);
      }
      await createGenerationRequest(scene.id, {
        sceneId: scene.id,
        storyboardId,
        projectId,
        ...(overrides.promptOverride != null
          ? { promptOverride: overrides.promptOverride }
          : {}),
        ...(overrides.negativePromptOverride != null
          ? { negativePromptOverride: overrides.negativePromptOverride }
          : {}),
      });
      setRegenSceneId(null);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("errors.regen"));
    }
  }

  const regenReview = regenSceneId
    ? (reviews.find((r) => r.scene.id === regenSceneId) ?? null)
    : null;

  if (loading) {
    return (
      <AppShell projectId={projectId}>
        <p style={{ color: "#8898aa" }}>{tCommon("loading")}</p>
      </AppShell>
    );
  }

  return (
    <AppShell projectId={projectId}>
      <div className="screen-header">
        <h2>{t("title")}</h2>
        <p>{t("subtitle")}</p>
      </div>

      {error && <ErrorAlert message={error} />}

      {reviews.length > 0 && (
        <div className={styles.controls}>
          <div className={styles.controlGroup}>
            <span className={styles.controlLabel}>{t("controls.view")}</span>
            {(["card", "timeline", "table"] as const).map((v) => (
              <button
                key={v}
                className={`${styles.controlBtn} ${view === v ? styles.controlBtnActive : ""}`}
                onClick={() => setView(v)}
              >
                {t(`controls.views.${v}`)}
              </button>
            ))}
          </div>
          <div className={styles.controlGroup}>
            <span className={styles.controlLabel}>{t("controls.show")}</span>
            {(["all", "original", "generated"] as const).map((value) => (
              <button
                key={value}
                className={`${styles.controlBtn} ${filter === value ? styles.controlBtnActive : ""}`}
                onClick={() => setFilter(value)}
              >
                {t(`controls.filters.${value}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      {reviews.length === 0 && (
        <div className="card">
          <p>{t("noScenes")}</p>
          <Link
            href={`/projects/${projectId}/generate`}
            className="btn btn-primary"
            style={{ marginTop: 12 }}
          >
            {t("backToGenerate")}
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
            {t("backToGenerate")}
          </Link>
          {storyboardId && (
            <Link
              href={`/projects/${projectId}/generation-history`}
              className="btn btn-secondary"
              style={{ marginLeft: 8 }}
            >
              {t("generationHistory")}
            </Link>
          )}
          {storyboardId && (
            <a
              href={exportStoryboardUrl(storyboardId)}
              download
              className="btn btn-primary"
              style={{ marginLeft: "auto" }}
            >
              {t("exportJson")}
            </a>
          )}
          {storyboardId && (
            <>
              <label style={{ marginLeft: 8 }}>
                {t("assetSelection.label")}
                <select
                  value={assetSelection ?? ""}
                  onChange={(event) =>
                    setAssetSelection(
                      event.target.value === ""
                        ? null
                        : (event.target.value as AssetSelection),
                    )
                  }
                >
                  <option value="">{t("assetSelection.placeholder")}</option>
                  <option value="both">{t("assetSelection.both")}</option>
                  <option value="original_only">
                    {t("assetSelection.originalOnly")}
                  </option>
                  <option value="generated_only">
                    {t("assetSelection.generatedOnly")}
                  </option>
                </select>
              </label>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={assetSelection == null}
                onClick={handleAssetExport}
                style={{ marginLeft: 8 }}
              >
                {t("exportAssets")}
              </button>
            </>
          )}
        </div>
      )}

      {assetExportPath && (
        <p>{t("assetExported", { path: assetExportPath })}</p>
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
  const t = useTranslations("review");

  const latest = latestRequest(review);
  const latestRequestStatus = latest?.status ?? null;
  const latestErrorMessage = latest?.errorMessage ?? null;
  const latestRequestId = latest?.id ?? null;
  const formatRelativeTime = useFormatRelativeTime();

  const adoptedImage = generatedImages.find((img) => img.adoptedAt !== null);

  return (
    <div className={`card ${styles.sceneCard}`}>
      <div className={styles.sceneHeader}>
        <h3 className={styles.sceneTitle}>{scene.title}</h3>
        {/* No "adopted" status here either: the image in use is shown right
            below, and the history's radio group says which row it is. The
            failure badge stays — that is a problem to act on, not a state. */}
        {latestRequestStatus === "failed" && (
          <span className={styles.failedBadge}>{t("card.failedBadge")}</span>
        )}
        <button className={styles.regenBtn} onClick={onRegen}>
          {t("card.regenerate")}
        </button>
      </div>

      {latestErrorMessage && latestRequestStatus === "failed" && (
        <p className={styles.errorMsg}>{latestErrorMessage}</p>
      )}

      <div className={styles.comparisonRow}>
        {/* Source photo */}
        {filter !== "generated" && (
          <div className={styles.comparisonCol}>
            <p className={styles.colLabel}>{t("card.sourcePhoto")}</p>
            <div className={styles.imgBox}>
              {primaryPhoto ? (
                <img
                  src={storageKeyToUrl(primaryPhoto.storageKey)}
                  alt={primaryPhoto.name}
                  className={styles.img}
                />
              ) : (
                <div className={styles.imgPlaceholder}>
                  {t("card.noPhotoAssigned")}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Adopted image */}
        {filter !== "original" && (
          <div className={styles.comparisonCol}>
            <p className={styles.colLabel}>{t("card.generatedImage")}</p>
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
                    ? t("card.generationFailed")
                    : latestRequestStatus === "running" ||
                        latestRequestStatus === "queued"
                      ? t("card.generatingState")
                      : t("card.notGeneratedYet")}
                </div>
              ) : (
                <div className={styles.imgPlaceholder}>
                  {t("card.noImageAdopted")}
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
            {t("card.retryGeneration")}
          </button>
        )}

        {generatedImages.length === 0 && latestRequestStatus !== "failed" && (
          <Link
            href={`/projects/${projectId}/generate`}
            className="btn btn-secondary"
            style={{ fontSize: 13 }}
          >
            {t("card.goToGenerate")}
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
            {t("card.historyHeader", { count: requests.length })}
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
                      {/* Where the image came from, not a status: a sample was
                          rendered for the style test rather than by a full
                          generation pass, and it is picked the same way. */}
                      {req.testGenerationBatchId !== null && (
                        <span className={styles.sampleTag}>
                          {t("card.sampleTag")}
                        </span>
                      )}
                      {req.errorMessage && (
                        <span className={styles.historyError}>
                          {req.errorMessage}
                        </span>
                      )}
                    </div>
                    <div className={styles.historyActions}>
                      {/* Choosing this scene's image is a pick-one-of-many, so
                          it is a radio group. The checked row is the image in
                          use, which is why no row carries an "adopted" status
                          of its own. */}
                      {img && (
                        <label className={styles.useChoice}>
                          <input
                            type="radio"
                            name={`adopted-${scene.id}`}
                            checked={img.adoptedAt !== null}
                            onChange={() => onAdopt(scene.id, img.id)}
                          />
                          {t("card.useThis")}
                        </label>
                      )}
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

function useFormatRelativeTime() {
  const t = useTranslations("review.time");
  return (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t("justNow");
    if (mins < 60) return t("minutesAgo", { count: mins });
    const hours = Math.floor(mins / 60);
    if (hours < 24) return t("hoursAgo", { count: hours });
    return t("daysAgo", { count: Math.floor(hours / 24) });
  };
}

type RegenFields = {
  imagePrompt: string;
  emotion: string;
  cameraDirection: string;
  lightingDirection: string;
  motionDirection: string;
  photoFidelity: "off" | "low" | "high";
  promptOverride?: string;
  negativePromptOverride?: string;
};

const PHOTO_FIDELITY_OPTIONS = ["off", "low", "high"] as const;

// AI scene fill is asked to keep these fields short, English, label-style
// values, but nothing constrains it to this exact list — a value like "Peace"
// or "Straight-on" is a legitimate AI choice that just isn't one of the fixed
// options below. Without this, the <select> silently shows no selection (or
// the wrong one) for a scene whose real value is perfectly valid, which reads
// as "the scene lost its setting" and invites overwriting it by accident.
function withCurrentOption(options: string[], current: string): string[] {
  if (!current || options.includes(current)) return options;
  return [current, ...options];
}

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
const MOTION_OPTIONS = [
  "Slow pan",
  "Static",
  "Zoom in",
  "Zoom out",
  "Tracking",
];

function RegenModal({
  scene,
  onConfirm,
  onClose,
}: {
  scene: SceneDto;
  onConfirm: (fields: RegenFields) => void;
  onClose: () => void;
}) {
  const t = useTranslations("review.regenModal");
  const tSel = useTranslations("selections");
  const [fields, setFields] = useState<RegenFields>({
    imagePrompt: scene.imagePrompt ?? "",
    emotion: scene.emotion ?? "",
    cameraDirection: scene.cameraDirection ?? "",
    lightingDirection: scene.lightingDirection ?? "",
    motionDirection: scene.motionDirection ?? "",
    photoFidelity: scene.photoFidelity ?? "off",
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
      <div className={styles.modalBox} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.modalTitle}>
          {t("title", {
            sceneTitle: scene.title || t("untitledScene"),
          })}
        </h3>
        <p className={styles.modalSubtitle}>{t("subtitle")}</p>

        <div className={styles.modalFields}>
          <label className={styles.modalLabel}>
            {t("imagePrompt")}
            <textarea
              className={styles.modalTextarea}
              rows={3}
              value={fields.imagePrompt}
              onChange={(e) => set("imagePrompt", e.target.value)}
            />
          </label>

          <div className={styles.modalSelects}>
            <label className={styles.modalLabel}>
              {t("emotion")}
              <select
                className={styles.modalSelect}
                value={fields.emotion}
                onChange={(e) => set("emotion", e.target.value)}
              >
                <option value="">—</option>
                {withCurrentOption(EMOTION_OPTIONS, fields.emotion).map((o) => (
                  <option key={o} value={o}>
                    {EMOTION_OPTIONS.includes(o) ? tSel(`emotion.${o}`) : o}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.modalLabel}>
              {t("camera")}
              <select
                className={styles.modalSelect}
                value={fields.cameraDirection}
                onChange={(e) => set("cameraDirection", e.target.value)}
              >
                <option value="">—</option>
                {withCurrentOption(CAMERA_OPTIONS, fields.cameraDirection).map(
                  (o) => (
                    <option key={o} value={o}>
                      {CAMERA_OPTIONS.includes(o) ? tSel(`camera.${o}`) : o}
                    </option>
                  ),
                )}
              </select>
            </label>

            <label className={styles.modalLabel}>
              {t("lighting")}
              <select
                className={styles.modalSelect}
                value={fields.lightingDirection}
                onChange={(e) => set("lightingDirection", e.target.value)}
              >
                <option value="">—</option>
                {withCurrentOption(
                  LIGHTING_OPTIONS,
                  fields.lightingDirection,
                ).map((o) => (
                  <option key={o} value={o}>
                    {LIGHTING_OPTIONS.includes(o) ? tSel(`lighting.${o}`) : o}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.modalLabel}>
              {t("motion")}
              <select
                className={styles.modalSelect}
                value={fields.motionDirection}
                onChange={(e) => set("motionDirection", e.target.value)}
              >
                <option value="">—</option>
                {withCurrentOption(MOTION_OPTIONS, fields.motionDirection).map(
                  (o) => (
                    <option key={o} value={o}>
                      {MOTION_OPTIONS.includes(o) ? tSel(`motion.${o}`) : o}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>

          <label className={styles.modalLabel}>
            {t("photoFidelityLabel")}
            <div className={styles.photoFidelityOptions}>
              {PHOTO_FIDELITY_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`${styles.photoFidelityOption} ${
                    fields.photoFidelity === option
                      ? styles.photoFidelityOptionActive
                      : ""
                  }`}
                  onClick={() => set("photoFidelity", option)}
                  title={t(`photoFidelity.${option}Hint`)}
                >
                  {t(`photoFidelity.${option}`)}
                </button>
              ))}
            </div>
          </label>
        </div>

        <ComposedPromptPreview
          sceneId={scene.id}
          overrides={{
            imagePrompt: fields.imagePrompt,
            emotion: fields.emotion,
            cameraDirection: fields.cameraDirection,
            lightingDirection: fields.lightingDirection,
            motionDirection: fields.motionDirection,
            photoFidelity: fields.photoFidelity,
          }}
          onChange={({ prompt, negativePrompt }) => {
            setFields((current) => ({
              ...current,
              promptOverride: prompt,
              negativePromptOverride: negativePrompt,
            }));
          }}
        />

        <div className={styles.modalFooter}>
          <button className="btn btn-secondary" onClick={onClose}>
            {t("cancel")}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? t("queuing") : t("queue")}
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
  const t = useTranslations("review.timeline");
  return (
    <div className={styles.timeline}>
      {reviews.map((r, index) => {
        const generated = adoptedOrLatest(r.generatedImages);
        return (
          <div key={r.scene.id} className={styles.timelineItem}>
            <div className={styles.timelineMarker}>{index + 1}</div>
            <div className={styles.timelineCard}>
              <p className={styles.colLabel}>
                {r.scene.title || t("untitled")}
              </p>
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
                          ? t("complementScene")
                          : t("noPhoto")}
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
                      <div className={styles.imgPlaceholder}>
                        {t("notGenerated")}
                      </div>
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
  const t = useTranslations("review.table");
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>{t("hash")}</th>
            <th>{t("title")}</th>
            <th>{t("emotion")}</th>
            <th>{t("camera")}</th>
            {filter !== "generated" && <th>{t("sourcePhoto")}</th>}
            {filter !== "original" && <th>{t("generatedImage")}</th>}
          </tr>
        </thead>
        <tbody>
          {reviews.map((r, index) => {
            const generated = adoptedOrLatest(r.generatedImages);
            return (
              <tr key={r.scene.id}>
                <td>{index + 1}</td>
                <td>{r.scene.title || t("untitled")}</td>
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
