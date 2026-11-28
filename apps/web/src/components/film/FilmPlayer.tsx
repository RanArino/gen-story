"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  FILM_LAYOUT_LIMITS,
  FULL_FRAME_LAYOUT,
} from "@gen-story/domain/film-layout";
import { previewLayout } from "@gen-story/infrastructure/camera-preview";
import type {
  FilmAspect,
  FilmFrameLayout,
  FilmSceneDirectionDto,
  FilmTemplateDto,
} from "@gen-story/shared";
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

/** The note face; the CSS note uses the same family so measured lines match what renders. */
const NOTE_FONT = '"Noto Sans JP", sans-serif';
let measureSpan: HTMLSpanElement | undefined;
const measured = new Map<string, number>();
/**
 * Width of `value` as the CSS note draws it. A detached canvas cannot inherit the page's
 * `lang`, so its generic-family fallback differs from the note's (13% narrower in Chrome
 * for Latin text on a `ja` page) and the wrapped lines overflowed the paper. A hidden span
 * in the page resolves fonts exactly like the note; results are cached for playback.
 */
function measureNoteText(value: string, size: number) {
  const key = `${size}|${value}`;
  const hit = measured.get(key);
  if (hit !== undefined) return hit;
  if (!measureSpan?.isConnected) {
    measureSpan = document.createElement("span");
    measureSpan.setAttribute("aria-hidden", "true");
    measureSpan.style.cssText =
      "position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;font-weight:400;letter-spacing:normal";
    document.body.append(measureSpan);
  }
  measureSpan.style.fontFamily = NOTE_FONT;
  measureSpan.style.fontSize = `${size}px`;
  measureSpan.textContent = value;
  const width = measureSpan.getBoundingClientRect().width;
  if (measured.size > 2000) measured.clear();
  measured.set(key, width);
  return width;
}
/** Caption text for the Memory Board note, measured like the painter measures it. */
function noteInput(caption: { text: string; sub: string } | null | undefined) {
  if (!caption || !(caption.text || caption.sub)) return null;
  return { text: caption.text, sub: caption.sub, measure: measureNoteText };
}

/** The frame's aspect ratio, also exposed to CSS so the width can follow the height limit. */
function frameRatio(ratio: string) {
  return { aspectRatio: ratio, "--frame-ratio": ratio } as React.CSSProperties;
}

type LayoutPart = "photo" | "caption";
/** Direct manipulation of the photo box and caption on the preview. */
export interface LayoutEditing {
  selected: LayoutPart | null;
  onSelect: (part: LayoutPart) => void;
  /** Live value while dragging; `commit` saves it. */
  onChange: (frame: FilmFrameLayout) => void;
  onCommit: (frame: FilmFrameLayout) => void;
  labels: { photo: string; caption: string; resize: string };
}

const clampTo = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const [PHOTO_MIN, PHOTO_MAX] = FILM_LAYOUT_LIMITS.photoSize;
const [CAPTION_MIN, CAPTION_MAX] = FILM_LAYOUT_LIMITS.captionSize;

/** `frame` with `part` moved by (dx, dy) and scaled by `scale`, kept inside the limits. */
function adjusted(
  frame: FilmFrameLayout,
  part: LayoutPart,
  dx: number,
  dy: number,
  scale = 1,
): FilmFrameLayout {
  if (part === "photo") {
    const { photo } = frame;
    const k = clampTo(
      scale,
      Math.max(PHOTO_MIN / photo.width, PHOTO_MIN / photo.height),
      Math.min(PHOTO_MAX / photo.width, PHOTO_MAX / photo.height),
    );
    return {
      ...frame,
      photo: {
        ...photo,
        x: round3(clampTo(photo.x + dx, 0, 1)),
        y: round3(clampTo(photo.y + dy, 0, 1)),
        width: round3(photo.width * k),
        height: round3(photo.height * k),
      },
    };
  }
  const { caption } = frame;
  return {
    ...frame,
    caption: {
      x: round3(clampTo(caption.x + dx, 0, 1)),
      y: round3(clampTo(caption.y + dy, 0, 1)),
      size: round3(clampTo(caption.size * scale, CAPTION_MIN, CAPTION_MAX)),
    },
  };
}

