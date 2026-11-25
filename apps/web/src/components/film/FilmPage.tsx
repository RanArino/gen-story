"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  FILM_ASPECTS,
  FILM_CAMERA_MOVES,
  type FilmDetailDto,
  type FilmDirectionConflictDto,
  type FilmDirectionContentDto,
  type FilmDirectionDto,
  type FilmSceneCaption,
  type FilmSceneDirectionDto,
  type FilmSubtitleMode,
  type FilmTreatment,
} from "@gen-story/shared";
import {
  ApiError,
  adoptGeneratedImage,
  adoptOriginalImage,
  approveFilmDirection,
  getFilm,
  renderFilm,
  requestFilmDirection,
  saveFilm,
  updateFilmDirection,
} from "../../lib/api-client";
import { storageKeyToUrl } from "../../lib/image-url";
import { AppShell } from "../AppShell";
import { ErrorAlert } from "../ErrorAlert";
import { CameraAudition } from "./CameraAudition";
import {
  DirectionConfirmDialog,
  MusicFields,
  Range,
  SceneLightAndSound,
  type DirectionRequest,
} from "./FilmDirectionPanel";
import { FilmExportDialog, subtitleLines } from "./FilmExportDialog";
import { FilmPlayer } from "./FilmPlayer";
import styles from "./FilmPage.module.css";
import panel from "./FilmDirectionPanel.module.css";
import ws from "./FilmWorkspace.module.css";

const ASPECT_SHAPES = {
  "16:9": { width: 22, height: 12 },
  "9:16": { width: 12, height: 22 },
  "1:1": { width: 16, height: 16 },
} as const;
const DEFAULT_SCENE_MS = 4000;

type Selection = { chapterId: string; sceneId: string | null };
type SaveState = "saved" | "unsaved" | "saving" | "failed";
type Conflict = { directionId: string; conflicts: FilmDirectionConflictDto[] };

