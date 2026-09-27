"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  IMAGE_GENERATION_MODELS,
} from "@gen-story/shared";

const IMAGE_MODEL_STORAGE_KEY = "gen-story:image-model";

function isKnownImageModel(value: string | null): value is string {
  return IMAGE_GENERATION_MODELS.some((option) => option.id === value);
}

// Shared by test generation and bulk generation so the samples a user confirms
// come from the same model as the final images.
export function useImageModel(): [string, (model: string) => void] {
  const [model, setModel] = useState(DEFAULT_IMAGE_GENERATION_MODEL);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(IMAGE_MODEL_STORAGE_KEY);
      if (isKnownImageModel(stored)) setModel(stored);
    } catch {
      // Storage can be unavailable (private mode, tests); keep the default.
    }
  }, []);

  function update(next: string) {
    setModel(next);
    try {
      window.localStorage.setItem(IMAGE_MODEL_STORAGE_KEY, next);
    } catch {
      // Not persisting only means the choice resets on reload.
    }
  }

  return [model, update];
}

export function ImageModelSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("imageModel");
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
      }}
    >
      <span style={{ color: "#52606d", fontWeight: 600 }}>{t("label")}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      >
        {IMAGE_GENERATION_MODELS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
