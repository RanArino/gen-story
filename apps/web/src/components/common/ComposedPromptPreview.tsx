"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

import {
  previewScenePrompt,
  type ComposedPromptPreview as ComposedPromptPreviewData,
  type PreviewScenePromptOverrides,
} from "../../lib/api-client";

// Collapsible model-input panel. It starts from the composed prompt, then lets
// the caller carry any edits into the next generation request.
export function ComposedPromptPreview({
  sceneId,
  overrides,
  onChange,
}: {
  sceneId: string;
  overrides: PreviewScenePromptOverrides;
  onChange?: (value: ComposedPromptPreviewData) => void;
}) {
  const t = useTranslations("composedPrompt");
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ComposedPromptPreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
          if (!cancelled) {
            setData(result);
            onChangeRef.current?.(result);
          }
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

  function updatePrompt(prompt: string) {
    if (data == null) return;
    const next = { ...data, prompt };
    setData(next);
    onChangeRef.current?.(next);
  }

  function updateNegativePrompt(negativePrompt: string) {
    if (data == null) return;
    const next = { ...data, negativePrompt };
    setData(next);
    onChangeRef.current?.(next);
  }

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
              <textarea
                aria-label={t("promptLabel")}
                value={data.prompt}
                onChange={(event) => updatePrompt(event.target.value)}
                style={textStyle}
              />
              <p style={labelStyle}>{t("avoidLabel")}</p>
              <textarea
                aria-label={t("avoidLabel")}
                placeholder={t("avoidNone")}
                value={data.negativePrompt}
                onChange={(event) => updateNegativePrompt(event.target.value)}
                style={textStyle}
              />
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
  display: "block",
  width: "100%",
  minHeight: 88,
  margin: 0,
  padding: 8,
  background: "#ffffff",
  border: "1px solid #e2e8f0",
  borderRadius: 6,
  fontSize: 12.5,
  lineHeight: 1.5,
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  color: "#1e293b",
};

const noteStyle: React.CSSProperties = {
  margin: "8px 0 0",
  fontSize: 12,
  color: "#64748b",
};
