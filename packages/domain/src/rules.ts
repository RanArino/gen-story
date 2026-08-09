import {
  type CharacterPolicy,
  type GeneratedImage,
  type GenerationRequest,
  type GenerationRequestStatus,
  type PhotoAsset,
  type PhotoInsight,
  type PhotoUsage,
  type Scene,
  type SceneBridge,
  type ScenePhotoAsset,
  type Storyboard,
  type StylePreset,
  type TestAdjustmentId,
  type TestGenerationBatch,
  type Timestamp,
  isTestAdjustmentId,
} from "./model";

export const MAX_ADJUSTMENTS_PER_VARIANT = 3;

// The scene fields the AI writes, and therefore the fields whose blankness
// decides both whether a scene is eligible for AI fill and whether setup step 5
// is finished.
export const SCENE_FILL_FIELDS = [
  "title",
  "description",
  "imagePrompt",
  "emotion",
  "cameraDirection",
  "lightingDirection",
  "motionDirection",
] as const satisfies ReadonlyArray<keyof Scene>;

export type SceneFillField = (typeof SCENE_FILL_FIELDS)[number];

// The free-text fields, where the web layer's old placeholder strings are
// unambiguous filler rather than something a user could have meant.
const FREE_TEXT_SCENE_FILL_FIELDS = new Set<SceneFillField>([
  "title",
  "description",
  "imagePrompt",
]);

// Placeholder text the web layer used to write into blank scene fields so they
// would pass a since-relaxed non-empty validation. Scenes saved before that fix
// still carry these values, and treating them as real content would leave those
// scenes permanently ineligible for AI fill, so they are recognized as blank
// and recover on the next fill.
//
// Deliberately limited to the free-text fields. The old placeholders for the
// four dropdown fields were "Joy", "Wide", "Natural" and "Slow pan" — each the
// first option of its list and a perfectly legitimate choice. Treating those as
// blank would mean a scene that really is lit naturally could never finish
// setup step 5 and would be re-billed for AI fill on every pass.
const LEGACY_SCENE_TEXT_PLACEHOLDERS = new Set(["-", "untitled"]);

export function isBlankSceneField(
  field: SceneFillField,
  value: string,
): boolean {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return true;
  }

  return (
    FREE_TEXT_SCENE_FILL_FIELDS.has(field) &&
    LEGACY_SCENE_TEXT_PLACEHOLDERS.has(trimmed.toLowerCase())
  );
}

export function hasBlankSceneFields(
  scene: Pick<Scene, SceneFillField>,
): boolean {
  return SCENE_FILL_FIELDS.some((field) =>
    isBlankSceneField(field, scene[field]),
  );
}

// The five ordered setup steps, in the order they must be completed. Each step
// feeds the next: tone is chosen from what the photos show, the story is
// written against tone and style, and scene text is written against all of it.
export const STORYBOARD_SETUP_STEPS = [
  "photos",
  "tone",
  "style",
  "story",
  "scenes",
] as const;

export type StoryboardSetupStep = (typeof STORYBOARD_SETUP_STEPS)[number];

// "complete" means every step is satisfied by the data right now. It is not the
// same as `Storyboard.setupCompletedAt`, which records that the storyboard has
// been through the flow once and is permanently unlocked.
export type StoryboardSetupStatus = StoryboardSetupStep | "complete";

export type ComputeStoryboardSetupStepInput = {
  // Photos with usage `candidate` or `reference` that are not deleted — the
  // same set photo analysis runs on.
  analyzablePhotoCount: number;
  storyboard: Pick<
    Storyboard,
    "tone" | "stylePresetId" | "story" | "commonPrompt"
  >;
  scenes: ReadonlyArray<Pick<Scene, SceneFillField>>;
};

// The single definition of "which step is this storyboard on", derived from
// persisted data so the API and the web can never disagree. Returns the first
// step that is not yet satisfied.
export function computeStoryboardSetupStep(
  input: ComputeStoryboardSetupStepInput,
): StoryboardSetupStatus {
  if (input.analyzablePhotoCount === 0) {
    return "photos";
  }

  if (input.storyboard.tone.trim() === "") {
    return "tone";
  }

  if (input.storyboard.stylePresetId == null) {
    return "style";
  }

  if (
    input.storyboard.story.trim() === "" ||
    input.storyboard.commonPrompt.trim() === ""
  ) {
    return "story";
  }

  // A storyboard with no scenes has not finished step 5, even though "no scene
  // has a blank field" is vacuously true.
  if (input.scenes.length === 0 || input.scenes.some(hasBlankSceneFields)) {
    return "scenes";
  }

  return "complete";
}

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

// A conservative heuristic, not a classifier: photo analysis writes a free-text
// `people` summary per photo (e.g. "No people visible" or "A young woman
// smiling"), and this never has enough signal to know whether a person should
// become a *prominent, recurring* character — that is deliberately left to the
// user. It only ever suggests "none" (when nothing in the photo set mentions a
// person) or "background_only" (the safe default otherwise); it never suggests
// "featured", since promising a story is "about" a character is a real
// commitment the user makes explicitly, not something to infer from a caption.
const NO_PEOPLE_PATTERN =
  /^(no\s+(one|people|person)|none|n\/a|nobody)\b/i;

export function suggestCharacterPolicy(
  photoInsights: PhotoInsight[],
): CharacterPolicy {
  const mentionsAnyone = photoInsights.some((insight) => {
    const people = insight.people.trim();
    return people !== "" && !NO_PEOPLE_PATTERN.test(people);
  });

  return mentionsAnyone ? "background_only" : "none";
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
