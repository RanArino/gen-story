import {
  type GeneratedImage,
  type GenerationRequest,
  type GenerationRequestStatus,
  type PhotoAsset,
  type PhotoUsage,
  type Scene,
  type SceneBridge,
  type ScenePhotoAsset,
  type StylePreset,
  type TestAdjustmentId,
  type TestGenerationBatch,
  type TestGenerationBatchStatus,
  type Timestamp,
  isTestAdjustmentId,
} from "./model";

export const MAX_ADJUSTMENTS_PER_VARIANT = 3;

function assertScenePhotoAssets(scenePhotoAssets: ScenePhotoAsset[]): void {
  const primaryCount = scenePhotoAssets.filter(
    (scenePhotoAsset) => scenePhotoAsset.role === "primary",
  ).length;
  const seenPhotoAssetIds = new Set<string>();

  if (primaryCount > 1) {
    throw new Error("A scene can have at most one primary photo.");
  }

  for (const scenePhotoAsset of scenePhotoAssets) {
    if (seenPhotoAssetIds.has(scenePhotoAsset.photoAssetId)) {
      throw new Error("A scene cannot contain duplicate photo assets.");
    }

    seenPhotoAssetIds.add(scenePhotoAsset.photoAssetId);
  }
}

export function assertComplementSceneBridge(
  bridge: SceneBridge,
  siblingScenes: ReadonlyArray<{ id: string }>,
): void {
  if (bridge.fromSceneId === bridge.toSceneId) {
    throw new Error(
      "A complement scene bridge must reference two distinct scenes.",
    );
  }

  const siblingIds = new Set(siblingScenes.map((scene) => scene.id));

  if (
    !siblingIds.has(bridge.fromSceneId) ||
    !siblingIds.has(bridge.toSceneId)
  ) {
    throw new Error(
      "A complement scene bridge must reference existing sibling scenes.",
    );
  }
}

export function updatePhotoUsage(
  photoAsset: PhotoAsset,
  usage: PhotoUsage,
  updatedAt: Timestamp,
): PhotoAsset {
  return {
    ...photoAsset,
    usage,
    updatedAt,
  };
}

export function sortScenesByOrderIndex<
  T extends { id: string; orderIndex: number },
>(scenes: T[]): T[] {
  return [...scenes].sort((left, right) => {
    if (left.orderIndex !== right.orderIndex) {
      return left.orderIndex - right.orderIndex;
    }

    return left.id.localeCompare(right.id);
  });
}

export function replaceScenePhotoAssets(
  scene: Scene,
  scenePhotoAssets: ScenePhotoAsset[],
  updatedAt: Timestamp,
): Scene {
  assertScenePhotoAssets(scenePhotoAssets);

  return {
    ...scene,
    photoAssets: [...scenePhotoAssets],
    updatedAt,
  };
}

export function setSceneAdoptedGeneratedImage(
  scene: Scene,
  generatedImages: GeneratedImage[],
  generatedImageId: string,
  adoptedAt: Timestamp,
  updatedAt: Timestamp,
): { scene: Scene; generatedImages: GeneratedImage[] } {
  const sceneImages = generatedImages.filter(
    (generatedImage) => generatedImage.sceneId === scene.id,
  );
  const targetImage = sceneImages.find(
    (generatedImage) => generatedImage.id === generatedImageId,
  );

  if (!targetImage) {
    throw new Error("The generated image does not belong to this scene.");
  }

  return {
    scene: {
      ...scene,
      adoptedGeneratedImageId: generatedImageId,
      updatedAt,
    },
    generatedImages: generatedImages.map((generatedImage) => {
      if (generatedImage.sceneId !== scene.id) {
        return generatedImage;
      }

      if (generatedImage.id === generatedImageId) {
        return {
          ...generatedImage,
          adoptedAt,
          updatedAt,
        };
      }

      if (generatedImage.adoptedAt == null) {
        return generatedImage;
      }

      return {
        ...generatedImage,
        adoptedAt: null,
        updatedAt,
      };
    }),
  };
}

export function updateStylePreset(
  stylePreset: StylePreset,
  updates: Partial<Pick<StylePreset, "name" | "description" | "prompt">>,
  updatedAt: Timestamp,
): StylePreset {
  if (stylePreset.scope === "system") {
    throw new Error("System style presets cannot be edited directly.");
  }

  return {
    ...stylePreset,
    name: updates.name ?? stylePreset.name,
    description: updates.description ?? stylePreset.description,
    prompt: updates.prompt ?? stylePreset.prompt,
    updatedAt,
  };
}

const allowedGenerationRequestTransitions: Record<
  GenerationRequestStatus,
  readonly GenerationRequestStatus[]
> = {
  queued: ["running", "canceled"],
  running: ["succeeded", "failed", "canceled"],
  succeeded: [],
  failed: ["canceled"],
  canceled: [],
};

