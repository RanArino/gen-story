"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
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
type ViewSize = "small" | "medium" | "large";

const ACCEPTED = "image/jpeg,image/jpg,image/png,image/heic,image/webp";
const MAX_PHOTOS = 30;

export function PhotosPage({ projectId }: { projectId: string }) {
  const t = useTranslations("photos");
  const tCommon = useTranslations("common");
  const [photos, setPhotos] = useState<PhotoAssetDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [tab, setTab] = useState<"upload" | "manage">("upload");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [viewSize, setViewSize] = useState<ViewSize>("medium");

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
    const fileArr: File[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f != null) fileArr.push(f);
    }
    const activePhotos = photos.filter((p) => p.deletedAt === null);
    const slots = MAX_PHOTOS - activePhotos.length;
    if (slots <= 0) {
      setError(t("errors.maxPhotos", { max: MAX_PHOTOS }));
      return;
    }
    const toUpload = fileArr.slice(0, slots);
    if (toUpload.length < fileArr.length) {
      setError(t("errors.slotsLeft", { slots, max: MAX_PHOTOS }));
    }

    for (const file of toUpload) {
      const tempId = `uploading-${file.name}-${Date.now()}`;
      setUploading((prev) => [...prev, tempId]);
      try {
        const asset = await uploadPhotoAsset(projectId, file);
        setPhotos((prev) => [...prev, asset]);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : t("errors.uploadFailed"));
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
      setError(e instanceof Error ? e.message : t("errors.updateFailed"));
    }
  }

  async function handleDelete(photoId: string) {
    try {
      await deletePhotoAsset(photoId);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(photoId);
        return next;
      });
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("errors.deleteFailed"));
    }
  }

  async function handleRestore(photoId: string) {
    try {
      await restorePhotoAsset(photoId);
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("errors.restoreFailed"));
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
      setError(e instanceof Error ? e.message : t("errors.reorderFailed"));
      await refresh();
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allSelected =
    activePhotos.length > 0 &&
    activePhotos.every((p) => selectedIds.has(p.id));
  const someSelected = selectedIds.size > 0;

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(activePhotos.map((p) => p.id)));
    }
  }

  async function handleBulkDelete() {
    const ids = [...selectedIds];
    for (const id of ids) {
      try {
        await deletePhotoAsset(id);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : t("errors.deleteFailed"));
      }
    }
    setSelectedIds(new Set());
    await refresh();
  }

  async function handleBulkUsage(usage: UsageValue) {
    const ids = [...selectedIds];
    for (const id of ids) {
      try {
        const updated = await patchPhotoAsset(id, usage);
        setPhotos((prev) =>
          prev.map((p) => (p.id === updated.id ? updated : p)),
        );
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : t("errors.updateFailed"));
      }
    }
  }

  return (
    <AppShell projectId={projectId}>
      <div className="screen-header">
        <h2>{t("title")}</h2>
        <p>{t("subtitle")}</p>
      </div>

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tab === "upload" ? styles.tabActive : ""}`}
          onClick={() => setTab("upload")}
        >
          {t("tabs.upload")}
        </button>
        <button
          className={`${styles.tab} ${tab === "manage" ? styles.tabActive : ""}`}
          onClick={() => setTab("manage")}
          disabled={activePhotos.length === 0}
        >
          {t("tabs.manage", { count: activePhotos.length })}
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
            {t.rich("dropzone.primary", {
              strong: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
          <p className={styles.dropzoneHint}>
            {t("dropzone.hint", { max: MAX_PHOTOS })}
          </p>
        </div>
      )}

      {tab === "manage" && (
        <>
          {/* Toolbar: select-all + view size */}
          <div className={styles.toolbar}>
            <label className={styles.selectAllLabel}>
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el)
                    el.indeterminate = someSelected && !allSelected;
                }}
                onChange={toggleSelectAll}
                className={styles.selectAllCheckbox}
              />
              {allSelected ? t("deselectAll") : t("selectAll")}
            </label>

            <div className={styles.viewSizeGroup}>
              <button
                className={`${styles.viewSizeBtn} ${viewSize === "small" ? styles.viewSizeBtnActive : ""}`}
                onClick={() => setViewSize("small")}
                title={t("viewSize.small")}
              >
                ⊞
              </button>
              <button
                className={`${styles.viewSizeBtn} ${viewSize === "medium" ? styles.viewSizeBtnActive : ""}`}
                onClick={() => setViewSize("medium")}
                title={t("viewSize.medium")}
              >
                ▦
              </button>
              <button
                className={`${styles.viewSizeBtn} ${viewSize === "large" ? styles.viewSizeBtnActive : ""}`}
                onClick={() => setViewSize("large")}
                title={t("viewSize.large")}
              >
                ◻
              </button>
            </div>
          </div>

          {/* Bulk action bar */}
          {someSelected && (
            <div className={styles.bulkBar}>
              <span className={styles.bulkCount}>
                {t("bulk.selectedCount", { count: selectedIds.size })}
              </span>
              <button
                className={`${styles.bulkBtn} ${styles.bulkBtnUsage}`}
                onClick={() => handleBulkUsage("candidate")}
              >
                {t("bulk.setCandidate")}
              </button>
              <button
                className={`${styles.bulkBtn} ${styles.bulkBtnUsage}`}
                onClick={() => handleBulkUsage("reference")}
              >
                {t("bulk.setReference")}
              </button>
              <button
                className={`${styles.bulkBtn} ${styles.bulkBtnUsage}`}
                onClick={() => handleBulkUsage("excluded")}
              >
                {t("bulk.setExcluded")}
              </button>
              <button
                className={`${styles.bulkBtn} ${styles.bulkBtnDelete}`}
                onClick={handleBulkDelete}
              >
                {t("bulk.deleteSelected")}
              </button>
            </div>
          )}

          {loading ? (
            <p className={styles.hint}>{tCommon("loading")}</p>
          ) : (
            <div
              className={styles.photoGrid}
              style={
                {
                  "--grid-min": viewSize === "small"
                    ? "120px"
                    : viewSize === "large"
                      ? "300px"
                      : "200px",
                } as React.CSSProperties
              }
            >
              {activePhotos.map((photo, index) => (
                <PhotoCard
                  key={photo.id}
                  photo={photo}
                  index={index}
                  isDragging={dragIndex === index}
                  isSelected={selectedIds.has(photo.id)}
                  onToggleSelect={() => toggleSelect(photo.id)}
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
                  <p className={styles.hint}>{t("uploading")}</p>
                </div>
              ))}
            </div>
          )}

          {deletedPhotos.length > 0 && (
            <section className={styles.deletedSection}>
              <h3 className={styles.deletedTitle}>
                {t("deletedSectionTitle")}
              </h3>
              <p className={styles.deletedHint}>{t("deletedSectionHint")}</p>
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
          {t("addMore")}
        </button>
        <Link
          href={`/projects/${projectId}/storyboard`}
          className="btn btn-primary"
          style={{ marginLeft: "auto" }}
        >
          {t("continueToStoryboard")}
        </Link>
      </div>
    </AppShell>
  );
}

function PhotoCard({
  photo,
  index,
  isDragging,
  isSelected,
  onToggleSelect,
  onDragStart,
  onDragEnd,
  onDropOn,
  onUsageChange,
  onDelete,
}: {
  photo: PhotoAssetDto;
  index: number;
  isDragging: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropOn: () => void;
  onUsageChange: (id: string, usage: UsageValue) => void;
  onDelete: (id: string) => void;
}) {
  const t = useTranslations("photos");
  const imgUrl = storageKeyToUrl(photo.storageKey);

  return (
    <div
      className={`card ${styles.photoCard} ${isSelected ? styles.photoCardSelected : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDropOn();
      }}
      style={{ opacity: isDragging ? 0.4 : 1, cursor: "grab" }}
      title={t("dragHint", { index: index + 1 })}
    >
      <div className={styles.photoThumb}>
        <img src={imgUrl} alt={photo.name} className={styles.thumbImg} />
        <label
          className={styles.cardCheckbox}
          onClick={(e) => e.stopPropagation()}
          title={t("selectPhotoTitle")}
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
          />
        </label>
      </div>
      <p className={styles.photoName}>{photo.name}</p>
      <div className={styles.usageRow}>
        {(["candidate", "reference", "excluded"] as UsageValue[]).map((u) => (
          <button
            key={u}
            className={`${styles.usageBtn} ${photo.usage === u ? styles.usageBtnActive : ""}`}
            onClick={() => onUsageChange(photo.id, u)}
          >
            {t(`usage.${u}`)}
          </button>
        ))}
      </div>
      <button
        className={styles.deleteBtn}
        onClick={() => onDelete(photo.id)}
        title={t("deleteTitle")}
      >
        {t("delete")}
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
  const t = useTranslations("photos");
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
        <p className={styles.deletedDate}>
          {t("deletedAt", { date: deletedDate })}
        </p>
      )}
      <button
        className="btn btn-secondary"
        style={{ fontSize: 12, padding: "4px 10px", marginTop: 6 }}
        onClick={() => onRestore(photo.id)}
      >
        {t("restore")}
      </button>
    </div>
  );
}
