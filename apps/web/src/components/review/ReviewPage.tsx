"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type {
  GeneratedImageDto,
  PhotoAssetDto,
  SceneDto,
} from "@gen-story/shared";
import {
  adoptGeneratedImage,
  exportStoryboardUrl,
  listGeneratedImages,
  listGenerationRequests,
  listPhotoAssets,
  listScenes,
  listStoryboards,
  retryGenerationRequest,
} from "../../lib/api-client";
import { storageKeyToUrl } from "../../lib/image-url";
import { AppShell } from "../AppShell";
import { ErrorAlert } from "../ErrorAlert";
import styles from "./ReviewPage.module.css";

type SceneReview = {
  scene: SceneDto;
  generatedImages: GeneratedImageDto[];
  primaryPhoto: PhotoAssetDto | null;
  latestRequestId: string | null;
  latestRequestStatus: string | null;
  latestErrorMessage: string | null;
};

export function ReviewPage({ projectId }: { projectId: string }) {
  const [reviews, setReviews] = useState<SceneReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storyboardId, setStoryboardId] = useState<string | null>(null);
  const [view, setView] = useState<"card" | "timeline" | "table">("card");
  const [filter, setFilter] = useState<"all" | "original" | "generated">("all");

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

        const latest =
          requests.length > 0
            ? requests.reduce((a, b) =>
                new Date(a.createdAt) > new Date(b.createdAt) ? a : b,
              )
            : null;

        const primaryPhotoAssetId = scene.photoAssets.find(
          (pa) => pa.role === "primary",
        )?.photoAssetId;

        const primaryPhoto = primaryPhotoAssetId
          ? (photoList.find((p) => p.id === primaryPhotoAssetId) ?? null)
          : null;

        return {
          scene,
          generatedImages: images,
          primaryPhoto,
          latestRequestId: latest?.id ?? null,
          latestRequestStatus: latest?.status ?? null,
          latestErrorMessage: latest?.errorMessage ?? null,
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

  async function handleRetry(latestRequestId: string) {
    setError(null);
    try {
      await retryGenerationRequest(latestRequestId);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to retry");
    }
  }

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
    </AppShell>
  );
}

function SceneReviewCard({
  review,
  projectId,
  filter,
  onAdopt,
  onRetry,
}: {
  review: SceneReview;
  projectId: string;
  filter: "all" | "original" | "generated";
  onAdopt: (sceneId: string, imageId: string) => void;
  onRetry: (requestId: string) => void;
}) {
  const {
    scene,
    generatedImages,
    primaryPhoto,
    latestRequestStatus,
    latestErrorMessage,
    latestRequestId,
  } = review;

  const adoptedImage = generatedImages.find((img) => img.adoptedAt !== null);
  const unadoptedImages = generatedImages.filter(
    (img) => img.adoptedAt === null,
  );

  return (
    <div className={`card ${styles.sceneCard}`}>
      <div className={styles.sceneHeader}>
        <h3 className={styles.sceneTitle}>{scene.title}</h3>
        {adoptedImage && <span className={styles.adoptedBadge}>✓ Adopted</span>}
        {latestRequestStatus === "failed" && (
          <span className={styles.failedBadge}>Generation failed</span>
        )}
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

        {unadoptedImages.length > 0 && (
          <div className={styles.candidateList}>
            <p className={styles.colLabel} style={{ marginBottom: 8 }}>
              {adoptedImage ? "Other candidates:" : "Select image to adopt:"}
            </p>
            <div className={styles.candidateRow}>
              {[
                ...(adoptedImage ? [adoptedImage] : []),
                ...unadoptedImages,
              ].map((img) => (
                <div key={img.id} className={styles.candidateItem}>
                  <img
                    src={storageKeyToUrl(img.storageKey)}
                    alt="Candidate"
                    className={`${styles.candidateThumb} ${img.adoptedAt ? styles.candidateThumbAdopted : ""}`}
                  />
                  {img.adoptedAt ? (
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
                  )}
                </div>
              ))}
            </div>
          </div>
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
