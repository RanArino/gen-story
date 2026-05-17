"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import type {
  PhotoAssetDto,
  ProjectPhotoAnalysisDto,
  SceneDto,
  StoryboardDto,
  StylePresetDto,
} from "@gen-story/shared";
import {
  analyzeProjectPhotos,
  assignPhotosToScene,
  createTemplateScenesFromPhotos,
  fillSceneWithAi,
  getProjectPhotoAnalysis,
  listPhotoAssets,
  listScenes,
  listStoryboards,
  listStylePresets,
  upsertScenes,
  upsertStoryboard,
  type UpsertSceneInput,
} from "../../lib/api-client";
import { storageKeyToUrl } from "../../lib/image-url";
import { AppShell } from "../AppShell";
import { ErrorAlert } from "../ErrorAlert";
import styles from "./StoryboardPage.module.css";

const TONES = [
  { value: "warm", label: "Warm", desc: "Heartfelt and nostalgic" },
  { value: "cinematic", label: "Cinematic", desc: "Dramatic and epic" },
  { value: "playful", label: "Playful", desc: "Fun and energetic" },
  { value: "quiet", label: "Quiet", desc: "Peaceful and reflective" },
] as const;

const CAMERA_OPTIONS = [
  "Wide",
  "Extreme Wide",
  "Medium",
  "Close-up",
  "Extreme Close-up",
  "Aerial",
  "Overhead",
  "POV",
  "Low Angle",
  "Telephoto",
  "Voyeur",
];
const LIGHTING_OPTIONS = [
  "Golden hour",
  "Natural",
  "Dramatic",
  "Night",
  "Soft",
  "Backlit",
  "Silhouette",
  "Volumetric",
];
const MOTION_OPTIONS = [
  "Slow pan",
  "Static",
  "Zoom in",
  "Zoom out",
  "Tracking",
];
const EMOTION_OPTIONS = [
  "Joy",
  "Nostalgia",
  "Love",
  "Pride",
  "Wonder",
  "Calm",
  "Excitement",
  "Gratitude",
];

const DEFAULT_SCENE: Omit<UpsertSceneInput, "orderIndex"> = {
  title: "New scene",
  description: "Describe what happens in this scene.",
  imagePrompt: "A cinematic moment capturing the essence of the scene.",
  emotion: "Joy",
  cameraDirection: "Wide",
  lightingDirection: "Natural",
  motionDirection: "Slow pan",
  notes: "",
};

type SceneState = UpsertSceneInput & { id?: string };

function sceneDtoToState(scene: SceneDto): SceneState {
  return {
    id: scene.id,
    sceneId: scene.id,
    orderIndex: scene.orderIndex,
    title: scene.title,
    description: scene.description,
    imagePrompt: scene.imagePrompt,
    emotion: scene.emotion,
    cameraDirection: scene.cameraDirection,
    lightingDirection: scene.lightingDirection,
    motionDirection: scene.motionDirection,
    notes: scene.notes,
  };
}

