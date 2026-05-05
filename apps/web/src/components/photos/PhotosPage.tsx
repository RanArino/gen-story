"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoAssetDto } from "@gen-story/shared";
import type { PhotoUsage } from "../../lib/api-client";
import {
  listPhotoAssets,
  patchPhotoAsset,
  uploadPhotoAsset,
} from "../../lib/api-client";
import { storageKeyToUrl } from "../../lib/image-url";
import { AppShell } from "../AppShell";
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

  const refresh = useCallback(() => {
    return listPhotoAssets(projectId)
      .then(setPhotos)
      .catch((e: Error) => setError(e.message));
  }, [projectId]);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function handleFiles(files: FileList | File[]) {
    const fileArr = Array.from(files);
    const slots = MAX_PHOTOS - photos.length;
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
          disabled={photos.length === 0}
        >
          Manage ({photos.length})
        </button>
      </div>

      {error && <p className="error-msg" style={{ marginBottom: 12 }}>{error}</p>}

      {tab === "upload" && (
        <div
          className={`${styles.dropzone} ${dragOver ? styles.dropzoneActive : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
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
              {photos.map((photo) => (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  onUsageChange={handleUsageChange}
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
  onUsageChange,
}: {
  photo: PhotoAssetDto;
  onUsageChange: (id: string, usage: UsageValue) => void;
}) {
  const imgUrl = storageKeyToUrl(photo.storageKey);

  return (
    <div className={`card ${styles.photoCard}`}>
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
      {photo.notes && (
        <p className={styles.photoName} style={{ color: "#8898aa", fontSize: 11 }}>
          {photo.notes}
        </p>
      )}
    </div>
  );
}
