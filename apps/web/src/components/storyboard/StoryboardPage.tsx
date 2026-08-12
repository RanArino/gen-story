"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
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
  AiJobCanceledError,
  analyzeProjectPhotos,
  assignPhotosToScene,
  awaitAiJob,
  cancelAiJob,
  createCustomStyle,
  createTemplateScenesFromPhotos,
  deleteScene as deleteSceneRequest,
  deleteScenes as deleteScenesRequest,
  fillSceneWithAi,
  fillStoryboardScenesWithAi,
  generateStorySetup,
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
  type DeleteScenesScope,
  type UpsertSceneInput,
} from "../../lib/api-client";
import { StorySetupAiModal } from "./StorySetupAiModal";
import { TestGenerationModal } from "./TestGenerationModal";
import { storageKeyToUrl } from "../../lib/image-url";
import { AppShell } from "../AppShell";
import { ComposedPromptPreview } from "../common/ComposedPromptPreview";
import { ErrorAlert } from "../ErrorAlert";
import styles from "./StoryboardPage.module.css";
import {
  SETUP_STEP_ORDER,
  StoryboardStepper,
  stepIndex,
  type SetupStep,
} from "./StoryboardStepper";

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
  photoFidelity: "off",
} as const;

const PHOTO_FIDELITY_OPTIONS = ["off", "low", "high"] as const;

// AI scene fill is asked to keep emotion/camera/lighting/motion short,
// English, label-style values, but nothing constrains it to this exact list —
// a value like "Peace" or "Straight-on" is a legitimate AI choice that just
// isn't one of the fixed options below. Without this, the <select> silently
// shows the wrong option selected (the browser falls back to the first one)
// for a scene whose real value is perfectly valid, and saving without editing
// that field would then overwrite it with the wrong value.
function withCurrentOption(options: string[], current: string): string[] {
  if (!current || options.includes(current)) return options;
  return [current, ...options];
}

type SceneState = UpsertSceneInput & {
  id?: string;
  kind: string;
  bridge: { fromSceneId: string; toSceneId: string } | null;
  photoAssets: ScenePhotoAssetDto[];
};

type SceneViewMode = "split" | "gallery";

const VIEW_MODE_STORAGE_KEY = "gen-story:storyboard-view";

function isSceneViewMode(value: string | null): value is SceneViewMode {
  return value === "split" || value === "gallery";
}

function sceneAnchorId(scene: SceneState, idx: number): string {
  return `scene-${scene.id ?? `draft-${idx}`}`;
}

