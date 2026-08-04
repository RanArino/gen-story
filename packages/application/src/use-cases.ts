import { createHash, randomUUID } from "node:crypto";

import {
  appendAdjustmentsToCommonPrompt,
  assertAdjustmentsValid,
  assertComplementSceneBridge,
  canStartTestGeneration,
  completeTestGenerationBatch,
  createComplementScene,
  createGeneratedImage,
  createGenerationRequest,
  createPhotoAsset,
  createProject,
  createProjectPhotoAnalysis,
  createScene,
  createStoryboard,
  createStylePreset,
  createTemplateScene,
  createTestGenerationBatch,
  composeCommonPrompt,
  computeStoryboardSetupStep,
  createAiJob,
  hasBlankSceneFields,
  isBlankSceneField,
  replaceScenePhotoAssets,
  retryGenerationRequest,
  SCENE_FILL_FIELDS,
  setSceneAdoptedGeneratedImage,
  sortScenesByOrderIndex,
  transitionGenerationRequestStatus,
  unconfirmTestGenerationBatch,
  type AiJob,
  type GeneratedImage,
  type GenerationRequest,
  type PhotoAsset,
  type PhotoUsage,
  type Project,
  type ProjectPhotoAnalysis,
  type Scene,
  type SceneFillField,
  type StoryboardSetupStatus,
  type ScenePhotoAsset,
  type Storyboard,
  type StoryboardStatus,
  type StylePreset,
  type TestAdjustmentId,
  type TestGenerationBatch,
} from "@gen-story/domain";

import type {
  ApplicationDependencies,
  Language,
  UseCaseResult,
  UserPreference,
} from "./ports";
import { DEFAULT_LANGUAGE, isLanguage } from "./ports";

function success<T>(value: T): UseCaseResult<T> {
  return {
    ok: true,
    value,
  };
}

function failure(
  code: "validation_error" | "not_found" | "conflict" | "invalid_state",
  message: string,
): UseCaseResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  };
}

function validationFailure(error: unknown): UseCaseResult<never> {
  return failure(
    "validation_error",
    error instanceof Error ? error.message : "Invalid input.",
  );
}

function now(): string {
  return new Date().toISOString();
}

function isFailure<T>(
  value: T | UseCaseResult<never>,
): value is UseCaseResult<never> {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    value.ok === false
  );
}

async function getProjectOrNotFound(
  deps: ApplicationDependencies,
  projectId: string,
): Promise<Project | UseCaseResult<never>> {
  const project = await deps.projects.findById(projectId);

  if (project == null) {
    return failure("not_found", "Project not found.");
  }

  return project;
}

async function getStoryboardOrNotFound(
  deps: ApplicationDependencies,
  storyboardId: string,
): Promise<Storyboard | UseCaseResult<never>> {
  const storyboard = await deps.storyboards.findById(storyboardId);

  if (storyboard == null) {
    return failure("not_found", "Storyboard not found.");
  }

  return storyboard;
}

async function getSceneOrNotFound(
  deps: ApplicationDependencies,
  sceneId: string,
): Promise<Scene | UseCaseResult<never>> {
  const scene = await deps.scenes.findById(sceneId);

  if (scene == null) {
    return failure("not_found", "Scene not found.");
  }

  return scene;
}

async function getPhotoAssetOrNotFound(
  deps: ApplicationDependencies,
  photoAssetId: string,
): Promise<PhotoAsset | UseCaseResult<never>> {
  const photoAsset = await deps.photoAssets.findById(photoAssetId);

  if (photoAsset == null) {
    return failure("not_found", "Photo asset not found.");
  }

  return photoAsset;
}

async function getGenerationRequestOrNotFound(
  deps: ApplicationDependencies,
  generationRequestId: string,
): Promise<GenerationRequest | UseCaseResult<never>> {
  const generationRequest =
    await deps.generationRequests.findById(generationRequestId);

  if (generationRequest == null) {
    return failure("not_found", "Generation request not found.");
  }

  return generationRequest;
}

async function getGeneratedImageOrNotFound(
  deps: ApplicationDependencies,
  generatedImageId: string,
): Promise<GeneratedImage | UseCaseResult<never>> {
  const generatedImage = await deps.generatedImages.findById(generatedImageId);

  if (generatedImage == null) {
    return failure("not_found", "Generated image not found.");
  }

  return generatedImage;
}

export type CreateProjectInput = {
  projectId: string;
  organizationId: string;
  ownerUserId: string;
  name: string;
};

export async function createProjectUseCase(
  deps: ApplicationDependencies,
  input: CreateProjectInput,
): Promise<UseCaseResult<Project>> {
  try {
    const organization = await deps.organizations.findById(
      input.organizationId,
    );

    if (organization == null) {
      return failure("not_found", "Organization not found.");
    }

    const ownerUser = await deps.users.findById(input.ownerUserId);

    if (ownerUser == null) {
      return failure("not_found", "User not found.");
    }

    const existingProject = await deps.projects.findById(input.projectId);

    if (existingProject != null) {
      return failure("conflict", "Project already exists.");
    }

    const project = createProject({
      id: input.projectId,
      organizationId: input.organizationId,
      ownerUserId: input.ownerUserId,
      name: input.name,
      createdAt: now(),
      updatedAt: now(),
    });

    await deps.projects.save(project);
    await deps.progressEvents.publish({
      kind: "project.created",
      entityType: "project",
      entityId: project.id,
      payload: {
        organizationId: organization.id,
        ownerUserId: ownerUser.id,
      },
    });

    return success(project);
  } catch (error) {
    return validationFailure(error);
  }
}

export type CreateCustomStyleInput = {
  name: string;
  description: string;
  prompt: string;
  referenceImageStorageKey?: string;
};

