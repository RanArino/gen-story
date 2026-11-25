"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  FILM_FOOTSTEP_SURFACES,
  FILM_MELODY_DENSITIES,
  FILM_MUSIC_ARCS,
  FILM_MUSIC_INSTRUMENTS,
  FILM_MUSIC_JOINS,
  FILM_MUSIC_KEYS,
  FILM_SCENE_SOUNDS,
  type AiRuntimeInfoDto,
  type FilmDirectionContentDto,
  type FilmSceneDirectionDto,
} from "@gen-story/shared";
import { getAiRuntimeInfo } from "../../lib/api-client";
import page from "./FilmPage.module.css";
import styles from "./FilmDirectionPanel.module.css";

export type DirectionRequest = {
  scope: "film" | "chapter";
  chapterId?: string;
  sceneId?: string;
  regenerate: boolean;
  photos: number;
};

/** Rough wall-clock guide for one Agent call with photos, shown before the user confirms. */
const estimateMinutes = (photos: number) =>
  Math.max(1, Math.round((20 + 7 * photos) / 60));

/** Scope, runtime, photo count and estimated wait, shown before any request that calls the AI. */
export function DirectionConfirmDialog({
  request,
  onCancel,
  onConfirm,
}: {
  request: DirectionRequest | null;
  onCancel: () => void;
  onConfirm: (request: DirectionRequest) => void;
}) {
  const t = useTranslations("film.direction");
  const [runtime, setRuntime] = useState<AiRuntimeInfoDto | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    void getAiRuntimeInfo()
      .then(setRuntime)
      .catch(() => setRuntime(null));
  }, []);
  useEffect(() => {
    if (request) ref.current?.showModal();
    else ref.current?.close();
  }, [request]);
  const runtimeReady =
    runtime?.runtime === "claude" || runtime?.runtime === "codex";
  return (
    <dialog
      ref={ref}
      className={page.dialog}
      aria-label={t("confirmTitle")}
      onCancel={onCancel}
      onClose={onCancel}
    >
      {request && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(request);
          }}
        >
          <h3>{t("confirmTitle")}</h3>
          <dl className={styles.confirmList}>
            <dt>{t("scope")}</dt>
            <dd>
              {request.sceneId
                ? t("scopes.scene")
                : t(`scopes.${request.scope}`)}
            </dd>
            <dt>{t("runtime")}</dt>
            <dd>
              {runtime ? t(`runtimes.${runtime.runtime}`) : t("runtimeUnknown")}
            </dd>
            <dt>{t("photos")}</dt>
            <dd>{t("photoCount", { count: request.photos })}</dd>
            <dt>{t("estimate")}</dt>
            <dd>{t("minutes", { count: estimateMinutes(request.photos) })}</dd>
          </dl>
          <p className={styles.note}>
            {runtimeReady ? t("confirmHint") : t("runtimeUnsupported")}
          </p>
          <div className={page.dialogActions}>
            <button type="button" onClick={onCancel}>
              {t("cancel")}
            </button>
            <button
              className={page.primary}
              type="submit"
              disabled={!runtimeReady}
            >
              {t("create")}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}

