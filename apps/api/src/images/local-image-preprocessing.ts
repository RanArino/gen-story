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

    return {
      ...input.inputJson,
      normalizedInputImages,
      prompt: composedPrompt,
      negativePrompt,
    };
  }
}
