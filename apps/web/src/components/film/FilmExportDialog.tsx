"use client";
import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import {
  FILM_SUBTITLE_MODES,
  type FilmDetailDto,
  type FilmJob,
  type FilmSceneCaption,
  type FilmSubtitleMode,
} from "@gen-story/shared";
import { filmArtifactUrl } from "../../lib/api-client";
import { ErrorAlert } from "../ErrorAlert";
import styles from "./FilmWorkspace.module.css";

export function subtitleLines(
  caption: FilmSceneCaption,
  mode: FilmSubtitleMode,
): { text: string; sub: string } {
  if (mode === "both") return { text: caption.ja, sub: caption.en };
  if (mode === "ja") return { text: caption.ja, sub: "" };
  if (mode === "en") return { text: caption.en, sub: "" };
  return { text: "", sub: "" };
}

/**
 * Delivery only: what to export, in which subtitle mode, and the exact output to play and
 * download. Subtitle text is edited in the scene editor; "Edit" routes back to that scene.
 */
export function FilmExportDialog({
  open,
  projectId,
  detail,
  scope,
  onScope,
  subtitles,
  onSubtitles,
  ready,
  pendingChanges,
  pendingDrafts,
  busy,
  requestedJobId,
  caption,
  sceneTitle,
  onEditScene,
  onExport,
  onClose,
}: {
  open: boolean;
  projectId: string;
  detail: FilmDetailDto;
  /** null = whole film, otherwise a Chapter id. */
  scope: string | null;
  onScope: (scope: string | null) => void;
  subtitles: FilmSubtitleMode;
  onSubtitles: (mode: FilmSubtitleMode) => void;
  /** False while outputs for a newly chosen subtitle mode are still loading. */
  ready: boolean;
  pendingChanges: boolean;
  /** Chapters whose AI draft is still under review; the applied version is exported. */
  pendingDrafts: string[];
  busy: boolean;
  requestedJobId: string | null;
  caption: (sceneId: string) => FilmSceneCaption;
  sceneTitle: (sceneId: string) => string;
  onEditScene: (chapterId: string, sceneId: string) => void;
  onExport: () => void;
  onClose: () => void;
}) {
  const t = useTranslations("film.export");
  const tf = useTranslations("film");
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  const treatment = detail.treatment;
  const chapters = treatment.chapters.filter((c) => c.scenes.length);
  const inScope = scope ? chapters.filter((c) => c.id === scope) : chapters;
  const blocked = detail.preflight.find(
    (p) => p.error && inScope.some((c) => c.id === p.chapterId),
  );
  const jobs = detail.jobs.filter((j) => j.chapterId === scope);
  const fingerprint = scope
    ? detail.preflight.find((p) => p.chapterId === scope)?.fingerprint
    : detail.currentAssemblyFingerprint;
  const isCurrent = (job: FilmJob) =>
    !pendingChanges && !!fingerprint && job.fingerprint === fingerprint;
  // Never present another subtitle mode's output as current while the new mode loads.
  const shown = !ready
    ? null
    : (jobs.find((j) => j.id === requestedJobId) ??
      jobs.find((j) => isCurrent(j)) ??
      null);
  const history = jobs.filter(
    (j) => j.id !== shown?.id && j.status === "succeeded",
  );
  const running = jobs.some(
    (j) => j.status === "queued" || j.status === "running",
  );
  const aspect = treatment.outputAspect ?? "16:9";
  return (
    <dialog
      ref={ref}
      className={styles.exportDialog}
      aria-labelledby="film-export-title"
      onClose={onClose}
      onCancel={onClose}
    >
      <div className={styles.auditionHeader}>
        <h3 id="film-export-title">{t("title")}</h3>
        <button type="button" aria-label={t("close")} onClick={onClose}>
          ×
        </button>
      </div>
      <fieldset className={styles.segmented}>
        <legend>{t("scope")}</legend>
        <label>
          <input
            type="radio"
            name="export-scope"
            checked={scope === null}
            onChange={() => onScope(null)}
          />
          {t("wholeFilm")}
        </label>
        {chapters.map((c, i) => (
          <label key={c.id}>
            <input
              type="radio"
              name="export-scope"
              checked={scope === c.id}
              onChange={() => onScope(c.id)}
            />
            {t("chapter", {
              number: String(i + 1).padStart(2, "0"),
              title: c.title,
            })}
          </label>
        ))}
      </fieldset>
      <fieldset className={styles.segmented}>
        <legend>{tf("subtitles")}</legend>
        {FILM_SUBTITLE_MODES.map((mode) => (
          <label key={mode}>
            <input
              type="radio"
              name="export-subtitles"
              checked={subtitles === mode}
              onChange={() => onSubtitles(mode)}
            />
            {tf(`subtitleModes.${mode}`)}
          </label>
        ))}
      </fieldset>
      <dl className={styles.versionList}>
        <dt>{t("size")}</dt>
        <dd>{tf(`aspects.${aspect.replace(":", "x")}`)}</dd>
        <dt>{t("version")}</dt>
        <dd>
          {t("revision", { revision: treatment.revision })}
          {pendingChanges && ` · ${t("savedOnExport")}`}
        </dd>
        <dt>{t("direction")}</dt>
        <dd>
          {pendingDrafts.length
            ? t("appliedOnly", { count: pendingDrafts.length })
            : t("applied")}
        </dd>
      </dl>
      {subtitles !== "none" && (
        <details className={styles.captionCheck}>
          <summary>{t("checkSubtitles")}</summary>
          <ol>
            {inScope.flatMap((c) =>
              c.scenes.map(({ sceneId }) => {
                const lines = subtitleLines(caption(sceneId), subtitles);
                return (
                  <li key={sceneId}>
                    <span>
                      <strong>{sceneTitle(sceneId)}</strong>
                      {lines.text || t("noLine")}
                      {lines.sub && <small>{lines.sub}</small>}
                    </span>
                    <button
                      type="button"
                      onClick={() => onEditScene(c.id, sceneId)}
                      aria-label={t("editSubtitleFor", {
                        title: sceneTitle(sceneId),
                      })}
                    >
                      {t("edit")}
                    </button>
                  </li>
                );
              }),
            )}
          </ol>
        </details>
      )}
      {blocked && !pendingChanges && (
        <p className={styles.note} role="status">
          {blocked.error!.startsWith("Approve the AI direction")
            ? t("needsApplied")
            : blocked.error}
        </p>
      )}
      <div className={styles.dialogActions}>
        <button type="button" onClick={onClose}>
          {t("close")}
        </button>
        <button
          type="button"
          className={styles.primary}
          disabled={
            !ready ||
            busy ||
            running ||
            !inScope.length ||
            (!!blocked && !pendingChanges)
          }
          onClick={onExport}
        >
          {running ? t("running") : t("start")}
        </button>
      </div>
      {open && shown && (
        <div className={styles.output}>
          <p role="status">
            {tf(`status.${shown.status}`)} ·{" "}
            {t("revision", { revision: shown.revision })}
            {!isCurrent(shown) && ` · ${t("historical")}`}
          </p>
          {shown.error && <ErrorAlert message={shown.error} />}
          {shown.status === "succeeded" && (
            <>
              <video
                controls
                preload="metadata"
                src={filmArtifactUrl(projectId, shown.id)}
                aria-label={tf("player")}
              />
              <a href={filmArtifactUrl(projectId, shown.id, true)}>
                {tf("download")}
              </a>
            </>
          )}
        </div>
      )}
      {ready && !!history.length && (
        <details className={styles.history}>
          <summary>{t("history", { count: history.length })}</summary>
          <ul>
            {history.map((job) => (
              <li key={job.id}>
                <span>
                  {t("revision", { revision: job.revision })} ·{" "}
                  {new Date(job.createdAt).toLocaleString()}
                  {!isCurrent(job) && ` · ${t("historical")}`}
                </span>
                <a href={filmArtifactUrl(projectId, job.id)}>{t("play")}</a>
                <a href={filmArtifactUrl(projectId, job.id, true)}>
                  {tf("download")}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </dialog>
  );
}
