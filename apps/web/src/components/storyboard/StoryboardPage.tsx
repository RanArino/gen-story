"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useState } from "react";
import type {
  ComplementSceneProposalDto,
  PhotoAssetDto,
  ProjectPhotoAnalysisDto,
  SceneDto,
  ScenePhotoAssetDto,
  StoryboardDto,
  StylePresetDto,
  TestGenerationBatchDto,
} from "@gen-story/shared";
import { RECOMMENDED_NEGATIVE_FENCE } from "@gen-story/shared";
import {
  analyzeProjectPhotos,
  assignPhotosToScene,
  createCustomStyle,
  createTemplateScenesFromPhotos,
  fillSceneWithAi,
  getProjectPhotoAnalysis,
  getTestGenerationBatch,
  insertComplementScene,
  listPhotoAssets,
  listScenes,
  listStoryboards,
  listStylePresets,
  proposeComplementScenes,
  reorderScenes,
  upsertScenes,
  upsertStoryboard,
  type UpsertSceneInput,
} from "../../lib/api-client";
import { TestGenerationModal } from "./TestGenerationModal";
import { storageKeyToUrl } from "../../lib/image-url";
import { AppShell } from "../AppShell";
import { ComposedPromptPreview } from "../common/ComposedPromptPreview";
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

const DEFAULT_SCENE_FIXED = {
  emotion: "Joy",
  cameraDirection: "Wide",
  lightingDirection: "Natural",
  motionDirection: "Slow pan",
  notes: "",
} as const;

type SceneState = UpsertSceneInput & {
  id?: string;
  kind: string;
  bridge: { fromSceneId: string; toSceneId: string } | null;
  photoAssets: ScenePhotoAssetDto[];
};

function sceneDtoToState(scene: SceneDto): SceneState {
  return {
    id: scene.id,
    sceneId: scene.id,
    orderIndex: scene.orderIndex,
    kind: scene.kind,
    bridge: scene.bridge,
    title: scene.title,
    description: scene.description,
    imagePrompt: scene.imagePrompt,
    emotion: scene.emotion,
    cameraDirection: scene.cameraDirection,
    lightingDirection: scene.lightingDirection,
    motionDirection: scene.motionDirection,
    notes: scene.notes,
    negativePrompt: scene.negativePrompt,
    photoAssets: scene.photoAssets,
  };
}

