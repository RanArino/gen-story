"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { GeneratedImageDto, PhotoAssetDto, SceneDto } from "@gen-story/shared";
import {
  adoptGeneratedImage,
  listGeneratedImages,
  listGenerationRequests,
  listPhotoAssets,
  listScenes,
  listStoryboards,
  retryGenerationRequest,
} from "../../lib/api-client";
import { storageKeyToUrl } from "../../lib/image-url";
import { AppShell } from "../AppShell";
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

  const load = useCallback(async () => {
    const [storyboards, photoList] = await Promise.all([
      listStoryboards(projectId),
      listPhotoAssets(projectId),
    ]);

    if (storyboards.length === 0) return;
    const sb = storyboards[0]!;
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
    load().catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
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
        <p>Compare generated images with source photos. Adopt the ones you want to keep.</p>
      </div>

      {error && <p className="error-msg" style={{ marginBottom: 12 }}>{error}</p>}

      {reviews.length === 0 && (
        <div className="card">
          <p>No scenes found.</p>
          <Link href={`/projects/${projectId}/generate`} className="btn btn-primary" style={{ marginTop: 12 }}>
            ← Back to Generate
          </Link>
        </div>
      )}

      <div className={styles.sceneList}>
        {reviews.map((r) => (
          <SceneReviewCard
            key={r.scene.id}
            review={r}
            projectId={projectId}
            onAdopt={handleAdopt}
            onRetry={handleRetry}
          />
        ))}
      </div>

      {reviews.length > 0 && (
        <div className={styles.footer}>
          <Link href={`/projects/${projectId}/generate`} className="btn btn-secondary">
            ← Back to Generate
          </Link>
        </div>
      )}
    </AppShell>
  );
}

function SceneReviewCard({
  review,
  projectId,
  onAdopt,
  onRetry,
}: {
  review: SceneReview;
  projectId: string;
  onAdopt: (sceneId: string, imageId: string) => void;
  onRetry: (requestId: string) => void;
}) {
  const { scene, generatedImages, primaryPhoto, latestRequestStatus, latestErrorMessage, latestRequestId } = review;

  const adoptedImage = generatedImages.find((img) => img.adoptedAt !== null);
  const unadoptedImages = generatedImages.filter((img) => img.adoptedAt === null);

  return (
    <div className={`card ${styles.sceneCard}`}>
      <div className={styles.sceneHeader}>
        <h3 className={styles.sceneTitle}>{scene.title}</h3>
        {adoptedImage && (
          <span className={styles.adoptedBadge}>✓ Adopted</span>
        )}
        {latestRequestStatus === "failed" && (
          <span className={styles.failedBadge}>Generation failed</span>
        )}
      </div>

      {latestErrorMessage && latestRequestStatus === "failed" && (
        <p className={styles.errorMsg}>{latestErrorMessage}</p>
      )}

      <div className={styles.comparisonRow}>
        {/* Source photo */}
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

        {/* Adopted image */}
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
                  : latestRequestStatus === "running" || latestRequestStatus === "queued"
                  ? "Generating…"
                  : "Not generated yet"}
              </div>
            ) : (
              <div className={styles.imgPlaceholder}>No image adopted yet</div>
            )}
          </div>
        </div>
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
              {[...(adoptedImage ? [adoptedImage] : []), ...unadoptedImages].map((img) => (
                <div key={img.id} className={styles.candidateItem}>
                  <img
                    src={storageKeyToUrl(img.storageKey)}
                    alt="Candidate"
                    className={`${styles.candidateThumb} ${img.adoptedAt ? styles.candidateThumbAdopted : ""}`}
                  />
                  {img.adoptedAt ? (
                    <span className={styles.adoptedBadge} style={{ fontSize: 11 }}>Adopted</span>
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
          <Link href={`/projects/${projectId}/generate`} className="btn btn-secondary" style={{ fontSize: 13 }}>
            Go to Generate →
          </Link>
        )}
      </div>
    </div>
  );
}
