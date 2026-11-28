"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { type FilmAspect, type FilmSceneDirectionDto } from "@gen-story/shared";
import {
  FramedPhoto,
  usePlayback,
  usePrefersReducedMotion,
} from "./FilmPlayer";
import styles from "./FilmWorkspace.module.css";

type Camera = FilmSceneDirectionDto["camera"];
/** Original synthetic photo bundled for demos (see public/film-previews/README.md). */
const SAMPLE = "/film-previews/photos/coastal-train.jpg";
/** The same focus for every move, so only the move and strength differ. */
const SAMPLE_FOCUS = { x: 0.62, y: 0.45 };
const SAMPLE_MS = 4000;
const STRENGTHS = { low: 0, high: 1 } as const;

/**
 * Plays each camera move on one cleared example photo with the current aspect and the production
 * camera path, then applies the chosen move and strength to the selected scene.
 */
export function CameraAudition({
  open,
  aspect,
  current,
  moves,
  maxSpeed,
  onClose,
  onChoose,
}: {
  open: boolean;
  aspect: FilmAspect;
  current: Camera;
  moves: readonly Camera["move"][];
  maxSpeed: number;
  onClose: () => void;
  onChoose: (camera: Pick<Camera, "move" | "speed">) => void;
}) {
  const t = useTranslations("film.workspace");
  const tm = useTranslations("film.direction.moves");
  const ref = useRef<HTMLDialogElement>(null);
  const prefersReduced = usePrefersReducedMotion();
  const [move, setMove] = useState(current.move);
  const [strength, setStrength] = useState<keyof typeof STRENGTHS>("high");
  const [view, setView] = useState<"play" | "frames">("play");
  const [p, setP] = useState(0);
  const [playing, setPlaying] = useState(false);
  usePlayback(SAMPLE_MS, playing, p, setP, () => setPlaying(false));
  useEffect(() => {
    if (open) {
      setMove(current.move);
      setP(0);
      setPlaying(false);
      setView(prefersReduced ? "frames" : "play");
      ref.current?.showModal();
    } else ref.current?.close();
    // Re-initialize only when the dialog opens.
  }, [open]);
  const camera = (s: keyof typeof STRENGTHS): Camera => ({
    move,
    speed: STRENGTHS[s] * maxSpeed,
    focus: SAMPLE_FOCUS,
    reason: "",
  });
  return (
    <dialog
      ref={ref}
      className={styles.audition}
      aria-labelledby="camera-audition-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <div className={styles.auditionHeader}>
        <h3 id="camera-audition-title">{t("auditionTitle")}</h3>
        <button type="button" aria-label={t("close")} onClick={onClose}>
          ×
        </button>
      </div>
      <p className={styles.note}>{t("auditionHint")}</p>
      <div className={styles.moveList} role="radiogroup" aria-label={t("move")}>
        {moves.map((m) => (
          <label key={m} className={styles.moveOption}>
            <input
              type="radio"
              name="audition-move"
              value={m}
              checked={move === m}
              onChange={() => {
                setMove(m);
                setP(0);
              }}
            />
            {tm(m)}
          </label>
        ))}
      </div>
      <div className={styles.auditionControls}>
        <fieldset className={styles.segmented}>
          <legend>{t("strength")}</legend>
          {(["low", "high"] as const).map((s) => (
            <label key={s}>
              <input
                type="radio"
                name="audition-strength"
                checked={strength === s}
                onChange={() => setStrength(s)}
              />
              {t(`strengths.${s}`)}
            </label>
          ))}
        </fieldset>
        <fieldset className={styles.segmented}>
          <legend>{t("compareAs")}</legend>
          {(["play", "frames"] as const).map((v) => (
            <label key={v}>
              <input
                type="radio"
                name="audition-view"
                checked={view === v}
                onChange={() => {
                  setView(v);
                  setPlaying(false);
                }}
              />
              {t(`views.${v}`)}
            </label>
          ))}
        </fieldset>
      </div>
      {view === "play" ? (
        <>
          <div className={styles.auditionPair}>
            {(["low", "high"] as const).map((s) => (
              <figure key={s} aria-current={strength === s}>
                <FramedPhoto
                  src={SAMPLE}
                  alt={t("sampleAlt")}
                  camera={camera(s)}
                  p={p}
                  aspect={aspect}
                />
                <figcaption>{t(`strengths.${s}`)}</figcaption>
              </figure>
            ))}
          </div>
          <div className={styles.transport}>
            <button
              type="button"
              aria-pressed={playing}
              onClick={() => {
                if (!playing && p >= 1) setP(0);
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
              value={p}
              aria-label={t("playhead")}
              onChange={(e) => {
                setPlaying(false);
                setP(Number(e.target.value));
              }}
            />
          </div>
        </>
      ) : (
        <div className={styles.frameSheet}>
          {(["low", "high"] as const).map((s) => (
            <div key={s}>
              <strong>{t(`strengths.${s}`)}</strong>
              <div className={styles.frameRow}>
                {[0, 0.5, 1].map((at) => (
                  <figure key={at}>
                    <FramedPhoto
                      src={SAMPLE}
                      alt={t("sampleAlt")}
                      camera={camera(s)}
                      p={at}
                      aspect={aspect}
                    />
                    <figcaption>{t(`frames.${at * 2}`)}</figcaption>
                  </figure>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className={styles.dialogActions}>
        <button type="button" onClick={onClose}>
          {t("cancel")}
        </button>
        <button
          type="button"
          className={styles.primary}
          onClick={() =>
            onChoose({ move, speed: STRENGTHS[strength] * maxSpeed })
          }
        >
          {t("useMove", {
            move: tm(move),
            strength: t(`strengths.${strength}`),
          })}
        </button>
      </div>
    </dialog>
  );
}
