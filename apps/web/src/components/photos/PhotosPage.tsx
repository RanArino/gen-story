"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoAssetDto } from "@gen-story/shared";
import type { PhotoUsage } from "../../lib/api-client";
import {
  deletePhotoAsset,
  listPhotoAssets,
  patchPhotoAsset,
  reorderPhotos,
  restorePhotoAsset,
  uploadPhotoAsset,
} from "../../lib/api-client";
import { storageKeyToUrl } from "../../lib/image-url";
import { AppShell } from "../AppShell";
import { ErrorAlert } from "../ErrorAlert";
import styles from "./PhotosPage.module.css";

type UsageValue = PhotoUsage;

const ACCEPTED = "image/jpeg,image/jpg,image/png,image/heic,image/webp";
const MAX_PHOTOS = 20;

export function PhotosPage({ projectId }: { projectId: string }) {
  const [photos, setPhotos] = useState<PhotoAssetDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [tab, setTab] = useState<"upload" | "manage">("upload");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    const all = await listPhotoAssets(projectId, true);
    setPhotos(all);
  }, [projectId]);

  useEffect(() => {
    refresh()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [refresh]);

  async function handleFiles(files: FileList | File[]) {
    const fileArr = Array.from(files);
    const activePhotos = photos.filter((p) => p.deletedAt === null);
    const slots = MAX_PHOTOS - activePhotos.length;
    if (slots <= 0) {
      setError(`Maximum ${MAX_PHOTOS} photos per project.`);
      return;
    }
    const toUpload = fileArr.slice(0, slots);
    if (toUpload.length < fileArr.length) {
      setError(`Only ${slots} more photo(s) can be added (max ${MAX_PHOTOS}).`);
    }

    for (const file of toUpload) {
      const tempId = `uploading-${file.name}-${Date.now()}`;
      setUploading((prev) => [...prev, tempId]);
      try {
        const asset = await uploadPhotoAsset(projectId, file);
        setPhotos((prev) => [...prev, asset]);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setUploading((prev) => prev.filter((id) => id !== tempId));
      }
    }

    if (tab === "upload") setTab("manage");
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) handleFiles(e.target.files);
    e.target.value = "";
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
  }

  async function handleUsageChange(photoId: string, usage: UsageValue) {
    try {
      const updated = await patchPhotoAsset(photoId, usage);
      setPhotos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Update failed");
    }
  }

  async function handleDelete(photoId: string) {
    try {
      await deletePhotoAsset(photoId);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  async function handleRestore(photoId: string) {
    try {
      await restorePhotoAsset(photoId);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Restore failed");
    }
  }

  const activePhotos = photos.filter((p) => p.deletedAt === null);
  const deletedPhotos = photos.filter((p) => p.deletedAt !== null);

  async function handleReorder(targetIndex: number) {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null);
      return;
    }
    const next = [...activePhotos];
    const [moved] = next.splice(dragIndex, 1);
    if (!moved) {
      setDragIndex(null);
      return;
    }
    next.splice(targetIndex, 0, moved);
    setDragIndex(null);
    setPhotos([...next, ...deletedPhotos]);
    try {
      await reorderPhotos(
        projectId,
        next.map((p) => p.id),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Reorder failed");
      await refresh();
    }
  }

  return (
    <AppShell projectId={projectId}>
      <div className="screen-header">
        <h2>Photos</h2>
        <p>Upload and manage the photos for this project</p>
      </div>

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === "upload" ? styles.tabActive : ""}`}
          onClick={() => setTab("upload")}
        >
          Upload
        </button>
        <button
          className={`${styles.tab} ${tab === "manage" ? styles.tabActive : ""}`}
          onClick={() => setTab("manage")}
          disabled={activePhotos.length === 0}
        >
          Manage ({activePhotos.length})
        </button>
      </div>

      {error && <ErrorAlert message={error} />}

      {tab === "upload" && (
        <div
          className={`${styles.dropzone} ${dragOver ? styles.dropzoneActive : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED}
            multiple
            style={{ display: "none" }}
            onChange={handleInputChange}
          />
          <div className={styles.dropzoneIcon}>📷</div>
          <p className={styles.dropzoneText}>
            Drop photos here or <strong>click to browse</strong>
          </p>
          <p className={styles.dropzoneHint}>
            JPG, PNG, HEIC, WebP · up to {MAX_PHOTOS} photos
          </p>
        </div>
      )}

      {tab === "manage" && (
        <>
          {loading ? (
            <p className={styles.hint}>Loading…</p>
          ) : (
            <div className={styles.photoGrid}>
              {activePhotos.map((photo, index) => (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  index={index}
                  isDragging={dragIndex === index}
                  onDragStart={() => setDragIndex(index)}
                  onDragEnd={() => setDragIndex(null)}
                  onDropOn={() => handleReorder(index)}
                  onUsageChange={handleUsageChange}
                  onDelete={handleDelete}
                />
              ))}
              {uploading.map((id) => (
                <div key={id} className={`card ${styles.uploadingCard}`}>
                  <div className={styles.uploadingSpinner} />
                  <p className={styles.hint}>Uploading…</p>
                </div>
              ))}
            </div>
          )}

          {deletedPhotos.length > 0 && (
            <section className={styles.deletedSection}>
              <h3 className={styles.deletedTitle}>Recently deleted</h3>
              <p className={styles.deletedHint}>
                Deleted photos are kept for 7 days.
              </p>
              <div className={styles.photoGrid}>
                {deletedPhotos.map((photo) => (
                  <DeletedPhotoCard
                    key={photo.id}
                    photo={photo}
                    onRestore={handleRestore}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <div className={styles.footer}>
        <button
          className="btn btn-secondary"
          onClick={() => setTab("upload")}
          style={{ display: tab === "manage" ? "inline-flex" : "none" }}
        >
          + Add more photos
        </button>
        <Link
          href={`/projects/${projectId}/storyboard`}
          className="btn btn-primary"
          style={{ marginLeft: "auto" }}
        >
          Continue to Storyboard →
        </Link>
      </div>
    </AppShell>
  );
}

function PhotoCard({
  photo,
  index,
  isDragging,
  onDragStart,
  onDragEnd,
  onDropOn,
  onUsageChange,
  onDelete,
}: {
  photo: PhotoAssetDto;
  index: number;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropOn: () => void;
  onUsageChange: (id: string, usage: UsageValue) => void;
  onDelete: (id: string) => void;
}) {
  const imgUrl = storageKeyToUrl(photo.storageKey);

  return (
    <div
      className={`card ${styles.photoCard}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropOn();
      }}
      style={{ opacity: isDragging ? 0.4 : 1, cursor: "grab" }}
      title={`Drag to reorder (position ${index + 1})`}
    >
      <div className={styles.photoThumb}>
        <img src={imgUrl} alt={photo.name} className={styles.thumbImg} />
      </div>
      <p className={styles.photoName}>{photo.name}</p>
      <div className={styles.usageRow}>
        {(["candidate", "reference", "excluded"] as UsageValue[]).map((u) => (
          <button
            key={u}
            className={`${styles.usageBtn} ${photo.usage === u ? styles.usageBtnActive : ""}`}
            onClick={() => onUsageChange(photo.id, u)}
          >
            {u}
          </button>
        ))}
      </div>
      <button
        className={styles.deleteBtn}
        onClick={() => onDelete(photo.id)}
        title="Delete photo"
      >
        Delete
      </button>
    </div>
  );
}

function DeletedPhotoCard({
  photo,
  onRestore,
}: {
  photo: PhotoAssetDto;
  onRestore: (id: string) => void;
}) {
  const imgUrl = storageKeyToUrl(photo.storageKey);
  const deletedDate = photo.deletedAt
    ? new Date(photo.deletedAt).toLocaleDateString()
    : "";

  return (
    <div className={`card ${styles.photoCard} ${styles.photoCardDeleted}`}>
      <div className={styles.photoThumb}>
        <img
          src={imgUrl}
          alt={photo.name}
          className={`${styles.thumbImg} ${styles.thumbDeleted}`}
        />
      </div>
      <p className={styles.photoName}>{photo.name}</p>
      {deletedDate && (
        <p className={styles.deletedDate}>Deleted {deletedDate}</p>
      )}
      <button
        className="btn btn-secondary"
        style={{ fontSize: 12, padding: "4px 10px", marginTop: 6 }}
        onClick={() => onRestore(photo.id)}
      >
        Restore
      </button>
    </div>
  );
}
