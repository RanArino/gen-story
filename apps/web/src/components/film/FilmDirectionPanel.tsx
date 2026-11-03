"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  FILM_CAMERA_MOVES,
  FILM_FOOTSTEP_SURFACES,
  FILM_MELODY_DENSITIES,
  FILM_MUSIC_ARCS,
  FILM_MUSIC_INSTRUMENTS,
  FILM_MUSIC_JOINS,
  FILM_MUSIC_KEYS,
  FILM_SCENE_SOUNDS,
  type AiRuntimeInfoDto,
  type FilmDetailDto,
  type FilmDirectionContentDto,
  type FilmDirectionDto,
  type FilmSceneDirectionDto,
} from "@gen-story/shared";
import {
  approveFilmDirection,
  getAiRuntimeInfo,
  requestFilmDirection,
  updateFilmDirection,
} from "../../lib/api-client";
import { ErrorAlert } from "../ErrorAlert";
import page from "./FilmPage.module.css";
import styles from "./FilmDirectionPanel.module.css";

type Request = {
  scope: "film" | "chapter";
  chapterId?: string;
  sceneId?: string;
  regenerate: boolean;
  photos: number;
};

/** Rough wall-clock guide for one Agent call with photos, shown before the user confirms. */
const estimateMinutes = (photos: number) =>
  Math.max(1, Math.round((20 + 7 * photos) / 60));

