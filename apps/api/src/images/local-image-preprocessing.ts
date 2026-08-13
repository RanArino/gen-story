import type {
  ApplicationDependencies,
  ImagePreprocessingPort,
} from "@gen-story/application";

import { createAiInputImage } from "./image-metadata";
import { buildPhotoAiInputStorageKey } from "../storage/storage-keys";
import { composeScenePrompt } from "../generation/compose-scene-prompt";

export type NormalizedInputImage = {
  photoAssetId: string;
  role: string;
  storageKey: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  checksum: string;
  preset: string;
};

export class LocalImagePreprocessingAdapter implements ImagePreprocessingPort {
  constructor(
    private readonly deps: Pick<
      ApplicationDependencies,
      | "scenes"
      | "photoAssets"
      | "objectStorage"
      | "storyboards"
      | "stylePresets"
      | "aiJobs"
    >,
  ) {}

  async preprocess(input: {
    projectId: string;
    storyboardId: string;
    sceneId: string;
    inputJson: Record<string, unknown>;
    commonPromptOverride?: string;
  }): Promise<Record<string, unknown>> {
    const {
      scene,
      prompt: composedPrompt,
      negativePrompt,
    } = await composeScenePrompt(this.deps, {
      sceneId: input.sceneId,
      overrides: { commonPrompt: input.commonPromptOverride },
    });

    if (
      scene.projectId !== input.projectId ||
      scene.storyboardId !== input.storyboardId
    ) {
      throw new Error("Scene does not match preprocessing target.");
    }

    const normalizedInputImages: NormalizedInputImage[] = [];

    for (const scenePhotoAsset of scene.photoAssets) {
      const photoAsset = await this.deps.photoAssets.findById(
        scenePhotoAsset.photoAssetId,
      );

      if (photoAsset == null) {
        throw new Error("Photo asset not found for image preprocessing.");
      }

      if (photoAsset.projectId !== input.projectId) {
        throw new Error("Photo asset does not match preprocessing project.");
      }

      const originalBody = await this.deps.objectStorage.getObject(
        photoAsset.storageKey,
      );

      if (originalBody == null) {
        throw new Error("Original photo object not found.");
      }

      const normalizedImage = await createAiInputImage(originalBody);
      const storageKey = buildPhotoAiInputStorageKey({
        projectId: input.projectId,
        photoAssetId: photoAsset.id,
      });

      await this.deps.objectStorage.putObject({
        key: storageKey,
        body: normalizedImage.body,
        contentType: normalizedImage.mimeType,
      });

      normalizedInputImages.push({
        photoAssetId: photoAsset.id,
        role: scenePhotoAsset.role,
        storageKey,
        mimeType: normalizedImage.mimeType,
        size: normalizedImage.size,
        width: normalizedImage.width,
        height: normalizedImage.height,
        checksum: normalizedImage.checksum,
        preset: normalizedImage.preset,
      });
    }

    const sheetJob = (await this.deps.aiJobs.findByProjectId(input.projectId))
      .filter(
        (job) =>
          job.kind === "character_sheet_generation" &&
          job.status === "succeeded" &&
          job.inputJson.storyboardId === input.storyboardId &&
          typeof job.resultJson?.storageKey === "string",
      )
      .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!))[0];
    if (sheetJob?.resultJson) {
      normalizedInputImages.push({
        photoAssetId: `character-sheet:${sheetJob.id}`,
        role: "character_reference",
        storageKey: String(sheetJob.resultJson.storageKey),
        mimeType: String(sheetJob.resultJson.mimeType ?? "image/png"),
        size: Number(sheetJob.resultJson.size ?? 0),
        width: Number(sheetJob.resultJson.width ?? 0),
        height: Number(sheetJob.resultJson.height ?? 0),
        checksum: String(sheetJob.resultJson.checksum ?? ""),
        preset: "character-reference-sheet",
      });
    }

    const promptOverride = readOptionalString(input.inputJson.promptOverride);
    const negativePromptOverride = readOptionalString(
      input.inputJson.negativePromptOverride,
    );

    return {
      ...input.inputJson,
      // Set after the spread on purpose: these are the validated targets, and
      // generation adapters build their storage keys from them. Leaving it to
      // the caller's inputJson meant the test-generation path, which sends only
      // a batch id, wrote to an "unknown-project" directory.
      projectId: input.projectId,
      sceneId: input.sceneId,
      normalizedInputImages,
      photoFidelity: scene.photoFidelity,
      prompt: applyNegativePromptOverride(
        promptOverride ?? composedPrompt,
        negativePromptOverride,
      ),
      negativePrompt: negativePromptOverride ?? negativePrompt,
    };
  }
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

// gpt-image accepts one prompt rather than a separate negative-prompt field.
// The composed prompt always puts its avoid clause last, so replacing it here
// lets users change the visible negative prompt without editing both fields.
function applyNegativePromptOverride(
  prompt: string,
  negativePromptOverride: string | undefined,
): string {
  if (negativePromptOverride === undefined) return prompt;

  const withoutAvoidClause = prompt.replace(/, avoid: [\s\S]*$/, "").trim();
  return negativePromptOverride.trim()
    ? `${withoutAvoidClause}, avoid: ${negativePromptOverride.trim()}`
    : withoutAvoidClause;
}
