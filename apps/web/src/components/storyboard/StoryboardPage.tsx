"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState } from "react";
import type { PhotoAssetDto, StylePresetDto, StoryboardDto } from "@gen-story/shared";
import {
  assignPhotosToScene,
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
  "Wide", "Extreme Wide", "Medium", "Close-up", "Extreme Close-up",
  "Aerial", "Overhead", "POV", "Low Angle", "Telephoto", "Voyeur",
];
const LIGHTING_OPTIONS = [
  "Golden hour", "Natural", "Dramatic", "Night", "Soft",
  "Backlit", "Silhouette", "Volumetric",
];
const MOTION_OPTIONS = ["Slow pan", "Static", "Zoom in", "Zoom out", "Tracking"];
const EMOTION_OPTIONS = [
  "Joy", "Nostalgia", "Love", "Pride", "Wonder", "Calm", "Excitement", "Gratitude",
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

export function StoryboardPage({ projectId }: { projectId: string }) {
  const [storyboard, setStoryboard] = useState<StoryboardDto | null>(null);
  const [scenes, setScenes] = useState<SceneState[]>([]);
  const [stylePresets, setStylePresets] = useState<StylePresetDto[]>([]);
  const [photos, setPhotos] = useState<PhotoAssetDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const sbId = storyboard?.id;

  const load = useCallback(async () => {
    const [sbs, presets, photoList] = await Promise.all([
      listStoryboards(projectId),
      listStylePresets(),
      listPhotoAssets(projectId),
    ]);
    setStylePresets(presets);
    setPhotos(photoList);
    if (sbs.length > 0) {
      const sb = sbs[0]!;
      setStoryboard(sb);
      const sceneList = await listScenes(sb.id);
      setScenes(
        sceneList.map((s) => ({
          id: s.id,
          sceneId: s.id,
          orderIndex: s.orderIndex,
          title: s.title,
          description: s.description,
          imagePrompt: s.imagePrompt,
          emotion: s.emotion,
          cameraDirection: s.cameraDirection,
          lightingDirection: s.lightingDirection,
          motionDirection: s.motionDirection,
          notes: s.notes,
        })),
      );
    }
  }, [projectId]);

  useEffect(() => {
    load().catch((e: Error) => setError(e.message)).finally(() => setLoading(false));
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
      const saved = await upsertScenes(sbId, scenes.map((s) => ({
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
      })));
      setScenes(saved.map((s) => ({
        id: s.id,
        sceneId: s.id,
        orderIndex: s.orderIndex,
        title: s.title,
        description: s.description,
        imagePrompt: s.imagePrompt,
        emotion: s.emotion,
        cameraDirection: s.cameraDirection,
        lightingDirection: s.lightingDirection,
        motionDirection: s.motionDirection,
        notes: s.notes,
      })));
      setSaveMsg("Saved");
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save scenes");
    } finally {
      setSaving(false);
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
        </div>
      </section>

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
              disabled={saving}
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
}: {
  scene: SceneState;
  idx: number;
  total: number;
  photos: PhotoAssetDto[];
  onUpdate: (patch: Partial<SceneState>) => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [assigningPhoto, setAssigningPhoto] = useState<string | null>(null);
  const id = useId();

  const candidatePhotos = photos.filter((p) => p.usage === "candidate");


  async function handleAssignPhoto(photoAssetId: string, role: "primary" | "reference") {
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
        <div className={styles.sceneMoveButtons}>
          <button
            className={styles.moveBtn}
            onClick={() => onMove(-1)}
            disabled={idx === 0}
            title="Move up"
          >
            ↑
          </button>
          <button
            className={styles.moveBtn}
            onClick={() => onMove(1)}
            disabled={idx === total - 1}
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
              {EMOTION_OPTIONS.map((o) => <option key={o}>{o}</option>)}
            </select>
          </SceneField>

          <SceneField label="Camera" htmlFor={`${id}-camera`}>
            <select
              id={`${id}-camera`}
              className={styles.fieldInput}
              value={scene.cameraDirection}
              onChange={(e) => onUpdate({ cameraDirection: e.target.value })}
            >
              {CAMERA_OPTIONS.map((o) => <option key={o}>{o}</option>)}
            </select>
          </SceneField>

          <SceneField label="Lighting" htmlFor={`${id}-lighting`}>
            <select
              id={`${id}-lighting`}
              className={styles.fieldInput}
              value={scene.lightingDirection}
              onChange={(e) => onUpdate({ lightingDirection: e.target.value })}
            >
              {LIGHTING_OPTIONS.map((o) => <option key={o}>{o}</option>)}
            </select>
          </SceneField>

          <SceneField label="Motion" htmlFor={`${id}-motion`}>
            <select
              id={`${id}-motion`}
              className={styles.fieldInput}
              value={scene.motionDirection}
              onChange={(e) => onUpdate({ motionDirection: e.target.value })}
            >
              {MOTION_OPTIONS.map((o) => <option key={o}>{o}</option>)}
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