export function FilmPage({ projectId }: { projectId: string }) {
  const t = useTranslations("film");
  const tw = useTranslations("film.workspace");
  const td = useTranslations("film.direction");
  const [detail, setDetail] = useState<FilmDetailDto | null>(null);
  /** The editable treatment; saved with the header Save or before AI/export actions. */
  const [film, setFilm] = useState<FilmTreatment | null>(null);
  const [dirty, setDirty] = useState(false);
  /** Unsaved edits to an AI draft under review or to an applied direction, by direction id. */
  const [directionEdits, setDirectionEdits] = useState<
    Record<string, FilmDirectionContentDto>
  >({});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "failed">(
    "idle",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<{
    message: string;
    retry: () => void;
  } | null>(null);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [organizing, setOrganizing] = useState<boolean | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirm, setConfirm] = useState<DirectionRequest | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [resolutions, setResolutions] = useState<
    Record<string, "mine" | "draft">
  >({});
  const [audition, setAudition] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportScope, setExportScope] = useState<string | null>(null);
  const [requestedJobId, setRequestedJobId] = useState<string | null>(null);
  const [subtitles, setSubtitles] = useState<FilmSubtitleMode>("both");
  /** The subtitle mode `detail` was loaded for; outputs and fingerprints depend on it. */
  const [loadedSubtitles, setLoadedSubtitles] =
    useState<FilmSubtitleMode | null>(null);
  // Organization state (multi-select photo library).
  const [selection, setSelectionIds] = useState<string[]>([]);
  const [filter, setFilter] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"create" | "move" | null>(null);
  const [chapterName, setChapterName] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (dialog) dialogRef.current?.showModal();
    else dialogRef.current?.close();
  }, [dialog]);

  const load = useCallback(async () => {
    const value = await getFilm(projectId, subtitles);
    setDetail(value);
    setLoadedSubtitles(subtitles);
    setFilm((current) => current ?? value.treatment);
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

  // Keep a valid selection: default to the first scene, survive removals and reloads.
  useEffect(() => {
    if (!film) return;
    const chapters = film.chapters;
    const chapter = chapters.find((c) => c.id === selected?.chapterId);
    if (
      chapter &&
      (selected!.sceneId === null ||
        chapter.scenes.some((s) => s.sceneId === selected!.sceneId))
    )
      return;
    const first = chapter ?? chapters.find((c) => c.scenes.length);
    setSelected(
      first
        ? { chapterId: first.id, sceneId: first.scenes[0]?.sceneId ?? null }
        : null,
    );
  }, [film, selected]);

  // Open the organizer on a first visit (no photos placed yet) and keep it open while organizing.
  useEffect(() => {
    if (film && organizing === null)
      setOrganizing(!film.chapters.some((c) => c.scenes.length));
  }, [film, organizing]);

  function edit(change: Partial<FilmTreatment>) {
    setFilm((d) => (d ? { ...d, ...change } : d));
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

  if (!detail || !film)
    return (
      <AppShell projectId={projectId}>
        {error ? <ErrorAlert message={error} /> : <p>{t("loading")}</p>}
      </AppShell>
    );

  const hasPending = dirty || Object.keys(directionEdits).length > 0;
  const status: SaveState =
    saveState === "saving"
      ? "saving"
      : saveState === "failed"
        ? "failed"
        : hasPending
          ? "unsaved"
          : "saved";

  /**
   * Saves the treatment and any direction edits. Keeps every local edit on failure so the user
   * can retry from the header without losing work. Returns the saved revision.
   */
  async function flush(): Promise<number> {
    let revision = film!.revision;
    if (!hasPending) return revision;
    setSaveState("saving");
    try {
      if (dirty) {
        const value = await saveFilm(film!);
        setDetail(value);
        setFilm(value.treatment);
        setDirty(false);
        revision = value.treatment.revision;
      }
      for (const [id, content] of Object.entries(directionEdits))
        await updateFilmDirection(projectId, id, content);
      if (Object.keys(directionEdits).length) {
        setDirectionEdits({});
        await load();
      }
      setSaveState("idle");
      return revision;
    } catch (e) {
      setSaveState("failed");
      throw e;
    }
  }

  const directions = detail.directions;
  const stale = (d: FilmDirectionDto) =>
    detail.directionInputDigests[d.chapterId] !== undefined &&
    d.inputDigest !== detail.directionInputDigests[d.chapterId];
  const latest = (chapterId: string) =>
    directions.find((d) => d.chapterId === chapterId);
  const appliedFor = (chapterId: string) =>
    directions.find(
      (d) => d.chapterId === chapterId && d.status === "approved" && !stale(d),
    );
  const draftFor = (chapterId: string) => {
    const d = latest(chapterId);
    return d && d.status === "proposed" && !stale(d) ? d : undefined;
  };
  /** The direction the workspace shows and edits: a draft under review, else the applied one. */
  const shownFor = (chapterId: string) => {
    const d = draftFor(chapterId) ?? appliedFor(chapterId);
    return d
      ? { direction: d, content: directionEdits[d.id] ?? d.content! }
      : null;
  };
  const changeDirection = (id: string, content: FilmDirectionContentDto) =>
    setDirectionEdits((e) => ({ ...e, [id]: content }));

  const sceneOf = (id: string) => detail.scenes.find((s) => s.id === id);
  function imageUrl(id: string) {
    const scene = sceneOf(id);
    const image = scene?.selectedImageId
      ? scene.images.find((i) => i.id === scene.selectedImageId)
      : scene?.original;
    return image ? storageKeyToUrl(image.storageKey) : null;
  }
  function thumbnail(id: string, className?: string) {
    const url = imageUrl(id);
    return url ? (
      <img className={className} src={url} alt={sceneOf(id)?.title ?? ""} />
    ) : (
      <span className={styles.missingImage}>{t("missingScene")}</span>
    );
  }
  /** What the render will burn in for a scene: the draft's text while reviewing, else saved. */
  function captionFor(sceneId: string, chapterId?: string): FilmSceneCaption {
    const draft = chapterId ? draftFor(chapterId) : undefined;
    const draftScene = draft
      ? (directionEdits[draft.id] ?? draft.content)?.scenes.find(
          (s) => s.sceneId === sceneId,
        )
      : undefined;
    return (
      draftScene?.captions ??
      film!.sceneCaptions?.[sceneId] ?? {
        ja: sceneOf(sceneId)?.title ?? "",
        en: "",
      }
    );
  }
  const savedCaption = (sceneId: string): FilmSceneCaption =>
    film!.sceneCaptions?.[sceneId] ?? {
      ja: sceneOf(sceneId)?.title ?? "",
      en: "",
    };

  function changeChapter(
    id: string,
    change: Partial<FilmTreatment["chapters"][number]>,
  ) {
    edit({
      chapters: film!.chapters.map((c) =>
        c.id === id ? { ...c, ...change } : c,
      ),
    });
  }
  function select(next: Selection) {
    setSelected(next);
    setPlayhead(0);
  }

  // ---- AI direction ----
  const directable = film.chapters.filter((c) => c.scenes.length);
  function ask(request: DirectionRequest) {
    const targets =
      request.scope === "film"
        ? directable
        : directable.filter((c) => c.id === request.chapterId);
    const usable = (d: FilmDirectionDto | undefined) =>
      !!d && d.status !== "failed" && !stale(d);
    // A current direction is reused by the server without an AI call, so no confirmation.
    if (!request.regenerate && targets.every((c) => usable(latest(c.id))))
      return send(request);
    setConfirm(request);
  }
  function send(request: DirectionRequest) {
    setConfirm(null);
    setAiError(null);
    void action(async () => {
      try {
        await flush();
        await requestFilmDirection(projectId, {
          scope: request.scope,
          chapterId: request.chapterId,
          sceneId: request.sceneId,
          regenerate: request.regenerate,
        });
        await load();
      } catch (e) {
        setAiError({
          message: e instanceof Error ? e.message : String(e),
          retry: () => send(request),
        });
      }
    });
  }
  /** Applies reviewed drafts in order; stops at a conflict and shows it in the editor. */
  function apply(ids: string[], chosen?: Record<string, "mine" | "draft">) {
    void action(async () => {
      let revision = await flush();
      for (const id of ids) {
        try {
          const next = await approveFilmDirection(
            projectId,
            id,
            revision,
            id === conflict?.directionId ? chosen : undefined,
          );
          revision = next.treatment.revision;
          setDetail(next);
          setFilm(next.treatment);
          setDirty(false);
        } catch (e) {
          if (e instanceof ApiError && e.code === "direction_conflict") {
            const d = directions.find((x) => x.id === id)!;
            setConflict({
              directionId: id,
              conflicts: e.details.conflicts as FilmDirectionConflictDto[],
            });
            setResolutions({});
            setSelected({ chapterId: d.chapterId, sceneId: null });
            setSheetOpen(true);
            return;
          }
          throw e;
        }
      }
      setConflict(null);
    });
  }

  // ---- Selection-derived values ----
  const chapter = film.chapters.find((c) => c.id === selected?.chapterId);
  const chapterIndex = chapter ? film.chapters.indexOf(chapter) : -1;
  const shown = chapter ? shownFor(chapter.id) : null;
  const sceneId = selected?.sceneId ?? chapter?.scenes[0]?.sceneId ?? null;
  const sceneEntry = chapter?.scenes.find((s) => s.sceneId === sceneId);
  const sceneIndex = shown?.content.scenes.findIndex(
    (s) => s.sceneId === sceneId,
  );
  const sceneDirection =
    shown && sceneIndex !== undefined && sceneIndex >= 0
      ? shown.content.scenes[sceneIndex]!
      : null;
  const resolvedMs = (id: string | null, chapterId?: string) =>
    (!dirty
      ? detail.preflight
          .find((p) => p.chapterId === chapterId)
          ?.durations.find((s) => s.sceneId === id)?.durationMs
      : undefined) ??
    chapter?.scenes.find((s) => s.sceneId === id)?.durationMs ??
    DEFAULT_SCENE_MS;
  const draftLabel = chapter ? draftFor(chapter.id) : undefined;
  function changeScene(next: FilmSceneDirectionDto) {
    if (!shown) return;
    changeDirection(shown.direction.id, {
      ...shown.content,
      scenes: shown.content.scenes.map((s) =>
        s.sceneId === next.sceneId ? next : s,
      ),
    });
  }
  function setCaption(id: string, caption: FilmSceneCaption) {
    if (draftLabel && sceneDirection)
      changeScene({ ...sceneDirection, captions: caption });
    else edit({ sceneCaptions: { ...film!.sceneCaptions, [id]: caption } });
  }
  function nextScene(): boolean {
    if (!chapter || !sceneId) return false;
    const at = chapter.scenes.findIndex((s) => s.sceneId === sceneId);
    const next = chapter.scenes[at + 1];
    if (!next) return false;
    setSelected({ chapterId: chapter.id, sceneId: next.sceneId });
    setPlayhead(0);
    return true;
  }

  // ---- Organization ----
  const membership = new Map(
    film.chapters.flatMap((c) =>
      c.scenes.map((entry) => [entry.sceneId, c] as const),
    ),
  );
  const unassigned = detail.scenes.filter((scene) => !membership.has(scene.id));
  const showOrganizer = organizing ?? false;
  const currentFilter = filter ?? (unassigned.length ? "unassigned" : "all");
  const visible =
    currentFilter === "all"
      ? detail.scenes
      : currentFilter === "unassigned"
        ? unassigned
        : (
            film.chapters.find((c) => c.id === currentFilter)?.scenes ?? []
          ).flatMap((entry) =>
            detail.scenes.filter((s) => s.id === entry.sceneId),
          );
  const filtered = film.chapters.find((c) => c.id === currentFilter);
  function chooseFilter(value: string) {
    setFilter(value);
    setSelectionIds([]);
  }
  function toggle(id: string) {
    setSelectionIds((ids) =>
      ids.includes(id) ? ids.filter((s) => s !== id) : [...ids, id],
    );
  }
  function transfer(destination: string | null, newTitle?: string) {
    const entries = selection.map(
      (id) =>
        membership.get(id)?.scenes.find((s) => s.sceneId === id) ?? {
          sceneId: id,
        },
    );
    const chapters = film!.chapters.map((c) => ({
      ...c,
      scenes:
        c.id === destination
          ? [
              ...c.scenes,
              ...entries.filter(
                (entry) => !c.scenes.some((s) => s.sceneId === entry.sceneId),
              ),
            ]
          : c.scenes.filter((entry) => !selection.includes(entry.sceneId)),
    }));
    if (newTitle && destination)
      chapters.push({
        id: destination,
        title: newTitle,
        limitMs: 60000,
        scenes: entries,
      });
    edit({ chapters });
    setSelectionIds([]);
    setDialog(null);
    if (destination) setFilter(destination);
  }
  function reorderScene(
    c: FilmTreatment["chapters"][number],
    at: number,
    offset: number,
  ) {
    const scenes = [...c.scenes];
    [scenes[at], scenes[at + offset]] = [scenes[at + offset]!, scenes[at]!];
    changeChapter(c.id, { scenes });
  }

  const pendingDrafts = directable
    .filter((c) => draftFor(c.id))
    .map((c) => c.id);
  const filmRequest = directions.find((d) => d.scope === "film")?.requestId;
  const filmDrafts = directions.filter(
    (d) =>
      d.scope === "film" &&
      d.status === "proposed" &&
      !stale(d) &&
      d.requestId === filmRequest,
  );
  const anyApplied = directable.some((c) => appliedFor(c.id));
  const aiIntro = (
    <div className={ws.aiIntro}>
      <button
        className={`${styles.primary} ${ws.primary}`}
        disabled={busy || !directable.length}
        onClick={() =>
          ask({
            scope: "film",
            regenerate: false,
            photos: directable.reduce((n, c) => n + c.scenes.length, 0),
          })
        }
      >
        {tw("directFilm")}
      </button>
      <p>{tw("aiExplain")}</p>
    </div>
  );

  // ---- Status for the selected Chapter, shown under the player ----
  const latestForChapter = chapter ? latest(chapter.id) : undefined;
  function chapterStatus() {
    if (aiError)
      return (
        <div className={ws.statusBar} data-tone="error">
          <ErrorAlert message={aiError.message} />
          <button onClick={aiError.retry} disabled={busy}>
            {td("retry")}
          </button>
        </div>
      );
    if (!chapter) return null;
    const d = latestForChapter;
    if (!d) return <div className={ws.statusBar}>{aiIntro}</div>;
    if (d.status === "generating")
      return (
        <div className={ws.statusBar} role="status">
          <span className={`${panel.badge} ${panel.generating}`}>
            {td("status.generating")}
          </span>
          <span>{td("generating")}</span>
        </div>
      );
    if (d.status === "failed")
      return (
        <div className={ws.statusBar} data-tone="error">
          <ErrorAlert message={d.error ?? td("failed")} />
          {appliedFor(chapter.id) && (
            <p className={ws.note}>{td("previousStillUsed")}</p>
          )}
          <button
            disabled={busy}
            onClick={() =>
              ask({
                scope: "chapter",
                chapterId: chapter.id,
                regenerate: true,
                photos: chapter.scenes.length,
              })
            }
          >
            {td("retry")}
          </button>
        </div>
      );
    if (stale(d))
      return (
        <div className={ws.statusBar}>
          <span className={`${panel.badge} ${panel.stale}`}>
            {td("status.stale")}
          </span>
          <span>{td("staleHint")}</span>
          <button
            disabled={busy}
            onClick={() =>
              ask({
                scope: "chapter",
                chapterId: chapter.id,
                regenerate: true,
                photos: chapter.scenes.length,
              })
            }
          >
            {td("regenerateChapter")}
          </button>
        </div>
      );
    if (d.status === "proposed")
      return (
        <div className={ws.statusBar} data-tone="draft">
          <span className={`${panel.badge} ${panel.proposed}`} role="status">
            {tw("draftPreview")}
          </span>
          <span className={ws.grow}>
            {tw("draftHint")}
            {d.model && <small> · {td("madeBy", { model: d.model })}</small>}
          </span>
          <button
            className={`${styles.primary} ${ws.primary}`}
            disabled={busy}
            onClick={() => apply([d.id])}
          >
            {tw("useDraft")}
          </button>
          {filmDrafts.length > 1 && filmDrafts.some((x) => x.id === d.id) && (
            <button
              disabled={busy}
              onClick={() => apply(filmDrafts.map((x) => x.id))}
            >
              {td("approveAll", { count: filmDrafts.length })}
            </button>
          )}
        </div>
      );
    return (
      <div className={ws.statusBar}>
        <span className={`${panel.badge} ${panel.approved}`} role="status">
          {tw("applied")}
        </span>
        <span className={ws.grow}>{tw("appliedHint")}</span>
      </div>
    );
  }

  // ---- Inspector ----
  function conflictPanel() {
    if (!conflict) return null;
    const d = directions.find((x) => x.id === conflict.directionId);
    const label = (field: string) =>
      field === "chapterName"
        ? tw("conflictChapterName")
        : tw("conflictCaption", {
            title: sceneOf(field.slice("caption:".length))?.title ?? "",
          });
    const show = (v: FilmDirectionConflictDto["mine"]) =>
      v === null
        ? tw("storyboardTitle")
        : typeof v === "string"
          ? v
          : [v.ja || tw("blank"), v.en].filter(Boolean).join(" / ");
    return (
      <section className={ws.conflict} aria-labelledby="conflict-title">
        <h4 id="conflict-title">{tw("conflictTitle")}</h4>
        <p>{tw("conflictHint")}</p>
        {conflict.conflicts.map((c) => (
          <fieldset key={c.field}>
            <legend>{label(c.field)}</legend>
            {(["mine", "draft"] as const).map((side) => (
              <label key={side}>
                <input
                  type="radio"
                  name={`conflict-${c.field}`}
                  checked={resolutions[c.field] === side}
                  onChange={() =>
                    setResolutions((r) => ({ ...r, [c.field]: side }))
                  }
                />
                <span>
                  <strong>{tw(`conflictSides.${side}`)}</strong> {show(c[side])}
                </span>
              </label>
            ))}
          </fieldset>
        ))}
        <div className={ws.row}>
          <button onClick={() => setConflict(null)}>{tw("cancel")}</button>
          <button
            className={`${styles.primary} ${ws.primary}`}
            disabled={
              busy ||
              !d ||
              conflict.conflicts.some((c) => !resolutions[c.field])
            }
            onClick={() => apply([conflict.directionId], resolutions)}
          >
            {tw("applyChoices")}
          </button>
        </div>
      </section>
    );
  }

  function sceneEditor() {
    if (!chapter || !sceneId) return null;
    const scene = sceneOf(sceneId);
    const caption = draftLabel
      ? captionFor(sceneId, chapter.id)
      : savedCaption(sceneId);
    const at = chapter.scenes.findIndex((s) => s.sceneId === sceneId);
    const camera = sceneDirection?.camera;
    const image = imageUrl(sceneId);
    return (
      <div className={ws.editor}>
        <div className={ws.editorHeader}>
          <span className={ws.kicker}>
            {tw("sceneOf", {
              chapter: String(chapterIndex + 1).padStart(2, "0"),
              number: at + 1,
            })}
          </span>
          <h3>{scene?.title}</h3>
          {draftLabel && (
            <span className={`${panel.badge} ${panel.proposed}`}>
              {tw("editingDraft")}
            </span>
          )}
        </div>
        <label>
          {tw("captionJa")}
          <textarea
            rows={2}
            maxLength={120}
            value={caption.ja}
            aria-label={t("captionFor", { title: scene?.title ?? "" })}
            onChange={(e) =>
              setCaption(sceneId, { ...caption, ja: e.target.value })
            }
          />
        </label>
        <label>
          {tw("captionEn")}
          <textarea
            rows={2}
            maxLength={200}
            value={caption.en}
            aria-label={t("secondaryCaptionFor", { title: scene?.title ?? "" })}
            onChange={(e) =>
              setCaption(sceneId, { ...caption, en: e.target.value })
            }
          />
        </label>
        {!draftLabel && (
          <div className={ws.row}>
            <small className={ws.grow}>{tw("captionHint")}</small>
            <button
              disabled={!Object.hasOwn(film!.sceneCaptions ?? {}, sceneId)}
              onClick={() => {
                const captions = { ...film!.sceneCaptions };
                delete captions[sceneId];
                edit({ sceneCaptions: captions });
              }}
            >
              {t("resetCaption")}
            </button>
          </div>
        )}
        <label>
          {tw("displayTime")}
          <input
            type="number"
            min="0.001"
            step="0.1"
            value={
              sceneEntry?.durationMs === undefined
                ? ""
                : sceneEntry.durationMs / 1000
            }
            placeholder={String(resolvedMs(sceneId, chapter.id) / 1000)}
            onChange={(e) =>
              changeChapter(chapter.id, {
                scenes: chapter.scenes.map((s) =>
                  s.sceneId === sceneId
                    ? {
                        ...s,
                        durationMs:
                          e.target.value === ""
                            ? undefined
                            : Math.round(Number(e.target.value) * 1000),
                      }
                    : s,
                ),
              })
            }
          />
        </label>
        <fieldset className={ws.cameraGroup}>
          <legend>{tw("camera")}</legend>
          {camera && sceneDirection ? (
            <>
              <div className={ws.row}>
                <label className={ws.grow}>
                  {tw("move")}
                  <select
                    value={camera.move}
                    onChange={(e) =>
                      changeScene({
                        ...sceneDirection,
                        camera: {
                          ...camera,
                          move: e.target.value as typeof camera.move,
                        },
                      })
                    }
                  >
                    {FILM_CAMERA_MOVES.map((m) => (
                      <option key={m} value={m}>
                        {td(`moves.${m}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" onClick={() => setAudition(true)}>
                  {tw("tryMoves")}
                </button>
              </div>
              <Range
                label={tw("strengthValue", {
                  value: Math.round(camera.speed * 100),
                })}
                value={camera.speed}
                onChange={(speed) =>
                  changeScene({
                    ...sceneDirection,
                    camera: { ...camera, speed },
                  })
                }
              />
              {image && (
                <button
                  type="button"
                  className={ws.focusPicker}
                  aria-label={tw("setFocus")}
                  onClick={(e) => {
                    const box = e.currentTarget.getBoundingClientRect();
                    const round = (v: number) =>
                      Math.round(Math.min(1, Math.max(0, v)) * 100) / 100;
                    changeScene({
                      ...sceneDirection,
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
                    className={ws.focusMarker}
                    style={{
                      left: `${camera.focus.x * 100}%`,
                      top: `${camera.focus.y * 100}%`,
                    }}
                    aria-hidden
                  />
                </button>
              )}
              <small>{tw("focusHint")}</small>
              {sceneDirection.observation && (
                <p className={ws.note}>
                  <strong>{tw("aiSaw")}</strong> {sceneDirection.observation}
                </p>
              )}
            </>
          ) : (
            <p className={ws.note}>{tw("cameraNeedsDirection")}</p>
          )}
        </fieldset>
        {sceneDirection && (
          <SceneLightAndSound value={sceneDirection} onChange={changeScene} />
        )}
        <details className={ws.more}>
          <summary>{t("changeImage")}</summary>
          <label>
            {t("imageFor")} {scene?.title}
            <select
              aria-label={`${t("imageFor")} ${scene?.title ?? ""}`}
              value={scene?.selectedImageId ?? "original"}
              onChange={(e) => {
                const value = e.target.value;
                void action(async () => {
                  if (value === "original")
                    await adoptOriginalImage(projectId, sceneId);
                  else await adoptGeneratedImage(sceneId, value);
                  await load();
                });
              }}
            >
              <option value="original" disabled={!scene?.original}>
                {t("original")}
              </option>
              {scene?.images.map((image, i) => (
                <option key={image.id} value={image.id}>
                  {t("generated", { number: i + 1 })}
                </option>
              ))}
            </select>
          </label>
        </details>
        {shown && (
          <button
            className={ws.aiSmall}
            disabled={busy}
            onClick={() =>
              ask({
                scope: "chapter",
                chapterId: chapter.id,
                sceneId,
                regenerate: true,
                photos: 1,
              })
            }
          >
            {td("regenerateScene")}
          </button>
        )}
      </div>
    );
  }

  function chapterEditor() {
    if (!chapter) return null;
    const name =
      draftLabel && shown ? shown.content.chapterName : chapter.title;
    return (
      <div className={ws.editor}>
        <div className={ws.editorHeader}>
          <span className={ws.kicker}>
            {tw("chapterNumber", {
              number: String(chapterIndex + 1).padStart(2, "0"),
            })}
          </span>
          <h3>{name}</h3>
          {draftLabel && (
            <span className={`${panel.badge} ${panel.proposed}`}>
              {tw("editingDraft")}
            </span>
          )}
        </div>
        <label>
          {t("chapterTitle")}
          <input
            value={name}
            maxLength={200}
            onChange={(e) =>
              draftLabel && shown
                ? changeDirection(shown.direction.id, {
                    ...shown.content,
                    chapterName: e.target.value,
                  })
                : changeChapter(chapter.id, { title: e.target.value })
            }
          />
        </label>
        {draftLabel && shown?.content.nameReason && (
          <p className={ws.note}>{shown.content.nameReason}</p>
        )}
        <label>
          {t("limit")}
          <input
            type="number"
            min="0.001"
            step="0.1"
            placeholder={t("unlimited")}
            value={chapter.limitMs === null ? "" : chapter.limitMs / 1000}
            onChange={(e) =>
              changeChapter(chapter.id, {
                limitMs:
                  e.target.value === ""
                    ? null
                    : Math.round(Number(e.target.value) * 1000),
              })
            }
          />
        </label>
        {shown ? (
          <details className={ws.more}>
            <summary>{tw("sharedDirection")}</summary>
            <MusicFields
              value={shown.content.music}
              onChange={(music) =>
                changeDirection(shown.direction.id, {
                  ...shown.content,
                  music,
                })
              }
            />
            <Range
              label={t("sfxLevel")}
              value={chapter.settings?.sfxLevel ?? 1}
              onChange={(sfxLevel) =>
                changeChapter(chapter.id, {
                  settings: { ...chapter.settings, sfxLevel },
                })
              }
            />
          </details>
        ) : (
          <p className={ws.note}>{tw("cameraNeedsDirection")}</p>
        )}
        <button
          className={ws.aiSmall}
          disabled={busy || !chapter.scenes.length}
          onClick={() =>
            ask({
              scope: "chapter",
              chapterId: chapter.id,
              regenerate: !!latestForChapter,
              photos: chapter.scenes.length,
            })
          }
        >
          {latestForChapter ? td("regenerateChapter") : td("directChapter")}
        </button>
      </div>
    );
  }

  const aspect = film.outputAspect ?? "16:9";
  const reducedMotion = film.reducedMotion;
  const previewCaption =
    sceneId && chapter
      ? subtitleLines(captionFor(sceneId, chapter.id), subtitles)
      : null;

  return (
    <AppShell projectId={projectId}>
      <header className={ws.topBar}>
        <label className={ws.titleField}>
          <span className={ws.kicker}>{t("overallTitle")}</span>
          <input
            value={film.title}
            aria-label={t("overallTitle")}
            onChange={(e) => edit({ title: e.target.value })}
          />
        </label>
        <div className={ws.topActions}>
          <span className={ws.saveStatus} role="status" data-state={status}>
            {tw(`saveStates.${status}`)}
          </span>
          <button
            disabled={busy || !hasPending}
            onClick={() => void action(async () => void (await flush()))}
          >
            {status === "failed" ? tw("retrySave") : t("save")}
          </button>
          <button
            aria-expanded={showOrganizer}
            onClick={() => setOrganizing(!showOrganizer)}
          >
            {showOrganizer ? tw("closeOrganizer") : tw("organize")}
          </button>
          <button
            className={`${styles.primary} ${ws.primary}`}
            disabled={busy || !directable.length}
            onClick={() =>
              ask({
                scope: "film",
                regenerate: false,
                photos: directable.reduce((n, c) => n + c.scenes.length, 0),
              })
            }
          >
            {tw("directFilm")}
          </button>
          <button
            disabled={!directable.length}
            onClick={() => {
              setExportScope((s) => s);
              setExporting(true);
            }}
          >
            {tw("export")}
          </button>
        </div>
        <details className={ws.settings}>
          <summary>{tw("filmSettings")}</summary>
          <label>
            {t("template")}
            <select
              aria-label={t("template")}
              value={film.recipe}
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
              checked={film.reducedMotion}
              onChange={(e) => edit({ reducedMotion: e.target.checked })}
            />
            {t("reducedMotion")}
          </label>
          <fieldset className={panel.sizeOptions}>
            <legend>{t("videoSize")}</legend>
            {FILM_ASPECTS.map((a) => (
              <label key={a} className={panel.sizeOption}>
                <input
                  type="radio"
                  name="film-aspect"
                  value={a}
                  checked={aspect === a}
                  onChange={() => edit({ outputAspect: a })}
                />
                <span
                  className={panel.sizeShape}
                  style={ASPECT_SHAPES[a]}
                  aria-hidden
                />
                {t(`aspects.${a.replace(":", "x")}`)}
              </label>
            ))}
          </fieldset>
          {anyApplied && <p className={ws.note}>{tw("sizeStalesDirection")}</p>}
        </details>
      </header>
      {error && (
        <div className={ws.errorRow}>
          <ErrorAlert message={error} />
        </div>
      )}
      {!detail.scenes.length && <p>{t("noScenes")}</p>}

      <section
        className={ws.organizer}
        hidden={!showOrganizer}
        aria-label={tw("organize")}
      >
        <fieldset disabled={busy} className={styles.editor}>
          <div className={styles.workspace}>
            <section className={styles.library} aria-label={t("images")}>
              <div className={styles.sectionHeading}>
                <div>
                  <h3>{filtered?.title ?? t("images")}</h3>
                  <p>{t("selectionHint")}</p>
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
                {filtered && (
                  <span className={styles.activeFilter}>{filtered.title}</span>
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
                      setSelectionIds(
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
                  <button onClick={() => setSelectionIds([])}>
                    {t("clearSelection")}
                  </button>
                )}
              </div>
              <div className={styles.images}>
                {visible.map((scene) => {
                  const c = membership.get(scene.id);
                  const at =
                    c?.scenes.findIndex((s) => s.sceneId === scene.id) ?? -1;
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
                        <span
                          className={styles.selectionMark}
                          aria-hidden="true"
                        >
                          {selection.includes(scene.id) ? "✓" : ""}
                        </span>
                        <span className={styles.photoCaption}>
                          {scene.title}
                        </span>
                      </button>
                      <div className={styles.photoMeta}>
                        <span>{c?.title ?? t("unassigned")}</span>
                        {filtered && c && (
                          <span className={ws.order}>
                            <button
                              disabled={at === 0}
                              aria-label={t("sceneUp")}
                              onClick={() => reorderScene(c, at, -1)}
                            >
                              ←
                            </button>
                            {at + 1}
                            <button
                              disabled={at === c.scenes.length - 1}
                              aria-label={t("sceneDown")}
                              onClick={() => reorderScene(c, at, 1)}
                            >
                              →
                            </button>
                          </span>
                        )}
                      </div>
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
                  className={`${styles.primary} ${ws.primary}`}
                  disabled={!selection.length}
                  onClick={() => {
                    setChapterName(
                      t("newChapter", { number: film.chapters.length + 1 }),
                    );
                    setDialog("create");
                  }}
                >
                  {t("createFromSelection")}
                </button>
                <button
                  disabled={!selection.length || !film.chapters.length}
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
                <span className={styles.count}>{film.chapters.length}</span>
              </div>
              {!film.chapters.length && (
                <div className={styles.emptyState}>
                  <span aria-hidden="true">＋</span>
                  <h4>{t("startWithPhotos")}</h4>
                  <p>{t("startWithPhotosHint")}</p>
                </div>
              )}
              {film.chapters.map((c, index) => (
                <article
                  key={c.id}
                  className={`${styles.chapter} ${filtered?.id === c.id ? styles.activeChapter : ""}`}
                >
                  <div className={styles.chapterHeading}>
                    <span className={styles.chapterNumber}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <h4>{c.title}</h4>
                      <span>{t("photoCount", { count: c.scenes.length })}</span>
                    </div>
                    <button
                      aria-label={t("viewChapter", { title: c.title })}
                      aria-pressed={filtered?.id === c.id}
                      onClick={() => chooseFilter(c.id)}
                    >
                      {tw("showPhotos")}
                    </button>
                  </div>
                  <button
                    className={styles.chapterPreview}
                    aria-label={t("viewChapter", { title: c.title })}
                    onClick={() => chooseFilter(c.id)}
                  >
                    {c.scenes.map((s) => (
                      <span key={s.sceneId}>{thumbnail(s.sceneId)}</span>
                    ))}
                    {!c.scenes.length && (
                      <span className={styles.emptyPreview}>
                        {t("emptyChapter")}
                      </span>
                    )}
                  </button>
                  <div className={styles.row}>
                    <button
                      disabled={index === 0}
                      aria-label={t("chapterUp")}
                      onClick={() => {
                        const chapters = [...film.chapters];
                        [chapters[index - 1], chapters[index]] = [
                          chapters[index]!,
                          chapters[index - 1]!,
                        ];
                        edit({ chapters });
                      }}
                    >
                      ↑
                    </button>
                    <button
                      disabled={index === film.chapters.length - 1}
                      aria-label={t("chapterDown")}
                      onClick={() => {
                        const chapters = [...film.chapters];
                        [chapters[index + 1], chapters[index]] = [
                          chapters[index]!,
                          chapters[index + 1]!,
                        ];
                        edit({ chapters });
                      }}
                    >
                      ↓
                    </button>
                    <button
                      className={styles.remove}
                      onClick={() => {
                        edit({
                          chapters: film.chapters.filter((x) => x.id !== c.id),
                        });
                        chooseFilter("unassigned");
                      }}
                    >
                      {t("remove")}
                    </button>
                  </div>
                </article>
              ))}
              {!!directable.length && aiIntro}
            </section>
          </div>
        </fieldset>
      </section>

      {!!directable.length && (
        <div className={ws.workspace} data-sheet={sheetOpen}>
          <div className={ws.stage}>
            <FilmPlayer
              src={sceneId ? imageUrl(sceneId) : null}
              title={sceneId ? (sceneOf(sceneId)?.title ?? "") : ""}
              camera={sceneDirection?.camera ?? null}
              aspect={aspect}
              durationMs={resolvedMs(sceneId, chapter?.id)}
              playhead={playhead}
              onPlayhead={setPlayhead}
              caption={previewCaption}
              reducedMotion={reducedMotion}
              onEnd={nextScene}
              status={chapterStatus()}
            />
            <button
              className={ws.mobileEdit}
              onClick={() => setSheetOpen(true)}
              disabled={!chapter}
            >
              {selected?.sceneId ? tw("editScene") : tw("editChapter")}
            </button>
            <nav className={ws.strip} aria-label={tw("strip")}>
              {film.chapters.map((c, index) => {
                const d = latest(c.id);
                const state = !d
                  ? "none"
                  : stale(d)
                    ? "stale"
                    : d.status === "approved"
                      ? appliedFor(c.id)
                        ? "approved"
                        : "none"
                      : d.status;
                return (
                  <div key={c.id} className={ws.stripChapter}>
                    <button
                      className={ws.stripHeader}
                      aria-current={
                        selected?.chapterId === c.id && !selected.sceneId
                      }
                      onClick={() => select({ chapterId: c.id, sceneId: null })}
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>{c.title}</strong>
                      {state !== "none" && (
                        <span className={`${panel.badge} ${panel[state]}`}>
                          {state === "proposed"
                            ? tw("draftShort")
                            : state === "approved"
                              ? tw("applied")
                              : td(`status.${state}`)}
                        </span>
                      )}
                    </button>
                    <ol>
                      {c.scenes.map((s, i) => (
                        <li key={s.sceneId}>
                          <button
                            className={ws.stripScene}
                            aria-current={
                              selected?.chapterId === c.id &&
                              selected.sceneId === s.sceneId
                            }
                            aria-label={tw("selectScene", {
                              number: i + 1,
                              title: sceneOf(s.sceneId)?.title ?? "",
                            })}
                            onClick={() =>
                              select({ chapterId: c.id, sceneId: s.sceneId })
                            }
                          >
                            {thumbnail(s.sceneId)}
                            <span>{i + 1}</span>
                          </button>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
            </nav>
          </div>
          <aside className={ws.inspector} aria-label={tw("inspector")}>
            <button
              className={ws.sheetClose}
              onClick={() => setSheetOpen(false)}
            >
              {tw("closeEditor")}
            </button>
            {conflictPanel()}
            <fieldset disabled={busy} className={ws.inspectorFields}>
              {selected?.sceneId ? sceneEditor() : chapterEditor()}
            </fieldset>
          </aside>
        </div>
      )}

      <DirectionConfirmDialog
        request={confirm}
        onCancel={() => setConfirm(null)}
        onConfirm={send}
      />
      {sceneDirection && (
        <CameraAudition
          open={audition}
          aspect={aspect}
          current={sceneDirection.camera}
          onClose={() => setAudition(false)}
          onChoose={({ move, speed }) => {
            changeScene({
              ...sceneDirection,
              camera: { ...sceneDirection.camera, move, speed },
            });
            setAudition(false);
            setPlayhead(0);
          }}
        />
      )}
      <FilmExportDialog
        open={exporting}
        projectId={projectId}
        detail={detail}
        scope={exportScope}
        onScope={(s) => {
          setExportScope(s);
          setRequestedJobId(null);
        }}
        subtitles={subtitles}
        onSubtitles={(mode) => {
          setSubtitles(mode);
          setRequestedJobId(null);
        }}
        ready={loadedSubtitles === subtitles}
        pendingChanges={hasPending}
        pendingDrafts={pendingDrafts}
        busy={busy}
        requestedJobId={requestedJobId}
        caption={(id) => savedCaption(id)}
        sceneTitle={(id) => sceneOf(id)?.title ?? ""}
        onEditScene={(chapterId, id) => {
          setExporting(false);
          select({ chapterId, sceneId: id });
          setSheetOpen(true);
        }}
        onExport={() =>
          void action(async () => {
            const revision = await flush();
            const job = await renderFilm(
              projectId,
              exportScope,
              revision,
              subtitles,
            );
            setRequestedJobId(job.id);
            await load();
          })
        }
        onClose={() => setExporting(false)}
      />
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
                  className={`${styles.primary} ${ws.primary}`}
                  type="submit"
                  disabled={!chapterName.trim()}
                >
                  {t("createChapter")}
                </button>
              </div>
            </>
          ) : (
            <div className={styles.destinations}>
              {film.chapters.map((c) => (
                <button type="button" key={c.id} onClick={() => transfer(c.id)}>
                  <span className={styles.destinationPhotos}>
                    {c.scenes.slice(0, 3).map((s) => (
                      <span key={s.sceneId}>{thumbnail(s.sceneId)}</span>
                    ))}
                  </span>
                  <strong>{c.title}</strong>
                  <span>{t("photoCount", { count: c.scenes.length })}</span>
                </button>
              ))}
            </div>
          )}
        </form>
      </dialog>
    </AppShell>
  );
}