export function FilmDirectionPanel({
  projectId,
  detail,
  dirty,
  busy,
  action,
  onDetail,
  reload,
  imageUrl,
  thumbnail,
}: {
  projectId: string;
  detail: FilmDetailDto;
  dirty: boolean;
  busy: boolean;
  action: (fn: () => Promise<void>) => void;
  onDetail: (detail: FilmDetailDto) => void;
  reload: () => Promise<void>;
  imageUrl: (sceneId: string) => string | null;
  thumbnail: (sceneId: string) => ReactNode;
}) {
  const t = useTranslations("film.direction");
  const [runtime, setRuntime] = useState<AiRuntimeInfoDto | null>(null);
  const [confirm, setConfirm] = useState<Request | null>(null);
  const [edits, setEdits] = useState<Record<string, FilmDirectionContentDto>>(
    {},
  );
  const [chapterChoice, setChapterChoice] = useState<string>("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  const treatment = detail.treatment;
  const chapters = treatment.chapters.filter((c) => c.scenes.length);
  const chosen = chapters.find((c) => c.id === chapterChoice) ?? chapters[0];
  useEffect(() => {
    void getAiRuntimeInfo()
      .then(setRuntime)
      .catch(() => setRuntime(null));
  }, []);
  useEffect(() => {
    if (confirm) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [confirm]);

  const latest = (chapterId: string) =>
    detail.directions.find((d) => d.chapterId === chapterId);
  const stale = (d: FilmDirectionDto) =>
    detail.directionInputDigests[d.chapterId] !== undefined &&
    d.inputDigest !== detail.directionInputDigests[d.chapterId];
  const usable = (d: FilmDirectionDto | undefined) =>
    !!d && d.status !== "failed" && !stale(d);

  function ask(request: Request) {
    const targets =
      request.scope === "film"
        ? chapters
        : chapters.filter((c) => c.id === request.chapterId);
    // A current direction is reused by the server without an Agent call, so no confirmation.
    if (!request.regenerate && targets.every((c) => usable(latest(c.id))))
      return send(request);
    setConfirm(request);
  }
  function send(request: Request) {
    setConfirm(null);
    action(async () => {
      await requestFilmDirection(projectId, {
        scope: request.scope,
        chapterId: request.chapterId,
        sceneId: request.sceneId,
        regenerate: request.regenerate,
      });
      await reload();
    });
  }
  function approve(ids: string[]) {
    action(async () => {
      let revision = treatment.revision;
      for (const id of ids) {
        if (edits[id]) await updateFilmDirection(projectId, id, edits[id]!);
        const next = await approveFilmDirection(projectId, id, revision);
        revision = next.treatment.revision;
        onDetail(next);
      }
      setEdits((current) => {
        const rest = { ...current };
        for (const id of ids) delete rest[id];
        return rest;
      });
    });
  }

  const blocked = dirty || busy || !treatment.revision;
  const runtimeReady =
    runtime?.runtime === "claude" || runtime?.runtime === "codex";
  const proposedInFilmRequest = detail.directions.filter(
    (d) =>
      d.scope === "film" &&
      d.status === "proposed" &&
      !stale(d) &&
      d.requestId ===
        detail.directions.find((x) => x.scope === "film")?.requestId,
  );

  return (
    <section className={styles.panel} aria-labelledby="film-direction-heading">
      <div className={page.sectionHeading}>
        <div>
          <p className={page.eyebrow}>{t("step")}</p>
          <h3 id="film-direction-heading">{t("title")}</h3>
          <p>{t("hint")}</p>
        </div>
      </div>
      {dirty && <p role="status">{t("saveFirst")}</p>}
      <div className={styles.requestRow}>
        <button
          className={page.primary}
          disabled={blocked || !chapters.length}
          onClick={() =>
            ask({
              scope: "film",
              regenerate: false,
              photos: chapters.reduce((n, c) => n + c.scenes.length, 0),
            })
          }
        >
          {t("directFilm")}
        </button>
        <span className={styles.or}>{t("or")}</span>
        <select
          aria-label={t("chapterForDirection")}
          value={chosen?.id ?? ""}
          onChange={(e) => setChapterChoice(e.target.value)}
          disabled={blocked || !chapters.length}
        >
          {chapters.map((c, i) => (
            <option key={c.id} value={c.id}>
              {String(i + 1).padStart(2, "0")} {c.title}
            </option>
          ))}
        </select>
        <button
          disabled={blocked || !chosen}
          onClick={() =>
            chosen &&
            ask({
              scope: "chapter",
              chapterId: chosen.id,
              regenerate: false,
              photos: chosen.scenes.length,
            })
          }
        >
          {t("directChapter")}
        </button>
      </div>
      {proposedInFilmRequest.length > 1 && (
        <button
          className={styles.approveAll}
          disabled={blocked}
          onClick={() => approve(proposedInFilmRequest.map((d) => d.id))}
        >
          {t("approveAll", { count: proposedInFilmRequest.length })}
        </button>
      )}
      {treatment.chapters.map((chapter, index) => {
        const direction = latest(chapter.id);
        if (!direction) return null;
        const approvedBefore = detail.directions.some(
          (d) =>
            d.chapterId === chapter.id &&
            d.status === "approved" &&
            d.id !== direction.id,
        );
        const content = edits[direction.id] ?? direction.content;
        const editable = direction.status === "proposed" && !stale(direction);
        const regenerate = (sceneId?: string) =>
          ask({
            scope: "chapter",
            chapterId: chapter.id,
            sceneId,
            regenerate: true,
            photos: sceneId ? 1 : chapter.scenes.length,
          });
        const change = (next: FilmDirectionContentDto) =>
          setEdits((e) => ({ ...e, [direction.id]: next }));
        return (
          <article
            key={chapter.id}
            className={styles.review}
            aria-label={t("reviewFor", { title: chapter.title })}
          >
            <header className={styles.reviewHeader}>
              <h4>
                {t("reviewTitle", {
                  number: String(index + 1).padStart(2, "0"),
                  title: chapter.title,
                })}
              </h4>
              <span
                className={`${styles.badge} ${styles[stale(direction) ? "stale" : direction.status]}`}
                role="status"
              >
                {stale(direction)
                  ? t("status.stale")
                  : t(`status.${direction.status}`)}
              </span>
            </header>
            {direction.status === "generating" && (
              <p className={styles.note}>{t("generating")}</p>
            )}
            {direction.status === "failed" && (
              <>
                <ErrorAlert message={direction.error ?? t("failed")} />
                {approvedBefore && (
                  <p className={styles.note}>{t("previousStillUsed")}</p>
                )}
                <button disabled={blocked} onClick={() => regenerate()}>
                  {t("retry")}
                </button>
              </>
            )}
            {stale(direction) && (
              <div className={styles.staleBanner}>
                <p>{t("staleHint")}</p>
                <button disabled={blocked} onClick={() => regenerate()}>
                  {t("regenerateChapter")}
                </button>
              </div>
            )}
            {content && direction.status !== "failed" && (
              <fieldset disabled={!editable || blocked} className={styles.form}>
                <div className={styles.chapterFields}>
                  <label>
                    {t("chapterName")}
                    <input
                      value={content.chapterName}
                      maxLength={200}
                      onChange={(e) =>
                        change({ ...content, chapterName: e.target.value })
                      }
                    />
                  </label>
                  <p className={styles.reason}>{content.nameReason}</p>
                </div>
                <MusicFields
                  value={content.music}
                  onChange={(music) => change({ ...content, music })}
                />
                <ol className={styles.scenes}>
                  {content.scenes.map((scene, i) => (
                    <SceneFields
                      key={scene.sceneId}
                      number={i + 1}
                      value={scene}
                      image={imageUrl(scene.sceneId)}
                      fallback={thumbnail(scene.sceneId)}
                      onChange={(next) =>
                        change({
                          ...content,
                          scenes: content.scenes.map((s, k) =>
                            k === i ? next : s,
                          ),
                        })
                      }
                      onRegenerate={
                        editable ? () => regenerate(scene.sceneId) : undefined
                      }
                    />
                  ))}
                </ol>
              </fieldset>
            )}
            {content &&
              direction.status !== "failed" &&
              direction.status !== "generating" && (
                <div className={styles.reviewActions}>
                  {direction.model && (
                    <small>{t("madeBy", { model: direction.model })}</small>
                  )}
                  <button disabled={blocked} onClick={() => regenerate()}>
                    {t("regenerateChapter")}
                  </button>
                  {editable && (
                    <button
                      className={page.primary}
                      disabled={blocked}
                      onClick={() => approve([direction.id])}
                    >
                      {t("approve")}
                    </button>
                  )}
                </div>
              )}
          </article>
        );
      })}
      <dialog
        ref={dialogRef}
        className={page.dialog}
        aria-label={t("confirmTitle")}
        onCancel={() => setConfirm(null)}
        onClose={() => setConfirm(null)}
      >
        {confirm && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(confirm);
            }}
          >
            <h3>{t("confirmTitle")}</h3>
            <dl className={styles.confirmList}>
              <dt>{t("runtime")}</dt>
              <dd>
                {runtime
                  ? t(`runtimes.${runtime.runtime}`)
                  : t("runtimeUnknown")}
              </dd>
              <dt>{t("photos")}</dt>
              <dd>{t("photoCount", { count: confirm.photos })}</dd>
              <dt>{t("estimate")}</dt>
              <dd>
                {t("minutes", { count: estimateMinutes(confirm.photos) })}
              </dd>
            </dl>
            <p className={styles.note}>
              {runtimeReady ? t("confirmHint") : t("runtimeUnsupported")}
            </p>
            <div className={page.dialogActions}>
              <button type="button" onClick={() => setConfirm(null)}>
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
    </section>
  );
}

function MusicFields({
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

function Range({
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

function SceneFields({
  number,
  value,
  image,
  fallback,
  onChange,
  onRegenerate,
}: {
  number: number;
  value: FilmSceneDirectionDto;
  image: string | null;
  fallback: ReactNode;
  onChange: (value: FilmSceneDirectionDto) => void;
  onRegenerate?: () => void;
}) {
  const t = useTranslations("film.direction");
  const [adding, setAdding] = useState("");
  const camera = value.camera;
  return (
    <li className={styles.scene}>
      <div className={styles.focusPicker}>
        {image ? (
          <button
            type="button"
            aria-label={t("setFocus", { number })}
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              const round = (v: number) =>
                Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
              onChange({
                ...value,
                camera: {
                  ...camera,
                  focus: {
                    x: round((e.clientX - box.left) / box.width),
                    y: round((e.clientY - box.top) / box.height),
                  },
                },
              });
            }}
          >
            <img src={image} alt="" />
            <span
              className={styles.focusMarker}
              style={{
                left: `${camera.focus.x * 100}%`,
                top: `${camera.focus.y * 100}%`,
              }}
              aria-hidden
            />
          </button>
        ) : (
          fallback
        )}
        <small>{t("focusHint")}</small>
      </div>
      <div className={styles.sceneFields}>
        <p className={styles.observation}>
          <strong>{t("observed", { number })}</strong> {value.observation}
        </p>
        <div className={styles.cameraRow}>
          <label>
            {t("camera")}
            <select
              value={camera.move}
              onChange={(e) =>
                onChange({
                  ...value,
                  camera: {
                    ...camera,
                    move: e.target.value as typeof camera.move,
                  },
                })
              }
            >
              {FILM_CAMERA_MOVES.map((m) => (
                <option key={m} value={m}>
                  {t(`moves.${m}`)}
                </option>
              ))}
            </select>
          </label>
          <Range
            label={t("speed")}
            value={camera.speed}
            onChange={(speed) =>
              onChange({ ...value, camera: { ...camera, speed } })
            }
          />
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
        </div>
        {camera.reason && <p className={styles.reason}>{camera.reason}</p>}
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
        <details className={styles.more}>
          <summary>{t("lookAndAmbience")}</summary>
          <div className={styles.ranges}>
            {(["rays", "motes", "leaves"] as const).map((key) => (
              <Range
                key={key}
                label={t(`effects.${key}`)}
                value={value.effects[key]}
                onChange={(v) =>
                  onChange({
                    ...value,
                    effects: { ...value.effects, [key]: v },
                  })
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
                  onChange({
                    ...value,
                    ambience: { ...value.ambience, [key]: v },
                  })
                }
              />
            ))}
          </div>
        </details>
        <div className={styles.captions}>
          <label>
            {t("captionJa")}
            <textarea
              rows={2}
              maxLength={120}
              value={value.captions.ja}
              onChange={(e) =>
                onChange({
                  ...value,
                  captions: { ...value.captions, ja: e.target.value },
                })
              }
            />
          </label>
          <label>
            {t("captionEn")}
            <textarea
              rows={2}
              maxLength={200}
              value={value.captions.en}
              onChange={(e) =>
                onChange({
                  ...value,
                  captions: { ...value.captions, en: e.target.value },
                })
              }
            />
          </label>
        </div>
        {onRegenerate && (
          <button
            type="button"
            className={styles.regenerateScene}
            onClick={onRegenerate}
          >
            {t("regenerateScene")}
          </button>
        )}
      </div>
    </li>
  );
}
