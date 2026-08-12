"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

type Props = {
  onGenerate: (storyPurpose: string) => void;
  onClose: () => void;
};

export function StorySetupAiModal({ onGenerate, onClose }: Props) {
  const t = useTranslations("storyboard.setup");
  const [storyPurpose, setStoryPurpose] = useState("");

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
          maxWidth: 560,
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
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: 0 }}>{t("storyModalTitle")}</h2>
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

        <p style={{ color: "#666", marginTop: 0, marginBottom: 16 }}>
          {t("storyModalIntro")}
        </p>

        <label
          htmlFor="story-purpose-input"
          style={{
            display: "block",
            fontSize: 13,
            fontWeight: 600,
            marginBottom: 6,
          }}
        >
          {t("storyModalLabel")}
        </label>
        <textarea
          id="story-purpose-input"
          value={storyPurpose}
          onChange={(e) => setStoryPurpose(e.target.value)}
          placeholder={t("storyModalPlaceholder")}
          rows={5}
          style={{
            width: "100%",
            resize: "vertical",
            padding: 8,
            fontSize: 14,
            borderRadius: 6,
            border: "1px solid #ddd",
            boxSizing: "border-box",
          }}
        />

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 24,
          }}
        >
          <button className="btn btn-secondary" onClick={onClose}>
            {t("storyModalCancel")}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => onGenerate(storyPurpose)}
          >
            {t("storyModalGenerate")}
          </button>
        </div>
      </div>
    </div>
  );
}
