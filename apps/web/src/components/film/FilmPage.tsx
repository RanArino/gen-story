"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { FilmDetailDto, FilmTreatment, FilmJob } from "@gen-story/shared";
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
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dialog) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [dialog]);
  const load = useCallback(async () => {
    const value = await getFilm(projectId);
    setDetail(value);
    setDraft((current) => current ?? value.treatment);
  }, [projectId]);
  useEffect(() => {
    void load().catch((e) => setError(String(e)));
  }, [load]);
  const active = detail?.jobs.some(
    (j) => j.status === "queued" || j.status === "running",
  );
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
            <div className={styles.images}>
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
                    className={`${styles.imageCard} ${selection.includes(scene.id) ? styles.selected : ""}`}
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
                  {!dirty && preflight?.error && (
                    <ErrorAlert message={preflight.error} />
                  )}
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
                        await renderFilm(projectId, chapter.id, draft.revision);
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
          </div>
          {dirty && <p>{t("saveFirst")}</p>}
          <h3>{t("joined")}</h3>
          <p>{t("joinedDescription")}</p>
          <button
            className={styles.primary}
            disabled={
              busy ||
              dirty ||
              !draft.revision ||
              detail.preflight.length === 0 ||
              detail.preflight.some(
                (p) =>
                  p.error ||
                  !detail.jobs.some(
                    (j) =>
                      j.chapterId === p.chapterId &&
                      j.fingerprint === p.fingerprint &&
                      j.status === "succeeded",
                  ),
              )
            }
            onClick={() =>
              void action(async () => {
                await renderFilm(projectId, null, draft.revision);
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