/** Pointer and keyboard handlers that move or resize one part of the layout. */
function useLayoutHandles(
  frame: FilmFrameLayout,
  editing: LayoutEditing | undefined,
  container: React.RefObject<HTMLDivElement | null>,
) {
  const drag = useRef<{
    part: LayoutPart;
    mode: "move" | "resize";
    x: number;
    y: number;
    start: FilmFrameLayout;
    center: { x: number; y: number };
    last: FilmFrameLayout;
  } | null>(null);
  if (!editing) return () => ({});
  return (part: LayoutPart, mode: "move" | "resize") => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      const rect = container.current?.getBoundingClientRect();
      if (!rect || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      editing.onSelect(part);
      e.currentTarget.setPointerCapture(e.pointerId);
      const anchor = part === "photo" ? frame.photo : frame.caption;
      drag.current = {
        part,
        mode,
        x: e.clientX,
        y: e.clientY,
        start: frame,
        last: frame,
        center: {
          x: rect.left + anchor.x * rect.width,
          y: rect.top + anchor.y * rect.height,
        },
      };
    },
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => {
      const d = drag.current;
      const rect = container.current?.getBoundingClientRect();
      if (!d || !rect) return;
      const next =
        d.mode === "move"
          ? adjusted(
              d.start,
              d.part,
              (e.clientX - d.x) / rect.width,
              (e.clientY - d.y) / rect.height,
            )
          : adjusted(
              d.start,
              d.part,
              0,
              0,
              Math.hypot(e.clientX - d.center.x, e.clientY - d.center.y) /
                Math.max(8, Math.hypot(d.x - d.center.x, d.y - d.center.y)),
            );
      d.last = next;
      editing.onChange(next);
    },
    onPointerUp: () => {
      const d = drag.current;
      drag.current = null;
      if (d && d.last !== d.start) editing.onCommit(d.last);
    },
    onPointerCancel: () => {
      const d = drag.current;
      drag.current = null;
      if (d) editing.onChange(d.start);
    },
    ...(mode === "move" && {
      tabIndex: 0,
      role: "button",
      "aria-pressed": editing.selected === part,
      onFocus: () => editing.onSelect(part),
      onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => {
        const step = e.shiftKey ? 0.05 : 0.01;
        const moves: Record<string, [number, number, number]> = {
          ArrowLeft: [-step, 0, 1],
          ArrowRight: [step, 0, 1],
          ArrowUp: [0, -step, 1],
          ArrowDown: [0, step, 1],
          "+": [0, 0, 1.05],
          "=": [0, 0, 1.05],
          "-": [0, 0, 1 / 1.05],
        };
        const move = moves[e.key];
        if (!move) return;
        e.preventDefault();
        editing.onCommit(adjusted(frame, part, ...move));
      },
    }),
  });
}