export function transitionGenerationRequestStatus(
  request: GenerationRequest,
  nextStatus: GenerationRequestStatus,
  updatedAt: Timestamp,
  errorMessage?: string | null,
): GenerationRequest {
  if (
    !allowedGenerationRequestTransitions[request.status].includes(nextStatus)
  ) {
    throw new Error(
      `Cannot transition generation request from ${request.status} to ${nextStatus}.`,
    );
  }

  return {
    ...request,
    status: nextStatus,
    errorMessage:
      nextStatus === "failed"
        ? (errorMessage ?? request.errorMessage)
        : request.errorMessage,
    updatedAt,
  };
}

export function retryGenerationRequest(
  request: GenerationRequest,
  newGenerationRequestId: string,
  createdAt: Timestamp,
  updatedAt: Timestamp,
): GenerationRequest {
  if (request.status !== "failed") {
    throw new Error("Only failed generation requests can be retried.");
  }

  return {
    ...request,
    id: newGenerationRequestId,
    status: "queued",
    errorMessage: null,
    sourceGenerationRequestId: request.id,
    createdAt,
    updatedAt,
  };
}

// A storyboard may hold any number of batches. Only work that is still in
// flight blocks a new one: a batch whose variants all failed used to need an
// explicit reset to get past, which is what reset was really being used for.
export function canStartTestGeneration(
  latestBatch: TestGenerationBatch | null,
  latestBatchVariantStatuses: GenerationRequestStatus[] = [],
): boolean {
  if (latestBatch === null) return true;
  if (latestBatch.status === "completed") return true;
  return !latestBatchVariantStatuses.some(
    (status) => status === "queued" || status === "running",
  );
}

// A batch's samples are generated from the storyboard's first scene, so they
// land in that scene's request history next to its real generations. Only the
// confirmed sample belongs there: the rejected ones are alternatives internal to
// the batch, and every batch is readable in the test-generation dialog. Without
// this the first scene gains three entries per batch and its real generations
// get buried.
export function isVisibleInSceneHistory(
  request: Pick<GenerationRequest, "id" | "testGenerationBatchId">,
  confirmedTestRequestIds: ReadonlySet<string>,
): boolean {
  if (request.testGenerationBatchId === null) return true;
  return confirmedTestRequestIds.has(request.id);
}

export function completeTestGenerationBatch(
  batch: TestGenerationBatch,
  confirmedGenerationRequestId: string,
  completedAt: Timestamp,
): TestGenerationBatch {
  return {
    ...batch,
    status: "completed",
    confirmedGenerationRequestId,
    completedAt,
  };
}

// Moves the storyboard's single confirmation off this batch. `createdAt` is
// deliberately untouched: the batch keeps its place in the history ordering.
// The removed `resetTestGenerationBatch` overwrote it, which is what made an
// older batch look newer than the samples that replaced it.
export function unconfirmTestGenerationBatch(
  batch: TestGenerationBatch,
): TestGenerationBatch {
  return {
    ...batch,
    status: "pending",
    confirmedGenerationRequestId: null,
    completedAt: null,
  };
}

export function assertAdjustmentsValid(ids: TestAdjustmentId[]): void {
  if (ids.length > MAX_ADJUSTMENTS_PER_VARIANT) {
    throw new Error(
      `At most ${MAX_ADJUSTMENTS_PER_VARIANT} adjustments may be applied per variant.`,
    );
  }

  const seen = new Set<string>();

  for (const id of ids) {
    if (!isTestAdjustmentId(id)) {
      throw new Error(`Unknown adjustment id: ${String(id)}.`);
    }

    if (seen.has(id)) {
      throw new Error(`Duplicate adjustment id: ${id}.`);
    }

    seen.add(id);
  }
}

export function appendAdjustmentsToCommonPrompt(
  commonPrompt: string,
  ids: TestAdjustmentId[],
  suffixesById: Record<TestAdjustmentId, string>,
): string {
  let result = commonPrompt;

  for (const id of ids) {
    const suffix = suffixesById[id];

    if (!suffix) {
      continue;
    }

    const trimmedSuffix = suffix.trim();

    if (!trimmedSuffix) {
      continue;
    }

    if (result.includes(trimmedSuffix)) {
      continue;
    }

    result =
      result.trim().length === 0
        ? trimmedSuffix
        : `${result.trim()} ${trimmedSuffix}`;
  }

  return result;
}

export function composeCommonPrompt(input: {
  tone: string;
  stylePresetName: string | null;
  stylePresetPrompt: string | null;
}): string {
  const tone = input.tone.trim();
  const styleName = (input.stylePresetName ?? "").trim();
  const stylePrompt = (input.stylePresetPrompt ?? "").trim();

  const clauses: string[] = [];

  if (tone) {
    clauses.push(`Overall emotional tone: ${tone}.`);
  }

  if (styleName && stylePrompt) {
    clauses.push(`Visual style: ${styleName} — ${stylePrompt}.`);
  } else if (styleName) {
    clauses.push(`Visual style: ${styleName}.`);
  } else if (stylePrompt) {
    clauses.push(`Visual style: ${stylePrompt}.`);
  }

  clauses.push("Keep this tone and style consistent across every scene.");

  return clauses.join(" ");
}