function primaryPhotoForScene(
  scene: SceneState,
  photos: PhotoAssetDto[],
): PhotoAssetDto | null {
  const primaryId = scene.photoAssets.find(
    (pa) => pa.role === "primary",
  )?.photoAssetId;
  return primaryId
    ? (photos.find((photo) => photo.id === primaryId) ?? null)
    : null;
}

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
    photoFidelity: scene.photoFidelity,
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
  const [deletingSceneId, setDeletingSceneId] = useState<string | null>(null);
  const [showDeleteScenesModal, setShowDeleteScenesModal] = useState(false);
  const [deleteScenesScope, setDeleteScenesScope] =
    useState<DeleteScenesScope>("all");
  const [deleteScenesAcknowledged, setDeleteScenesAcknowledged] =
    useState(false);
  const [deletingScenes, setDeletingScenes] = useState(false);
  // The background AI job currently being watched, so it can be cancelled.
  const [activeAiJob, setActiveAiJob] = useState<{
    id: string;
    status: string;
  } | null>(null);
  const [testBatch, setTestBatch] = useState<TestGenerationBatchDto | null>(
    null,
  );
  const [showTestModal, setShowTestModal] = useState(false);
  const [commonPromptDraft, setCommonPromptDraft] = useState("");
  const [savingCommonPrompt, setSavingCommonPrompt] = useState(false);
  const [storyDraft, setStoryDraft] = useState("");
  const [savingStory, setSavingStory] = useState(false);
  const [negativePromptDraft, setNegativePromptDraft] = useState("");
  const [savingNegativePrompt, setSavingNegativePrompt] = useState(false);
  const [savingCharacterPolicy, setSavingCharacterPolicy] = useState(false);
  const [showCustomStyleModal, setShowCustomStyleModal] = useState(false);
  const [customStyleForm, setCustomStyleForm] = useState({
    name: "",
    description: "",
    prompt: "",
  });
  const [savingCustomStyle, setSavingCustomStyle] = useState(false);
  const [complementBusy, setComplementBusy] = useState(false);
  const [generatingStorySetup, setGeneratingStorySetup] = useState(false);
  const [showStorySetupModal, setShowStorySetupModal] = useState(false);
  const [bulkFilling, setBulkFilling] = useState(false);
  const [photoViewSize, setPhotoViewSize] = useState<
    "small" | "medium" | "large"
  >("small");
  const [sceneDragIndex, setSceneDragIndex] = useState<number | null>(null);
  const [filmstripDropIndex, setFilmstripDropIndex] = useState<number | null>(
    null,
  );
  const [showAddScenesModal, setShowAddScenesModal] = useState(false);
  const [photoPickerFilter, setPhotoPickerFilter] = useState<"unused" | "all">(
    "unused",
  );
  // Opt-in: bills one model call per selected photo.
  const [autoFillNewScenes, setAutoFillNewScenes] = useState(false);
  const [autoFillProgress, setAutoFillProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const [sceneViewMode, setSceneViewMode] = useState<SceneViewMode>("split");
  const [activeSceneAnchor, setActiveSceneAnchor] = useState<string | null>(
    null,
  );
  const [galleryEditingIndex, setGalleryEditingIndex] = useState<number | null>(
    null,
  );
  const boardRef = useRef<HTMLDivElement | null>(null);
  const projectSettingsInitializedRef = useRef(false);
  const [accordionOpen, setAccordionOpen] = useState({
    projectSettings: true,
    tone: true,
    style: true,
    commonPrompt: true,
    story: true,
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
  const candidatePhotos = useMemo(
    () => photos.filter((photo) => photo.usage === "candidate"),
    [photos],
  );
  const usedPrimaryPhotoIds = useMemo(
    () =>
      new Set(
        scenes
          .flatMap((scene) => scene.photoAssets)
          .filter((asset) => asset.role === "primary")
          .map((asset) => asset.photoAssetId),
      ),
    [scenes],
  );
  const unusedCandidatePhotos = useMemo(
    () => candidatePhotos.filter((photo) => !usedPrimaryPhotoIds.has(photo.id)),
    [candidatePhotos, usedPrimaryPhotoIds],
  );
  // The picker defaults to photos no scene uses yet, but a photo may
  // deliberately be reused — a second scene from the same shot is how you get a
  // different palette or moment out of it — so "all" stays one click away.
  const pickerPhotos = useMemo(
    () =>
      photoPickerFilter === "unused" ? unusedCandidatePhotos : candidatePhotos,
    [photoPickerFilter, unusedCandidatePhotos, candidatePhotos],
  );

  const analyzablePhotos = photos.filter(
    (photo) => photo.usage === "candidate" || photo.usage === "reference",
  );
  const analyzablePhotoCount = analyzablePhotos.length;
  // Advisory "did the inputs change since the last analysis" signal used to gate
  // the re-analyze button. The server makes the authoritative call (input-hash
  // compare) and skips the AI request when nothing changed.
  const analysisStale =
    photoAnalysis == null ||
    (() => {
      const analyzedIds = new Set(
        photoAnalysis.photoInsights.map((insight) => insight.photoAssetId),
      );
      if (analyzedIds.size !== analyzablePhotos.length) return true;
      if (analyzablePhotos.some((photo) => !analyzedIds.has(photo.id)))
        return true;
      const analyzedAt = new Date(photoAnalysis.updatedAt).getTime();
      return analyzablePhotos.some(
        (photo) => new Date(photo.updatedAt).getTime() > analyzedAt,
      );
    })();

  useEffect(() => {
    setCommonPromptDraft(storyboard?.commonPrompt ?? "");
  }, [storyboard?.commonPrompt]);

  useEffect(() => {
    setStoryDraft(storyboard?.story ?? "");
  }, [storyboard?.story]);

  useEffect(() => {
    setNegativePromptDraft(storyboard?.negativePrompt ?? "");
  }, [storyboard?.negativePrompt]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedMode = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
    setSceneViewMode(isSceneViewMode(storedMode) ? storedMode : "split");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, sceneViewMode);
  }, [sceneViewMode]);

  useEffect(() => {
    if (!storyboard || projectSettingsInitializedRef.current) return;
    projectSettingsInitializedRef.current = true;
    const configured =
      storyboard.tone.trim() !== "" &&
      (storyboard.stylePresetId != null ||
        storyboard.commonPrompt.trim() !== "" ||
        storyboard.story.trim() !== "" ||
        storyboard.negativePrompt.trim() !== "");
    setAccordionOpen((prev) => ({ ...prev, projectSettings: !configured }));
  }, [storyboard]);

  useEffect(() => {
    if (sceneViewMode !== "split") return;
    const board = boardRef.current;
    if (!board) return;
    const scrollRoot = board.closest("main");
    if (!scrollRoot) return;
    const sceneNodes = scenes
      .map((scene, idx) => document.getElementById(sceneAnchorId(scene, idx)))
      .filter((node): node is HTMLElement => node != null);
    if (sceneNodes.length === 0) return;

    // The active scene is the topmost one whose top edge has reached the
    // activation line just below the scroll root's top — not the scene with the
    // largest visible area, which would highlight the next (often taller) scene
    // right after a click-jump.
    let raf = 0;
    const computeActive = () => {
      raf = 0;
      const activationLine = scrollRoot.getBoundingClientRect().top + 120;
      let activeId = sceneNodes[0]!.id;
      for (const node of sceneNodes) {
        if (node.getBoundingClientRect().top <= activationLine) {
          activeId = node.id;
        } else {
          break;
        }
      }
      setActiveSceneAnchor(activeId);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(computeActive);
    };
    computeActive();
    scrollRoot.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      scrollRoot.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [scenes, sceneViewMode]);

  useEffect(() => {
    setSelectedPhotoIds((prev) => {
      // Keep the selection to what the picker currently shows: switching back
      // to "unused only" must not leave an invisible already-used photo queued
      // for creation.
      const allowed = new Set(pickerPhotos.map((photo) => photo.id));
      const next = new Set([...prev].filter((id) => allowed.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [pickerPhotos]);

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
      // No tone is seeded on purpose: the storyboard starts undecided so setup
      // step 2 can tell "not chosen yet" from a real choice.
      const sb = await upsertStoryboard(id, { projectId, status: "draft" });
      setStoryboard(sb);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("scenes.failedInit"));
    }
  }

  // The setup step is derived server-side from photos, storyboard fields and
  // scenes, so anything that changes those has to re-read the storyboard for
  // the stepper to move.
  const refreshStoryboard = useCallback(async () => {
    const sbs = await listStoryboards(projectId);
    const refreshed = sbs[0];
    if (refreshed) setStoryboard(refreshed);
  }, [projectId]);

  async function handleToneChange(tone: string) {
    if (!sbId) return;
    const prev = storyboard!;
    setStoryboard({ ...prev, tone });
    try {
      const updated = await upsertStoryboard(sbId, { projectId, tone });
      setStoryboard(updated);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("scenes.failedTone"));
    }
  }

  // Shared watch callbacks: expose the running job so it can be cancelled and
  // so its status can be shown.
  const aiJobWatch = {
    onJobId: (id: string) => setActiveAiJob({ id, status: "queued" }),
    onStatus: (status: string) =>
      setActiveAiJob((prev) => (prev == null ? prev : { ...prev, status })),
  };

  async function handleCancelAiJob() {
    if (activeAiJob == null) return;
    try {
      await cancelAiJob(activeAiJob.id);
    } catch {
      // The watcher reports the real outcome; a lost cancel is not fatal.
    }
  }

  async function handleAnalyzePhotos() {
    // Re-analysis sends every analyzable photo to the AI again, which costs
    // tokens. Confirm before spending on a result the user already has.
    if (
      photoAnalysis &&
      !window.confirm(t("ai.confirmReanalyze", { count: analyzablePhotoCount }))
    ) {
      return;
    }
    setAnalyzingPhotos(true);
    setError(null);
    try {
      const { photoAnalysis: analysis, cached } = await analyzeProjectPhotos(
        projectId,
        aiJobWatch,
      );
      setPhotoAnalysis(analysis);
      // Analysis can move the flow off step 1, so the stepper needs the fresh
      // derived step.
      await refreshStoryboard();
      setSaveMsg(cached ? t("ai.cachedMsg") : t("ai.completeMsg"));
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e: unknown) {
      if (!(e instanceof AiJobCanceledError)) {
        setError(e instanceof Error ? e.message : t("scenes.failedAnalyze"));
      }
    } finally {
      setAnalyzingPhotos(false);
      setActiveAiJob(null);
    }
  }

  async function handleStyleChange(stylePresetId: string | null) {
    if (!sbId) return;
    const prev = storyboard!;
    setStoryboard({ ...prev, stylePresetId });
    try {
      const updated = await upsertStoryboard(sbId, {
        projectId,
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
    setSavingCommonPrompt(true);
    setError(null);
    try {
      const updated = await upsertStoryboard(sbId, {
        projectId,
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

  async function saveStory(story: string) {
    if (!sbId) return;
    setSavingStory(true);
    setError(null);
    try {
      const updated = await upsertStoryboard(sbId, {
        projectId,
        story,
      });
      setStoryboard(updated);
      if (story === "") {
        setAccordionOpen((prev) => ({ ...prev, story: true }));
      }
      setSaveMsg(t("story.savedMsg"));
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("story.failed"));
    } finally {
      setSavingStory(false);
    }
  }

  async function saveNegativePrompt(negativePrompt: string) {
    if (!sbId) return;
    setSavingNegativePrompt(true);
    setError(null);
    try {
      const updated = await upsertStoryboard(sbId, {
        projectId,
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

  async function saveCharacterPolicy(
    characterPolicy: "featured" | "background_only" | "none",
  ) {
    if (!sbId) return;
    setSavingCharacterPolicy(true);
    setError(null);
    try {
      const updated = await upsertStoryboard(sbId, {
        projectId,
        characterPolicy,
      });
      setStoryboard(updated);
      setSaveMsg(t("characterPolicy.savedMsg"));
      setTimeout(() => setSaveMsg(null), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("characterPolicy.failed"));
    } finally {
      setSavingCharacterPolicy(false);
    }
  }

  // Setup step 4. One AI call producing the story, common prompt and negative
  // prompt together, so all three stay consistent with the chosen tone and
  // style instead of being written independently.
  async function handleGenerateStorySetup(storyPurpose: string) {
    if (!sbId) return;
    setShowStorySetupModal(false);
    setGeneratingStorySetup(true);
    setError(null);
    try {
      const updated = await generateStorySetup(sbId, {
        projectId,
        storyPurpose: storyPurpose.trim() || undefined,
        ...aiJobWatch,
      });
      setStoryboard(updated);
      setSaveMsg(t("setup.storyGeneratedMsg"));
      setTimeout(() => setSaveMsg(null), 4000);
    } catch (e: unknown) {
      if (!(e instanceof AiJobCanceledError)) {
        setError(e instanceof Error ? e.message : t("setup.storyFailed"));
      }
    } finally {
      setGeneratingStorySetup(false);
      setActiveAiJob(null);
    }
  }

  // Setup step 5. Bills one AI call per scene that still has a blank field;
  // scenes already written are skipped by the server, so pressing it again
  // after a partial failure only pays for what is still missing.
  async function handleFillAllScenes() {
    if (!sbId) return;
    setBulkFilling(true);
    setError(null);
    try {
      const { aiJobIds } = await fillStoryboardScenesWithAi(sbId);
      if (aiJobIds.length === 0) {
        setSaveMsg(t("setup.scenesNothingToFill"));
        setTimeout(() => setSaveMsg(null), 3000);
        return;
      }
      await watchAutoFillJobs(sbId, aiJobIds);
      await refreshStoryboard();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("setup.scenesFailed"));
    } finally {
      setBulkFilling(false);
    }
  }

  // Wait on every auto-fill job in parallel, refreshing the scene list as each
  // finishes. Failures are surfaced once, at the end, rather than as one banner
  // per photo.
  async function watchAutoFillJobs(storyboardId: string, jobIds: string[]) {
    setAutoFillProgress({ done: 0, total: jobIds.length });
    let done = 0;
    let failed = 0;

    await Promise.all(
      jobIds.map(async (jobId) => {
        try {
          const job = await awaitAiJob(jobId, { projectId });
          if (job.status !== "succeeded") failed += 1;
        } catch {
          failed += 1;
        } finally {
          done += 1;
          setAutoFillProgress({ done, total: jobIds.length });
          try {
            const refreshed = await listScenes(storyboardId);
            setScenes(refreshed.map(sceneDtoToState));
          } catch {
            // A failed refresh is recoverable by reloading; not worth a banner.
          }
        }
      }),
    );

    setAutoFillProgress(null);
    if (failed > 0) {
      setError(t("createScenes.autoFillFailed", { count: failed }));
    }
  }

  async function handleCreateTemplateScenes() {
    if (!sbId || selectedPhotoIds.size === 0) return;

    // Adding a second scene for a photo is allowed, but never silently. The
    // picker's "unused" filter is computed from the scenes held in this page's
    // state, so it is checked here against the server's list too — a stale
    // local list must not duplicate a whole batch without a word.
    let duplicateCount = 0;
    try {
      const serverScenes = await listScenes(sbId);
      const usedIds = new Set([
        ...usedPrimaryPhotoIds,
        ...serverScenes
          .flatMap((scene) => scene.photoAssets)
          .filter((asset) => asset.role === "primary")
          .map((asset) => asset.photoAssetId),
      ]);
      duplicateCount = [...selectedPhotoIds].filter((photoId) =>
        usedIds.has(photoId),
      ).length;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("createScenes.failed"));
      return;
    }
    if (
      duplicateCount > 0 &&
      !window.confirm(
        t("createScenes.confirmDuplicates", { count: duplicateCount }),
      )
    ) {
      return;
    }

    setCreatingTemplates(true);
    try {
      const { scenes: newScenes, aiJobIds } =
        await createTemplateScenesFromPhotos(
          sbId,
          Array.from(selectedPhotoIds),
          autoFillNewScenes,
        );
      setScenes((prev) => [...prev, ...newScenes.map(sceneDtoToState)]);
      setSelectedPhotoIds(new Set());
      setShowAddScenesModal(false);
      await refreshStoryboard();
      setSaveMsg(
        t(
          newScenes.length === 1
            ? "createScenes.createdMsg"
            : "createScenes.createdMsgPlural",
          { count: newScenes.length },
        ),
      );

      // The fill jobs run in the background; refresh the scene list as each
      // one lands so the storyboard fills in progressively.
      if (aiJobIds.length > 0) {
        void watchAutoFillJobs(sbId, aiJobIds);
      }
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

  // Dropping the scene from local state alone is not a delete: the row stays in
  // the database, comes back on the next load, and — because the photo now
  // looks unused — lets the add-scenes picker offer the same photo again.
  // Returns whether the scene is now gone, so callers such as the gallery
  // editor only close when the delete actually went through.
  async function deleteScene(idx: number): Promise<boolean> {
    const target = scenes[idx];
    if (!target) return false;

    function removeLocally() {
      setScenes((prev) =>
        prev
          .filter((_, i) => i !== idx)
          .map((s, i) => ({ ...s, orderIndex: i })),
      );
    }

    // An unsaved draft exists only in this page's state, so there is nothing to
    // delete on the server and nothing to lose by dropping it silently.
    if (!target.id) {
      removeLocally();
      return true;
    }

    if (!window.confirm(t("scenes.confirmDelete"))) return false;

    setDeletingSceneId(target.id);
    setError(null);
    try {
      await deleteSceneRequest(target.id);
      removeLocally();
      await refreshStoryboard();
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("scenes.failedDelete"));
      return false;
    } finally {
      setDeletingSceneId(null);
    }
  }

  function openDeleteScenesModal() {
    setDeleteScenesScope("all");
    setDeleteScenesAcknowledged(false);
    setShowDeleteScenesModal(true);
  }

  async function handleDeleteScenes() {
    if (!sbId || !deleteScenesAcknowledged) return;
    setDeletingScenes(true);
    setError(null);
    try {
      const { deletedCount } = await deleteScenesRequest(
        sbId,
        deleteScenesScope,
      );
      // "unfilled" leaves scenes behind, so the list is re-read rather than
      // cleared — the server decides which ones survived.
      const remaining = await listScenes(sbId);
      setScenes(remaining.map(sceneDtoToState));
      setGalleryEditingIndex(null);
      setShowDeleteScenesModal(false);
      await refreshStoryboard();
      setSaveMsg(t("scenes.deletedScenesMsg", { count: deletedCount }));
      setTimeout(() => setSaveMsg(null), 4000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("scenes.failedDeleteScenes"));
    } finally {
      setDeletingScenes(false);
    }
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
          // Save blanks as blanks. Substituting placeholder text here used to
          // make every scene look already-filled, which silently disabled AI
          // fill for the rest of the scene's life.
          title: s.title,
          description: s.description,
          imagePrompt: s.imagePrompt,
          emotion: s.emotion,
          cameraDirection: s.cameraDirection,
          lightingDirection: s.lightingDirection,
          motionDirection: s.motionDirection,
          notes: s.notes,
          negativePrompt: s.negativePrompt,
          photoFidelity: s.photoFidelity,
        })),
      );
      setScenes(saved.map(sceneDtoToState));
      // Writing the last blank field by hand can finish step 5.
      await refreshStoryboard();
      setSaveMsg(t("saved"));
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("scenes.failedSave"));
    } finally {
      setSaving(false);
    }
  }

  async function handleAiFill(sceneId: string) {
    if (!sbId) return;
    setAiFillingSceneId(sceneId);
    setError(null);
    try {
      const filled = await fillSceneWithAi(sceneId, {
        projectId,
        storyboardId: sbId,
        ...aiJobWatch,
      });
      setScenes((prev) =>
        prev.map((scene) =>
          scene.id === sceneId ? sceneDtoToState(filled) : scene,
        ),
      );
      await refreshStoryboard();
      setSaveMsg(t("aiFillSaved"));
      setTimeout(() => setSaveMsg(null), 2000);
    } catch (e: unknown) {
      if (!(e instanceof AiJobCanceledError)) {
        setError(e instanceof Error ? e.message : t("scenes.failedFill"));
      }
    } finally {
      setAiFillingSceneId(null);
      setActiveAiJob(null);
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
        { projectId, ...aiJobWatch },
      );
      setProposalCtx({ fromSceneId, toSceneId, proposals });
    } catch (e: unknown) {
      if (!(e instanceof AiJobCanceledError)) {
        setError(
          e instanceof Error ? e.message : t("complement.failedPropose"),
        );
      }
    } finally {
      setComplementBusy(false);
      setActiveAiJob(null);
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
  const allPickerSelected =
    pickerPhotos.length > 0 &&
    pickerPhotos.every((photo) => selectedPhotoIds.has(photo.id));
  const somePickerSelected = selectedPhotoIds.size > 0;
  const selectedGalleryScene =
    galleryEditingIndex == null ? null : (scenes[galleryEditingIndex] ?? null);

  // Gating applies only until the storyboard has been through all five steps.
  // Storyboards that predate this flow were backfilled as complete, so they
  // keep the full page exactly as before.
  const setupGated = storyboard.setupCompletedAt == null;
  const currentStepIndex = stepIndex(storyboard.setupStep);
  // A section is shown when it is the current step or one already finished.
  // Locked steps are not rendered at all; the stepper is what explains what
  // each of them is waiting for.
  const showStep = (step: SetupStep) =>
    !setupGated || SETUP_STEP_ORDER.indexOf(step) <= currentStepIndex;
  const pendingSceneFillCount = storyboard.pendingSceneFillCount;
  // How many scenes each bulk-delete scope would remove. "unfilled" reuses the
  // storyboard's blank-field count — the same number the "fill all" button
  // bills for — so the modal previews exactly what the server will delete.
  const deleteScopeCount = (scope: DeleteScenesScope = deleteScenesScope) =>
    scope === "all" ? scenes.length : pendingSceneFillCount;

  return (
    <AppShell projectId={projectId}>
      <div className="screen-header">
        <h2>{t("title")}</h2>
        <p>{t("subtitle")}</p>
      </div>

      {error && <ErrorAlert message={error} />}

      {setupGated && <StoryboardStepper currentStep={storyboard.setupStep} />}

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
            <div className={styles.aiAssistActions}>
              <button
                className="btn btn-primary"
                onClick={handleAnalyzePhotos}
                disabled={
                  analyzingPhotos || (!!photoAnalysis && !analysisStale)
                }
              >
                {analyzingPhotos
                  ? t("ai.analyzing")
                  : !photoAnalysis
                    ? t("ai.analyze")
                    : analysisStale
                      ? t("ai.reanalyze")
                      : t("ai.upToDate")}
              </button>
              {activeAiJob && (
                <>
                  <small className={styles.aiAssistHint}>
                    {t(`ai.jobStatus.${activeAiJob.status}`)}
                  </small>
                  <button
                    className="btn btn-secondary"
                    onClick={handleCancelAiJob}
                  >
                    {t("ai.cancelJob")}
                  </button>
                </>
              )}
              {photoAnalysis &&
                !analysisStale &&
                !analyzingPhotos &&
                !activeAiJob && (
                  <small className={styles.aiAssistHint}>
                    {t("ai.upToDateHint")}
                  </small>
                )}
            </div>
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
              <p className={styles.analysisMeta}>
                <span
                  className={`${styles.analysisModelBadge} ${photoAnalysis.model === "local-deterministic" ? styles.analysisModelBadgeLocal : ""}`}
                >
                  {photoAnalysis.model === "local-deterministic"
                    ? t("ai.localModelBadge")
                    : photoAnalysis.model}
                </span>
                <span>
                  {t("ai.analyzedAt", {
                    when: new Date(photoAnalysis.updatedAt).toLocaleString(),
                  })}
                </span>
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

      <CollapsibleSection
        title={t("sections.projectSettings")}
        // While gating, the current step must be on screen, so the accordion
        // is not collapsible.
        open={setupGated || accordionOpen.projectSettings}
        onToggle={() =>
          setAccordionOpen((prev) => ({
            ...prev,
            projectSettings: !prev.projectSettings,
          }))
        }
        summary={
          <span>
            {selectedToneLabel}
            {selectedStyle ? ` / ${selectedStyle.name}` : ""}
          </span>
        }
      >
        <div className={styles.projectSettingsGrid}>
          {showStep("tone") && (
            <section className={styles.projectSettingBlock}>
              <div className={styles.sectionHeader}>
                <h4 className={styles.settingTitle}>{t("sections.tone")}</h4>
                <span className={styles.settingSummary}>
                  {selectedToneLabel}
                </span>
              </div>
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
            </section>
          )}

          {showStep("style") && (
            <section className={styles.projectSettingBlock}>
              <div className={styles.sectionHeader}>
                <h4 className={styles.settingTitle}>{t("sections.style")}</h4>
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowCustomStyleModal(true)}
                >
                  {t("style.createCustom")}
                </button>
              </div>
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
            </section>
          )}

          {showStep("story") && (
            <section className={styles.projectSettingBlock}>
              <div className={styles.sectionHeader}>
                <h4 className={styles.settingTitle}>{t("setup.storyTitle")}</h4>
                <div className={styles.inlineActions}>
                  <button
                    className="btn btn-primary"
                    onClick={() => setShowStorySetupModal(true)}
                    disabled={generatingStorySetup}
                  >
                    {generatingStorySetup
                      ? t("setup.storyGenerating")
                      : t("setup.storyGenerate")}
                  </button>
                  {generatingStorySetup && activeAiJob && (
                    <button
                      className="btn btn-secondary"
                      onClick={handleCancelAiJob}
                    >
                      {t("ai.cancelJob")}
                    </button>
                  )}
                </div>
              </div>
              <p className={styles.photoAssignHint}>{t("setup.storyIntro")}</p>
            </section>
          )}

          {showStep("story") && (
            <section className={styles.projectSettingBlock}>
              <div className={styles.sectionHeader}>
                <h4 className={styles.settingTitle}>
                  {t("sections.commonPrompt")}
                </h4>
                <button
                  className="btn btn-secondary"
                  onClick={() => saveCommonPrompt("")}
                  disabled={savingCommonPrompt}
                >
                  {t("commonPrompt.regenerate")}
                </button>
              </div>
              <p className={styles.photoAssignHint}>
                {t("commonPrompt.intro")}
              </p>
              <textarea
                className={styles.fieldInput}
                rows={6}
                value={commonPromptDraft}
                onChange={(e) => setCommonPromptDraft(e.target.value)}
                placeholder={t("commonPrompt.placeholder")}
              />
              <div className={styles.inlineActions}>
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
            </section>
          )}

          {showStep("story") && (
            <section className={styles.projectSettingBlock}>
              <div className={styles.sectionHeader}>
                <h4 className={styles.settingTitle}>{t("sections.story")}</h4>
                <button
                  className="btn btn-secondary"
                  onClick={() => saveStory("")}
                  disabled={savingStory}
                >
                  {t("story.regenerate")}
                </button>
              </div>
              <p className={styles.photoAssignHint}>{t("story.intro")}</p>
              <textarea
                className={styles.fieldInput}
                rows={5}
                value={storyDraft}
                onChange={(e) => setStoryDraft(e.target.value)}
                placeholder={
                  photoAnalysis?.storySummary || t("story.placeholder")
                }
              />
              <div className={styles.inlineActions}>
                <button
                  className="btn btn-primary"
                  onClick={() => saveStory(storyDraft)}
                  disabled={
                    savingStory || storyDraft === (storyboard.story ?? "")
                  }
                >
                  {savingStory ? t("story.saving") : t("story.save")}
                </button>
              </div>
            </section>
          )}

          {showStep("story") && (
            <section className={styles.projectSettingBlock}>
              <div className={styles.sectionHeader}>
                <h4 className={styles.settingTitle}>
                  {t("sections.negativePrompt")}
                </h4>
              </div>
              <p className={styles.photoAssignHint}>
                {t("negativePrompt.intro")}
              </p>
              <textarea
                className={styles.fieldInput}
                rows={4}
                value={negativePromptDraft}
                onChange={(e) => setNegativePromptDraft(e.target.value)}
                placeholder={t("negativePrompt.placeholder")}
              />
              <div className={styles.inlineActions}>
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
            </section>
          )}

          {showStep("story") && (
            <section className={styles.projectSettingBlock}>
              <div className={styles.sectionHeader}>
                <h4 className={styles.settingTitle}>
                  {t("sections.characterPolicy")}
                </h4>
              </div>
              <p className={styles.photoAssignHint}>
                {t("characterPolicy.intro")}
              </p>
              <div className={styles.inlineActions} role="radiogroup">
                {(["featured", "background_only", "none"] as const).map(
                  (policy) => (
                    <label key={policy} className={styles.radioOption}>
                      <input
                        type="radio"
                        name="characterPolicy"
                        value={policy}
                        checked={storyboard.characterPolicy === policy}
                        disabled={savingCharacterPolicy}
                        onChange={() => saveCharacterPolicy(policy)}
                      />
                      {t(`characterPolicy.options.${policy}`)}
                    </label>
                  ),
                )}
              </div>
            </section>
          )}
        </div>
      </CollapsibleSection>

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

      {showStep("scenes") && (
        <section className={styles.section} data-scenes-section>
          <div className={styles.sceneBoardHeader}>
            <h3 className={styles.sectionTitle}>
              {t("sections.scenes", { count: scenes.length })}
            </h3>
            <div className={styles.sceneBoardActions}>
              {autoFillProgress && (
                <span className={styles.saveMsg}>
                  {t("createScenes.autoFillProgress", autoFillProgress)}
                </span>
              )}
              {saveMsg && <span className={styles.saveMsg}>{saveMsg}</span>}
              <div className={styles.viewSwitcher} aria-label={t("view.label")}>
                {(["split", "gallery"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className={
                      sceneViewMode === mode
                        ? styles.viewBtnActive
                        : styles.viewBtn
                    }
                    onClick={() => setSceneViewMode(mode)}
                  >
                    {t(`view.${mode}`)}
                  </button>
                ))}
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => setShowAddScenesModal(true)}
                disabled={candidatePhotos.length === 0 || creatingTemplates}
              >
                {t("addScenes.open")}
              </button>
              {/* Setup step 5. States the number of AI calls it will spend, and
                disappears once every scene is written. */}
              {pendingSceneFillCount > 0 && (
                <button
                  className="btn btn-primary"
                  onClick={handleFillAllScenes}
                  disabled={bulkFilling || saving || aiFillingSceneId !== null}
                >
                  {bulkFilling
                    ? t("setup.scenesFilling")
                    : t("setup.scenesFillAll", {
                        count: pendingSceneFillCount,
                      })}
                </button>
              )}
              <button className="btn btn-secondary" onClick={addScene}>
                {t("scenes.addScene")}
              </button>
              <button
                className="btn btn-danger"
                onClick={openDeleteScenesModal}
                disabled={
                  scenes.length === 0 ||
                  saving ||
                  creatingTemplates ||
                  bulkFilling ||
                  aiFillingSceneId !== null ||
                  deletingSceneId !== null
                }
              >
                {t("scenes.deleteMany")}
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

          <div
            className={`${styles.storyboardLayout} ${
              sceneViewMode === "split" && scenes.length >= 2
                ? styles.storyboardLayoutWithRail
                : ""
            }`}
          >
            <div
              ref={boardRef}
              className={
                sceneViewMode === "gallery"
                  ? styles.galleryGrid
                  : styles.sceneList
              }
            >
              {scenes.map((scene, idx) => {
                const nextScene = scenes[idx + 1];
                const anchorId = sceneAnchorId(scene, idx);
                if (sceneViewMode === "gallery") {
                  const primaryPhoto = primaryPhotoForScene(scene, photos);
                  return (
                    <button
                      key={scene.id ?? idx}
                      id={anchorId}
                      type="button"
                      className={styles.galleryTile}
                      onClick={() => setGalleryEditingIndex(idx)}
                    >
                      {primaryPhoto ? (
                        <img
                          src={storageKeyToUrl(primaryPhoto.storageKey)}
                          alt={primaryPhoto.name}
                        />
                      ) : (
                        <span className={styles.photoPlaceholder}>
                          {t("changePhoto.noPhoto")}
                        </span>
                      )}
                      <span className={styles.galleryTileMeta}>
                        <strong>
                          {t("scenes.sceneLabel", { index: idx + 1 })}
                        </strong>
                        <span>{scene.title || t("nav.untitled")}</span>
                      </span>
                    </button>
                  );
                }
                return (
                  <div
                    key={scene.id ?? idx}
                    id={anchorId}
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
                      onDelete={() => void deleteScene(idx)}
                      onAiFill={handleAiFill}
                      isAiFilling={aiFillingSceneId === scene.id}
                      isBusy={
                        saving ||
                        aiFillingSceneId !== null ||
                        deletingSceneId !== null
                      }
                      projectCommonPromptDraft={commonPromptDraft}
                      projectStoryDraft={storyDraft}
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
            {sceneViewMode === "split" && scenes.length >= 2 && (
              <nav className={styles.filmstripRail} aria-label={t("nav.label")}>
                {scenes.map((scene, idx) => {
                  const anchorId = sceneAnchorId(scene, idx);
                  const primaryPhoto = primaryPhotoForScene(scene, photos);
                  return (
                    <button
                      key={scene.id ?? idx}
                      type="button"
                      className={`${styles.filmstripItem} ${
                        activeSceneAnchor === anchorId
                          ? styles.filmstripItemActive
                          : ""
                      } ${
                        filmstripDropIndex === idx && sceneDragIndex !== idx
                          ? styles.filmstripItemDropTarget
                          : ""
                      }`}
                      style={{
                        ...(primaryPhoto
                          ? {
                              backgroundImage: `url(${storageKeyToUrl(primaryPhoto.storageKey)})`,
                            }
                          : {}),
                        opacity: sceneDragIndex === idx ? 0.4 : 1,
                      }}
                      draggable
                      title={t("scenes.dragTitle")}
                      onDragStart={() => setSceneDragIndex(idx)}
                      onDragEnd={() => {
                        setSceneDragIndex(null);
                        setFilmstripDropIndex(null);
                      }}
                      onDragOver={(e) => {
                        if (sceneDragIndex === null) return;
                        e.preventDefault();
                        setFilmstripDropIndex(idx);
                      }}
                      onDragLeave={() => {
                        setFilmstripDropIndex((prev) =>
                          prev === idx ? null : prev,
                        );
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (sceneDragIndex !== null) {
                          void handleSceneReorder(sceneDragIndex, idx);
                        }
                        setSceneDragIndex(null);
                        setFilmstripDropIndex(null);
                      }}
                      onClick={() =>
                        document.getElementById(anchorId)?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        })
                      }
                    >
                      <span>{idx + 1}</span>
                      <strong>{scene.title || t("nav.untitled")}</strong>
                    </button>
                  );
                })}
              </nav>
            )}
          </div>
        </section>
      )}

      {/* Bulk deletion is unrecoverable, so the modal is a second check on top
          of the button, and its own confirm stays disabled until the user picks
          a scope that would delete something and ticks the acknowledgement. */}
      {showDeleteScenesModal && (
        <div className={styles.modalOverlay} role="presentation">
          <div
            className={styles.modalContent}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-scenes-title"
          >
            <h4 id="delete-scenes-title" className={styles.modalTitle}>
              {t("scenes.deleteManyTitle")}
            </h4>
            <div
              className={styles.radioGroup}
              role="radiogroup"
              aria-labelledby="delete-scenes-title"
            >
              {(["all", "unfilled"] as const).map((scope) => (
                <label key={scope} className={styles.radioOption}>
                  <input
                    type="radio"
                    name="deleteScenesScope"
                    value={scope}
                    checked={deleteScenesScope === scope}
                    disabled={deletingScenes}
                    onChange={() => {
                      setDeleteScenesScope(scope);
                      setDeleteScenesAcknowledged(false);
                    }}
                  />
                  {t(`scenes.deleteScope.${scope}`, {
                    count: deleteScopeCount(scope),
                  })}
                </label>
              ))}
            </div>
            <p className={styles.dangerNote}>
              {t(`scenes.deleteScopeWarning.${deleteScenesScope}`)}
            </p>
            <label className={styles.photoModalSelectAll}>
              <input
                type="checkbox"
                checked={deleteScenesAcknowledged}
                onChange={(e) => setDeleteScenesAcknowledged(e.target.checked)}
                disabled={deletingScenes || deleteScopeCount() === 0}
              />
              {t("scenes.deleteManyAcknowledge", { count: deleteScopeCount() })}
            </label>
            <div className={styles.modalActions}>
              <button
                className="btn btn-danger"
                onClick={handleDeleteScenes}
                disabled={
                  !deleteScenesAcknowledged ||
                  deletingScenes ||
                  deleteScopeCount() === 0
                }
              >
                {deletingScenes
                  ? t("scenes.deletingMany")
                  : t("scenes.deleteManyConfirm", {
                      count: deleteScopeCount(),
                    })}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setShowDeleteScenesModal(false)}
                disabled={deletingScenes}
              >
                {tCommon("cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddScenesModal && (
        <div
          className={styles.modalOverlay}
          role="presentation"
          onClick={() => setShowAddScenesModal(false)}
        >
          <div
            className={styles.modalContent}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-scenes-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.sectionHeader}>
              <h4 id="add-scenes-title" className={styles.modalTitle}>
                {t("addScenes.title")}
              </h4>
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
            <div className={styles.photoModalToolbar}>
              <div
                className={styles.viewSwitcher}
                aria-label={t("addScenes.filterLabel")}
              >
                {(["unused", "all"] as const).map((filter) => (
                  <button
                    key={filter}
                    type="button"
                    className={
                      photoPickerFilter === filter
                        ? styles.viewBtnActive
                        : styles.viewBtn
                    }
                    onClick={() => setPhotoPickerFilter(filter)}
                  >
                    {t(`addScenes.filter.${filter}`, {
                      count:
                        filter === "unused"
                          ? unusedCandidatePhotos.length
                          : candidatePhotos.length,
                    })}
                  </button>
                ))}
              </div>
            </div>
            {pickerPhotos.length === 0 ? (
              <p className={styles.analysisEmpty}>
                {t(
                  photoPickerFilter === "unused"
                    ? "addScenes.empty"
                    : "addScenes.emptyAll",
                )}
              </p>
            ) : (
              <>
                <div className={styles.photoModalToolbar}>
                  <label className={styles.photoModalSelectAll}>
                    <input
                      type="checkbox"
                      checked={allPickerSelected}
                      ref={(el) => {
                        if (el)
                          el.indeterminate =
                            somePickerSelected && !allPickerSelected;
                      }}
                      onChange={() => {
                        setSelectedPhotoIds(
                          allPickerSelected
                            ? new Set()
                            : new Set(pickerPhotos.map((photo) => photo.id)),
                        );
                      }}
                    />
                    {allPickerSelected
                      ? t("createScenes.deselectAll")
                      : t("createScenes.selectAll")}
                  </label>
                  {/* One model call per selected photo, so this is opt-in and
                      states the count it will spend. */}
                  <label className={styles.photoModalSelectAll}>
                    <input
                      type="checkbox"
                      checked={autoFillNewScenes}
                      onChange={(e) => setAutoFillNewScenes(e.target.checked)}
                    />
                    {t("createScenes.autoFill", {
                      count: selectedPhotoIds.size,
                    })}
                  </label>
                  <div className={styles.sizeSwitcher}>
                    {(["small", "medium", "large"] as const).map((size) => (
                      <button
                        key={size}
                        type="button"
                        className={
                          photoViewSize === size
                            ? styles.sizeBtnActive
                            : styles.sizeBtn
                        }
                        onClick={() => setPhotoViewSize(size)}
                        title={t("createScenes.thumbsTitle", {
                          size: size.charAt(0).toUpperCase() + size.slice(1),
                        })}
                      >
                        {size === "small" ? "S" : size === "medium" ? "M" : "L"}
                      </button>
                    ))}
                  </div>
                </div>
                <p className={styles.photoAssignHint}>
                  {t(
                    photoPickerFilter === "unused"
                      ? "addScenes.hint"
                      : "addScenes.hintAll",
                  )}
                </p>
                <div
                  className={`${styles.photoPickerGrid} ${styles[`photoPickerGrid${photoViewSize}`]}`}
                >
                  {pickerPhotos.map((photo) => (
                    <label key={photo.id} className={styles.photoPickerItem}>
                      <input
                        type="checkbox"
                        checked={selectedPhotoIds.has(photo.id)}
                        onChange={(event) => {
                          setSelectedPhotoIds((prev) => {
                            const next = new Set(prev);
                            if (event.target.checked) {
                              next.add(photo.id);
                            } else {
                              next.delete(photo.id);
                            }
                            return next;
                          });
                        }}
                      />
                      <img
                        src={storageKeyToUrl(photo.storageKey)}
                        alt={photo.name}
                      />
                      <span>{photo.name}</span>
                      {usedPrimaryPhotoIds.has(photo.id) && (
                        <span className={styles.photoUsedBadge}>
                          {t("addScenes.alreadyUsed")}
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowAddScenesModal(false)}
              disabled={creatingTemplates}
            >
              {tCommon("cancel")}
            </button>
          </div>
        </div>
      )}

      {selectedGalleryScene && galleryEditingIndex != null && (
        <div
          className={styles.modalOverlay}
          role="presentation"
          onClick={() => setGalleryEditingIndex(null)}
        >
          <div
            className={styles.galleryEditor}
            role="dialog"
            aria-modal="true"
            aria-label={t("view.galleryEditor")}
            onClick={(e) => e.stopPropagation()}
          >
            <SceneCard
              scene={selectedGalleryScene}
              idx={galleryEditingIndex}
              total={scenes.length}
              scenes={scenes}
              photos={photos}
              isDragging={false}
              onDragHandleStart={() => undefined}
              onDragHandleEnd={() => undefined}
              onUpdate={(patch) => updateScene(galleryEditingIndex, patch)}
              onMove={(dir) => moveScene(galleryEditingIndex, dir)}
              onDelete={() => {
                void deleteScene(galleryEditingIndex).then((deleted) => {
                  if (deleted) setGalleryEditingIndex(null);
                });
              }}
              onAiFill={handleAiFill}
              isAiFilling={aiFillingSceneId === selectedGalleryScene.id}
              isBusy={
                saving || aiFillingSceneId !== null || deletingSceneId !== null
              }
              projectCommonPromptDraft={commonPromptDraft}
              projectStoryDraft={storyDraft}
              projectNegativePromptDraft={negativePromptDraft}
            />
            {selectedGalleryScene.id && scenes[galleryEditingIndex + 1]?.id && (
              <ComplementGap
                disabled={complementBusy || saving}
                onInsertBlank={() =>
                  handleInsertBlankComplement(
                    selectedGalleryScene.id!,
                    scenes[galleryEditingIndex + 1]!.id!,
                  )
                }
                onPropose={() =>
                  handleProposeComplement(
                    selectedGalleryScene.id!,
                    scenes[galleryEditingIndex + 1]!.id!,
                  )
                }
              />
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setGalleryEditingIndex(null)}
            >
              {tCommon("cancel")}
            </button>
          </div>
        </div>
      )}

      {proposalCtx && (
        <ComplementProposalModal
          proposals={proposalCtx.proposals}
          busy={complementBusy}
          onApply={handleApplyProposal}
          onClose={() => setProposalCtx(null)}
        />
      )}

      {/* The generate CTA is the exit from this screen, so it stays out of
          reach until the storyboard has been through setup. */}
      {showStep("scenes") && (
        <div className={styles.footer}>
          {testBatch?.status === "completed" ? (
            // Both affordances, not just the exit: a confirmed storyboard must
            // still be able to reach the samples it already generated and pick
            // a different one.
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                gap: 12,
                alignItems: "center",
              }}
            >
              <button
                className="btn btn-secondary"
                onClick={() => setShowTestModal(true)}
              >
                {t("footer.reviewTestGeneration")}
              </button>
              <Link
                href={`/projects/${projectId}/generate`}
                className="btn btn-primary"
              >
                {t("footer.continueToGenerate")}
              </Link>
            </div>
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
      )}

      {showStorySetupModal && (
        <StorySetupAiModal
          onGenerate={handleGenerateStorySetup}
          onClose={() => setShowStorySetupModal(false)}
        />
      )}

      {showTestModal && storyboard && scenes[0] && (
        <TestGenerationModal
          storyboardId={storyboard.id}
          sceneId={scenes[0].id ?? ""}
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
  projectStoryDraft,
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
  projectStoryDraft: string;
  projectNegativePromptDraft: string;
}) {
  const [assigningPhoto, setAssigningPhoto] = useState<string | null>(null);
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const id = useId();
  const t = useTranslations("storyboard");
  const tSel = useTranslations("selections");

  const isComplement = scene.kind === "complement";
  const candidatePhotos = photos.filter((p) => p.usage === "candidate");
  const primaryPhoto = primaryPhotoForScene(scene, photos);
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
      setPhotoPickerOpen(false);
    } catch {
      // silently ignore — scene will show stale state until next save
    } finally {
      setAssigningPhoto(null);
    }
  }

  const photoHero = (
    <div className={styles.scenePhotoPanel}>
      <div className={styles.primaryPhotoHero}>
        {primaryPhoto ? (
          <img
            className={styles.primaryPhotoImage}
            src={storageKeyToUrl(primaryPhoto.storageKey)}
            alt={primaryPhoto.name}
          />
        ) : (
          <span className={styles.photoPlaceholder}>
            {t("changePhoto.noPhoto")}
          </span>
        )}
      </div>
      {primaryPhoto && (
        <div className={styles.photoFidelityRow}>
          <span className={styles.photoFidelityLabel}>
            {t("fields.photoFidelity")}
          </span>
          <div className={styles.photoFidelityOptions}>
            {PHOTO_FIDELITY_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                className={`${styles.photoFidelityOption} ${
                  (scene.photoFidelity ?? "off") === option
                    ? styles.photoFidelityOptionActive
                    : ""
                }`}
                onClick={() => onUpdate({ photoFidelity: option })}
                title={t(`photoFidelity.${option}Hint`)}
              >
                {t(`photoFidelity.${option}`)}
              </button>
            ))}
          </div>
        </div>
      )}
      {scene.id && !isComplement && candidatePhotos.length > 0 && (
        <div className={styles.changePhotoWrap}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setPhotoPickerOpen((open) => !open)}
            disabled={assigningPhoto !== null}
          >
            {t("changePhoto.open")}
          </button>
          {photoPickerOpen && (
            <div className={styles.changePhotoPicker}>
              {candidatePhotos.map((photo) => {
                const isAssigned = primaryPhoto?.id === photo.id;
                return (
                  <button
                    key={photo.id}
                    type="button"
                    className={`${styles.changePhotoOption} ${
                      isAssigned ? styles.changePhotoOptionActive : ""
                    }`}
                    onClick={() => handleAssignPhoto(photo.id, "primary")}
                    disabled={assigningPhoto !== null}
                    title={photo.name}
                  >
                    <img
                      src={storageKeyToUrl(photo.storageKey)}
                      alt={photo.name}
                    />
                    <span>{photo.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const fieldSet = (
    <div className={styles.sceneFields}>
      <SceneField label={t("fields.title")} htmlFor={`${id}-title`}>
        <input
          id={`${id}-title`}
          className={styles.fieldInput}
          value={scene.title}
          onChange={(e) => onUpdate({ title: e.target.value })}
        />
      </SceneField>

      {detailsOpen && (
        <>
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
        </>
      )}

      <div className={styles.selectRow}>
        <SceneField label={t("fields.emotion")} htmlFor={`${id}-emotion`}>
          <select
            id={`${id}-emotion`}
            className={styles.fieldInput}
            value={scene.emotion}
            onChange={(e) => onUpdate({ emotion: e.target.value })}
          >
            {withCurrentOption(EMOTION_OPTIONS, scene.emotion).map((o) => (
              <option key={o} value={o}>
                {EMOTION_OPTIONS.includes(o) ? tSel(`emotion.${o}`) : o}
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
            {withCurrentOption(CAMERA_OPTIONS, scene.cameraDirection).map(
              (o) => (
                <option key={o} value={o}>
                  {CAMERA_OPTIONS.includes(o) ? tSel(`camera.${o}`) : o}
                </option>
              ),
            )}
          </select>
        </SceneField>

        <SceneField label={t("fields.lighting")} htmlFor={`${id}-lighting`}>
          <select
            id={`${id}-lighting`}
            className={styles.fieldInput}
            value={scene.lightingDirection}
            onChange={(e) => onUpdate({ lightingDirection: e.target.value })}
          >
            {withCurrentOption(LIGHTING_OPTIONS, scene.lightingDirection).map(
              (o) => (
                <option key={o} value={o}>
                  {LIGHTING_OPTIONS.includes(o) ? tSel(`lighting.${o}`) : o}
                </option>
              ),
            )}
          </select>
        </SceneField>

        <SceneField label={t("fields.motion")} htmlFor={`${id}-motion`}>
          <select
            id={`${id}-motion`}
            className={styles.fieldInput}
            value={scene.motionDirection}
            onChange={(e) => onUpdate({ motionDirection: e.target.value })}
          >
            {withCurrentOption(MOTION_OPTIONS, scene.motionDirection).map(
              (o) => (
                <option key={o} value={o}>
                  {MOTION_OPTIONS.includes(o) ? tSel(`motion.${o}`) : o}
                </option>
              ),
            )}
          </select>
        </SceneField>
      </div>

      <button
        type="button"
        className={styles.detailsToggle}
        onClick={() => setDetailsOpen((open) => !open)}
      >
        {detailsOpen ? t("view.hideDetails") : t("view.showDetails")}
      </button>

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
            story: projectStoryDraft,
            photoFidelity: scene.photoFidelity,
          }}
        />
      )}
    </div>
  );

  return (
    <div
      className={`card ${styles.sceneCard} ${styles.sceneCardSplit}${
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

      <div className={styles.sceneCardBody}>
        {photoHero}
        {fieldSet}
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
