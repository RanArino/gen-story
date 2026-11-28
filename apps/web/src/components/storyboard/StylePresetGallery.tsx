"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { StylePresetDto } from "@gen-story/shared";

import styles from "./StoryboardPage.module.css";

const FAVORITE_STYLE_PRESETS_STORAGE_KEY = "gen-story:favorite-style-presets";

function parseFavoriteIds(value: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

// Favorites are a per-browser display preference, like the image model and
// scene view mode, so they live in localStorage rather than the project.
export function useFavoriteStylePresets(): [
  ReadonlySet<string>,
  (presetId: string) => void,
] {
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);

  useEffect(() => {
    try {
      setFavoriteIds(
        parseFavoriteIds(
          window.localStorage.getItem(FAVORITE_STYLE_PRESETS_STORAGE_KEY),
        ),
      );
    } catch {
      // Storage can be unavailable (private mode, tests); start empty.
    }
  }, []);

  function toggle(presetId: string) {
    setFavoriteIds((current) => {
      const next = current.includes(presetId)
        ? current.filter((id) => id !== presetId)
        : [...current, presetId];
      try {
        window.localStorage.setItem(
          FAVORITE_STYLE_PRESETS_STORAGE_KEY,
          JSON.stringify(next),
        );
      } catch {
        // Not persisting only means favorites reset on reload.
      }
      return next;
    });
  }

  return [new Set(favoriteIds), toggle];
}

function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M12 20.5s-7.5-4.6-9.4-9.3C1.3 8 3.4 4.5 7 4.5c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.6 0 5.7 3.5 4.4 6.7-1.9 4.7-9.4 9.3-9.4 9.3z" />
    </svg>
  );
}

export function StylePresetGallery({
  presets,
  selectedId,
  onSelect,
}: {
  presets: StylePresetDto[];
  selectedId: string | null;
  onSelect: (presetId: string | null) => void;
}) {
  const t = useTranslations("storyboard");
  const [favoriteIds, toggleFavorite] = useFavoriteStylePresets();

  const favorites = presets.filter((p) => favoriteIds.has(p.id));
  const systemPresets = presets.filter(
    (p) => p.scope === "system" && !favoriteIds.has(p.id),
  );
  const userPresets = presets.filter(
    (p) => p.scope === "user" && !favoriteIds.has(p.id),
  );

  function favoriteButton(
    preset: StylePresetDto,
    className: string | undefined,
  ) {
    const favorite = favoriteIds.has(preset.id);
    return (
      <button
        type="button"
        className={`${className} ${favorite ? styles.favoriteBtnOn : ""}`}
        aria-pressed={favorite}
        aria-label={t("style.favorite", { name: preset.name })}
        title={t("style.favorite", { name: preset.name })}
        onClick={() => toggleFavorite(preset.id)}
      >
        <HeartIcon />
      </button>
    );
  }

  function presetControl(preset: StylePresetDto) {
    const selected = selectedId === preset.id;
    if (preset.scope === "system") {
      return (
        <div key={preset.id} className={styles.styleCardWrap}>
          <button
            type="button"
            className={`${styles.styleBtnCard} ${selected ? styles.styleBtnCardActive : ""}`}
            onClick={() => onSelect(preset.id)}
            title={preset.description}
          >
            {preset.previewImageUrl && (
              <img src={preset.previewImageUrl} alt={preset.name} />
            )}
            <span className={styles.styleBtnCardLabel}>{preset.name}</span>
          </button>
          {favoriteButton(preset, styles.favoriteBtnCard)}
        </div>
      );
    }
    return (
      <span
        key={preset.id}
        className={`${styles.styleChip} ${selected ? styles.styleChipActive : ""}`}
      >
        <button
          type="button"
          className={styles.styleChipSelect}
          onClick={() => onSelect(preset.id)}
          title={preset.description}
        >
          {preset.name}
        </button>
        {favoriteButton(preset, styles.favoriteBtnChip)}
      </span>
    );
  }

  return (
    <div className={styles.styleGrid}>
      <button
        type="button"
        className={`${styles.styleBtn} ${!selectedId ? styles.styleBtnActive : ""}`}
        onClick={() => onSelect(null)}
      >
        {t("style.aiRecommend")}
      </button>
      {favorites.length > 0 && (
        <span className={styles.styleGroupLabel}>{t("style.favorites")}</span>
      )}
      {favorites.map(presetControl)}
      {systemPresets.length > 0 && (
        <span className={styles.styleGroupLabel}>
          {t("style.systemStyles")}
        </span>
      )}
      {systemPresets.map(presetControl)}
      {userPresets.length > 0 && (
        <span className={styles.styleGroupLabel}>
          {t("style.customStyles")}
        </span>
      )}
      {userPresets.map(presetControl)}
    </div>
  );
}