export function StoryboardPage({ projectId }: { projectId: string }) {
  const t = useTranslations("storyboard");
  const tCommon = useTranslations("common");
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
  const [testBatch, setTestBatch] = useState<TestGenerationBatchDto | null>(
    null,
  );
  const [showTestModal, setShowTestModal] = useState(false);
  const [commonPromptDraft, setCommonPromptDraft] = useState("");
  const [savingCommonPrompt, setSavingCommonPrompt] = useState(false);
  const [negativePromptDraft, setNegativePromptDraft] = useState("");
  const [savingNegativePrompt, setSavingNegativePrompt] = useState(false);
  const [showCustomStyleModal, setShowCustomStyleModal] = useState(false);
  const [customStyleForm, setCustomStyleForm] = useState({
    name: "",
    description: "",
    prompt: "",
  });
  const [savingCustomStyle, setSavingCustomStyle] = useState(false);
  const [complementBusy, setComplementBusy] = useState(false);
  const [photoViewSize, setPhotoViewSize] = useState<
    "small" | "medium" | "large"
  >("small");
  const [sceneDragIndex, setSceneDragIndex] = useState<number | null>(null);
  const [accordionOpen, setAccordionOpen] = useState({
    tone: true,
    style: true,
    commonPrompt: true,
    negativePrompt: true,
  });
  const [proposalCtx, setProposalCtx] = useState<{
    fromSceneId: string;
    toSceneId: string;
    proposals: ComplementSceneProposalDto[];
  } | null>(null);

  const sbId = storyboard?.id;
  const systemStylePresets = stylePresets.filter((p) => p.scope === "system");
  const userStylePresets = stylePresets.filter((p) => p.scope === "user");

  useEffect(() => {
    setCommonPromptDraft(storyboard?.commonPrompt ?? "");
  }, [storyboard?.commonPrompt]);

  useEffect(() => {
    setNegativePromptDraft(storyboard?.negativePrompt ?? "");
  }, [storyboard?.negativePrompt]);

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
      const [sceneList, batch] = await Promise.all([
        listScenes(sb.id),
        getTestGenerationBatch(sb.id),
      ]);
      setScenes(sceneList.map(sceneDtoToState));
      setTestBatch(batch);
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
      setError(e instanceof Error ? e.message : t("scenes.failedInit"));
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
      setError(e instanceof Error ? e.message : t("scenes.failedTone"));
    }
  }

  async function handleAnalyzePhotos() {
    setAnalyzingPhotos(true);
    setError(null);
    try {
      const analysis = await analyzeProjectPhotos(projectId);
      setPhotoAnalysis(analysis);
      setSaveMsg(t("ai.completeMsg"));
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("scenes.failedAnalyze"));
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
      setError(e instanceof Error ? e.message : t("scenes.failedStyle"));
    }
  }

  async function handleCreateCustomStyle() {
    setSavingCustomStyle(true);
    setError(null);
    try {
      const newStyle = await createCustomStyle(customStyleForm);
      setStylePresets((prev) => [...prev, newStyle]);
      setCustomStyleForm({ name: "", description: "", prompt: "" });
      setShowCustomStyleModal(false);
      setSaveMsg(t("style.createdMsg"));
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("style.failed"));
    } finally {
      setSavingCustomStyle(false);
    }
  }

  async function saveCommonPrompt(commonPrompt: string) {
    if (!sbId) return;
    const prev = storyboard!;
    setSavingCommonPrompt(true);
    setError(null);
    try {
      const updated = await upsertStoryboard(sbId, {
        projectId,
        tone: prev.tone,
        stylePresetId: prev.stylePresetId,
        commonPrompt,
      });
      setStoryboard(updated);
      if (commonPrompt === "") {
        setAccordionOpen((prev) => ({ ...prev, commonPrompt: true }));
      }
      setSaveMsg(t("commonPrompt.savedMsg"));
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("commonPrompt.failed"));
    } finally {
      setSavingCommonPrompt(false);
    }
  }

  async function saveNegativePrompt(negativePrompt: string) {
    if (!sbId) return;
    const prev = storyboard!;
    setSavingNegativePrompt(true);
    setError(null);
    try {
      const updated = await upsertStoryboard(sbId, {
        projectId,
        tone: prev.tone,
        stylePresetId: prev.stylePresetId,
        negativePrompt,
      });
      setStoryboard(updated);
      setSaveMsg(t("negativePrompt.savedMsg"));
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("negativePrompt.failed"));
    } finally {
      setSavingNegativePrompt(false);
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
      setSaveMsg(
        t(
          newScenes.length === 1
            ? "createScenes.createdMsg"
            : "createScenes.createdMsgPlural",
          { count: newScenes.length },
        ),
      );
      setTimeout(() => setSaveMsg(null), 4000);
      // Scroll to scenes section after a short delay
      setTimeout(() => {
        const scenesSection = document.querySelector("[data-scenes-section]");
        if (scenesSection) {
          scenesSection.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }, 300);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("createScenes.failed"));
    } finally {
      setCreatingTemplates(false);
    }
  }

  function updateScene(idx: number, patch: Partial<SceneState>) {
    setScenes((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  }

  function deleteScene(idx: number) {
    setScenes((prev) =>
      prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, orderIndex: i })),
    );
  }

  function addScene() {
    setScenes((prev) => [
      ...prev,
      {
        ...DEFAULT_SCENE_FIXED,
        title: t("scenes.defaultTitle"),
        description: t("scenes.defaultDescription"),
        imagePrompt: t("scenes.defaultImagePrompt"),
        orderIndex: prev.length,
        kind: "photo",
        bridge: null,
        photoAssets: [],
      },
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

  async function handleSceneReorder(fromIdx: number, toIdx: number) {
    if (fromIdx === toIdx) return;
    const next = [...scenes];
    const [moved] = next.splice(fromIdx, 1);
    if (!moved) return;
    next.splice(toIdx, 0, moved);
    const reindexed = next.map((s, i) => ({ ...s, orderIndex: i }));
    setScenes(reindexed);
    if (sbId && reindexed.every((s) => s.id)) {
      try {
        const saved = await reorderScenes(
          sbId,
          reindexed.map((s) => s.id!),
        );
        setScenes(saved.map(sceneDtoToState));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : t("scenes.failedReorder"));
      }
    }
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
          negativePrompt: s.negativePrompt,
        })),
      );
      setScenes(saved.map(sceneDtoToState));
      setSaveMsg(t("saved"));
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("scenes.failedSave"));
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
      setSaveMsg(t("aiFillSaved"));
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("scenes.failedFill"));
    } finally {
      setAiFillingSceneId(null);
    }
  }

  async function handleInsertBlankComplement(
    fromSceneId: string,
    toSceneId: string,
  ) {
    if (!sbId) return;
    setComplementBusy(true);
    setError(null);
    try {
      await insertComplementScene(sbId, fromSceneId, toSceneId);
      const sceneList = await listScenes(sbId);
      setScenes(sceneList.map(sceneDtoToState));
      setSaveMsg(t("complement.inserted"));
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("complement.failedInsert"));
    } finally {
      setComplementBusy(false);
    }
  }

  async function handleProposeComplement(
    fromSceneId: string,
    toSceneId: string,
  ) {
    if (!sbId) return;
    setComplementBusy(true);
    setError(null);
    try {
      const proposals = await proposeComplementScenes(
        sbId,
        fromSceneId,
        toSceneId,
      );
      setProposalCtx({ fromSceneId, toSceneId, proposals });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("complement.failedPropose"));
    } finally {
      setComplementBusy(false);
    }
  }

  async function handleApplyProposal(proposal: ComplementSceneProposalDto) {
    if (!sbId || !proposalCtx) return;
    setComplementBusy(true);
    setError(null);
    try {
      const inserted = await insertComplementScene(
        sbId,
        proposalCtx.fromSceneId,
        proposalCtx.toSceneId,
      );
      const sceneList = await listScenes(sbId);
      setScenes(
        sceneList.map((dto) => {
          const state = sceneDtoToState(dto);
          if (dto.id === inserted.id) {
            return {
              ...state,
              title: proposal.title,
              description: proposal.description,
              imagePrompt: proposal.imagePrompt,
              emotion: proposal.emotion,
              cameraDirection: proposal.cameraDirection,
              lightingDirection: proposal.lightingDirection,
              motionDirection: proposal.motionDirection,
            };
          }
          return state;
        }),
      );
      setProposalCtx(null);
      setSaveMsg(t("complement.appliedReview"));
      setTimeout(() => setSaveMsg(null), 4000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("complement.failedApply"));
    } finally {
      setComplementBusy(false);
    }
  }

  if (loading) {
    return (
      <AppShell projectId={projectId}>
        <p style={{ color: "#8898aa" }}>{tCommon("loading")}</p>
      </AppShell>
    );
  }

  if (!storyboard) {
    return (
      <AppShell projectId={projectId}>
        <div className="screen-header">
          <h2>{t("title")}</h2>
          <p>{t("noStoryboard")}</p>
        </div>
        {error && <ErrorAlert message={error} />}
        <button className="btn btn-primary" onClick={initStoryboard}>
          {t("initialize")}
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
  const fixedTone = TONES.find((tn) => tn.value === storyboard.tone);
  const selectedToneLabel = fixedTone
    ? t(`tones.${fixedTone.value}.label`)
    : (selectedAnalysisTone?.label ?? storyboard.tone);
  const selectedStyle = stylePresets.find(
    (p) => p.id === storyboard.stylePresetId,
  );

  return (
    <AppShell projectId={projectId}>
      <div className="screen-header">
        <h2>{t("title")}</h2>
        <p>{t("subtitle")}</p>
      </div>

      {error && <ErrorAlert message={error} />}

      {/* AI assistant card — top-level, scope-explicit. Only affects Tone. */}
      <section className={styles.aiAssistCard}>
        <div className={styles.aiAssistHeader}>
          <div className={styles.aiAssistTitleBlock}>
            <h3 className={styles.aiAssistTitle}>
              <span className={styles.aiAssistIcon} aria-hidden>
                ✨
              </span>
              {t("ai.title")}
            </h3>
            <p className={styles.aiAssistSubtitle}>
              {t.rich("ai.subtitle", {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
          </div>
          {analyzablePhotoCount > 0 && (
            <button
              className="btn btn-primary"
              onClick={handleAnalyzePhotos}
              disabled={analyzingPhotos}
            >
              {analyzingPhotos
                ? t("ai.analyzing")
                : photoAnalysis
                  ? t("ai.reanalyze")
                  : t("ai.analyze")}
            </button>
          )}
        </div>

        <div className={styles.aiAssistBody}>
          {analyzablePhotoCount === 0 ? (
            <p className={styles.analysisEmpty}>{t("ai.emptyNoPhotos")}</p>
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
              {t.rich("ai.emptyClickToStart", {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </p>
          )}
        </div>
      </section>

      {/* 1. Emotion / Tone */}
      <CollapsibleSection
        title={t("sections.tone")}
        open={accordionOpen.tone}
        onToggle={() =>
          setAccordionOpen((prev) => ({ ...prev, tone: !prev.tone }))
        }
        summary={<span>{selectedToneLabel}</span>}
      >
        <div className={styles.toneGrid}>
          {TONES.map((tn) => (
            <button
              key={tn.value}
              className={`${styles.toneBtn} ${storyboard.tone === tn.value ? styles.toneBtnActive : ""}`}
              onClick={() => handleToneChange(tn.value)}
            >
              <strong>{t(`tones.${tn.value}.label`)}</strong>
              <span>{t(`tones.${tn.value}.desc`)}</span>
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
      </CollapsibleSection>

      {/* 2. Style preset */}
      <CollapsibleSection
        title={t("sections.style")}
        open={accordionOpen.style}
        onToggle={() =>
          setAccordionOpen((prev) => ({ ...prev, style: !prev.style }))
        }
        summary={
          selectedStyle ? (
            <span className={styles.accordionSummaryStyle}>
              {selectedStyle.previewImageUrl && (
                <img
                  src={selectedStyle.previewImageUrl}
                  alt=""
                  className={styles.accordionSummaryThumb}
                />
              )}
              <span>{selectedStyle.name}</span>
            </span>
          ) : (
            <span>{t("style.aiRecommend")}</span>
          )
        }
        headerAction={
          <button
            className="btn btn-secondary"
            onClick={() => setShowCustomStyleModal(true)}
          >
            {t("style.createCustom")}
          </button>
        }
      >
        <div className={styles.styleGrid}>
          <button
            className={`${styles.styleBtn} ${!storyboard.stylePresetId ? styles.styleBtnActive : ""}`}
            onClick={() => handleStyleChange(null)}
          >
            {t("style.aiRecommend")}
          </button>
          {systemStylePresets.length > 0 && (
            <span className={styles.styleGroupLabel}>
              {t("style.systemStyles")}
            </span>
          )}
          {systemStylePresets.map((p) => (
            <button
              key={p.id}
              className={`${styles.styleBtnCard} ${storyboard.stylePresetId === p.id ? styles.styleBtnCardActive : ""}`}
              onClick={() => handleStyleChange(p.id)}
              title={p.description}
            >
              {p.previewImageUrl && (
                <img src={p.previewImageUrl} alt={p.name} />
              )}
              <span className={styles.styleBtnCardLabel}>{p.name}</span>
            </button>
          ))}
          {userStylePresets.length > 0 && (
            <span className={styles.styleGroupLabel}>
              {t("style.customStyles")}
            </span>
          )}
          {userStylePresets.map((p) => (
            <button
              key={p.id}
              className={`${styles.styleBtn} ${storyboard.stylePresetId === p.id ? styles.styleBtnActive : ""}`}
              onClick={() => handleStyleChange(p.id)}
              title={p.description}
            >
              {p.name}
            </button>
          ))}
        </div>
        {showCustomStyleModal && (
          <div className={styles.modalOverlay} role="presentation">
            <div
              className={styles.modalContent}
              role="dialog"
              aria-modal="true"
              aria-labelledby="custom-style-title"
            >
              <h4 id="custom-style-title" className={styles.modalTitle}>
                {t("style.createCustom")}
              </h4>
              <label className={styles.sceneField}>
                <span className={styles.fieldLabel}>{t("style.name")}</span>
                <input
                  className={styles.fieldInput}
                  type="text"
                  value={customStyleForm.name}
                  onChange={(event) =>
                    setCustomStyleForm((prev) => ({
                      ...prev,
                      name: event.target.value,
                    }))
                  }
                  disabled={savingCustomStyle}
                  placeholder={t("style.namePlaceholder")}
                />
              </label>
              <label className={styles.sceneField}>
                <span className={styles.fieldLabel}>
                  {t("style.description")}
                </span>
                <textarea
                  className={styles.fieldInput}
                  value={customStyleForm.description}
                  onChange={(event) =>
                    setCustomStyleForm((prev) => ({
                      ...prev,
                      description: event.target.value,
                    }))
                  }
                  disabled={savingCustomStyle}
                  rows={2}
                  placeholder={t("style.descriptionPlaceholder")}
                />
              </label>
              <label className={styles.sceneField}>
                <span className={styles.fieldLabel}>{t("style.prompt")}</span>
                <textarea
                  className={styles.fieldInput}
                  value={customStyleForm.prompt}
                  onChange={(event) =>
                    setCustomStyleForm((prev) => ({
                      ...prev,
                      prompt: event.target.value,
                    }))
                  }
                  disabled={savingCustomStyle}
                  rows={5}
                  placeholder={t("style.promptPlaceholder")}
                />
              </label>
              <div className={styles.modalActions}>
                <button
                  className="btn btn-primary"
                  onClick={handleCreateCustomStyle}
                  disabled={
                    savingCustomStyle ||
                    !customStyleForm.name.trim() ||
                    !customStyleForm.prompt.trim()
                  }
                >
                  {savingCustomStyle
                    ? t("style.creating")
                    : t("style.createStyle")}
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowCustomStyleModal(false)}
                  disabled={savingCustomStyle}
                >
                  {tCommon("cancel")}
                </button>
              </div>
            </div>
          </div>
        )}
      </CollapsibleSection>

      {/* 3. Common prompt */}
      <CollapsibleSection
        title={t("sections.commonPrompt")}
        open={accordionOpen.commonPrompt}
        onToggle={() =>
          setAccordionOpen((prev) => ({
            ...prev,
            commonPrompt: !prev.commonPrompt,
          }))
        }
        summary={
          storyboard.commonPrompt ? (
            <span title={storyboard.commonPrompt}>
              {storyboard.commonPrompt}
            </span>
          ) : (
            <span className={styles.accordionSummaryMuted}>
              {t("commonPrompt.notSet")}
            </span>
          )
        }
        headerAction={
          <button
            className="btn btn-secondary"
            onClick={() => saveCommonPrompt("")}
            disabled={savingCommonPrompt}
          >
            {t("commonPrompt.regenerate")}
          </button>
        }
      >
        <p className={styles.photoAssignHint}>{t("commonPrompt.intro")}</p>
        <textarea
          className={styles.fieldInput}
          rows={10}
          value={commonPromptDraft}
          onChange={(e) => setCommonPromptDraft(e.target.value)}
          placeholder={t("commonPrompt.placeholder")}
        />
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginTop: 8,
          }}
        >
          <button
            className="btn btn-primary"
            onClick={() => saveCommonPrompt(commonPromptDraft)}
            disabled={
              savingCommonPrompt ||
              commonPromptDraft === (storyboard.commonPrompt ?? "")
            }
          >
            {savingCommonPrompt
              ? t("commonPrompt.saving")
              : t("commonPrompt.save")}
          </button>
        </div>
      </CollapsibleSection>

      {/* 3b. Negative prompt (deviation fence) */}
      <CollapsibleSection
        title={t("sections.negativePrompt")}
        open={accordionOpen.negativePrompt}
        onToggle={() =>
          setAccordionOpen((prev) => ({
            ...prev,
            negativePrompt: !prev.negativePrompt,
          }))
        }
        summary={
          storyboard.negativePrompt ? (
            <span title={storyboard.negativePrompt}>
              {storyboard.negativePrompt}
            </span>
          ) : (
            <span className={styles.accordionSummaryMuted}>
              {t("negativePrompt.notSet")}
            </span>
          )
        }
      >
        <p className={styles.photoAssignHint}>{t("negativePrompt.intro")}</p>
        <textarea
          className={styles.fieldInput}
          rows={4}
          value={negativePromptDraft}
          onChange={(e) => setNegativePromptDraft(e.target.value)}
          placeholder={t("negativePrompt.placeholder")}
        />
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            marginTop: 8,
          }}
        >
          <button
            className="btn btn-primary"
            onClick={() => saveNegativePrompt(negativePromptDraft)}
            disabled={
              savingNegativePrompt ||
              negativePromptDraft === (storyboard.negativePrompt ?? "")
            }
          >
            {savingNegativePrompt
              ? t("negativePrompt.saving")
              : t("negativePrompt.save")}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() =>
              setNegativePromptDraft((prev) => {
                const trimmed = prev.trim();
                return trimmed
                  ? `${trimmed}, ${RECOMMENDED_NEGATIVE_FENCE}`
                  : RECOMMENDED_NEGATIVE_FENCE;
              })
            }
            disabled={savingNegativePrompt}
          >
            {t("negativePrompt.insertFence")}
          </button>
        </div>
      </CollapsibleSection>

      {/* 4. Create Scenes from Photos — always visible, right above Scenes */}
      {photos.some((p) => p.usage === "candidate") &&
        (() => {
          const candidatePhotos = photos.filter((p) => p.usage === "candidate");
          const allSelected =
            candidatePhotos.length > 0 &&
            candidatePhotos.every((p) => selectedPhotoIds.has(p.id));
          const someSelected = selectedPhotoIds.size > 0;
          const gridMin =
            photoViewSize === "large"
              ? "180px"
              : photoViewSize === "medium"
                ? "130px"
                : "90px";
          return (
            <section className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>
                  {t("sections.createScenes")}
                </h3>
                <button
                  className="btn btn-primary"
                  onClick={handleCreateTemplateScenes}
                  disabled={creatingTemplates || selectedPhotoIds.size === 0}
                >
                  {creatingTemplates
                    ? t("createScenes.creating")
                    : selectedPhotoIds.size === 0
                      ? t("createScenes.selectPhotosCta")
                      : t(
                          selectedPhotoIds.size === 1
                            ? "createScenes.addAsScene"
                            : "createScenes.addAsScenes",
                          { count: selectedPhotoIds.size },
                        )}
                </button>
              </div>

              {/* Toolbar: select-all + view size */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 10,
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 13,
                    fontWeight: 500,
                    color: "#5a6a7e",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected && !allSelected;
                    }}
                    onChange={() => {
                      if (allSelected) {
                        setSelectedPhotoIds(new Set());
                      } else {
                        setSelectedPhotoIds(
                          new Set(candidatePhotos.map((p) => p.id)),
                        );
                      }
                    }}
                    style={{
                      width: 15,
                      height: 15,
                      accentColor: "#1a56db",
                      cursor: "pointer",
                    }}
                  />
                  {allSelected
                    ? t("createScenes.deselectAll")
                    : t("createScenes.selectAll")}
                </label>

                {/* Size toggle */}
                <div
                  style={{
                    display: "flex",
                    gap: 2,
                    background: "#f0f3f8",
                    borderRadius: 8,
                    padding: 3,
                  }}
                >
                  {(["small", "medium", "large"] as const).map((size) => (
                    <button
                      key={size}
                      onClick={() => setPhotoViewSize(size)}
                      title={t("createScenes.thumbsTitle", {
                        size: size.charAt(0).toUpperCase() + size.slice(1),
                      })}
                      style={{
                        width: 30,
                        height: 28,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize:
                          size === "small" ? 13 : size === "medium" ? 16 : 20,
                        background: photoViewSize === size ? "#fff" : "none",
                        border: "none",
                        borderRadius: 6,
                        color: photoViewSize === size ? "#1a56db" : "#8898aa",
                        cursor: "pointer",
                        boxShadow:
                          photoViewSize === size
                            ? "0 1px 3px rgba(0,0,0,.1)"
                            : "none",
                      }}
                    >
                      ⊞
                    </button>
                  ))}
                </div>
              </div>

              {selectedPhotoIds.size === 0 && (
                <p
                  style={{
                    color: "var(--color-text-muted)",
                    fontSize: "0.9em",
                    marginBottom: 12,
                  }}
                >
                  {t("createScenes.hint")}
                </p>
              )}

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(auto-fill, minmax(${gridMin}, 1fr))`,
                  gap: 12,
                }}
              >
                {candidatePhotos.map((photo) => (
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
                      style={{ marginBottom: 6 }}
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
                          : "2px solid transparent",
                      }}
                    />
                    <span
                      style={{
                        fontSize: 11,
                        marginTop: 4,
                        textAlign: "center",
                        color: "#5a6a7e",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        maxWidth: "100%",
                      }}
                    >
                      {photo.name}
                    </span>
                  </label>
                ))}
              </div>
            </section>
          );
        })()}

      {/* 5. Scene list */}
      <section className={styles.section} data-scenes-section>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>
            {t("sections.scenes", { count: scenes.length })}
          </h3>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {saveMsg && <span className={styles.saveMsg}>{saveMsg}</span>}
            <button className="btn btn-secondary" onClick={addScene}>
              {t("scenes.addScene")}
            </button>
            <button
              className="btn btn-primary"
              onClick={saveScenes}
              disabled={saving || aiFillingSceneId !== null}
            >
              {saving ? t("saving") : t("saveScenes")}
            </button>
          </div>
        </div>

        {scenes.length === 0 && (
          <div className={`card ${styles.emptyScenes}`}>
            <p>{t("scenes.empty")}</p>
          </div>
        )}

        <div className={styles.sceneList}>
          {scenes.map((scene, idx) => {
            const nextScene = scenes[idx + 1];
            return (
              <div
                key={scene.id ?? idx}
                onDragOver={(e) => {
                  if (sceneDragIndex !== null) e.preventDefault();
                }}
                onDrop={() => {
                  if (sceneDragIndex !== null) {
                    void handleSceneReorder(sceneDragIndex, idx);
                  }
                  setSceneDragIndex(null);
                }}
              >
                <SceneCard
                  scene={scene}
                  idx={idx}
                  total={scenes.length}
                  scenes={scenes}
                  photos={photos}
                  isDragging={sceneDragIndex === idx}
                  onDragHandleStart={() => setSceneDragIndex(idx)}
                  onDragHandleEnd={() => setSceneDragIndex(null)}
                  onUpdate={(patch) => updateScene(idx, patch)}
                  onMove={(dir) => moveScene(idx, dir)}
                  onDelete={() => deleteScene(idx)}
                  onAiFill={handleAiFill}
                  isAiFilling={aiFillingSceneId === scene.id}
                  isBusy={saving || aiFillingSceneId !== null}
                  projectCommonPromptDraft={commonPromptDraft}
                  projectNegativePromptDraft={negativePromptDraft}
                />
                {scene.id && nextScene?.id && (
                  <ComplementGap
                    disabled={complementBusy || saving}
                    onInsertBlank={() =>
                      handleInsertBlankComplement(scene.id!, nextScene.id!)
                    }
                    onPropose={() =>
                      handleProposeComplement(scene.id!, nextScene.id!)
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      {proposalCtx && (
        <ComplementProposalModal
          proposals={proposalCtx.proposals}
          busy={complementBusy}
          onApply={handleApplyProposal}
          onClose={() => setProposalCtx(null)}
        />
      )}

      <div className={styles.footer}>
        {testBatch?.status === "completed" ? (
          <Link
            href={`/projects/${projectId}/generate`}
            className="btn btn-primary"
            style={{ marginLeft: "auto" }}
          >
            {t("footer.continueToGenerate")}
          </Link>
        ) : (
          <div
            style={{
              marginLeft: "auto",
              display: "flex",
              gap: 12,
              alignItems: "center",
            }}
          >
            {testBatch?.status === "pending" && (
              <span style={{ fontSize: 13, color: "#888" }}>
                {t("footer.testInProgress")}
              </span>
            )}
            <button
              className="btn btn-primary"
              onClick={() => setShowTestModal(true)}
              disabled={scenes.length === 0}
            >
              {testBatch
                ? t("footer.viewTestGeneration")
                : t("footer.startTestGeneration")}
            </button>
          </div>
        )}
      </div>

      {showTestModal && storyboard && scenes[0] && (
        <TestGenerationModal
          storyboardId={storyboard.id}
          sceneId={scenes[0].id ?? ""}
          existingBatch={testBatch}
          onConfirmed={() => {
            setShowTestModal(false);
            load().catch(() => undefined);
          }}
          onClose={() => setShowTestModal(false)}
        />
      )}
    </AppShell>
  );
}

function CollapsibleSection({
  title,
  open,
  onToggle,
  children,
  headerAction,
  summary,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  headerAction?: React.ReactNode;
  summary?: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.accordionHeader}>
        <button
          type="button"
          className={styles.accordionToggle}
          onClick={onToggle}
          aria-expanded={open}
        >
          <span className={styles.accordionCaret}>{open ? "▾" : "▸"}</span>
          <h3 className={styles.sectionTitle}>{title}</h3>
        </button>
        {!open && summary !== undefined && (
          <div className={styles.accordionSummary}>{summary}</div>
        )}
        {headerAction && (
          <div onClick={(e) => e.stopPropagation()}>{headerAction}</div>
        )}
      </div>
      {open && <div className={styles.accordionBody}>{children}</div>}
    </section>
  );
}

function ComplementGap({
  disabled,
  onInsertBlank,
  onPropose,
}: {
  disabled: boolean;
  onInsertBlank: () => void;
  onPropose: () => void;
}) {
  const t = useTranslations("storyboard");
  return (
    <div className={styles.complementGap}>
      <button
        type="button"
        className={styles.complementGapBtn}
        onClick={onInsertBlank}
        disabled={disabled}
        title={t("complement.insertBlankTitle")}
      >
        {t("complement.insertBlank")}
      </button>
      <button
        type="button"
        className={styles.complementGapBtn}
        onClick={onPropose}
        disabled={disabled}
        title={t("complement.aiProposeTitle")}
      >
        {t("complement.aiPropose")}
      </button>
    </div>
  );
}

function ComplementProposalModal({
  proposals,
  busy,
  onApply,
  onClose,
}: {
  proposals: ComplementSceneProposalDto[];
  busy: boolean;
  onApply: (proposal: ComplementSceneProposalDto) => void;
  onClose: () => void;
}) {
  const t = useTranslations("storyboard");
  const tCommon = useTranslations("common");
  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.sectionTitle}>{t("complement.modalTitle")}</h3>
        <p className={styles.photoAssignHint}>{t("complement.modalHint")}</p>
        {proposals.length === 0 && (
          <p className={styles.analysisEmpty}>{t("complement.noProposals")}</p>
        )}
        {proposals.map((proposal, index) => (
          <div key={index} className={`card ${styles.proposalCard}`}>
            <strong>{proposal.title}</strong>
            <p>{proposal.description}</p>
            <small>{proposal.imagePrompt}</small>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onApply(proposal)}
              disabled={busy}
            >
              {busy ? t("complement.applying") : t("complement.useScene")}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClose}
          disabled={busy}
        >
          {tCommon("cancel")}
        </button>
      </div>
    </div>
  );
}

function SceneCard({
  scene,
  idx,
  total,
  scenes,
  photos,
  isDragging,
  onDragHandleStart,
  onDragHandleEnd,
  onUpdate,
  onMove,
  onDelete,
  onAiFill,
  isAiFilling,
  isBusy,
  projectCommonPromptDraft,
  projectNegativePromptDraft,
}: {
  scene: SceneState;
  idx: number;
  total: number;
  scenes: SceneState[];
  photos: PhotoAssetDto[];
  isDragging: boolean;
  onDragHandleStart: () => void;
  onDragHandleEnd: () => void;
  onUpdate: (patch: Partial<SceneState>) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
  onAiFill: (sceneId: string) => void;
  isAiFilling: boolean;
  isBusy: boolean;
  projectCommonPromptDraft: string;
  projectNegativePromptDraft: string;
}) {
  const [assigningPhoto, setAssigningPhoto] = useState<string | null>(null);
  const id = useId();
  const t = useTranslations("storyboard");
  const tSel = useTranslations("selections");

  const isComplement = scene.kind === "complement";
  const candidatePhotos = photos.filter((p) => p.usage === "candidate");
  const bridgeLabel = (() => {
    if (!isComplement || !scene.bridge) return null;
    const sceneTitle = (sceneId: string) => {
      const found = scenes.find((s) => s.id === sceneId);
      if (!found) return t("scenes.sceneAnonymous");
      const order = scenes.indexOf(found) + 1;
      return found.title
        ? t("scenes.sceneWithTitle", { index: order, title: found.title })
        : t("scenes.sceneLabel", { index: order });
    };
    return `${sceneTitle(scene.bridge.fromSceneId)} → ${sceneTitle(scene.bridge.toSceneId)}`;
  })();

  async function handleAssignPhoto(
    photoAssetId: string,
    role: "primary" | "reference",
  ) {
    if (!scene.id) return;
    setAssigningPhoto(photoAssetId);
    try {
      await assignPhotosToScene(scene.id, [{ photoAssetId, role }]);
      onUpdate({
        photoAssets: [
          ...scene.photoAssets.filter((pa) => pa.role !== role),
          { photoAssetId, role },
        ],
      });
    } catch {
      // silently ignore — scene will show stale state until next save
    } finally {
      setAssigningPhoto(null);
    }
  }

  return (
    <div
      className={`card ${styles.sceneCard}${
        isComplement ? ` ${styles.complementCard}` : ""
      }`}
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <div className={styles.sceneCardHeader}>
        <span
          className={styles.sceneIndex}
          draggable
          onDragStart={onDragHandleStart}
          onDragEnd={onDragHandleEnd}
          style={{ cursor: "grab" }}
          title={t("scenes.dragTitle")}
        >
          ⠿{" "}
          {isComplement
            ? t("scenes.complementLabel", { index: idx + 1 })
            : t("scenes.sceneLabel", { index: idx + 1 })}
        </span>
        <div className={styles.sceneHeaderActions}>
          <button
            className={styles.aiFillBtn}
            onClick={() => scene.id && onAiFill(scene.id)}
            disabled={!scene.id || isBusy}
            title={t("aiFillTitle")}
          >
            {isAiFilling ? t("aiFilling") : t("aiFill")}
          </button>
          <button
            className={styles.moveBtn}
            onClick={() => onMove(-1)}
            disabled={idx === 0 || isBusy}
            title={t("scenes.moveUp")}
          >
            ↑
          </button>
          <button
            className={styles.moveBtn}
            onClick={() => onMove(1)}
            disabled={idx === total - 1 || isBusy}
            title={t("scenes.moveDown")}
          >
            ↓
          </button>
          <button
            className={styles.deleteBtn}
            onClick={onDelete}
            disabled={isBusy}
            title={t("scenes.deleteTitle")}
          >
            ×
          </button>
        </div>
      </div>

      {bridgeLabel && (
        <p className={styles.photoAssignHint}>
          {t("scenes.bridgingScene", { label: bridgeLabel })}
        </p>
      )}

      <div className={styles.sceneFields}>
        <SceneField label={t("fields.title")} htmlFor={`${id}-title`}>
          <input
            id={`${id}-title`}
            className={styles.fieldInput}
            value={scene.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
          />
        </SceneField>

        <SceneField label={t("fields.description")} htmlFor={`${id}-desc`}>
          <textarea
            id={`${id}-desc`}
            className={styles.fieldInput}
            rows={2}
            value={scene.description}
            onChange={(e) => onUpdate({ description: e.target.value })}
          />
        </SceneField>

        <SceneField label={t("fields.imagePrompt")} htmlFor={`${id}-prompt`}>
          <textarea
            id={`${id}-prompt`}
            className={styles.fieldInput}
            rows={3}
            value={scene.imagePrompt}
            onChange={(e) => onUpdate({ imagePrompt: e.target.value })}
          />
        </SceneField>

        <SceneField
          label={t("fields.sceneNegativePrompt")}
          htmlFor={`${id}-negative`}
        >
          <textarea
            id={`${id}-negative`}
            className={styles.fieldInput}
            rows={2}
            value={scene.negativePrompt ?? ""}
            onChange={(e) => onUpdate({ negativePrompt: e.target.value })}
            placeholder={t("fields.sceneNegativePromptPlaceholder")}
          />
        </SceneField>

        <div className={styles.selectRow}>
          <SceneField label={t("fields.emotion")} htmlFor={`${id}-emotion`}>
            <select
              id={`${id}-emotion`}
              className={styles.fieldInput}
              value={scene.emotion}
              onChange={(e) => onUpdate({ emotion: e.target.value })}
            >
              {EMOTION_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {tSel(`emotion.${o}`)}
                </option>
              ))}
            </select>
          </SceneField>

          <SceneField label={t("fields.camera")} htmlFor={`${id}-camera`}>
            <select
              id={`${id}-camera`}
              className={styles.fieldInput}
              value={scene.cameraDirection}
              onChange={(e) => onUpdate({ cameraDirection: e.target.value })}
            >
              {CAMERA_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {tSel(`camera.${o}`)}
                </option>
              ))}
            </select>
          </SceneField>

          <SceneField label={t("fields.lighting")} htmlFor={`${id}-lighting`}>
            <select
              id={`${id}-lighting`}
              className={styles.fieldInput}
              value={scene.lightingDirection}
              onChange={(e) => onUpdate({ lightingDirection: e.target.value })}
            >
              {LIGHTING_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {tSel(`lighting.${o}`)}
                </option>
              ))}
            </select>
          </SceneField>

          <SceneField label={t("fields.motion")} htmlFor={`${id}-motion`}>
            <select
              id={`${id}-motion`}
              className={styles.fieldInput}
              value={scene.motionDirection}
              onChange={(e) => onUpdate({ motionDirection: e.target.value })}
            >
              {MOTION_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {tSel(`motion.${o}`)}
                </option>
              ))}
            </select>
          </SceneField>
        </div>

        {/* Photo assignment — only available after scene is saved (has ID) */}
        {scene.id && !isComplement && candidatePhotos.length > 0 && (
          <SceneField label={t("fields.primaryPhoto")} htmlFor={`${id}-photo`}>
            <div className={styles.photoAssignRow}>
              {candidatePhotos.map((p) => {
                const isAssigned = scene.photoAssets.some(
                  (pa) => pa.role === "primary" && pa.photoAssetId === p.id,
                );
                return (
                  <button
                    key={p.id}
                    className={`${styles.photoAssignBtn}${isAssigned ? ` ${styles.photoAssignBtnActive}` : ""}`}
                    onClick={() => handleAssignPhoto(p.id, "primary")}
                    disabled={assigningPhoto !== null}
                    title={isAssigned ? `${p.name} (assigned)` : p.name}
                    style={{ opacity: isAssigned ? 1 : 0.45 }}
                  >
                    <img
                      src={storageKeyToUrl(p.storageKey)}
                      alt={p.name}
                      className={styles.photoAssignThumb}
                    />
                  </button>
                );
              })}
            </div>
            <p className={styles.photoAssignHint}>
              {scene.photoAssets.some((pa) => pa.role === "primary")
                ? t("scenes.primaryClickReassign")
                : t("scenes.primaryClickAssign")}
            </p>
          </SceneField>
        )}

        {scene.id && (
          <ComposedPromptPreview
            sceneId={scene.id}
            overrides={{
              imagePrompt: scene.imagePrompt,
              emotion: scene.emotion,
              cameraDirection: scene.cameraDirection,
              lightingDirection: scene.lightingDirection,
              motionDirection: scene.motionDirection,
              sceneNegativePrompt: scene.negativePrompt ?? "",
              projectNegativePrompt: projectNegativePromptDraft,
              commonPrompt: projectCommonPromptDraft,
            }}
          />
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