/**
 * One photo framed exactly where the production painter places it at progress `p`: the photo
 * fills the layout's photo box (a tilted card for Memory Board) and the caption sits at the
 * layout's caption place. Without a camera (no AI direction yet) the photo rests at the start.
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
  layout = "full-frame",
  frame = FULL_FRAME_LAYOUT,
  cardIndex = 0,
  editing,
}: {
  src: string;
  alt: string;
  camera: FilmSceneDirectionDto["camera"] | null;
  p: number;
  aspect: FilmAspect;
  reducedMotion?: boolean;
  caption?: { text: string; sub: string } | null;
  className?: string;
  /** The template's fixed layout style: full frame or paper cards. */
  layout?: FilmTemplateDto["layout"];
  /** Resolved photo box and caption place (template default, then the user's edits). */
  frame?: FilmFrameLayout;
  /** Position of the photo in its Chapter; it decides the card's tilt, as in the export. */
  cardIndex?: number;
  editing?: LayoutEditing;
}) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const container = useRef<HTMLDivElement>(null);
  const handles = useLayoutHandles(frame, editing, container);
  const view = VIEW[aspect];
  const paper = layout === "paper-cards";
  const shown = caption && (caption.text || caption.sub) ? caption : null;
  const placed = size
    ? previewLayout(
        camera ?? { move: "hold", focus: { x: 0.5, y: 0.5 }, speed: 0 },
        camera ? p : 0,
        view,
        size,
        paper ? "paper-cards" : "full-frame",
        frame,
        cardIndex,
        reducedMotion,
        paper ? noteInput(shown) : null,
      )
    : null;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  const unit = Math.min(view.width, view.height);
  const em = (px: number) => `${(px / view.width) * 100}cqw`;
  const mark = (part: LayoutPart) =>
    editing
      ? {
          "data-editable": part,
          "data-selected": editing.selected === part || undefined,
          "aria-label": editing.labels[part],
        }
      : {};
  const resize = (part: LayoutPart) =>
    editing && (
      <span
        className={styles.resizeHandle}
        aria-hidden
        title={editing.labels.resize}
        {...handles(part, "resize")}
      />
    );
  const note = placed?.note;
  const captionNode = paper
    ? note && (
        <div
          className={styles.noteCaption}
          {...mark("caption")}
          {...handles("caption", "move")}
          style={
            {
              left: pct(note.x, view.width),
              top: pct(note.y, view.height),
              width: pct(note.width, view.width),
              height: pct(note.height, view.height),
              fontSize: em(note.size),
              lineHeight: note.lineHeight,
              "--note-rotation": `${note.rotation}rad`,
            } as React.CSSProperties
          }
        >
          {note.main.map((line, i) => (
            <span key={`m${i}`}>{line}</span>
          ))}
          {note.sub.map((line, i) => (
            <small
              key={`s${i}`}
              style={{
                fontSize: `${note.subSize / note.size}em`,
                marginTop:
                  i === 0 && note.main.length
                    ? `${note.gapLines / note.subSize}em`
                    : undefined,
              }}
            >
              {line}
            </small>
          ))}
          {resize("caption")}
        </div>
      )
    : shown && (
        <div
          className={styles.captionOverlay}
          {...mark("caption")}
          {...handles("caption", "move")}
          style={{
            left: pct(frame.caption.x, 1),
            top: pct(frame.caption.y, 1),
            fontSize: em(frame.caption.size * unit),
          }}
        >
          {shown.text && <span>{shown.text}</span>}
          {shown.sub && <small>{shown.sub}</small>}
          {resize("caption")}
        </div>
      );
  const photo = placed && (
    <img
      src={src}
      alt={alt}
      style={{
        left: pct(placed.fill.left, placed.inner.width),
        top: pct(placed.fill.top, placed.inner.height),
        width: pct(placed.fill.width, placed.inner.width),
        height: pct(placed.fill.height, placed.inner.height),
      }}
    />
  );
  return (
    <div
      ref={container}
      className={`${styles.frame} ${paper ? styles.paperFrame : ""} ${className ?? ""}`}
      style={frameRatio(`${view.width} / ${view.height}`)}
      data-editing={editing ? "true" : undefined}
    >
      {/* Loads the photo once to learn its size, then the layout places it. */}
      {!size && (
        <img
          className={styles.probe}
          src={src}
          alt={alt}
          onLoad={(e) =>
            setSize({
              width: e.currentTarget.naturalWidth,
              height: e.currentTarget.naturalHeight,
            })
          }
        />
      )}
      {placed?.backdrop && <img className={styles.backdrop} src={src} alt="" />}
      {placed && (
        <div
          className={paper ? styles.paperCard : styles.photoBox}
          {...mark("photo")}
          {...handles("photo", "move")}
          style={{
            left: pct(placed.box.x, view.width),
            top: pct(placed.box.y, view.height),
            width: pct(placed.box.width, view.width),
            height: pct(placed.box.height, view.height),
            padding: pct(placed.border, view.width),
            transform: `translate(-50%, -50%) rotate(${placed.rotation}rad)`,
          }}
        >
          <div className={styles.photoClip}>{photo}</div>
          {resize("photo")}
        </div>
      )}
      {captionNode}
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
  layout,
  cardIndex,
  frame,
  editing,
  layoutBar,
  layoutButton,
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
  layout?: FilmTemplateDto["layout"];
  cardIndex?: number;
  frame?: FilmFrameLayout;
  /** Present while the user adjusts the layout; playback pauses meanwhile. */
  editing?: LayoutEditing;
  /** Shown above the frame while editing (scope and reset). */
  layoutBar?: React.ReactNode;
  /** The control that starts and ends layout editing, beside the transport. */
  layoutButton?: React.ReactNode;
}) {
  const t = useTranslations("film.workspace");
  const [playing, setPlaying] = useState(false);
  const isEditing = Boolean(editing);
  useEffect(() => {
    if (isEditing) setPlaying(false);
  }, [isEditing]);
  usePlayback(durationMs, playing, playhead, onPlayhead, () => {
    if (!onEnd()) setPlaying(false);
  });
  return (
    <section className={styles.player} aria-label={t("preview")}>
      {status}
      {editing && layoutBar}
      {src ? (
        <FramedPhoto
          src={src}
          alt={title}
          camera={camera}
          p={playhead}
          aspect={aspect}
          reducedMotion={reducedMotion}
          caption={caption}
          layout={layout}
          cardIndex={cardIndex}
          frame={frame}
          editing={editing}
        />
      ) : (
        <div
          className={styles.frame}
          style={frameRatio(aspect.replace(":", " / "))}
        >
          <p className={styles.emptyFrame}>{t("noPreview")}</p>
        </div>
      )}
      <div className={styles.transport}>
        <button
          type="button"
          disabled={!src || !camera || isEditing}
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
        {layoutButton}
      </div>
      {reducedMotion && <p className={styles.note}>{t("reducedMotionNote")}</p>}
      {!camera && src && <p className={styles.note}>{t("noCameraYet")}</p>}
    </section>
  );
}
