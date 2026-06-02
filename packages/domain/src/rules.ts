import {
  type GeneratedImage,
  type GenerationRequest,
  type GenerationRequestStatus,
  type PhotoAsset,
  type PhotoUsage,
  type Scene,
  type ScenePhotoAsset,
  type StylePreset,
  type TestGenerationBatch,
  type TestGenerationBatchStatus,
  type Timestamp,
} from "./model";

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

export function canStartTestGeneration(
  existingBatch: TestGenerationBatch | null,
): boolean {
  if (existingBatch === null) return true;
  if (existingBatch.status === "completed") return true;
  return false;
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

export function resetTestGenerationBatch(
  batch: TestGenerationBatch,
  createdAt: Timestamp,
): TestGenerationBatch {
  return {
    ...batch,
    status: "pending",
    confirmedGenerationRequestId: null,
    completedAt: null,
    createdAt,
  };
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