export async function createCustomStyle(
  deps: ApplicationDependencies,
  input: CreateCustomStyleInput,
): Promise<UseCaseResult<StylePreset>> {
  try {
    const timestamp = now();
    const stylePreset = createStylePreset({
      id: randomUUID(),
      scope: "user",
      name: input.name,
      description: input.description,
      prompt: input.prompt,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await deps.stylePresets.save(stylePreset);
    return success(stylePreset);
  } catch (error) {
    return validationFailure(error);
  }
}

export type RegisterPhotoAssetInput = {
  photoAssetId: string;
  projectId: string;
  name: string;
  storageKey: string;
  mimeType: string;
  size: number;
  width?: number | null;
  height?: number | null;
  checksum: string;
  sourceKind: string;
  notes?: string | null;
  usage?: PhotoUsage;
};

export async function registerPhotoAsset(
  deps: ApplicationDependencies,
  input: RegisterPhotoAssetInput,
): Promise<UseCaseResult<PhotoAsset>> {
  try {
    const project = await getProjectOrNotFound(deps, input.projectId);

    if (isFailure(project)) {
      return project;
    }

    const existingPhotoAsset = await deps.photoAssets.findById(
      input.photoAssetId,
    );

    if (existingPhotoAsset != null) {
      return failure("conflict", "Photo asset already exists.");
    }

    const duplicatePhotoAsset =
      await deps.photoAssets.findByProjectIdAndChecksum(
        input.projectId,
        input.checksum,
      );

    if (duplicatePhotoAsset != null) {
      return failure("conflict", "Photo asset already exists in this project.");
    }

    const existingPhotos = await deps.photoAssets.findByProjectId(
      input.projectId,
    );

    const photoAsset = createPhotoAsset({
      id: input.photoAssetId,
      projectId: input.projectId,
      name: input.name,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      size: input.size,
      width: input.width ?? null,
      height: input.height ?? null,
      checksum: input.checksum,
      sourceKind: input.sourceKind,
      notes: input.notes ?? null,
      usage: input.usage,
      position: existingPhotos.length,
      createdAt: now(),
      updatedAt: now(),
    });

    await deps.photoAssets.save(photoAsset);
    await deps.progressEvents.publish({
      kind: "photo-asset.registered",
      entityType: "photoAsset",
      entityId: photoAsset.id,
      payload: {
        projectId: project.id,
      },
    });

    return success(photoAsset);
  } catch (error) {
    return validationFailure(error);
  }
}

export type UpdatePhotoCurationInput = {
  photoAssetId: string;
  usage: PhotoUsage;
};

export async function updatePhotoCuration(
  deps: ApplicationDependencies,
  input: UpdatePhotoCurationInput,
): Promise<UseCaseResult<PhotoAsset>> {
  try {
    const photoAsset = await getPhotoAssetOrNotFound(deps, input.photoAssetId);

    if ("ok" in photoAsset) {
      return photoAsset;
    }

    const updatedPhotoAsset = {
      ...photoAsset,
      usage: input.usage,
      updatedAt: now(),
    };

    await deps.photoAssets.save(updatedPhotoAsset);

    return success(updatedPhotoAsset);
  } catch (error) {
    return validationFailure(error);
  }
}

export type UpsertStoryboardInput = {
  storyboardId: string;
  projectId: string;
  status?: StoryboardStatus;
  // Omitted means "leave the stored tone alone", so a caller saving only the
  // story does not have to know what the tone is. An explicit empty string is
  // a deliberate reset back to undecided.
  tone?: string;
  stylePresetId?: string | null;
  commonPrompt?: string;
  story?: string;
  negativePrompt?: string;
  sceneIds?: string[];
};

// Composition happens only when the caller explicitly sends an empty string —
// that is the "regenerate from tone & style" action. An omitted field leaves
// the stored value untouched, including leaving a blank one blank: setup step 4
// gates on the common prompt being written, so silently composing one here
// would mark that step done before the user has decided anything.
async function resolveCommonPrompt(
  deps: ApplicationDependencies,
  args: {
    requestedCommonPrompt: string | undefined;
    existingCommonPrompt: string;
    tone: string;
    stylePresetId: string | null;
  },
): Promise<string> {
  if (args.requestedCommonPrompt === undefined) {
    return args.existingCommonPrompt;
  }

  const trimmed = args.requestedCommonPrompt.trim();
  if (trimmed !== "") {
    return trimmed;
  }

  let stylePreset: StylePreset | null = null;
  if (args.stylePresetId != null) {
    stylePreset = await deps.stylePresets.findById(args.stylePresetId);
  }

  return composeCommonPrompt({
    tone: args.tone,
    stylePresetName: stylePreset?.name ?? null,
    stylePresetPrompt: stylePreset?.prompt ?? null,
  });
}

// Same rule as the common prompt: an explicit empty string re-seeds from the
// photo analysis, an omitted field changes nothing.
async function resolveStory(
  deps: ApplicationDependencies,
  args: {
    requestedStory: string | undefined;
    existingStory: string;
    projectId: string;
  },
): Promise<string> {
  if (args.requestedStory === undefined) {
    return args.existingStory;
  }

  const trimmed = args.requestedStory.trim();
  if (trimmed !== "") {
    return trimmed;
  }

  const analysis = await deps.projectPhotoAnalyses.findLatestByProjectId(
    args.projectId,
  );
  return analysis?.storySummary.trim() ?? "";
}

export async function upsertStoryboard(
  deps: ApplicationDependencies,
  input: UpsertStoryboardInput,
): Promise<UseCaseResult<Storyboard>> {
  try {
    const project = await getProjectOrNotFound(deps, input.projectId);

    if (isFailure(project)) {
      return project;
    }

    if (input.stylePresetId != null) {
      const stylePreset = await deps.stylePresets.findById(input.stylePresetId);

      if (stylePreset == null) {
        return failure("not_found", "Style preset not found.");
      }
    }

    const existingStoryboard = await deps.storyboards.findById(
      input.storyboardId,
    );
    const effectiveStylePresetId =
      input.stylePresetId ?? existingStoryboard?.stylePresetId ?? null;
    const tone = input.tone ?? existingStoryboard?.tone ?? "";

    const commonPrompt = await resolveCommonPrompt(deps, {
      requestedCommonPrompt: input.commonPrompt,
      existingCommonPrompt: existingStoryboard?.commonPrompt ?? "",
      tone,
      stylePresetId: effectiveStylePresetId,
    });
    const story = await resolveStory(deps, {
      requestedStory: input.story,
      existingStory: existingStoryboard?.story ?? "",
      projectId: input.projectId,
    });

    const storyboard = createStoryboard({
      id: input.storyboardId,
      projectId: input.projectId,
      status: input.status ?? existingStoryboard?.status,
      tone,
      stylePresetId: effectiveStylePresetId,
      commonPrompt,
      story,
      negativePrompt:
        input.negativePrompt ?? existingStoryboard?.negativePrompt ?? "",
      sceneIds: input.sceneIds ?? existingStoryboard?.sceneIds ?? [],
      setupCompletedAt: existingStoryboard?.setupCompletedAt ?? null,
      createdAt: existingStoryboard?.createdAt ?? now(),
      updatedAt: now(),
    });

    await deps.storyboards.save(storyboard);

    return success(storyboard);
  } catch (error) {
    return validationFailure(error);
  }
}

// ── Storyboard setup flow ────────────────────────────────────────────────────

export type StoryboardSetup = {
  // The first step that is not yet satisfied by the data, or "complete".
  step: StoryboardSetupStatus;
  // Set once the storyboard has been through all five steps. From then on the
  // UI stops gating, even if a later edit blanks a field again.
  setupCompletedAt: string | null;
  // Scenes that still have a blank fillable field, and therefore how many AI
  // calls a bulk fill would spend. Derived here so the UI can state the cost
  // without re-implementing the blank-field rule.
  pendingSceneFillCount: number;
};

// Derives the step from persisted data using the one domain rule, so the API
// and the web never disagree about where a storyboard is in the flow.
export async function getStoryboardSetup(
  deps: ApplicationDependencies,
  storyboard: Storyboard,
): Promise<StoryboardSetup> {
  const photos = await deps.photoAssets.findByProjectId(storyboard.projectId);
  const scenes = await deps.scenes.findByStoryboardId(storyboard.id);

  return {
    step: computeStoryboardSetupStep({
      analyzablePhotoCount: photos.filter(isAnalyzablePhoto).length,
      storyboard,
      scenes,
    }),
    setupCompletedAt: storyboard.setupCompletedAt,
    pendingSceneFillCount: scenes.filter(hasBlankSceneFields).length,
  };
}

// Stamps completion the moment the data satisfies all five steps. Called from
// every path that can finish step 5 — bulk AI fill, single-scene fill, and
// saving scenes by hand — so completion does not depend on which route the user
// happened to take. Already-stamped storyboards are left alone: completion is
// sticky by design, so a later edit that blanks a field does not re-lock the UI.
async function stampStoryboardSetupCompletion(
  deps: ApplicationDependencies,
  storyboardId: string,
): Promise<void> {
  const storyboard = await deps.storyboards.findById(storyboardId);
  if (storyboard == null || storyboard.setupCompletedAt != null) return;

  const setup = await getStoryboardSetup(deps, storyboard);
  if (setup.step !== "complete") return;

  const timestamp = now();
  await deps.storyboards.save({
    ...storyboard,
    setupCompletedAt: timestamp,
    updatedAt: timestamp,
  });
  await deps.progressEvents.publish({
    kind: "storyboard.setup_completed",
    entityType: "storyboard",
    entityId: storyboard.id,
    payload: {
      storyboardId: storyboard.id,
      projectId: storyboard.projectId,
      setupCompletedAt: timestamp,
    },
  });
}

export type SceneInput = {
  sceneId: string;
  projectId: string;
  storyboardId: string;
  orderIndex: number;
  status?: Scene["status"];
  title: string;
  description: string;
  imagePrompt: string;
  emotion: string;
  cameraDirection: string;
  lightingDirection: string;
  motionDirection: string;
  notes?: string;
  negativePrompt?: string;
  photoFidelity?: Scene["photoFidelity"];
  photoAssets?: ScenePhotoAsset[];
  adoptedGeneratedImageId?: string | null;
};

export type UpsertScenesInput = {
  storyboardId: string;
  projectId: string;
  scenes: SceneInput[];
};

function buildScene(existingScene: Scene | null, input: SceneInput): Scene {
  return createScene({
    id: input.sceneId,
    projectId: input.projectId,
    storyboardId: input.storyboardId,
    orderIndex: input.orderIndex,
    status: input.status ?? existingScene?.status,
    kind: existingScene?.kind,
    bridge: existingScene?.bridge,
    title: input.title,
    description: input.description,
    imagePrompt: input.imagePrompt,
    emotion: input.emotion,
    cameraDirection: input.cameraDirection,
    lightingDirection: input.lightingDirection,
    motionDirection: input.motionDirection,
    notes: input.notes ?? existingScene?.notes,
    negativePrompt: input.negativePrompt ?? existingScene?.negativePrompt,
    photoFidelity: input.photoFidelity ?? existingScene?.photoFidelity,
    photoAssets: input.photoAssets ?? existingScene?.photoAssets,
    adoptedGeneratedImageId:
      input.adoptedGeneratedImageId ??
      existingScene?.adoptedGeneratedImageId ??
      null,
    createdAt: existingScene?.createdAt ?? now(),
    updatedAt: now(),
  });
}

export async function upsertScenes(
  deps: ApplicationDependencies,
  input: UpsertScenesInput,
): Promise<UseCaseResult<Scene[]>> {
  try {
    const storyboard = await getStoryboardOrNotFound(deps, input.storyboardId);

    if (isFailure(storyboard)) {
      return storyboard;
    }

    if (storyboard.projectId !== input.projectId) {
      return failure(
        "invalid_state",
        "Storyboard does not belong to this project.",
      );
    }

    const nextScenes: Scene[] = [];

    for (const sceneInput of input.scenes) {
      if (sceneInput.projectId !== input.projectId) {
        return failure(
          "invalid_state",
          "Scene does not belong to this project.",
        );
      }

      if (sceneInput.storyboardId !== input.storyboardId) {
        return failure(
          "invalid_state",
          "Scene does not belong to this storyboard.",
        );
      }

      const existingScene = await deps.scenes.findById(sceneInput.sceneId);
      const scene = buildScene(existingScene, sceneInput);

      await deps.scenes.save(scene);
      nextScenes.push(scene);
    }

    const allScenes = await deps.scenes.findByStoryboardId(input.storyboardId);
    const orderedScenes = sortScenesByOrderIndex(allScenes);
    const updatedStoryboard = {
      ...storyboard,
      sceneIds: orderedScenes.map((scene) => scene.id),
      updatedAt: now(),
    };

    await deps.storyboards.save(updatedStoryboard);
    // Writing the last blank scene by hand finishes step 5 just as legitimately
    // as letting the AI write it.
    await stampStoryboardSetupCompletion(deps, input.storyboardId);

    return success(sortScenesByOrderIndex(nextScenes));
  } catch (error) {
    return validationFailure(error);
  }
}

export type CreateTemplateScenesFromPhotosInput = {
  storyboardId: string;
  projectId: string;
  photoAssetIds: string[];
  // When true, each new scene also gets a background AI fill job, so the
  // storyboard arrives written rather than as a row of empty forms. Costs one
  // model call per photo, which is why the caller has to ask for it.
  autoFill?: boolean;
  language?: Language;
};

export type CreateTemplateScenesFromPhotosResult = {
  scenes: Scene[];
  // Job ids in the same order as `scenes`; empty when autoFill was not requested.
  aiJobIds: string[];
};

export async function createTemplateScenesFromPhotos(
  deps: ApplicationDependencies,
  input: CreateTemplateScenesFromPhotosInput,
): Promise<UseCaseResult<CreateTemplateScenesFromPhotosResult>> {
  try {
    const storyboard = await getStoryboardOrNotFound(deps, input.storyboardId);
    if (isFailure(storyboard)) return storyboard;

    if (storyboard.projectId !== input.projectId) {
      return failure(
        "invalid_state",
        "Storyboard does not belong to this project.",
      );
    }

    const existingScenes = await deps.scenes.findByStoryboardId(
      input.storyboardId,
    );
    const baseIndex = existingScenes.length;

    const createdScenes: Scene[] = [];
    const timestamp = now();

    for (let i = 0; i < input.photoAssetIds.length; i++) {
      const photoAssetId = input.photoAssetIds[i]!;
      const photo = await deps.photoAssets.findById(photoAssetId);

      if (
        !photo ||
        photo.projectId !== input.projectId ||
        photo.deletedAt !== null
      ) {
        return failure(
          "not_found",
          `Photo ${photoAssetId} not found in project.`,
        );
      }

      const scene = createTemplateScene({
        id: randomUUID(),
        projectId: input.projectId,
        storyboardId: input.storyboardId,
        orderIndex: baseIndex + i,
        photoAssetId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      await deps.scenes.save(scene);
      createdScenes.push(scene);
    }

    const allScenes = await deps.scenes.findByStoryboardId(input.storyboardId);
    const orderedScenes = sortScenesByOrderIndex(allScenes);
    const updatedStoryboard = {
      ...storyboard,
      sceneIds: orderedScenes.map((s) => s.id),
      updatedAt: timestamp,
    };
    await deps.storyboards.save(updatedStoryboard);

    const aiJobIds: string[] = [];
    if (input.autoFill === true) {
      const language = await resolvePrincipalLanguage(deps, input.language);
      for (const scene of createdScenes) {
        const { jobId } = await deps.jobQueue.enqueue({
          kind: "scene_ai_fill",
          projectId: input.projectId,
          payload: { sceneId: scene.id, language },
        });
        aiJobIds.push(jobId);
      }
    }

    return success({ scenes: createdScenes, aiJobIds });
  } catch (error) {
    return validationFailure(error);
  }
}

export type AnalyzeProjectPhotosInput = {
  projectId: string;
  language?: Language;
};

async function resolvePrincipalLanguage(
  deps: ApplicationDependencies,
  explicit?: Language,
): Promise<Language> {
  if (explicit && isLanguage(explicit)) return explicit;
  const principal = await deps.authContext.getCurrentPrincipal();
  if (principal) {
    const pref = await deps.userPreferences.findByUserId(principal.user.id);
    if (pref) return pref.language;
  }
  return DEFAULT_LANGUAGE;
}

// The language chosen when the job was enqueued, so a queued job is not
// affected by a later preference change.
function readLanguagePayload(payload: Record<string, unknown>): Language {
  const value = payload.language;
  return isLanguage(value) ? value : DEFAULT_LANGUAGE;
}

function readStringPayload(
  payload: Record<string, unknown>,
  key: string,
): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isAnalyzablePhoto(photo: PhotoAsset): boolean {
  return (
    photo.deletedAt === null &&
    (photo.usage === "candidate" || photo.usage === "reference")
  );
}

// Fingerprint of everything that materially changes a photo analysis result:
// the analyzable photo set (content + the metadata fed into the prompt) and the
// response language. When this matches the stored hash we can return the cached
// analysis instead of paying for another AI call.
function computeAnalysisInputsHash(
  photos: PhotoAsset[],
  language: Language,
): string {
  const fingerprint = photos
    .map((photo) => ({
      id: photo.id,
      checksum: photo.checksum,
      usage: photo.usage,
      name: photo.name,
      notes: photo.notes ?? "",
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return createHash("sha256")
    .update(JSON.stringify({ language, photos: fingerprint }))
    .digest("hex");
}

export type AnalyzeProjectPhotosResult = {
  // Present only on a cache hit; a fresh analysis arrives via the job.
  analysis: ProjectPhotoAnalysis | null;
  // True when the stored analysis was reused because inputs were unchanged
  // (no AI call was made, and no job was enqueued).
  cached: boolean;
  // Present only when a background job was enqueued.
  jobId: string | null;
};

// Enqueue half. The (paid) AI call happens in runPhotoAnalysisJob, driven by
// the worker. The input-hash cache guard stays here, before any job exists, so
// an unchanged photo set still costs nothing and still reports `cached: true`.
export async function analyzeProjectPhotos(
  deps: ApplicationDependencies,
  input: AnalyzeProjectPhotosInput,
): Promise<UseCaseResult<AnalyzeProjectPhotosResult>> {
  try {
    const project = await getProjectOrNotFound(deps, input.projectId);
    if (isFailure(project)) return project;

    const photos = (await deps.photoAssets.findByProjectId(project.id)).filter(
      isAnalyzablePhoto,
    );

    if (photos.length === 0) {
      return failure(
        "validation_error",
        "Project must have at least one candidate or reference photo for analysis.",
      );
    }

    const language = await resolvePrincipalLanguage(deps, input.language);
    const inputsHash = computeAnalysisInputsHash(photos, language);
    const existing = await deps.projectPhotoAnalyses.findLatestByProjectId(
      project.id,
    );

    // Skip the (paid) AI call when nothing relevant changed since last time.
    if (existing && existing.inputsHash === inputsHash) {
      return success({ analysis: existing, cached: true, jobId: null });
    }

    const { jobId } = await deps.jobQueue.enqueue({
      kind: "photo_analysis",
      projectId: project.id,
      payload: { projectId: project.id, language },
    });

    return success({ analysis: null, cached: false, jobId });
  } catch (error) {
    return validationFailure(error);
  }
}

// Run half. Inputs are re-read here rather than carried in the job payload,
// so a job that waited in the queue analyzes the photo set as it is now.
export async function runPhotoAnalysisJob(
  deps: ApplicationDependencies,
  job: AiJob,
): Promise<UseCaseResult<Record<string, unknown>>> {
  try {
    const project = await getProjectOrNotFound(deps, job.projectId);
    if (isFailure(project)) return project;

    const photos = (await deps.photoAssets.findByProjectId(project.id)).filter(
      isAnalyzablePhoto,
    );

    if (photos.length === 0) {
      return failure(
        "validation_error",
        "Project must have at least one candidate or reference photo for analysis.",
      );
    }

    const language = readLanguagePayload(job.inputJson);
    const inputsHash = computeAnalysisInputsHash(photos, language);
    const existing = await deps.projectPhotoAnalyses.findLatestByProjectId(
      project.id,
    );

    const storyboards = await deps.storyboards.findByProjectId(project.id);
    const storyboard = storyboards[0] ?? null;
    const generated = await deps.photoAnalysisGeneration.analyzeProjectPhotos({
      project,
      storyboard,
      photos,
      language,
    });
    const timestamp = now();
    const analysis = createProjectPhotoAnalysis({
      id: existing?.id ?? randomUUID(),
      projectId: project.id,
      emotionCandidates: generated.emotionCandidates,
      photoInsights: generated.photoInsights,
      storySummary: generated.storySummary,
      model: generated.model,
      inputsHash,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });

    await deps.projectPhotoAnalyses.save(analysis);
    await deps.progressEvents.publish({
      kind: "project_photo_analysis.completed",
      entityType: "project",
      entityId: project.id,
      payload: {
        projectPhotoAnalysisId: analysis.id,
        model: analysis.model,
        photoCount: photos.length,
      },
    });

    return success({
      projectPhotoAnalysisId: analysis.id,
      model: analysis.model,
      photoCount: photos.length,
    });
  } catch (error) {
    return validationFailure(error);
  }
}

export async function getProjectPhotoAnalysis(
  deps: ApplicationDependencies,
  input: AnalyzeProjectPhotosInput,
): Promise<UseCaseResult<ProjectPhotoAnalysis | null>> {
  try {
    const project = await getProjectOrNotFound(deps, input.projectId);
    if (isFailure(project)) return project;

    const analysis = await deps.projectPhotoAnalyses.findLatestByProjectId(
      project.id,
    );

    return success(analysis);
  } catch (error) {
    return validationFailure(error);
  }
}

export type FillSceneWithAiInput = {
  sceneId: string;
  language?: Language;
};

type SceneFillContext = {
  scene: Scene;
  blankFields: SceneFillField[];
  buildInput: (language: Language) => Promise<
    | UseCaseResult<never>
    | {
        project: Project;
        storyboard: Storyboard;
        scene: Scene;
        primaryPhoto: PhotoAsset;
        stylePreset: StylePreset | null;
        referencePhotos: PhotoAsset[];
        siblingScenes: Scene[];
        photoAnalysis: ProjectPhotoAnalysis | null;
        language: Language;
      }
  >;
};

// The photos the scene explicitly assigned as `reference`, in assignment order.
// Deleted ones are dropped so a stale assignment cannot fail the call.
async function resolveSceneReferencePhotos(
  deps: ApplicationDependencies,
  scene: Scene,
): Promise<PhotoAsset[]> {
  const photos: PhotoAsset[] = [];

  for (const assignment of scene.photoAssets) {
    if (assignment.role !== "reference") continue;
    const photo = await deps.photoAssets.findById(assignment.photoAssetId);
    if (photo != null && photo.deletedAt === null) photos.push(photo);
  }

  return photos;
}

// Everything the AI fill needs, gathered from persistence. Shared by the
// enqueue half (which only inspects `blankFields`) and the run half.
async function collectSceneFillContext(
  deps: ApplicationDependencies,
  sceneId: string,
): Promise<UseCaseResult<never> | SceneFillContext> {
  const scene = await getSceneOrNotFound(deps, sceneId);
  if (isFailure(scene)) return scene;

  const storyboard = await getStoryboardOrNotFound(deps, scene.storyboardId);
  if (isFailure(storyboard)) return storyboard;

  if (storyboard.projectId !== scene.projectId) {
    return failure(
      "invalid_state",
      "Scene does not belong to this storyboard.",
    );
  }

  const project = await getProjectOrNotFound(deps, scene.projectId);
  if (isFailure(project)) return project;

  const primaryPhotoAssignment = scene.photoAssets.find(
    (photoAsset) => photoAsset.role === "primary",
  );
  if (primaryPhotoAssignment == null) {
    return failure(
      "validation_error",
      "Scene must have a primary photo for AI fill.",
    );
  }

  const primaryPhoto = await getPhotoAssetOrNotFound(
    deps,
    primaryPhotoAssignment.photoAssetId,
  );
  if (isFailure(primaryPhoto)) return primaryPhoto;

  if (
    primaryPhoto.projectId !== scene.projectId ||
    primaryPhoto.deletedAt !== null
  ) {
    return failure("validation_error", "Scene primary photo is not available.");
  }

  const blankFields = SCENE_FILL_FIELDS.filter((field) =>
    isBlankSceneField(field, scene[field]),
  );

  return {
    scene,
    blankFields,
    buildInput: async (language: Language) => {
      const referencePhotos = await resolveSceneReferencePhotos(deps, scene);
      const siblingScenes = await deps.scenes.findByStoryboardId(storyboard.id);
      let stylePreset: StylePreset | null = null;

      if (storyboard.stylePresetId != null) {
        stylePreset = await deps.stylePresets.findById(
          storyboard.stylePresetId,
        );
        if (stylePreset == null) {
          return failure("not_found", "Style preset not found.");
        }
      }

      const photoAnalysis =
        await deps.projectPhotoAnalyses.findLatestByProjectId(project.id);

      return {
        project,
        storyboard,
        scene,
        primaryPhoto,
        stylePreset,
        referencePhotos,
        siblingScenes,
        photoAnalysis,
        language,
      };
    },
  };
}

export type FillSceneWithAiResult = {
  // Present when the scene had no blank fields, so no AI call was needed.
  scene: Scene | null;
  // Present only when a background job was enqueued.
  jobId: string | null;
};

// Enqueue half. The AI call happens in runSceneAiFillJob.
export async function fillSceneWithAi(
  deps: ApplicationDependencies,
  input: FillSceneWithAiInput,
): Promise<UseCaseResult<FillSceneWithAiResult>> {
  try {
    const context = await collectSceneFillContext(deps, input.sceneId);
    if (isFailure(context)) return context;

    if (context.blankFields.length === 0) {
      return success({ scene: context.scene, jobId: null });
    }

    const language = await resolvePrincipalLanguage(deps, input.language);
    const { jobId } = await deps.jobQueue.enqueue({
      kind: "scene_ai_fill",
      projectId: context.scene.projectId,
      payload: { sceneId: input.sceneId, language },
    });

    return success({ scene: null, jobId });
  } catch (error) {
    return validationFailure(error);
  }
}

export async function runSceneAiFillJob(
  deps: ApplicationDependencies,
  job: AiJob,
): Promise<UseCaseResult<Record<string, unknown>>> {
  try {
    const sceneId = readStringPayload(job.inputJson, "sceneId");
    if (sceneId == null) {
      return failure("validation_error", "AI job is missing a scene ID.");
    }

    const context = await collectSceneFillContext(deps, sceneId);
    if (isFailure(context)) return context;

    if (context.blankFields.length === 0) {
      return success({ sceneId, filledFields: [] });
    }

    const generationInput = await context.buildInput(
      readLanguagePayload(job.inputJson),
    );
    if (isFailure(generationInput)) return generationInput;

    const suggestion =
      await deps.sceneFillGeneration.generateSceneFill(generationInput);

    const updatedScene = {
      ...context.scene,
      ...Object.fromEntries(
        context.blankFields.map((field) => [field, suggestion[field]]),
      ),
      updatedAt: now(),
    };

    await deps.scenes.save(updatedScene);
    await deps.progressEvents.publish({
      kind: "scene.ai_filled",
      entityType: "scene",
      entityId: updatedScene.id,
      payload: { sceneId: updatedScene.id, projectId: updatedScene.projectId },
    });
    // The last job of a bulk fill is what finishes step 5.
    await stampStoryboardSetupCompletion(deps, updatedScene.storyboardId);

    return success({ sceneId, filledFields: [...context.blankFields] });
  } catch (error) {
    return validationFailure(error);
  }
}

export type FillStoryboardScenesWithAiInput = {
  storyboardId: string;
  language?: Language;
};

export type FillStoryboardScenesWithAiResult = {
  // One job per scene that still had a blank field, in scene order.
  aiJobIds: string[];
  // Scenes skipped because they were already written, so the caller can say
  // how many calls it actually spent.
  skippedSceneCount: number;
};

// Setup step 5. Enqueues through the same path as the single-scene case rather
// than adding a second one, so both share the blank-field test, the language
// resolution, and the per-project concurrency cap.
export async function fillStoryboardScenesWithAi(
  deps: ApplicationDependencies,
  input: FillStoryboardScenesWithAiInput,
): Promise<UseCaseResult<FillStoryboardScenesWithAiResult>> {
  try {
    const storyboard = await getStoryboardOrNotFound(deps, input.storyboardId);
    if (isFailure(storyboard)) return storyboard;

    const scenes = sortScenesByOrderIndex(
      await deps.scenes.findByStoryboardId(storyboard.id),
    );
    const language = await resolvePrincipalLanguage(deps, input.language);

    const aiJobIds: string[] = [];
    let skippedSceneCount = 0;

    for (const scene of scenes) {
      if (!hasBlankSceneFields(scene)) {
        skippedSceneCount += 1;
        continue;
      }

      const result = await fillSceneWithAi(deps, {
        sceneId: scene.id,
        language,
      });

      // A scene the single-scene path rejects — most often one with no primary
      // photo — must not abort the whole batch. Count it as skipped and move on.
      if (!result.ok || result.value.jobId == null) {
        skippedSceneCount += 1;
        continue;
      }

      aiJobIds.push(result.value.jobId);
    }

    return success({ aiJobIds, skippedSceneCount });
  } catch (error) {
    return validationFailure(error);
  }
}

// ── Story setup (step 4) ─────────────────────────────────────────────────────

export type GenerateStorySetupInput = {
  storyboardId: string;
  language?: Language;
};

export type GenerateStorySetupResult = {
  jobId: string;
};

// Enqueue half. The AI call happens in runStorySetupJob.
export async function generateStorySetup(
  deps: ApplicationDependencies,
  input: GenerateStorySetupInput,
): Promise<UseCaseResult<GenerateStorySetupResult>> {
  try {
    const storyboard = await getStoryboardOrNotFound(deps, input.storyboardId);
    if (isFailure(storyboard)) return storyboard;

    // Steps 2 and 3 are the inputs to this step; without them the model has
    // nothing to write the world against, which is the failure this whole flow
    // exists to prevent.
    if (storyboard.tone.trim() === "") {
      return failure(
        "invalid_state",
        "Choose a tone before generating the story setup.",
      );
    }

    if (storyboard.stylePresetId == null) {
      return failure(
        "invalid_state",
        "Choose a style before generating the story setup.",
      );
    }

    const language = await resolvePrincipalLanguage(deps, input.language);
    const { jobId } = await deps.jobQueue.enqueue({
      kind: "story_setup",
      projectId: storyboard.projectId,
      payload: { storyboardId: storyboard.id, language },
    });

    return success({ jobId });
  } catch (error) {
    return validationFailure(error);
  }
}

export async function runStorySetupJob(
  deps: ApplicationDependencies,
  job: AiJob,
): Promise<UseCaseResult<Record<string, unknown>>> {
  try {
    const storyboardId = readStringPayload(job.inputJson, "storyboardId");
    if (storyboardId == null) {
      return failure("validation_error", "AI job is missing a storyboard ID.");
    }

    const storyboard = await getStoryboardOrNotFound(deps, storyboardId);
    if (isFailure(storyboard)) return storyboard;

    const project = await getProjectOrNotFound(deps, storyboard.projectId);
    if (isFailure(project)) return project;

    let stylePreset: StylePreset | null = null;
    if (storyboard.stylePresetId != null) {
      stylePreset = await deps.stylePresets.findById(storyboard.stylePresetId);
      if (stylePreset == null) {
        return failure("not_found", "Style preset not found.");
      }
    }

    const photoAnalysis = await deps.projectPhotoAnalyses.findLatestByProjectId(
      project.id,
    );

    const suggestion = await deps.storySetupGeneration.generateStorySetup({
      project,
      storyboard,
      stylePreset,
      photoAnalysis,
      language: readLanguagePayload(job.inputJson),
    });

    const timestamp = now();
    const updated = createStoryboard({
      ...storyboard,
      story: suggestion.story,
      commonPrompt: suggestion.commonPrompt,
      negativePrompt: suggestion.negativePrompt,
      updatedAt: timestamp,
    });

    await deps.storyboards.save(updated);
    await deps.progressEvents.publish({
      kind: "storyboard.story_setup_completed",
      entityType: "storyboard",
      entityId: updated.id,
      payload: {
        storyboardId: updated.id,
        projectId: updated.projectId,
        model: suggestion.model,
      },
    });

    return success({
      storyboardId: updated.id,
      model: suggestion.model,
      story: updated.story,
      commonPrompt: updated.commonPrompt,
      negativePrompt: updated.negativePrompt,
    });
  } catch (error) {
    return validationFailure(error);
  }
}

// ── Complement Scenes ────────────────────────────────────────────────────────

export type InsertComplementSceneInput = {
  storyboardId: string;
  fromSceneId: string;
  toSceneId: string;
};

export async function insertComplementScene(
  deps: ApplicationDependencies,
  input: InsertComplementSceneInput,
): Promise<UseCaseResult<Scene>> {
  try {
    const storyboard = await getStoryboardOrNotFound(deps, input.storyboardId);
    if (isFailure(storyboard)) return storyboard;

    const scenes = sortScenesByOrderIndex(
      await deps.scenes.findByStoryboardId(input.storyboardId),
    );
    const fromIndex = scenes.findIndex(
      (scene) => scene.id === input.fromSceneId,
    );
    const toIndex = scenes.findIndex((scene) => scene.id === input.toSceneId);

    if (fromIndex === -1 || toIndex === -1) {
      return failure(
        "not_found",
        "Bridge scenes were not found in this storyboard.",
      );
    }

    if (toIndex !== fromIndex + 1) {
      return failure(
        "invalid_state",
        "A complement scene must bridge two adjacent scenes.",
      );
    }

    assertComplementSceneBridge(
      { fromSceneId: input.fromSceneId, toSceneId: input.toSceneId },
      scenes,
    );

    const timestamp = now();
    const complementScene = createComplementScene({
      id: randomUUID(),
      projectId: storyboard.projectId,
      storyboardId: input.storyboardId,
      orderIndex: fromIndex + 1,
      bridge: { fromSceneId: input.fromSceneId, toSceneId: input.toSceneId },
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const reordered = [
      ...scenes.slice(0, fromIndex + 1),
      complementScene,
      ...scenes.slice(fromIndex + 1),
    ];

    for (let index = 0; index < reordered.length; index++) {
      const scene = reordered[index]!;
      if (scene.id === complementScene.id) {
        await deps.scenes.save(scene);
      } else if (scene.orderIndex !== index) {
        await deps.scenes.save({
          ...scene,
          orderIndex: index,
          updatedAt: timestamp,
        });
      }
    }

    const updatedStoryboard = {
      ...storyboard,
      sceneIds: reordered.map((scene) => scene.id),
      updatedAt: timestamp,
    };
    await deps.storyboards.save(updatedStoryboard);

    return success(complementScene);
  } catch (error) {
    return validationFailure(error);
  }
}

export type ProposeComplementScenesInput = {
  storyboardId: string;
  fromSceneId: string;
  toSceneId: string;
  language?: Language;
};

export type ProposeComplementScenesResult = {
  jobId: string;
};

// Enqueue half. The AI call happens in runComplementSceneProposalsJob.
export async function proposeComplementScenes(
  deps: ApplicationDependencies,
  input: ProposeComplementScenesInput,
): Promise<UseCaseResult<ProposeComplementScenesResult>> {
  try {
    const storyboard = await getStoryboardOrNotFound(deps, input.storyboardId);
    if (isFailure(storyboard)) return storyboard;

    const scenes = await deps.scenes.findByStoryboardId(input.storyboardId);
    const known = new Set(scenes.map((scene) => scene.id));
    if (!known.has(input.fromSceneId) || !known.has(input.toSceneId)) {
      return failure(
        "not_found",
        "Bridge scenes were not found in this storyboard.",
      );
    }

    const language = await resolvePrincipalLanguage(deps, input.language);
    const { jobId } = await deps.jobQueue.enqueue({
      kind: "complement_scene_proposals",
      projectId: storyboard.projectId,
      payload: {
        storyboardId: input.storyboardId,
        fromSceneId: input.fromSceneId,
        toSceneId: input.toSceneId,
        language,
      },
    });

    return success({ jobId });
  } catch (error) {
    return validationFailure(error);
  }
}

export async function runComplementSceneProposalsJob(
  deps: ApplicationDependencies,
  job: AiJob,
): Promise<UseCaseResult<Record<string, unknown>>> {
  try {
    const storyboardId = readStringPayload(job.inputJson, "storyboardId");
    const fromSceneId = readStringPayload(job.inputJson, "fromSceneId");
    const toSceneId = readStringPayload(job.inputJson, "toSceneId");

    if (storyboardId == null || fromSceneId == null || toSceneId == null) {
      return failure(
        "validation_error",
        "AI job is missing complement scene bridge references.",
      );
    }

    const storyboard = await getStoryboardOrNotFound(deps, storyboardId);
    if (isFailure(storyboard)) return storyboard;

    const project = await getProjectOrNotFound(deps, storyboard.projectId);
    if (isFailure(project)) return project;

    const scenes = sortScenesByOrderIndex(
      await deps.scenes.findByStoryboardId(storyboardId),
    );
    const fromScene = scenes.find((scene) => scene.id === fromSceneId);
    const toScene = scenes.find((scene) => scene.id === toSceneId);

    if (fromScene == null || toScene == null) {
      return failure(
        "not_found",
        "Bridge scenes were not found in this storyboard.",
      );
    }

    let stylePreset: StylePreset | null = null;
    if (storyboard.stylePresetId != null) {
      stylePreset = await deps.stylePresets.findById(storyboard.stylePresetId);
      if (stylePreset == null) {
        return failure("not_found", "Style preset not found.");
      }
    }

    const projectPhotos = await deps.photoAssets.findByProjectId(project.id);
    const proposals =
      await deps.complementSceneProposal.proposeComplementScenes({
        project,
        storyboard,
        fromScene,
        toScene,
        stylePreset,
        projectPhotos,
        siblingScenes: scenes,
        language: readLanguagePayload(job.inputJson),
      });

    return success({
      storyboardId,
      fromSceneId,
      toSceneId,
      proposals: proposals.slice(0, 3),
    });
  } catch (error) {
    return validationFailure(error);
  }
}

// ── AI job lifecycle ─────────────────────────────────────────────────────────

async function getAiJobOrNotFound(
  deps: ApplicationDependencies,
  aiJobId: string,
): Promise<AiJob | UseCaseResult<never>> {
  const aiJob = await deps.aiJobs.findById(aiJobId);
  if (aiJob == null) return failure("not_found", "AI job not found.");
  return aiJob;
}

export type AiJobIdInput = {
  aiJobId: string;
};

export async function getAiJob(
  deps: ApplicationDependencies,
  input: AiJobIdInput,
): Promise<UseCaseResult<AiJob>> {
  try {
    const aiJob = await getAiJobOrNotFound(deps, input.aiJobId);
    if (isFailure(aiJob)) return aiJob;
    return success(aiJob);
  } catch (error) {
    return validationFailure(error);
  }
}

async function saveAiJobTransition(
  deps: ApplicationDependencies,
  job: AiJob,
  changes: Partial<AiJob>,
  eventKind: string,
): Promise<AiJob> {
  const updated = createAiJob({ ...job, ...changes });
  await deps.aiJobs.save(updated);
  await deps.progressEvents.publish({
    kind: eventKind,
    entityType: "aiJob",
    entityId: updated.id,
    payload: {
      aiJobId: updated.id,
      projectId: updated.projectId,
      jobKind: updated.kind,
      status: updated.status,
      result: updated.resultJson,
      errorMessage: updated.errorMessage,
    },
  });
  return updated;
}

export async function markAiJobRunning(
  deps: ApplicationDependencies,
  input: AiJobIdInput & { startedAt: string },
): Promise<UseCaseResult<AiJob>> {
  try {
    const job = await getAiJobOrNotFound(deps, input.aiJobId);
    if (isFailure(job)) return job;

    if (job.status !== "queued") {
      return failure(
        "invalid_state",
        `Cannot mark AI job as running: current status is "${job.status}".`,
      );
    }

    return success(
      await saveAiJobTransition(
        deps,
        job,
        {
          status: "running",
          startedAt: input.startedAt,
          updatedAt: input.startedAt,
        },
        "ai-job.running",
      ),
    );
  } catch (error) {
    return validationFailure(error);
  }
}

export async function markAiJobSucceeded(
  deps: ApplicationDependencies,
  input: AiJobIdInput & {
    resultJson: Record<string, unknown>;
    completedAt: string;
  },
): Promise<UseCaseResult<AiJob>> {
  try {
    const job = await getAiJobOrNotFound(deps, input.aiJobId);
    if (isFailure(job)) return job;

    // A job canceled mid-flight must not have its result written.
    if (job.status !== "running") {
      return failure(
        "invalid_state",
        `Cannot complete AI job: current status is "${job.status}".`,
      );
    }

    return success(
      await saveAiJobTransition(
        deps,
        job,
        {
          status: "succeeded",
          resultJson: input.resultJson,
          completedAt: input.completedAt,
          updatedAt: input.completedAt,
        },
        "ai-job.succeeded",
      ),
    );
  } catch (error) {
    return validationFailure(error);
  }
}

export async function markAiJobFailed(
  deps: ApplicationDependencies,
  input: AiJobIdInput & { errorMessage: string; completedAt: string },
): Promise<UseCaseResult<AiJob>> {
  try {
    const job = await getAiJobOrNotFound(deps, input.aiJobId);
    if (isFailure(job)) return job;

    if (job.status !== "running" && job.status !== "queued") {
      return failure(
        "invalid_state",
        `Cannot fail AI job: current status is "${job.status}".`,
      );
    }

    return success(
      await saveAiJobTransition(
        deps,
        job,
        {
          status: "failed",
          errorMessage: input.errorMessage,
          completedAt: input.completedAt,
          updatedAt: input.completedAt,
        },
        "ai-job.failed",
      ),
    );
  } catch (error) {
    return validationFailure(error);
  }
}

export async function cancelAiJob(
  deps: ApplicationDependencies,
  input: AiJobIdInput,
): Promise<UseCaseResult<AiJob>> {
  try {
    const job = await getAiJobOrNotFound(deps, input.aiJobId);
    if (isFailure(job)) return job;

    if (job.status !== "queued" && job.status !== "running") {
      return failure(
        "invalid_state",
        `Cannot cancel AI job: current status is "${job.status}".`,
      );
    }

    const timestamp = now();
    return success(
      await saveAiJobTransition(
        deps,
        job,
        {
          status: "canceled",
          completedAt: timestamp,
          updatedAt: timestamp,
        },
        "ai-job.canceled",
      ),
    );
  } catch (error) {
    return validationFailure(error);
  }
}

// Restart recovery: an API restart leaves `running` rows behind whose worker is
// gone. Fail them so the UI shows an honest terminal state instead of a spinner
// that never resolves.
export async function failInterruptedAiJobs(
  deps: ApplicationDependencies,
): Promise<UseCaseResult<number>> {
  try {
    const running = await deps.aiJobs.findRunning();
    const timestamp = now();

    for (const job of running) {
      await saveAiJobTransition(
        deps,
        job,
        {
          status: "failed",
          errorMessage: "interrupted by restart",
          completedAt: timestamp,
          updatedAt: timestamp,
        },
        "ai-job.failed",
      );
    }

    return success(running.length);
  } catch (error) {
    return validationFailure(error);
  }
}

// ── Reordering ───────────────────────────────────────────────────────────────

export type ReorderPhotosInput = {
  projectId: string;
  photoAssetIds: string[];
};

export async function reorderPhotos(
  deps: ApplicationDependencies,
  input: ReorderPhotosInput,
): Promise<UseCaseResult<PhotoAsset[]>> {
  try {
    const project = await getProjectOrNotFound(deps, input.projectId);
    if (isFailure(project)) return project;

    const photos = await deps.photoAssets.findByProjectId(input.projectId);
    const photosById = new Map(photos.map((photo) => [photo.id, photo]));

    for (const photoAssetId of input.photoAssetIds) {
      if (!photosById.has(photoAssetId)) {
        return failure(
          "not_found",
          `Photo ${photoAssetId} not found in this project.`,
        );
      }
    }

    const timestamp = now();
    for (let index = 0; index < input.photoAssetIds.length; index++) {
      const photo = photosById.get(input.photoAssetIds[index]!)!;
      if (photo.position !== index) {
        await deps.photoAssets.save({
          ...photo,
          position: index,
          updatedAt: timestamp,
        });
      }
    }

    const reordered = await deps.photoAssets.findByProjectId(input.projectId);
    return success(reordered);
  } catch (error) {
    return validationFailure(error);
  }
}

export type ReorderScenesInput = {
  storyboardId: string;
  sceneIds: string[];
};

export async function reorderScenes(
  deps: ApplicationDependencies,
  input: ReorderScenesInput,
): Promise<UseCaseResult<Scene[]>> {
  try {
    const storyboard = await getStoryboardOrNotFound(deps, input.storyboardId);
    if (isFailure(storyboard)) return storyboard;

    const scenes = await deps.scenes.findByStoryboardId(input.storyboardId);
    const scenesById = new Map(scenes.map((scene) => [scene.id, scene]));

    if (
      input.sceneIds.length !== scenes.length ||
      input.sceneIds.some((sceneId) => !scenesById.has(sceneId))
    ) {
      return failure(
        "invalid_state",
        "Scene order must list every scene in this storyboard exactly once.",
      );
    }

    const timestamp = now();
    for (let index = 0; index < input.sceneIds.length; index++) {
      const scene = scenesById.get(input.sceneIds[index]!)!;
      if (scene.orderIndex !== index) {
        await deps.scenes.save({
          ...scene,
          orderIndex: index,
          updatedAt: timestamp,
        });
      }
    }

    await deps.storyboards.save({
      ...storyboard,
      sceneIds: [...input.sceneIds],
      updatedAt: timestamp,
    });

    const reordered = sortScenesByOrderIndex(
      await deps.scenes.findByStoryboardId(input.storyboardId),
    );
    return success(reordered);
  } catch (error) {
    return validationFailure(error);
  }
}

export type AssignPhotosToSceneInput = {
  sceneId: string;
  photoAssets: ScenePhotoAsset[];
};

export async function assignPhotosToScene(
  deps: ApplicationDependencies,
  input: AssignPhotosToSceneInput,
): Promise<UseCaseResult<Scene>> {
  try {
    const scene = await getSceneOrNotFound(deps, input.sceneId);

    if (isFailure(scene)) {
      return scene;
    }

    for (const scenePhotoAsset of input.photoAssets) {
      const photoAsset = await deps.photoAssets.findById(
        scenePhotoAsset.photoAssetId,
      );

      if (photoAsset == null) {
        return failure("not_found", "Photo asset not found.");
      }

      if (photoAsset.projectId !== scene.projectId) {
        return failure(
          "invalid_state",
          "Photo asset does not belong to this project.",
        );
      }
    }

    const updatedScene = replaceScenePhotoAssets(
      scene,
      input.photoAssets,
      now(),
    );

    await deps.scenes.save(updatedScene);

    return success(updatedScene);
  } catch (error) {
    return validationFailure(error);
  }
}

export type CreateGenerationRequestInput = {
  generationRequestId: string;
  projectId: string;
  storyboardId: string;
  sceneId: string;
  inputJson: Record<string, unknown>;
};

export async function createGenerationRequestUseCase(
  deps: ApplicationDependencies,
  input: CreateGenerationRequestInput,
): Promise<UseCaseResult<GenerationRequest>> {
  try {
    const project = await getProjectOrNotFound(deps, input.projectId);

    if ("ok" in project) {
      return project;
    }

    const storyboard = await getStoryboardOrNotFound(deps, input.storyboardId);

    if ("ok" in storyboard) {
      return storyboard;
    }

    const scene = await getSceneOrNotFound(deps, input.sceneId);

    if (isFailure(scene)) {
      return scene;
    }

    if (storyboard.projectId !== project.id || scene.projectId !== project.id) {
      return failure(
        "invalid_state",
        "Generation request targets do not match the project.",
      );
    }

    if (scene.storyboardId !== storyboard.id) {
      return failure(
        "invalid_state",
        "Scene does not belong to this storyboard.",
      );
    }

    const preprocessedInputJson = await deps.imagePreprocessing.preprocess({
      projectId: project.id,
      storyboardId: storyboard.id,
      sceneId: scene.id,
      inputJson: input.inputJson,
    });

    const generationRequest = createGenerationRequest({
      id: input.generationRequestId,
      projectId: project.id,
      storyboardId: storyboard.id,
      sceneId: scene.id,
      inputJson: preprocessedInputJson,
      status: "queued",
      createdAt: now(),
      updatedAt: now(),
    });

    await deps.generationRequests.save(generationRequest);

    // The queued generation_requests row is itself the image work queue —
    // LocalJobWorker polls it directly, so there is no jobQueue enqueue here.
    await deps.progressEvents.publish({
      kind: "generation-request.created",
      entityType: "generationRequest",
      entityId: generationRequest.id,
      payload: {
        projectId: generationRequest.projectId,
      },
    });

    return success(generationRequest);
  } catch (error) {
    return validationFailure(error);
  }
}

export type MarkGeneratedImageAdoptedInput = {
  sceneId: string;
  generatedImageId: string;
};

export async function markGeneratedImageAdopted(
  deps: ApplicationDependencies,
  input: MarkGeneratedImageAdoptedInput,
): Promise<UseCaseResult<Scene>> {
  try {
    const scene = await getSceneOrNotFound(deps, input.sceneId);

    if (isFailure(scene)) {
      return scene;
    }

    const generatedImage = await getGeneratedImageOrNotFound(
      deps,
      input.generatedImageId,
    );

    if (isFailure(generatedImage)) {
      return generatedImage;
    }

    if (generatedImage.sceneId !== scene.id) {
      return failure(
        "invalid_state",
        "Generated image does not belong to this scene.",
      );
    }

    const sceneImages = await deps.generatedImages.findBySceneId(scene.id);
    const adoptedAt = now();
    const updated = setSceneAdoptedGeneratedImage(
      scene,
      sceneImages,
      generatedImage.id,
      adoptedAt,
      adoptedAt,
    );

    await deps.scenes.save(updated.scene);
    for (const sceneImage of updated.generatedImages) {
      await deps.generatedImages.save(sceneImage);
    }

    await deps.progressEvents.publish({
      kind: "generated-image.adopted",
      entityType: "scene",
      entityId: updated.scene.id,
      payload: {
        generatedImageId: generatedImage.id,
      },
    });

    return success(updated.scene);
  } catch (error) {
    return validationFailure(error);
  }
}

export type RetryFailedGenerationRequestInput = {
  generationRequestId: string;
  newGenerationRequestId: string;
};

export async function retryFailedGenerationRequest(
  deps: ApplicationDependencies,
  input: RetryFailedGenerationRequestInput,
): Promise<UseCaseResult<GenerationRequest>> {
  try {
    const generationRequest = await getGenerationRequestOrNotFound(
      deps,
      input.generationRequestId,
    );

    if (isFailure(generationRequest)) {
      return generationRequest;
    }

    if (generationRequest.status !== "failed") {
      return failure(
        "invalid_state",
        "Only failed generation requests can be retried.",
      );
    }

    const retryRequest = retryGenerationRequest(
      generationRequest,
      input.newGenerationRequestId,
      now(),
      now(),
    );

    await deps.generationRequests.save(retryRequest);

    await deps.progressEvents.publish({
      kind: "generation-request.retried",
      entityType: "generationRequest",
      entityId: retryRequest.id,
      payload: {
        projectId: retryRequest.projectId,
        sourceGenerationRequestId: generationRequest.id,
      },
    });

    return success(retryRequest);
  } catch (error) {
    return validationFailure(error);
  }
}

export type CancelGenerationRequestInput = {
  generationRequestId: string;
};

export async function cancelGenerationRequest(
  deps: ApplicationDependencies,
  input: CancelGenerationRequestInput,
): Promise<UseCaseResult<GenerationRequest>> {
  try {
    const generationRequest = await getGenerationRequestOrNotFound(
      deps,
      input.generationRequestId,
    );
    if (isFailure(generationRequest)) return generationRequest;

    const canceled = transitionGenerationRequestStatus(
      generationRequest,
      "canceled",
      now(),
    );

    await deps.generationRequests.save(canceled);
    return success(canceled);
  } catch (error) {
    return validationFailure(error);
  }
}

export async function deletePhotoAsset(
  deps: ApplicationDependencies,
  photoAssetId: string,
): Promise<UseCaseResult<void>> {
  const photoAsset = await deps.photoAssets.findById(photoAssetId);
  if (photoAsset == null) return failure("not_found", "Photo asset not found.");
  await deps.photoAssets.softDelete(photoAssetId, now());
  return success(undefined);
}

export async function restorePhotoAsset(
  deps: ApplicationDependencies,
  photoAssetId: string,
): Promise<UseCaseResult<void>> {
  await deps.photoAssets.restore(photoAssetId, now());
  return success(undefined);
}

export async function deleteProject(
  deps: ApplicationDependencies,
  projectId: string,
): Promise<UseCaseResult<void>> {
  const project = await deps.projects.findById(projectId);
  if (project == null) return failure("not_found", "Project not found.");
  await deps.projects.softDelete(projectId, now());
  return success(undefined);
}

export async function restoreProject(
  deps: ApplicationDependencies,
  projectId: string,
): Promise<UseCaseResult<void>> {
  await deps.projects.restore(projectId, now());
  return success(undefined);
}

export type MarkGenerationRequestRunningInput = {
  generationRequestId: string;
  startedAt: string;
};

export async function markGenerationRequestRunning(
  deps: ApplicationDependencies,
  input: MarkGenerationRequestRunningInput,
): Promise<UseCaseResult<GenerationRequest>> {
  try {
    const generationRequest = await getGenerationRequestOrNotFound(
      deps,
      input.generationRequestId,
    );

    if (isFailure(generationRequest)) {
      return generationRequest;
    }

    if (generationRequest.status !== "queued") {
      return failure(
        "invalid_state",
        `Cannot mark generation request as running: current status is "${generationRequest.status}".`,
      );
    }

    const updated = createGenerationRequest({
      ...generationRequest,
      status: "running",
      startedAt: input.startedAt,
      updatedAt: input.startedAt,
    });

    await deps.generationRequests.save(updated);

    await deps.progressEvents.publish({
      kind: "generation-request.running",
      entityType: "generationRequest",
      entityId: updated.id,
      payload: { projectId: updated.projectId },
    });

    return success(updated);
  } catch (error) {
    return validationFailure(error);
  }
}

export type MarkGenerationRequestCompletedInput = {
  generationRequestId: string;
  generatedImageId: string;
  storageKey: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  checksum: string;
  completedAt: string;
};

export async function markGenerationRequestCompleted(
  deps: ApplicationDependencies,
  input: MarkGenerationRequestCompletedInput,
): Promise<
  UseCaseResult<{
    generationRequest: GenerationRequest;
    generatedImage: GeneratedImage;
  }>
> {
  try {
    const generationRequest = await getGenerationRequestOrNotFound(
      deps,
      input.generationRequestId,
    );

    if (isFailure(generationRequest)) {
      return generationRequest;
    }

    if (generationRequest.status !== "running") {
      return failure(
        "invalid_state",
        `Cannot complete generation request: current status is "${generationRequest.status}".`,
      );
    }

    const updatedRequest = createGenerationRequest({
      ...generationRequest,
      status: "succeeded",
      completedAt: input.completedAt,
      updatedAt: input.completedAt,
    });

    await deps.generationRequests.save(updatedRequest);

    const generatedImage = createGeneratedImage({
      id: input.generatedImageId,
      projectId: generationRequest.projectId,
      storyboardId: generationRequest.storyboardId,
      sceneId: generationRequest.sceneId,
      generationRequestId: generationRequest.id,
      storageKey: input.storageKey,
      mimeType: input.mimeType,
      size: input.size,
      width: input.width,
      height: input.height,
      checksum: input.checksum,
      adoptedAt: null,
      createdAt: input.completedAt,
      updatedAt: input.completedAt,
    });

    await deps.generatedImages.save(generatedImage);

    await deps.progressEvents.publish({
      kind: "generation-request.succeeded",
      entityType: "generationRequest",
      entityId: updatedRequest.id,
      payload: {
        projectId: updatedRequest.projectId,
        generatedImageId: generatedImage.id,
      },
    });

    return success({ generationRequest: updatedRequest, generatedImage });
  } catch (error) {
    return validationFailure(error);
  }
}

export type MarkGenerationRequestFailedInput = {
  generationRequestId: string;
  errorMessage: string;
  completedAt: string;
};

export async function markGenerationRequestFailed(
  deps: ApplicationDependencies,
  input: MarkGenerationRequestFailedInput,
): Promise<UseCaseResult<GenerationRequest>> {
  try {
    const generationRequest = await getGenerationRequestOrNotFound(
      deps,
      input.generationRequestId,
    );

    if (isFailure(generationRequest)) {
      return generationRequest;
    }

    if (
      generationRequest.status !== "running" &&
      generationRequest.status !== "queued"
    ) {
      return failure(
        "invalid_state",
        `Cannot fail generation request: current status is "${generationRequest.status}".`,
      );
    }

    const truncated = input.errorMessage.slice(0, 500);

    const updated = createGenerationRequest({
      ...generationRequest,
      status: "failed",
      errorMessage: truncated,
      completedAt: input.completedAt,
      updatedAt: input.completedAt,
    });

    await deps.generationRequests.save(updated);

    await deps.progressEvents.publish({
      kind: "generation-request.failed",
      entityType: "generationRequest",
      entityId: updated.id,
      payload: { projectId: updated.projectId, errorMessage: truncated },
    });

    return success(updated);
  } catch (error) {
    return validationFailure(error);
  }
}

// ── Test Generation ──────────────────────────────────────────────────────────

export type RequestTestGenerationInput = {
  storyboardId: string;
  sceneId: string;
};

export async function requestTestGeneration(
  deps: ApplicationDependencies,
  input: RequestTestGenerationInput,
): Promise<
  UseCaseResult<{
    batch: TestGenerationBatch;
    generationRequests: GenerationRequest[];
  }>
> {
  try {
    const storyboard = await getStoryboardOrNotFound(deps, input.storyboardId);
    if (isFailure(storyboard)) return storyboard;

    const scene = await getSceneOrNotFound(deps, input.sceneId);
    if (isFailure(scene)) return scene;

    if (scene.storyboardId !== input.storyboardId) {
      return failure(
        "invalid_state",
        "Scene does not belong to this storyboard.",
      );
    }

    const latestBatch =
      await deps.testGenerationBatches.findLatestByStoryboardId(
        input.storyboardId,
      );
    // Only variants still in flight block another batch. A batch left pending
    // because its variants failed must not trap the operator: there is no
    // longer a reset to escape with.
    const latestVariants =
      latestBatch == null
        ? []
        : await deps.generationRequests.findByTestBatchId(latestBatch.id);
    if (
      !canStartTestGeneration(
        latestBatch,
        latestVariants.map((variant) => variant.status),
      )
    ) {
      return failure(
        "invalid_state",
        "A test generation batch for this storyboard is still running.",
      );
    }

    const ts = now();
    const batch = createTestGenerationBatch({
      id: randomUUID(),
      storyboardId: input.storyboardId,
      status: "pending",
      createdAt: ts,
    });
    await deps.testGenerationBatches.save(batch);

    const preprocessed = await deps.imagePreprocessing.preprocess({
      projectId: storyboard.projectId,
      storyboardId: input.storyboardId,
      sceneId: input.sceneId,
      inputJson: { testBatchId: batch.id },
    });

    const requests: GenerationRequest[] = [];
    for (let i = 0; i < 3; i++) {
      const req = createGenerationRequest({
        id: randomUUID(),
        projectId: storyboard.projectId,
        storyboardId: input.storyboardId,
        sceneId: input.sceneId,
        inputJson: { ...preprocessed, testBatchId: batch.id, testVariant: i },
        testGenerationBatchId: batch.id,
        createdAt: ts,
        updatedAt: ts,
      });
      await deps.generationRequests.save(req);
      requests.push(req);
    }

    return success({ batch, generationRequests: requests });
  } catch (error) {
    return validationFailure(error);
  }
}

export type ApplyAdjustmentToTestVariantInput = {
  storyboardId: string;
  variantId: string;
  adjustmentIds: TestAdjustmentId[];
  adjustmentSuffixes: Record<TestAdjustmentId, string>;
};

export async function applyAdjustmentToTestVariant(
  deps: ApplicationDependencies,
  input: ApplyAdjustmentToTestVariantInput,
): Promise<UseCaseResult<GenerationRequest>> {
  try {
    assertAdjustmentsValid(input.adjustmentIds);

    const storyboard = await getStoryboardOrNotFound(deps, input.storyboardId);
    if (isFailure(storyboard)) return storyboard;

    const variant = await deps.generationRequests.findById(input.variantId);
    if (!variant || variant.storyboardId !== input.storyboardId) {
      return failure(
        "not_found",
        "Generation request not found in this storyboard.",
      );
    }

    const inputJson = variant.inputJson as Record<string, unknown>;
    const testBatchId = inputJson?.testBatchId;
    if (typeof testBatchId !== "string") {
      return failure(
        "invalid_state",
        "Generation request is not a test variant.",
      );
    }

    const batch = await deps.testGenerationBatches.findLatestByStoryboardId(
      input.storyboardId,
    );
    if (!batch || batch.id !== testBatchId) {
      return failure(
        "invalid_state",
        "Test variant does not belong to the current batch.",
      );
    }
    if (batch.status === "completed") {
      return failure(
        "invalid_state",
        "Cannot adjust a variant after the batch is confirmed.",
      );
    }

    const effectiveCommonPrompt = appendAdjustmentsToCommonPrompt(
      storyboard.commonPrompt ?? "",
      input.adjustmentIds,
      input.adjustmentSuffixes,
    );

    const preprocessed = await deps.imagePreprocessing.preprocess({
      projectId: variant.projectId,
      storyboardId: input.storyboardId,
      sceneId: variant.sceneId,
      inputJson: { testBatchId, testVariant: inputJson.testVariant },
      commonPromptOverride: effectiveCommonPrompt,
    });

    const ts = now();

    await deps.generationRequests.softDelete(variant.id, ts);

    const newRequest = createGenerationRequest({
      id: randomUUID(),
      projectId: variant.projectId,
      storyboardId: input.storyboardId,
      sceneId: variant.sceneId,
      inputJson: preprocessed,
      appliedAdjustments: input.adjustmentIds,
      sourceGenerationRequestId: variant.id,
      testGenerationBatchId: testBatchId,
      createdAt: ts,
      updatedAt: ts,
    });
    await deps.generationRequests.save(newRequest);

    return success(newRequest);
  } catch (error) {
    return validationFailure(error);
  }
}

export type ConfirmTestGenerationInput = {
  storyboardId: string;
  confirmedGenerationRequestId: string;
  adjustmentSuffixes?: Record<TestAdjustmentId, string>;
};

export async function confirmTestGeneration(
  deps: ApplicationDependencies,
  input: ConfirmTestGenerationInput,
): Promise<UseCaseResult<TestGenerationBatch>> {
  try {
    const storyboard = await getStoryboardOrNotFound(deps, input.storyboardId);
    if (isFailure(storyboard)) return storyboard;

    const req = await deps.generationRequests.findById(
      input.confirmedGenerationRequestId,
    );
    if (!req || req.storyboardId !== input.storyboardId) {
      return failure(
        "not_found",
        "Generation request not found in this storyboard.",
      );
    }
    if (req.status !== "succeeded") {
      return failure(
        "invalid_state",
        "Only a succeeded sample can be confirmed.",
      );
    }

    // The batch comes from the sample, not from "the latest batch": the
    // operator may confirm a sample from any batch they have generated.
    const batches = await deps.testGenerationBatches.listByStoryboardId(
      input.storyboardId,
    );
    const batch = batches.find(
      (candidate) => candidate.id === req.testGenerationBatchId,
    );
    if (!batch) {
      return failure(
        "invalid_state",
        "Generation request is not a test generation sample.",
      );
    }

    const ts = now();
    // A storyboard holds exactly one confirmation, so moving it means taking it
    // off whichever other batch currently has it. `createdAt` is preserved, so
    // the batch keeps its place in the history ordering.
    for (const other of batches) {
      if (other.id === batch.id) continue;
      if (other.status !== "completed") continue;
      await deps.testGenerationBatches.save(
        unconfirmTestGenerationBatch(other),
      );
    }

    const confirmed = completeTestGenerationBatch(
      batch,
      input.confirmedGenerationRequestId,
      ts,
    );
    await deps.testGenerationBatches.save(confirmed);

    const appliedAdjustments = req.appliedAdjustments ?? [];
    if (appliedAdjustments.length > 0 && input.adjustmentSuffixes) {
      const nextCommonPrompt = appendAdjustmentsToCommonPrompt(
        storyboard.commonPrompt ?? "",
        appliedAdjustments,
        input.adjustmentSuffixes,
      );
      if (nextCommonPrompt !== storyboard.commonPrompt) {
        await deps.storyboards.save({
          ...storyboard,
          commonPrompt: nextCommonPrompt,
          updatedAt: ts,
        });
      }
    }

    return success(confirmed);
  } catch (error) {
    return validationFailure(error);
  }
}

export type TestGenerationBatchVariant = {
  request: GenerationRequest;
  generatedImage: GeneratedImage | null;
};

export type TestGenerationBatchWithVariants = {
  batch: TestGenerationBatch;
  variants: TestGenerationBatchVariant[];
};

// The storyboard's whole sample history, newest batch first. Assembled here so
// the modal and the history screen read one shape instead of each stitching
// batches to requests to images for itself.
export async function listTestGenerationBatches(
  deps: ApplicationDependencies,
  input: { storyboardId: string },
): Promise<UseCaseResult<TestGenerationBatchWithVariants[]>> {
  try {
    const storyboard = await getStoryboardOrNotFound(deps, input.storyboardId);
    if (isFailure(storyboard)) return storyboard;

    const batches = await deps.testGenerationBatches.listByStoryboardId(
      input.storyboardId,
    );

    const result: TestGenerationBatchWithVariants[] = [];
    for (const batch of batches) {
      const requests = await deps.generationRequests.findByTestBatchId(
        batch.id,
      );
      const variants: TestGenerationBatchVariant[] = [];
      for (const request of requests) {
        const images = await deps.generatedImages.findBySceneId(
          request.sceneId,
        );
        variants.push({
          request,
          generatedImage:
            images.find((image) => image.generationRequestId === request.id) ??
            null,
        });
      }
      variants.sort(
        (a, b) => testVariantIndex(a.request) - testVariantIndex(b.request),
      );
      result.push({ batch, variants });
    }

    return success(result);
  } catch (error) {
    return validationFailure(error);
  }
}

function testVariantIndex(request: GenerationRequest): number {
  const value = (request.inputJson as Record<string, unknown>).testVariant;
  return typeof value === "number" ? value : 0;
}

// ── Storyboard JSON Export ───────────────────────────────────────────────────

export type StoryboardExportScene = {
  id: string;
  orderIndex: number;
  title: string;
  description: string;
  imagePrompt: string;
  emotion: string;
  cameraDirection: string;
  lightingDirection: string;
  motionDirection: string;
  notes: string;
  sourcePhotoStorageKey: string | null;
  adoptedImageStorageKey: string | null;
};

export type StoryboardExportData = {
  storyboardId: string;
  projectId: string;
  tone: string;
  stylePresetName: string | null;
  exportedAt: string;
  language: Language;
  scenes: StoryboardExportScene[];
};

export type ExportStoryboardAsJsonInput = {
  storyboardId: string;
  language?: Language;
};

export async function exportStoryboardAsJson(
  deps: ApplicationDependencies,
  input: ExportStoryboardAsJsonInput,
): Promise<UseCaseResult<StoryboardExportData>> {
  try {
    const storyboard = await getStoryboardOrNotFound(deps, input.storyboardId);
    if (isFailure(storyboard)) return storyboard;

    let stylePresetName: string | null = null;
    if (storyboard.stylePresetId) {
      const preset = await deps.stylePresets.findById(storyboard.stylePresetId);
      stylePresetName = preset?.name ?? null;
    }

    const scenes = await deps.scenes.findByStoryboardId(input.storyboardId);
    const ordered = sortScenesByOrderIndex(scenes);

    const exportScenes: StoryboardExportScene[] = [];
    for (const scene of ordered) {
      const primaryPhotoAsset = scene.photoAssets.find(
        (p) => p.role === "primary",
      );
      let sourcePhotoStorageKey: string | null = null;
      if (primaryPhotoAsset) {
        const photo = await deps.photoAssets.findById(
          primaryPhotoAsset.photoAssetId,
        );
        sourcePhotoStorageKey = photo?.storageKey ?? null;
      }

      let adoptedImageStorageKey: string | null = null;
      if (scene.adoptedGeneratedImageId) {
        const images = await deps.generatedImages.findBySceneId(scene.id);
        const adopted = images.find(
          (img) => img.id === scene.adoptedGeneratedImageId,
        );
        adoptedImageStorageKey = adopted?.storageKey ?? null;
      }

      exportScenes.push({
        id: scene.id,
        orderIndex: scene.orderIndex,
        title: scene.title,
        description: scene.description,
        imagePrompt: scene.imagePrompt,
        emotion: scene.emotion,
        cameraDirection: scene.cameraDirection,
        lightingDirection: scene.lightingDirection,
        motionDirection: scene.motionDirection,
        notes: scene.notes,
        sourcePhotoStorageKey,
        adoptedImageStorageKey,
      });
    }

    const language = await resolvePrincipalLanguage(deps, input.language);
    return success({
      storyboardId: storyboard.id,
      projectId: storyboard.projectId,
      tone: storyboard.tone,
      stylePresetName,
      exportedAt: new Date().toISOString(),
      language,
      scenes: exportScenes,
    });
  } catch (error) {
    return validationFailure(error);
  }
}

export async function getUserPreference(
  deps: ApplicationDependencies,
  userId: string,
): Promise<UseCaseResult<UserPreference>> {
  try {
    const trimmedUserId = userId.trim();
    if (!trimmedUserId) {
      return failure("validation_error", "userId is required");
    }

    const existing = await deps.userPreferences.findByUserId(trimmedUserId);
    if (existing) {
      return success(existing);
    }

    return success({
      userId: trimmedUserId,
      language: DEFAULT_LANGUAGE,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return validationFailure(error);
  }
}

export type SetUserPreferenceInput = {
  userId: string;
  language: Language;
};

export async function setUserPreference(
  deps: ApplicationDependencies,
  input: SetUserPreferenceInput,
): Promise<UseCaseResult<UserPreference>> {
  try {
    const trimmedUserId = input.userId.trim();
    if (!trimmedUserId) {
      return failure("validation_error", "userId is required");
    }

    if (!isLanguage(input.language)) {
      return failure("validation_error", `language must be one of: en, ja`);
    }

    const preference: UserPreference = {
      userId: trimmedUserId,
      language: input.language,
      updatedAt: new Date().toISOString(),
    };

    await deps.userPreferences.upsert(preference);
    return success(preference);
  } catch (error) {
    return validationFailure(error);
  }
}
