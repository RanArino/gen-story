import { randomUUID } from "node:crypto";

import {
  createGeneratedImage,
  createGenerationRequest,
  createPhotoAsset,
  createProject,
  createScene,
  createStoryboard,
  createTemplateScene,
  retryGenerationRequest,
  replaceScenePhotoAssets,
  setSceneAdoptedGeneratedImage,
  sortScenesByOrderIndex,
  transitionGenerationRequestStatus,
  type GeneratedImage,
  type GenerationRequest,
  type PhotoAsset,
  type PhotoUsage,
  type Project,
  type Scene,
  type ScenePhotoAsset,
  type Storyboard,
  type StoryboardStatus,
} from "@gen-story/domain";

import type { ApplicationDependencies, UseCaseResult } from "./ports";

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
  tone: string;
  stylePresetId?: string | null;
  sceneIds?: string[];
};

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
    const storyboard = createStoryboard({
      id: input.storyboardId,
      projectId: input.projectId,
      status: input.status ?? existingStoryboard?.status,
      tone: input.tone,
      stylePresetId:
        input.stylePresetId ?? existingStoryboard?.stylePresetId ?? null,
      sceneIds: input.sceneIds ?? existingStoryboard?.sceneIds ?? [],
      createdAt: existingStoryboard?.createdAt ?? now(),
      updatedAt: now(),
    });

    await deps.storyboards.save(storyboard);

    return success(storyboard);
  } catch (error) {
    return validationFailure(error);
  }
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
    title: input.title,
    description: input.description,
    imagePrompt: input.imagePrompt,
    emotion: input.emotion,
    cameraDirection: input.cameraDirection,
    lightingDirection: input.lightingDirection,
    motionDirection: input.motionDirection,
    notes: input.notes ?? existingScene?.notes,
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

    return success(sortScenesByOrderIndex(nextScenes));
  } catch (error) {
    return validationFailure(error);
  }
}

export type CreateTemplateScenesFromPhotosInput = {
  storyboardId: string;
  projectId: string;
  photoAssetIds: string[];
};

export async function createTemplateScenesFromPhotos(
  deps: ApplicationDependencies,
  input: CreateTemplateScenesFromPhotosInput,
): Promise<UseCaseResult<Scene[]>> {
  try {
    const storyboard = await getStoryboardOrNotFound(deps, input.storyboardId);
    if (isFailure(storyboard)) return storyboard;

    if (storyboard.projectId !== input.projectId) {
      return failure("invalid_state", "Storyboard does not belong to this project.");
    }

    const existingScenes = await deps.scenes.findByStoryboardId(input.storyboardId);
    const baseIndex = existingScenes.length;

    const createdScenes: Scene[] = [];
    const timestamp = now();

    for (let i = 0; i < input.photoAssetIds.length; i++) {
      const photoAssetId = input.photoAssetIds[i]!;
      const photo = await deps.photoAssets.findById(photoAssetId);

      if (!photo || photo.projectId !== input.projectId || photo.deletedAt !== null) {
        return failure("not_found", `Photo ${photoAssetId} not found in project.`);
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

    return success(createdScenes);
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

    const queueResult = await deps.jobQueue.enqueue({
      kind: "generation-request",
      payload: {
        generationRequestId: generationRequest.id,
        projectId: project.id,
        storyboardId: storyboard.id,
        sceneId: scene.id,
      },
    });

    await deps.progressEvents.publish({
      kind: "generation-request.created",
      entityType: "generationRequest",
      entityId: generationRequest.id,
      payload: {
        jobId: queueResult.jobId,
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

    const queueResult = await deps.jobQueue.enqueue({
      kind: "generation-request",
      payload: {
        generationRequestId: retryRequest.id,
        sourceGenerationRequestId: generationRequest.id,
        projectId: retryRequest.projectId,
        storyboardId: retryRequest.storyboardId,
        sceneId: retryRequest.sceneId,
      },
    });

    await deps.progressEvents.publish({
      kind: "generation-request.retried",
      entityType: "generationRequest",
      entityId: retryRequest.id,
      payload: {
        jobId: queueResult.jobId,
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
      payload: { generatedImageId: generatedImage.id },
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
      payload: { errorMessage: truncated },
    });

    return success(updated);
  } catch (error) {
    return validationFailure(error);
  }
}