export function MusicFields({
  value,
  onChange,
}: {
  value: FilmDirectionContentDto["music"];
  onChange: (music: FilmDirectionContentDto["music"]) => void;
}) {
  const t = useTranslations("film.direction");
  return (
    <div className={styles.music}>
      <span className={styles.groupLabel}>{t("music")}</span>
      <label>
        {t("mood")}
        <input
          value={value.mood}
          maxLength={60}
          onChange={(e) => onChange({ ...value, mood: e.target.value })}
        />
      </label>
      <label>
        {t("tempo")}
        <input
          type="number"
          min={50}
          max={140}
          value={value.tempoBpm}
          onChange={(e) =>
            onChange({ ...value, tempoBpm: Number(e.target.value) })
          }
        />
      </label>
      <label>
        {t("key")}
        <select
          value={value.key}
          onChange={(e) =>
            onChange({ ...value, key: e.target.value as typeof value.key })
          }
        >
          {FILM_MUSIC_KEYS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <label>
        {t("mode")}
        <select
          value={value.mode}
          onChange={(e) =>
            onChange({ ...value, mode: e.target.value as typeof value.mode })
          }
        >
          <option value="major">{t("modes.major")}</option>
          <option value="minor">{t("modes.minor")}</option>
        </select>
      </label>
      <label>
        {t("melody")}
        <select
          value={value.melody}
          onChange={(e) =>
            onChange({
              ...value,
              melody: e.target.value as typeof value.melody,
            })
          }
        >
          {FILM_MELODY_DENSITIES.map((m) => (
            <option key={m} value={m}>
              {t(`melodies.${m}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("arc")}
        <select
          value={value.arc}
          onChange={(e) =>
            onChange({ ...value, arc: e.target.value as typeof value.arc })
          }
        >
          {FILM_MUSIC_ARCS.map((a) => (
            <option key={a} value={a}>
              {t(`arcs.${a}`)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("fromPrevious")}
        <select
          value={value.fromPrevious}
          onChange={(e) =>
            onChange({
              ...value,
              fromPrevious: e.target.value as typeof value.fromPrevious,
            })
          }
        >
          {FILM_MUSIC_JOINS.map((j) => (
            <option key={j} value={j}>
              {t(`joins.${j}`)}
            </option>
          ))}
        </select>
      </label>
      <fieldset className={styles.chips}>
        <legend>{t("instruments")}</legend>
        {FILM_MUSIC_INSTRUMENTS.map((instrument) => (
          <label key={instrument} className={styles.chip}>
            <input
              type="checkbox"
              checked={value.instruments.includes(instrument)}
              onChange={(e) =>
                onChange({
                  ...value,
                  instruments: e.target.checked
                    ? [...value.instruments, instrument]
                    : value.instruments.filter((i) => i !== instrument),
                })
              }
            />
            {t(`instrumentNames.${instrument}`)}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

export function Range({
  label,
  value,
  min = 0,
  onChange,
}: {
  label: string;
  value: number;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className={styles.range}>
      {label}
      <input
        type="range"
        min={min}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

/** Footsteps, one-shot sounds, light and ambience for one scene: revealed on demand. */
export function SceneLightAndSound({
  value,
  onChange,
}: {
  value: FilmSceneDirectionDto;
  onChange: (value: FilmSceneDirectionDto) => void;
}) {
  const t = useTranslations("film.direction");
  const [adding, setAdding] = useState("");
  return (
    <details className={styles.more}>
      <summary>{t("lightAndSound")}</summary>
      <label>
        {t("footsteps")}
        <select
          value={value.footsteps}
          onChange={(e) =>
            onChange({
              ...value,
              footsteps: e.target.value as typeof value.footsteps,
            })
          }
        >
          {FILM_FOOTSTEP_SURFACES.map((f) => (
            <option key={f} value={f}>
              {t(`surfaces.${f}`)}
            </option>
          ))}
        </select>
      </label>
      <div className={styles.soundRow}>
        <span className={styles.groupLabel}>{t("sounds")}</span>
        {value.sounds.map((sound, k) => (
          <span key={`${sound.sound}-${k}`} className={styles.soundChip}>
            {t(`soundNames.${sound.sound}`)}
            <button
              type="button"
              aria-label={t("removeSound", {
                name: t(`soundNames.${sound.sound}`),
              })}
              onClick={() =>
                onChange({
                  ...value,
                  sounds: value.sounds.filter((_, j) => j !== k),
                })
              }
            >
              ×
            </button>
          </span>
        ))}
        {!value.sounds.length && <small>{t("silence")}</small>}
        {value.sounds.length < 6 && (
          <select
            aria-label={t("addSound")}
            value={adding}
            onChange={(e) => {
              const sound = e.target
                .value as (typeof FILM_SCENE_SOUNDS)[number];
              setAdding("");
              if (sound)
                onChange({
                  ...value,
                  sounds: [...value.sounds, { sound, at: 0.5, gain: 0.6 }],
                });
            }}
          >
            <option value="">{t("addSound")}</option>
            {FILM_SCENE_SOUNDS.map((s) => (
              <option key={s} value={s}>
                {t(`soundNames.${s}`)}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className={styles.ranges}>
        {(["rays", "motes", "leaves"] as const).map((key) => (
          <Range
            key={key}
            label={t(`effects.${key}`)}
            value={value.effects[key]}
            onChange={(v) =>
              onChange({ ...value, effects: { ...value.effects, [key]: v } })
            }
          />
        ))}
        <Range
          label={t("effects.warmth")}
          min={-1}
          value={value.effects.warmth}
          onChange={(warmth) =>
            onChange({ ...value, effects: { ...value.effects, warmth } })
          }
        />
        {(["wind", "stream"] as const).map((key) => (
          <Range
            key={key}
            label={t(`ambience.${key}`)}
            value={value.ambience[key]}
            onChange={(v) =>
              onChange({ ...value, ambience: { ...value.ambience, [key]: v } })
            }
          />
        ))}
      </div>
    </details>
  );
}
