import type {
  ApplicationDependencies,
  ImagePreprocessingPort,
} from "@gen-story/application";

import { createAiInputImage } from "./image-metadata";
import { buildPhotoAiInputStorageKey } from "../storage/storage-keys";
import { composeImagePrompt } from "../generation/prompt-composer";

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
    >,
  ) {}

  async preprocess(input: {
    projectId: string;
    storyboardId: string;
    sceneId: string;
    inputJson: Record<string, unknown>;
    commonPromptOverride?: string;
  }): Promise<Record<string, unknown>> {
    const scene = await this.deps.scenes.findById(input.sceneId);

    if (scene == null) {
      throw new Error("Scene not found for image preprocessing.");
    }

    if (
      scene.projectId !== input.projectId ||
      scene.storyboardId !== input.storyboardId
    ) {
      throw new Error("Scene does not match preprocessing target.");
    }

    const storyboard = await this.deps.storyboards.findById(input.storyboardId);
    if (storyboard == null) {
      throw new Error("Storyboard not found for image preprocessing.");
    }

    const stylePreset = storyboard.stylePresetId
      ? await this.deps.stylePresets.findById(storyboard.stylePresetId)
      : null;

    const composedPrompt = composeImagePrompt({
      imagePrompt: scene.imagePrompt ?? "",
      emotion: scene.emotion ?? "",
      cameraDirection: scene.cameraDirection ?? "",
      lightingDirection: scene.lightingDirection ?? "",
      motionDirection: scene.motionDirection ?? "",
      tone: storyboard.tone ?? "",
      stylePresetPrompt: stylePreset?.prompt ?? null,
      commonPrompt: input.commonPromptOverride ?? storyboard.commonPrompt ?? "",
    });

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

    return {
      ...input.inputJson,
      normalizedInputImages,
      prompt: composedPrompt,
    };
  }
}
