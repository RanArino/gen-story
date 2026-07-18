"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import {
  previewScenePrompt,
  type ComposedPromptPreview as ComposedPromptPreviewData,
  type PreviewScenePromptOverrides,
} from "../../lib/api-client";

// Collapsible "What we'll send to the model" panel. On expand (and debounced on
// change) it asks the API for the exact positive prompt and merged negative
// prompt the next generation would use, computed from the current draft form
// values. It performs no image generation, so it is free to call freely.
export function ComposedPromptPreview({
  sceneId,
  overrides,
}: {
  sceneId: string;
  overrides: PreviewScenePromptOverrides;
}) {
  const t = useTranslations("composedPrompt");
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ComposedPromptPreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Serialize the overrides so the effect only refetches when their content
  // (not their object identity) changes.
  const overridesKey = JSON.stringify(overrides);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const handle = setTimeout(() => {
      previewScenePrompt(sceneId, JSON.parse(overridesKey))
        .then((result) => {
          if (!cancelled) setData(result);
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : t("failed"));
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [open, sceneId, overridesKey, t]);

  return (
    <div style={panelStyle}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={toggleStyle}
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span> {t("title")}
      </button>

      {open && (
        <div style={bodyStyle}>
          {loading && <p style={noteStyle}>{t("loading")}</p>}
          {error && <p style={{ ...noteStyle, color: "#b42318" }}>{error}</p>}
          {data && !loading && !error && (
            <>
              <p style={labelStyle}>{t("promptLabel")}</p>
              <pre style={textStyle}>{data.prompt}</pre>
              <p style={labelStyle}>{t("avoidLabel")}</p>
              <pre style={textStyle}>
                {data.negativePrompt || t("avoidNone")}
              </pre>
            </>
          )}
          <p style={{ ...noteStyle, fontStyle: "italic" }}>{t("note")}</p>
        </div>
      )}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  marginTop: 8,
  border: "1px solid #e2e8f0",
  borderRadius: 8,
  background: "#f8fafc",
};

const toggleStyle: React.CSSProperties = {
  width: "100%",
  textAlign: "left",
  padding: "8px 12px",
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
  color: "#334155",
};

const bodyStyle: React.CSSProperties = {
  padding: "0 12px 12px",
};

const labelStyle: React.CSSProperties = {
  margin: "8px 0 4px",
  fontSize: 12,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "#64748b",
};

const textStyle: React.CSSProperties = {
  margin: 0,
  padding: 8,
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  fontSize: 12.5,
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  color: "#1e293b",
};

const noteStyle: React.CSSProperties = {
  margin: "8px 0 0",
  fontSize: 12,
  color: "#64748b",
};
