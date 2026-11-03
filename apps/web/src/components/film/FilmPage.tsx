"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  FILM_ASPECTS,
  FILM_SUBTITLE_MODES,
  type FilmDetailDto,
  type FilmTreatment,
  type FilmJob,
  type FilmSubtitleMode,
} from "@gen-story/shared";
import {
  getFilm,
  saveFilm,
  renderFilm,
  adoptOriginalImage,
  adoptGeneratedImage,
  filmArtifactUrl,
} from "../../lib/api-client";
import { storageKeyToUrl } from "../../lib/image-url";
import { AppShell } from "../AppShell";
import { ErrorAlert } from "../ErrorAlert";
import styles from "./FilmPage.module.css";
import panel from "./FilmDirectionPanel.module.css";
import { FilmDirectionPanel } from "./FilmDirectionPanel";

const APPROVAL_NEEDED = "Approve the AI direction";
const ASPECT_SHAPES = {
  "16:9": { width: 22, height: 12 },
  "9:16": { width: 12, height: 22 },
  "1:1": { width: 16, height: 16 },
} as const;

export function FilmPage({ projectId }: { projectId: string }) {
  const t = useTranslations("film");
  const [detail, setDetail] = useState<FilmDetailDto | null>(null);
  const [draft, setDraft] = useState<FilmTreatment | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"create" | "move" | null>(null);
  const [chapterName, setChapterName] = useState("");
  const [subtitles, setSubtitles] = useState<FilmSubtitleMode>("both");
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dialog) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [dialog]);
  const load = useCallback(async () => {
    const value = await getFilm(projectId, subtitles);
    setDetail(value);
    setDraft((current) => current ?? value.treatment);
  }, [projectId, subtitles]);
  useEffect(() => {
    void load().catch((e) => setError(String(e)));
  }, [load]);
  const active =
    detail?.jobs.some((j) => j.status === "queued" || j.status === "running") ||
    detail?.directions.some((d) => d.status === "generating");
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      void load().catch((e) => setError(String(e)));
    }, 2500);
    return () => clearInterval(timer);
  }, [active, load]);
  function edit(change: Partial<FilmTreatment>) {
    setDraft((d) => (d ? { ...d, ...change } : d));
    setDirty(true);
  }
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  if (!detail || !draft)
    return (
      <AppShell projectId={projectId}>
        {error ? <ErrorAlert message={error} /> : <p>{t("loading")}</p>}
      </AppShell>
    );
  function output(job: FilmJob | undefined, current = true) {
    if (!job) return null;
    return (
      <div className={styles.output}>
        <p role="status">
          {t(`status.${job.status}`)}
          {!current ? ` · ${t("previousRevision")}` : ""}
        </p>
        {job.error && <ErrorAlert message={job.error} />}
        {job.status === "succeeded" && (
          <>
            <video
              controls
              preload="metadata"
              src={filmArtifactUrl(projectId, job.id)}
              aria-label={t("player")}
            />
            <a href={filmArtifactUrl(projectId, job.id, true)}>
              {t("download")}
            </a>
          </>
        )}
      </div>
    );
  }
  const membership = new Map(
    draft.chapters.flatMap((chapter) =>
      chapter.scenes.map((entry) => [entry.sceneId, chapter] as const),
    ),
  );
  const unassigned = detail.scenes.filter((scene) => !membership.has(scene.id));
  const currentFilter = filter ?? (unassigned.length ? "unassigned" : "all");
  const visible =
    currentFilter === "all"
      ? detail.scenes
      : currentFilter === "unassigned"
        ? unassigned
        : (
            draft.chapters.find((c) => c.id === currentFilter)?.scenes ?? []
          ).flatMap((entry) =>
            detail.scenes.filter((s) => s.id === entry.sceneId),
          );
  const editing = draft.chapters.find((c) => c.id === currentFilter);
  function chooseFilter(value: string) {
    setFilter(value);
    setSelection([]);
  }
  function toggle(id: string) {
    setSelection((ids) =>
      ids.includes(id) ? ids.filter((s) => s !== id) : [...ids, id],
    );
  }
  function imageUrl(id: string) {
    const scene = detail!.scenes.find((s) => s.id === id);
    const image = scene?.selectedImageId
      ? scene.images.find((i) => i.id === scene.selectedImageId)
      : scene?.original;
    return image ? storageKeyToUrl(image.storageKey) : null;
  }
  function thumbnail(id: string, className?: string) {
    const scene = detail!.scenes.find((s) => s.id === id);
    const image = scene?.selectedImageId
      ? scene.images.find((i) => i.id === scene.selectedImageId)
      : scene?.original;
    return image ? (
      <img
        className={className}
        src={storageKeyToUrl(image.storageKey)}
        alt={scene?.title ?? ""}
      />
    ) : (
      <span className={styles.missingImage}>{t("missingScene")}</span>
    );
  }
  function transfer(destination: string | null, newTitle?: string) {
    const entries = selection.map(
      (sceneId) =>
        membership.get(sceneId)?.scenes.find((s) => s.sceneId === sceneId) ?? {
          sceneId,
        },
    );
    const chapters = draft!.chapters.map((chapter) => ({
      ...chapter,
      scenes:
        chapter.id === destination
          ? [
              ...chapter.scenes,
              ...entries.filter(
                (entry) =>
                  !chapter.scenes.some((s) => s.sceneId === entry.sceneId),
              ),
            ]
          : chapter.scenes.filter(
              (entry) => !selection.includes(entry.sceneId),
            ),
    }));
    if (newTitle && destination)
      chapters.push({
        id: destination,
        title: newTitle,
        limitMs: 60000,
        scenes: entries,
      });
    edit({ chapters });
    setSelection([]);
    setDialog(null);
    if (destination) setFilter(destination);
  }
  function changeChapter(
    id: string,
    change: Partial<FilmTreatment["chapters"][number]>,
  ) {
    edit({
      chapters: draft!.chapters.map((c) =>
        c.id === id ? { ...c, ...change } : c,
      ),
    });
  }
  function save() {
    void action(async () => {
      const value = await saveFilm(draft!);
      setDetail(value);
      setDraft(value.treatment);
      setDirty(false);
    });
  }
  return (
    <AppShell projectId={projectId}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t("organizeStep")}</p>
          <h2>{t("title")}</h2>
          <p>{t("subtitle")}</p>
        </div>
        <div className={styles.saveBar}>
          <span role="status">{dirty ? t("unsaved") : t("saved")}</span>
          <button
            className={styles.primary}
            disabled={busy || !dirty}
            onClick={save}
          >
            {t("save")}
          </button>
        </div>
      </header>
      {error && <ErrorAlert message={error} />}
      {!detail.scenes.length && <p>{t("noScenes")}</p>}
      <fieldset disabled={busy} className={styles.editor}>
        <div className={styles.workspace}>
          <section className={styles.library} aria-label={t("images")}>
            <div className={styles.sectionHeading}>
              <div>
                <h3>{editing?.title ?? t("images")}</h3>
                <p>{editing ? t("editingHint") : t("selectionHint")}</p>
              </div>
              <span className={styles.count}>
                {t("photoCount", { count: visible.length })}
              </span>
            </div>
            <div className={styles.filters} aria-label={t("photoFilters")}>
              <button
                aria-pressed={currentFilter === "unassigned"}
                onClick={() => chooseFilter("unassigned")}
              >
                {t("unassigned")} <span>{unassigned.length}</span>
              </button>
              <button
                aria-pressed={currentFilter === "all"}
                onClick={() => chooseFilter("all")}
              >
                {t("allPhotos")} <span>{detail.scenes.length}</span>
              </button>
              {editing && (
                <span className={styles.activeFilter}>{editing.title}</span>
              )}
            </div>
            <div className={styles.selectionBar}>
              <label className={styles.selectAll}>
                <input
                  type="checkbox"
                  checked={
                    visible.length > 0 &&
                    visible.every((s) => selection.includes(s.id))
                  }
                  disabled={!visible.length}
                  onChange={(e) =>
                    setSelection(
                      e.target.checked ? visible.map((s) => s.id) : [],
                    )
                  }
                />
                {t("selectAll")}
              </label>
              <span role="status">
                {t("selectedCount", { count: selection.length })}
              </span>
              {!!selection.length && (
                <button onClick={() => setSelection([])}>
                  {t("clearSelection")}
                </button>
              )}
            </div>
            <div
              className={`${styles.images} ${editing ? styles.captionImages : ""}`}
            >
              {visible.map((scene) => {
                const chapter = membership.get(scene.id);
                const entry = chapter?.scenes.find(
                  (s) => s.sceneId === scene.id,
                );
                const at =
                  chapter?.scenes.findIndex((s) => s.sceneId === scene.id) ??
                  -1;
                const resolved = !dirty
                  ? detail.preflight
                      .find((p) => p.chapterId === chapter?.id)
                      ?.durations.find((s) => s.sceneId === scene.id)
                      ?.durationMs
                  : undefined;
                function reorder(offset: number) {
                  if (!chapter) return;
                  const scenes = [...chapter.scenes];
                  [scenes[at], scenes[at + offset]] = [
                    scenes[at + offset]!,
                    scenes[at]!,
                  ];
                  changeChapter(chapter.id, { scenes });
                }
                return (
                  <div
                    key={scene.id}
                    className={`${styles.imageCard} ${editing ? styles.captionCard : ""} ${selection.includes(scene.id) ? styles.selected : ""}`}
                  >
                    <button
                      className={styles.photoSelect}
                      aria-label={t("selectPhoto", { title: scene.title })}
                      aria-pressed={selection.includes(scene.id)}
                      onClick={() => toggle(scene.id)}
                    >
                      {thumbnail(scene.id)}
                      <span className={styles.selectionMark} aria-hidden="true">
                        {selection.includes(scene.id) ? "✓" : ""}
                      </span>
                      <span className={styles.photoCaption}>{scene.title}</span>
                    </button>
                    <div className={styles.photoMeta}>
                      <span>{chapter?.title ?? t("unassigned")}</span>
                    </div>
                    {editing && (
                      <div className={styles.captionEditor}>
                        <label>
                          {t("caption")}
                          <textarea
                            aria-label={t("captionFor", { title: scene.title })}
                            rows={2}
                            maxLength={120}
                            value={
                              draft.sceneCaptions?.[scene.id]?.ja ?? scene.title
                            }
                            onChange={(e) =>
                              edit({
                                sceneCaptions: {
                                  ...draft.sceneCaptions,
                                  [scene.id]: {
                                    ja: e.target.value,
                                    en:
                                      draft.sceneCaptions?.[scene.id]?.en ?? "",
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <label>
                          {t("secondaryCaption")}
                          <textarea
                            aria-label={t("secondaryCaptionFor", {
                              title: scene.title,
                            })}
                            rows={2}
                            maxLength={200}
                            value={draft.sceneCaptions?.[scene.id]?.en ?? ""}
                            onChange={(e) =>
                              edit({
                                sceneCaptions: {
                                  ...draft.sceneCaptions,
                                  [scene.id]: {
                                    ja:
                                      draft.sceneCaptions?.[scene.id]?.ja ??
                                      scene.title,
                                    en: e.target.value,
                                  },
                                },
                              })
                            }
                          />
                        </label>
                        <div className={styles.captionActions}>
                          <small>{t("captionHint")}</small>
                          <button
                            disabled={
                              !Object.hasOwn(
                                draft.sceneCaptions ?? {},
                                scene.id,
                              )
                            }
                            onClick={() => {
                              const captions = { ...draft.sceneCaptions };
                              delete captions[scene.id];
                              edit({ sceneCaptions: captions });
                            }}
                            aria-label={t("resetCaptionFor", {
                              title: scene.title,
                            })}
                          >
                            {t("resetCaption")}
                          </button>
                        </div>
                      </div>
                    )}
                    <details className={styles.imageSource}>
                      <summary>{t("changeImage")}</summary>
                      <label>
                        {t("imageFor")} {scene.title}
                        <select
                          aria-label={`${t("imageFor")} ${scene.title}`}
                          value={scene.selectedImageId ?? "original"}
                          onChange={(e) => {
                            const value = e.target.value;
                            void action(async () => {
                              if (value === "original")
                                await adoptOriginalImage(projectId, scene.id);
                              else await adoptGeneratedImage(scene.id, value);
                              await load();
                            });
                          }}
                        >
                          <option value="original" disabled={!scene.original}>
                            {t("original")}
                          </option>
                          {scene.images.map((image, i) => (
                            <option key={image.id} value={image.id}>
                              {t("generated", { number: i + 1 })}
                            </option>
                          ))}
                        </select>
                      </label>
                    </details>
                    {editing && entry && chapter && (
                      <div className={styles.photoTiming}>
                        <label>
                          {t("seconds")}
                          <input
                            type="number"
                            min="0.001"
                            step="0.001"
                            value={
                              entry.durationMs === undefined
                                ? ""
                                : entry.durationMs / 1000
                            }
                            placeholder={
                              resolved
                                ? String(resolved / 1000)
                                : t("automatic")
                            }
                            onChange={(e) =>
                              changeChapter(chapter.id, {
                                scenes: chapter.scenes.map((s) =>
                                  s.sceneId === scene.id
                                    ? {
                                        ...s,
                                        durationMs:
                                          e.target.value === ""
                                            ? undefined
                                            : Math.round(
                                                Number(e.target.value) * 1000,
                                              ),
                                      }
                                    : s,
                                ),
                              })
                            }
                          />
                        </label>
                        <div>
                          <button
                            disabled={at === 0}
                            aria-label={t("sceneUp")}
                            onClick={() => reorder(-1)}
                          >
                            ←
                          </button>
                          <span>{at + 1}</span>
                          <button
                            disabled={at === chapter.scenes.length - 1}
                            aria-label={t("sceneDown")}
                            onClick={() => reorder(1)}
                          >
                            →
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {!visible.length && (
              <div className={styles.emptyState}>
                <span aria-hidden="true">▧</span>
                <h4>{t("noPhotosHere")}</h4>
                <p>{t("emptyLibraryHint")}</p>
                <button onClick={() => chooseFilter("all")}>
                  {t("allPhotos")}
                </button>
              </div>
            )}
            <div className={styles.bulkBar}>
              <span>{t("selectedCount", { count: selection.length })}</span>
              <button
                className={styles.primary}
                disabled={!selection.length}
                onClick={() => {
                  setChapterName(
                    t("newChapter", { number: draft.chapters.length + 1 }),
                  );
                  setDialog("create");
                }}
              >
                {t("createFromSelection")}
              </button>
              <button
                disabled={!selection.length || !draft.chapters.length}
                onClick={() => setDialog("move")}
              >
                {t("moveToChapter")}
              </button>
              <button
                disabled={!selection.some((id) => membership.has(id))}
                onClick={() => transfer(null)}
              >
                {t("returnUnassigned")}
              </button>
            </div>
          </section>
          <section className={styles.composition} aria-label={t("chapters")}>
            <div className={styles.sectionHeading}>
              <div>
                <h3>{t("chapters")}</h3>
                <p>{t("compositionHint")}</p>
              </div>
              <span className={styles.count}>{draft.chapters.length}</span>
            </div>
            {!draft.chapters.length && (
              <div className={styles.emptyState}>
                <span aria-hidden="true">＋</span>
                <h4>{t("startWithPhotos")}</h4>
                <p>{t("startWithPhotosHint")}</p>
              </div>
            )}
            {draft.chapters.map((chapter, index) => {
              const preflight = detail.preflight.find(
                (c) => c.chapterId === chapter.id,
              );
              const job = detail.jobs.find((j) => j.chapterId === chapter.id);
              const current =
                !dirty && job?.fingerprint === preflight?.fingerprint;
              function change(value: Partial<typeof chapter>) {
                changeChapter(chapter.id, value);
              }
              function move(offset: number) {
                const chapters = [...draft!.chapters];
                [chapters[index], chapters[index + offset]] = [
                  chapters[index + offset]!,
                  chapters[index]!,
                ];
                edit({ chapters });
              }
              return (
                <article
                  key={chapter.id}
                  className={`${styles.chapter} ${editing?.id === chapter.id ? styles.activeChapter : ""}`}
                >
                  <div className={styles.chapterHeading}>
                    <span className={styles.chapterNumber}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h4>{chapter.title}</h4>
                      <span>
                        {t("photoCount", { count: chapter.scenes.length })}
                      </span>
                    </div>
                    <button
                      aria-label={t("editChapter", { title: chapter.title })}
                      aria-pressed={editing?.id === chapter.id}
                      onClick={() => chooseFilter(chapter.id)}
                    >
                      {t("edit")}
                    </button>
                  </div>
                  <button
                    className={styles.chapterPreview}
                    aria-label={t("viewChapter", { title: chapter.title })}
                    onClick={() => chooseFilter(chapter.id)}
                  >
                    {chapter.scenes.map((s) => (
                      <span key={s.sceneId}>{thumbnail(s.sceneId)}</span>
                    ))}
                    {!chapter.scenes.length && (
                      <span className={styles.emptyPreview}>
                        {t("emptyChapter")}
                      </span>
                    )}
                  </button>
                  {editing?.id === chapter.id && (
                    <div className={styles.chapterSettings}>
                      <label>
                        {t("chapterTitle")}
                        <input
                          value={chapter.title}
                          onChange={(e) => change({ title: e.target.value })}
                        />
                      </label>
                      <label>
                        {t("limit")}
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          placeholder={t("unlimited")}
                          value={
                            chapter.limitMs === null
                              ? ""
                              : chapter.limitMs / 1000
                          }
                          onChange={(e) =>
                            change({
                              limitMs:
                                e.target.value === ""
                                  ? null
                                  : Math.round(Number(e.target.value) * 1000),
                            })
                          }
                        />
                      </label>
                      <div className={styles.row}>
                        <button
                          disabled={index === 0}
                          onClick={() => move(-1)}
                          aria-label={t("chapterUp")}
                        >
                          ↑
                        </button>
                        <button
                          disabled={index === draft.chapters.length - 1}
                          onClick={() => move(1)}
                          aria-label={t("chapterDown")}
                        >
                          ↓
                        </button>
                        <button
                          className={styles.remove}
                          onClick={() => {
                            edit({
                              chapters: draft.chapters.filter(
                                (c) => c.id !== chapter.id,
                              ),
                            });
                            chooseFilter("unassigned");
                          }}
                        >
                          {t("remove")}
                        </button>
                      </div>
                      <details>
                        <summary>{t("chapterStyle")}</summary>
                        {(
                          [
                            "pacing",
                            "motionAmount",
                            "emphasis",
                            "sfxLevel",
                            "visualIntensity",
                          ] as const
                        ).map((field) => (
                          <label key={field} className={styles.row}>
                            {t(field)}
                            <input
                              type="range"
                              min={field === "pacing" ? 0.5 : 0}
                              max={field === "pacing" ? 2 : 1}
                              step="0.05"
                              value={
                                chapter.settings?.[field] ??
                                (field === "pacing" || field === "sfxLevel"
                                  ? 1
                                  : 0.5)
                              }
                              onChange={(e) =>
                                change({
                                  settings: {
                                    ...chapter.settings,
                                    [field]: Number(e.target.value),
                                  },
                                })
                              }
                            />
                          </label>
                        ))}
                      </details>
                    </div>
                  )}
                  {!dirty &&
                    preflight?.error &&
                    (preflight.error.startsWith(APPROVAL_NEEDED) ? (
                      <p className={styles.runtime}>
                        {t("direction.approvalNeeded")}
                      </p>
                    ) : (
                      <ErrorAlert message={preflight.error} />
                    ))}
                  {!dirty && !!preflight?.runtimeMs && (
                    <p className={styles.runtime}>
                      {t("runtime", { seconds: preflight.runtimeMs / 1000 })}
                    </p>
                  )}
                  <button
                    disabled={
                      busy ||
                      dirty ||
                      !draft.revision ||
                      !chapter.scenes.length ||
                      !preflight ||
                      !!preflight.error ||
                      job?.status === "running" ||
                      job?.status === "queued"
                    }
                    onClick={() =>
                      void action(async () => {
                        await renderFilm(
                          projectId,
                          chapter.id,
                          draft.revision,
                          subtitles,
                        );
                        await load();
                      })
                    }
                  >
                    {t("renderChapter")}
                  </button>
                  {output(job, current)}
                </article>
              );
            })}
          </section>
        </div>
        <section className={styles.finish}>
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>{t("finishStep")}</p>
              <h3>{t("filmSettings")}</h3>
              <p>{t("finishHint")}</p>
            </div>
          </div>
          <div className={styles.settings}>
            <label>
              {t("overallTitle")}
              <input
                value={draft.title}
                onChange={(e) => edit({ title: e.target.value })}
              />
            </label>
            <label>
              {t("template")}
              <select
                aria-label={t("template")}
                value={draft.recipe}
                onChange={(e) =>
                  edit({ recipe: e.target.value as FilmTreatment["recipe"] })
                }
              >
                <option value="quiet-cinema">Quiet Cinema</option>
                <option value="memory-board">Memory Board</option>
                <option value="pulse-cut">Pulse Cut</option>
              </select>
            </label>
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={draft.reducedMotion}
                onChange={(e) => edit({ reducedMotion: e.target.checked })}
              />
              {t("reducedMotion")}
            </label>
            <fieldset className={panel.sizeOptions}>
              <legend>{t("videoSize")}</legend>
              {FILM_ASPECTS.map((aspect) => (
                <label key={aspect} className={panel.sizeOption}>
                  <input
                    type="radio"
                    name="film-aspect"
                    value={aspect}
                    checked={(draft.outputAspect ?? "16:9") === aspect}
                    onChange={() => edit({ outputAspect: aspect })}
                  />
                  <span
                    className={panel.sizeShape}
                    style={ASPECT_SHAPES[aspect]}
                    aria-hidden
                  />
                  {t(`aspects.${aspect.replace(":", "x")}`)}
                </label>
              ))}
            </fieldset>
          </div>
          {dirty && <p>{t("saveFirst")}</p>}
          <FilmDirectionPanel
            projectId={projectId}
            detail={detail}
            dirty={dirty}
            busy={busy}
            action={(fn) => void action(fn)}
            onDetail={(value) => {
              setDetail(value);
              setDraft(value.treatment);
              setDirty(false);
            }}
            reload={load}
            imageUrl={imageUrl}
            thumbnail={(id) => thumbnail(id)}
          />
          <div className={panel.panel}>
            <div className={styles.sectionHeading}>
              <div>
                <p className={styles.eyebrow}>{t("exportStep")}</p>
                <h3>{t("exportTitle")}</h3>
              </div>
            </div>
            <fieldset className={panel.sizeOptions}>
              <legend>{t("subtitles")}</legend>
              {FILM_SUBTITLE_MODES.map((mode) => (
                <label key={mode} className={panel.sizeOption}>
                  <input
                    type="radio"
                    name="film-subtitles"
                    value={mode}
                    checked={subtitles === mode}
                    onChange={() => setSubtitles(mode)}
                  />
                  {t(`subtitleModes.${mode}`)}
                </label>
              ))}
            </fieldset>
            {subtitles === "none" ? (
              <p className={panel.note}>{t("noSubtitles")}</p>
            ) : (
              <>
                <p className={panel.note}>{t("subtitleReview")}</p>
                <ol className={panel.subtitleList}>
                  {draft.chapters.flatMap((chapter) =>
                    chapter.scenes.map(({ sceneId }) => {
                      const scene = detail.scenes.find((s) => s.id === sceneId);
                      const caption = draft.sceneCaptions?.[sceneId] ?? {
                        ja: scene?.title ?? "",
                        en: "",
                      };
                      const set = (key: "ja" | "en", value: string) =>
                        edit({
                          sceneCaptions: {
                            ...draft.sceneCaptions,
                            [sceneId]: { ...caption, [key]: value },
                          },
                        });
                      return (
                        <li
                          key={sceneId}
                          className={`${panel.subtitleItem} ${subtitles === "both" ? "" : panel.single}`}
                        >
                          {thumbnail(sceneId)}
                          {subtitles !== "en" && (
                            <label>
                              {t("caption")}
                              <textarea
                                rows={2}
                                maxLength={120}
                                aria-label={t("exportJaFor", {
                                  title: scene?.title ?? "",
                                })}
                                value={caption.ja}
                                onChange={(e) => set("ja", e.target.value)}
                              />
                            </label>
                          )}
                          {subtitles !== "ja" && (
                            <label>
                              {t("secondaryCaption")}
                              <textarea
                                rows={2}
                                maxLength={200}
                                aria-label={t("exportEnFor", {
                                  title: scene?.title ?? "",
                                })}
                                value={caption.en}
                                onChange={(e) => set("en", e.target.value)}
                              />
                            </label>
                          )}
                        </li>
                      );
                    }),
                  )}
                </ol>
              </>
            )}
          </div>
          <h3>{t("joined")}</h3>
          <p>{t("joinedDescription")}</p>
          <button
            className={styles.primary}
            disabled={
              busy ||
              dirty ||
              !draft.revision ||
              detail.jobs.some(
                (j) =>
                  j.chapterId === null &&
                  (j.status === "queued" || j.status === "running"),
              ) ||
              detail.preflight.length === 0 ||
              detail.preflight.some((p) => p.error)
            }
            onClick={() =>
              void action(async () => {
                await renderFilm(projectId, null, draft.revision, subtitles);
                await load();
              })
            }
          >
            {t("renderJoined")}
          </button>
          {output(
            detail.jobs.find((j) => j.chapterId === null),
            !dirty &&
              detail.jobs.find((j) => j.chapterId === null)?.fingerprint ===
                detail.currentAssemblyFingerprint,
          )}
        </section>
      </fieldset>
      <dialog
        aria-label={
          dialog === "create" ? t("createFromSelection") : t("moveToChapter")
        }
        ref={dialogRef}
        className={styles.dialog}
        onCancel={() => setDialog(null)}
        onClose={() => setDialog(null)}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (dialog === "create" && chapterName.trim())
              transfer(crypto.randomUUID(), chapterName.trim());
          }}
        >
          <div className={styles.sectionHeading}>
            <h3>
              {dialog === "create"
                ? t("createFromSelection")
                : t("moveToChapter")}
            </h3>
            <button
              type="button"
              aria-label={t("cancel")}
              onClick={() => setDialog(null)}
            >
              ×
            </button>
          </div>
          <p>{t("selectedCount", { count: selection.length })}</p>
          <div className={styles.dialogPhotos}>
            {selection.map((id) => (
              <span key={id}>{thumbnail(id)}</span>
            ))}
          </div>
          {dialog === "create" ? (
            <>
              <label>
                {t("chapterTitle")}
                <input
                  autoFocus
                  required
                  value={chapterName}
                  onChange={(e) => setChapterName(e.target.value)}
                />
              </label>
              <div className={styles.dialogActions}>
                <button type="button" onClick={() => setDialog(null)}>
                  {t("cancel")}
                </button>
                <button
                  className={styles.primary}
                  type="submit"
                  disabled={!chapterName.trim()}
                >
                  {t("createChapter")}
                </button>
              </div>
            </>
          ) : (
            <div className={styles.destinations}>
              {draft.chapters.map((chapter) => (
                <button
                  type="button"
                  key={chapter.id}
                  onClick={() => transfer(chapter.id)}
                >
                  <span className={styles.destinationPhotos}>
                    {chapter.scenes.slice(0, 3).map((s) => (
                      <span key={s.sceneId}>{thumbnail(s.sceneId)}</span>
                    ))}
                  </span>
                  <strong>{chapter.title}</strong>
                  <span>
                    {t("photoCount", { count: chapter.scenes.length })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </form>
      </dialog>
    </AppShell>
  );
}