export function StoryboardPage({ projectId }: { projectId: string }) {
  const [storyboard, setStoryboard] = useState<StoryboardDto | null>(null);
  const [scenes, setScenes] = useState<SceneState[]>([]);
  const [stylePresets, setStylePresets] = useState<StylePresetDto[]>([]);
  const [photos, setPhotos] = useState<PhotoAssetDto[]>([]);
  const [photoAnalysis, setPhotoAnalysis] =
    useState<ProjectPhotoAnalysisDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(
    new Set(),
  );
  const [creatingTemplates, setCreatingTemplates] = useState(false);
  const [analyzingPhotos, setAnalyzingPhotos] = useState(false);
  const [aiFillingSceneId, setAiFillingSceneId] = useState<string | null>(null);

  const sbId = storyboard?.id;

  const load = useCallback(async () => {
    const [sbs, presets, photoList, latestPhotoAnalysis] = await Promise.all([
      listStoryboards(projectId),
      listStylePresets(),
      listPhotoAssets(projectId),
      getProjectPhotoAnalysis(projectId),
    ]);
    setStylePresets(presets);
    setPhotos(photoList);
    setPhotoAnalysis(latestPhotoAnalysis);
    if (sbs.length > 0) {
      const sb = sbs[0]!;
      setStoryboard(sb);
      const sceneList = await listScenes(sb.id);
      setScenes(sceneList.map(sceneDtoToState));
    }
  }, [projectId]);

  useEffect(() => {
    load()
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [load]);

  async function initStoryboard() {
    const id = crypto.randomUUID();
    try {
      const sb = await upsertStoryboard(id, {
        projectId,
        tone: "warm",
        status: "draft",
      });
      setStoryboard(sb);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create storyboard");
    }
  }

  async function handleToneChange(tone: string) {
    if (!sbId) return;
    const prev = storyboard!;
    setStoryboard({ ...prev, tone });
    try {
      const updated = await upsertStoryboard(sbId, {
        projectId,
        tone,
        stylePresetId: prev.stylePresetId,
      });
      setStoryboard(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save tone");
    }
  }

  async function handleAnalyzePhotos() {
    setAnalyzingPhotos(true);
    setError(null);
    try {
      const analysis = await analyzeProjectPhotos(projectId);
      setPhotoAnalysis(analysis);
      setSaveMsg("Photo analysis complete!");
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to analyze photos");
    } finally {
      setAnalyzingPhotos(false);
    }
  }

  async function handleStyleChange(stylePresetId: string | null) {
    if (!sbId) return;
    const prev = storyboard!;
    setStoryboard({ ...prev, stylePresetId });
    try {
      const updated = await upsertStoryboard(sbId, {
        projectId,
        tone: prev.tone,
        stylePresetId,
      });
      setStoryboard(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save style");
    }
  }

  async function handleCreateTemplateScenes() {
    if (!sbId || selectedPhotoIds.size === 0) return;
    setCreatingTemplates(true);
    try {
      const newScenes = await createTemplateScenesFromPhotos(
        sbId,
        Array.from(selectedPhotoIds),
      );
      setScenes((prev) => [...prev, ...newScenes.map(sceneDtoToState)]);
      setSelectedPhotoIds(new Set());
      setSaveMsg("Template scenes created!");
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : "Failed to create template scenes",
      );
    } finally {
      setCreatingTemplates(false);
    }
  }

  function updateScene(idx: number, patch: Partial<SceneState>) {
    setScenes((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  }

  function addScene() {
    setScenes((prev) => [
      ...prev,
      { ...DEFAULT_SCENE, orderIndex: prev.length },
    ]);
  }

  function moveScene(idx: number, dir: -1 | 1) {
    setScenes((prev) => {
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target]!, next[idx]!];
      return next.map((s, i) => ({ ...s, orderIndex: i }));
    });
  }

  async function saveScenes() {
    if (!sbId) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await upsertScenes(
        sbId,
        scenes.map((s) => ({
          sceneId: s.id,
          orderIndex: s.orderIndex,
          title: s.title || "Untitled",
          description: s.description || "-",
          imagePrompt: s.imagePrompt || "-",
          emotion: s.emotion || "Joy",
          cameraDirection: s.cameraDirection || "Wide",
          lightingDirection: s.lightingDirection || "Natural",
          motionDirection: s.motionDirection || "Slow pan",
          notes: s.notes,
        })),
      );
      setScenes(saved.map(sceneDtoToState));
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save scenes");
    } finally {
      setSaving(false);
    }
  }

  async function handleAiFill(sceneId: string) {
    setAiFillingSceneId(sceneId);
    setError(null);
    try {
      const filled = await fillSceneWithAi(sceneId);
      setScenes((prev) =>
        prev.map((scene) =>
          scene.id === sceneId ? sceneDtoToState(filled) : scene,
        ),
      );
      setSaveMsg("AI fill saved");
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to fill scene");
    } finally {
      setAiFillingSceneId(null);
    }
  }

  if (loading) {
    return (
      <AppShell projectId={projectId}>
        <p style={{ color: "#8898aa" }}>Loading…</p>
      </AppShell>
    );
  }

  if (!storyboard) {
    return (
      <AppShell projectId={projectId}>
        <div className="screen-header">
          <h2>Storyboard</h2>
          <p>No storyboard yet — initialize one to start building scenes.</p>
        </div>
        {error && <ErrorAlert message={error} />}
        <button className="btn btn-primary" onClick={initStoryboard}>
          Initialize storyboard
        </button>
      </AppShell>
    );
  }

  const analyzablePhotoCount = photos.filter(
    (photo) => photo.usage === "candidate" || photo.usage === "reference",
  ).length;
  const fixedToneSelected = TONES.some(
    (tone) => tone.value === storyboard.tone,
  );
  const selectedAnalysisTone = photoAnalysis?.emotionCandidates.find(
    (candidate) => candidate.value === storyboard.tone,
  );

  return (
    <AppShell projectId={projectId}>
      <div className="screen-header">
        <h2>Storyboard</h2>
        <p>Choose an emotion &amp; style, then edit your scenes.</p>
      </div>

      {error && <ErrorAlert message={error} />}

      {/* Tone selector */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Emotion / Tone</h3>
        <div className={styles.toneGrid}>
          {TONES.map((t) => (
            <button
              key={t.value}
              className={`${styles.toneBtn} ${storyboard.tone === t.value ? styles.toneBtnActive : ""}`}
              onClick={() => handleToneChange(t.value)}
            >
              <strong>{t.label}</strong>
              <span>{t.desc}</span>
            </button>
          ))}
          {!fixedToneSelected && selectedAnalysisTone && (
            <button
              className={`${styles.toneBtn} ${styles.toneBtnActive}`}
              onClick={() => handleToneChange(selectedAnalysisTone.value)}
            >
              <strong>{selectedAnalysisTone.label}</strong>
              <span>{selectedAnalysisTone.description}</span>
            </button>
          )}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>AI Photo Analysis</h3>
          {analyzablePhotoCount > 0 && (
            <button
              className="btn btn-secondary"
              onClick={handleAnalyzePhotos}
              disabled={analyzingPhotos}
            >
              {analyzingPhotos ? "Analyzing…" : "Analyze photos"}
            </button>
          )}
        </div>
        {analyzablePhotoCount === 0 ? (
          <p className={styles.analysisEmpty}>
            Mark at least one photo as candidate or reference to analyze tone.
          </p>
        ) : photoAnalysis ? (
          <div className={styles.analysisPanel}>
            <p className={styles.analysisSummary}>
              {photoAnalysis.storySummary}
            </p>
            <div className={styles.analysisCandidates}>
              {photoAnalysis.emotionCandidates.map((candidate) => (
                <button
                  key={candidate.value}
                  className={`${styles.analysisCandidate} ${storyboard.tone === candidate.value ? styles.analysisCandidateActive : ""}`}
                  onClick={() => handleToneChange(candidate.value)}
                >
                  <strong>{candidate.label}</strong>
                  <span>{candidate.description}</span>
                  <small>{candidate.reason}</small>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className={styles.analysisEmpty}>
            Run analysis to get emotion candidates from the selected photo set.
          </p>
        )}
      </section>

      {/* Create template scenes from photos */}
      {photos.some((p) => p.usage === "candidate") && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>Create Scenes from Photos</h3>
            {selectedPhotoIds.size > 0 && (
              <button
                className="btn btn-primary"
                onClick={handleCreateTemplateScenes}
                disabled={creatingTemplates}
              >
                {creatingTemplates
                  ? "Creating…"
                  : `Add ${selectedPhotoIds.size} as scene${selectedPhotoIds.size !== 1 ? "s" : ""}`}
              </button>
            )}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))",
              gap: 12,
            }}
          >
            {photos
              .filter((p) => p.usage === "candidate")
              .map((photo) => (
                <label
                  key={photo.id}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    cursor: "pointer",
                    opacity: selectedPhotoIds.has(photo.id) ? 1 : 0.6,
                    transition: "opacity 0.2s",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedPhotoIds.has(photo.id)}
                    onChange={(e) => {
                      const newSet = new Set(selectedPhotoIds);
                      if (e.target.checked) {
                        newSet.add(photo.id);
                      } else {
                        newSet.delete(photo.id);
                      }
                      setSelectedPhotoIds(newSet);
                    }}
                    style={{ marginBottom: 8 }}
                  />
                  <img
                    src={storageKeyToUrl(photo.storageKey)}
                    alt={photo.name}
                    style={{
                      width: "100%",
                      aspectRatio: "1 / 1",
                      objectFit: "cover",
                      borderRadius: 8,
                      border: selectedPhotoIds.has(photo.id)
                        ? "2px solid var(--color-primary)"
                        : "none",
                    }}
                  />
                  <span
                    style={{ fontSize: 12, marginTop: 4, textAlign: "center" }}
                  >
                    {photo.name}
                  </span>
                </label>
              ))}
          </div>
        </section>
      )}

      {/* Style preset selector */}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>Style preset</h3>
        <div className={styles.styleGrid}>
          <button
            className={`${styles.styleBtn} ${!storyboard.stylePresetId ? styles.styleBtnActive : ""}`}
            onClick={() => handleStyleChange(null)}
          >
            AI recommend
          </button>
          {stylePresets.map((p) => (
            <button
              key={p.id}
              className={`${styles.styleBtn} ${storyboard.stylePresetId === p.id ? styles.styleBtnActive : ""}`}
              onClick={() => handleStyleChange(p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
      </section>

      {/* Scene list */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>Scenes ({scenes.length})</h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {saveMsg && <span className={styles.saveMsg}>{saveMsg}</span>}
            <button className="btn btn-secondary" onClick={addScene}>
              + Add scene
            </button>
            <button
              className="btn btn-primary"
              onClick={saveScenes}
              disabled={saving || aiFillingSceneId !== null}
            >
              {saving ? "Saving…" : "Save scenes"}
            </button>
          </div>
        </div>

        {scenes.length === 0 && (
          <div className={`card ${styles.emptyScenes}`}>
            <p>No scenes yet. Click "Add scene" to start.</p>
          </div>
        )}

        <div className={styles.sceneList}>
          {scenes.map((scene, idx) => (
            <SceneCard
              key={scene.id ?? idx}
              scene={scene}
              idx={idx}
              total={scenes.length}
              photos={photos}
              onUpdate={(patch) => updateScene(idx, patch)}
              onMove={(dir) => moveScene(idx, dir)}
              onAiFill={handleAiFill}
              isAiFilling={aiFillingSceneId === scene.id}
              isBusy={saving || aiFillingSceneId !== null}
            />
          ))}
        </div>
      </section>

      <div className={styles.footer}>
        <Link
          href={`/projects/${projectId}/generate`}
          className="btn btn-primary"
          style={{ marginLeft: "auto" }}
        >
          Continue to Generate →
        </Link>
      </div>
    </AppShell>
  );
}

function SceneCard({
  scene,
  idx,
  total,
  photos,
  onUpdate,
  onMove,
  onAiFill,
  isAiFilling,
  isBusy,
}: {
  scene: SceneState;
  idx: number;
  total: number;
  photos: PhotoAssetDto[];
  onUpdate: (patch: Partial<SceneState>) => void;
  onMove: (dir: -1 | 1) => void;
  onAiFill: (sceneId: string) => void;
  isAiFilling: boolean;
  isBusy: boolean;
}) {
  const [assigningPhoto, setAssigningPhoto] = useState<string | null>(null);
  const id = useId();

  const candidatePhotos = photos.filter((p) => p.usage === "candidate");

  async function handleAssignPhoto(
    photoAssetId: string,
    role: "primary" | "reference",
  ) {
    if (!scene.id) return;
    setAssigningPhoto(photoAssetId);
    try {
      await assignPhotosToScene(scene.id, [{ photoAssetId, role }]);
    } catch {
      // silently ignore — scene will show stale state until next save
    } finally {
      setAssigningPhoto(null);
    }
  }

  return (
    <div className={`card ${styles.sceneCard}`}>
      <div className={styles.sceneCardHeader}>
        <span className={styles.sceneIndex}>Scene {idx + 1}</span>
        <div className={styles.sceneHeaderActions}>
          <button
            className={styles.aiFillBtn}
            onClick={() => scene.id && onAiFill(scene.id)}
            disabled={!scene.id || isBusy}
            title="Fill blank fields with AI"
          >
            {isAiFilling ? "Filling..." : "AI fill"}
          </button>
          <button
            className={styles.moveBtn}
            onClick={() => onMove(-1)}
            disabled={idx === 0 || isBusy}
            title="Move up"
          >
            ↑
          </button>
          <button
            className={styles.moveBtn}
            onClick={() => onMove(1)}
            disabled={idx === total - 1 || isBusy}
            title="Move down"
          >
            ↓
          </button>
        </div>
      </div>

      <div className={styles.sceneFields}>
        <SceneField label="Title" htmlFor={`${id}-title`}>
          <input
            id={`${id}-title`}
            className={styles.fieldInput}
            value={scene.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
          />
        </SceneField>

        <SceneField label="Description" htmlFor={`${id}-desc`}>
          <textarea
            id={`${id}-desc`}
            className={styles.fieldInput}
            rows={2}
            value={scene.description}
            onChange={(e) => onUpdate({ description: e.target.value })}
          />
        </SceneField>

        <SceneField label="Image prompt" htmlFor={`${id}-prompt`}>
          <textarea
            id={`${id}-prompt`}
            className={styles.fieldInput}
            rows={3}
            value={scene.imagePrompt}
            onChange={(e) => onUpdate({ imagePrompt: e.target.value })}
          />
        </SceneField>

        <div className={styles.selectRow}>
          <SceneField label="Emotion" htmlFor={`${id}-emotion`}>
            <select
              id={`${id}-emotion`}
              className={styles.fieldInput}
              value={scene.emotion}
              onChange={(e) => onUpdate({ emotion: e.target.value })}
            >
              {EMOTION_OPTIONS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </SceneField>

          <SceneField label="Camera" htmlFor={`${id}-camera`}>
            <select
              id={`${id}-camera`}
              className={styles.fieldInput}
              value={scene.cameraDirection}
              onChange={(e) => onUpdate({ cameraDirection: e.target.value })}
            >
              {CAMERA_OPTIONS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </SceneField>

          <SceneField label="Lighting" htmlFor={`${id}-lighting`}>
            <select
              id={`${id}-lighting`}
              className={styles.fieldInput}
              value={scene.lightingDirection}
              onChange={(e) => onUpdate({ lightingDirection: e.target.value })}
            >
              {LIGHTING_OPTIONS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </SceneField>

          <SceneField label="Motion" htmlFor={`${id}-motion`}>
            <select
              id={`${id}-motion`}
              className={styles.fieldInput}
              value={scene.motionDirection}
              onChange={(e) => onUpdate({ motionDirection: e.target.value })}
            >
              {MOTION_OPTIONS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </SceneField>
        </div>

        {/* Photo assignment — only available after scene is saved (has ID) */}
        {scene.id && candidatePhotos.length > 0 && (
          <SceneField label="Primary photo" htmlFor={`${id}-photo`}>
            <div className={styles.photoAssignRow}>
              {candidatePhotos.map((p) => (
                <button
                  key={p.id}
                  className={styles.photoAssignBtn}
                  onClick={() => handleAssignPhoto(p.id, "primary")}
                  disabled={assigningPhoto !== null}
                  title={p.name}
                >
                  <img
                    src={storageKeyToUrl(p.storageKey)}
                    alt={p.name}
                    className={styles.photoAssignThumb}
                  />
                </button>
              ))}
            </div>
            <p className={styles.photoAssignHint}>
              Click a photo to assign it as primary for this scene.
            </p>
          </SceneField>
        )}
      </div>
    </div>
  );
}

function SceneField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className={styles.sceneField}>
      <label className={styles.fieldLabel} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}
