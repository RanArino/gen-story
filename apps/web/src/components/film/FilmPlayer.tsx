"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { previewFrame } from "@gen-story/infrastructure/camera-preview";
import type { FilmAspect, FilmSceneDirectionDto } from "@gen-story/shared";
import styles from "./FilmWorkspace.module.css";

const VIEW = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
} as const;

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    setReduced(query.matches);
    const change = () => setReduced(query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  return reduced;
}

/**
 * One photo framed exactly where the production painter places it at progress `p`.
 * Without a camera (no AI direction yet) it shows the whole photo at rest.
 */
export function FramedPhoto({
  src,
  alt,
  camera,
  p,
  aspect,
  reducedMotion = false,
  caption,
  className,
}: {
  src: string;
  alt: string;
  camera: FilmSceneDirectionDto["camera"] | null;
  p: number;
  aspect: FilmAspect;
  reducedMotion?: boolean;
  caption?: { text: string; sub: string } | null;
  className?: string;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const view = VIEW[aspect];
  const frame = size
    ? previewFrame(
        camera ?? { move: "hold", focus: { x: 0.5, y: 0.5 }, speed: 0 },
        camera ? p : 0,
        view,
        size,
        reducedMotion,
      )
    : null;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <div
      className={`${styles.frame} ${className ?? ""}`}
      style={{ aspectRatio: `${view.width} / ${view.height}` }}
    >
      {frame && <img className={styles.backdrop} src={src} alt="" />}
      <img
        src={src}
        alt={alt}
        onLoad={(e) =>
          setSize({
            width: e.currentTarget.naturalWidth,
            height: e.currentTarget.naturalHeight,
          })
        }
        style={
          frame
            ? {
                left: pct(frame.left, view.width),
                top: pct(frame.top, view.height),
                width: pct(frame.width, view.width),
                height: pct(frame.height, view.height),
              }
            : { inset: 0, width: "100%", height: "100%", objectFit: "contain" }
        }
      />
      {caption && (caption.text || caption.sub) && (
        <div className={styles.captionOverlay}>
          {caption.text && <span>{caption.text}</span>}
          {caption.sub && <small>{caption.sub}</small>}
        </div>
      )}
    </div>
  );
}

/** Animates `p` from 0 to 1 over `durationMs` while playing; calls onEnd at the end. */
export function usePlayback(
  durationMs: number,
  playing: boolean,
  p: number,
  setP: (p: number) => void,
  onEnd: () => void,
) {
  const state = useRef({ p, setP, onEnd });
  state.current = { p, setP, onEnd };
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = state.current.p + (now - last) / Math.max(500, durationMs);
      last = now;
      if (next >= 1) {
        state.current.setP(1);
        state.current.onEnd();
        return;
      }
      state.current.setP(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, durationMs]);
}

export function FilmPlayer({
  src,
  title,
  camera,
  aspect,
  durationMs,
  playhead,
  onPlayhead,
  caption,
  reducedMotion,
  onEnd,
  status,
}: {
  src: string | null;
  title: string;
  camera: FilmSceneDirectionDto["camera"] | null;
  aspect: FilmAspect;
  durationMs: number;
  playhead: number;
  onPlayhead: (p: number) => void;
  caption: { text: string; sub: string } | null;
  reducedMotion: boolean;
  /** Called when playback reaches the end; returns true when it moved to another scene. */
  onEnd: () => boolean;
  status?: React.ReactNode;
}) {
  const t = useTranslations("film.workspace");
  const [playing, setPlaying] = useState(false);
  usePlayback(durationMs, playing, playhead, onPlayhead, () => {
    if (!onEnd()) setPlaying(false);
  });
  return (
    <section className={styles.player} aria-label={t("preview")}>
      {status}
      {src ? (
        <FramedPhoto
          src={src}
          alt={title}
          camera={camera}
          p={playhead}
          aspect={aspect}
          reducedMotion={reducedMotion}
          caption={caption}
        />
      ) : (
        <div
          className={styles.frame}
          style={{ aspectRatio: aspect.replace(":", " / ") }}
        >
          <p className={styles.emptyFrame}>{t("noPreview")}</p>
        </div>
      )}
      <div className={styles.transport}>
        <button
          type="button"
          disabled={!src || !camera}
          aria-pressed={playing}
          onClick={() => {
            if (!playing && playhead >= 1) onPlayhead(0);
            setPlaying(!playing);
          }}
        >
          {playing ? t("pause") : t("play")}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={playhead}
          aria-label={t("playhead")}
          disabled={!src || !camera}
          onChange={(e) => {
            setPlaying(false);
            onPlayhead(Number(e.target.value));
          }}
        />
        <span className={styles.time}>
          {((playhead * durationMs) / 1000).toFixed(1)} /{" "}
          {(durationMs / 1000).toFixed(1)}s
        </span>
      </div>
      {reducedMotion && <p className={styles.note}>{t("reducedMotionNote")}</p>}
      {!camera && src && <p className={styles.note}>{t("noCameraYet")}</p>}
    </section>
  );
}
