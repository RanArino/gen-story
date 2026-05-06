import {
  registerPhotoAsset,
  type ApplicationDependencies,
  type UseCaseResult,
} from "@gen-story/application";
import type { PhotoAsset, PhotoUsage } from "@gen-story/domain";

import {
  convertHeicToJpeg,
  createPreviewImage,
  detectSupportedImageType,
  readOriginalImageMetadata,
} from "../images/image-metadata";
import {
  buildOriginalPhotoStorageKey,
  buildPhotoPreviewStorageKey,
} from "../storage/storage-keys";

export type IngestPhotoAssetInput = {
  projectId: string;
  photoAssetId: string;
  fileName: string;
  body: Uint8Array;
  mimeTypeHint?: string;
  notes?: string | null;
  usage?: PhotoUsage;
};

export class PhotoAssetIngestionService {
  constructor(private readonly deps: ApplicationDependencies) {}

  async ingest(
    input: IngestPhotoAssetInput,
  ): Promise<UseCaseResult<PhotoAsset>> {
    const createdStorageKeys: string[] = [];

    try {
      const imageType = await detectSupportedImageType(input.body);

      let workingBody = input.body;
      let workingType = imageType;
      if (imageType.extension === "heic" || imageType.extension === "heif") {
        workingBody = await convertHeicToJpeg(input.body);
        workingType = { extension: "jpg", mimeType: "image/jpeg" };
      }

      const originalMetadata = await readOriginalImageMetadata({
        body: workingBody,
        mimeType: workingType.mimeType,
      });
      const originalStorageKey = buildOriginalPhotoStorageKey({
        projectId: input.projectId,
        photoAssetId: input.photoAssetId,
        extension: workingType.extension,
      });
      const previewStorageKey = buildPhotoPreviewStorageKey({
        projectId: input.projectId,
        photoAssetId: input.photoAssetId,
      });
      const previewImage = await createPreviewImage(workingBody);

      await this.deps.objectStorage.putObject({
        key: originalStorageKey,
        body: workingBody,
        contentType: imageType.mimeType,
      });
      createdStorageKeys.push(originalStorageKey);

      await this.deps.objectStorage.putObject({
        key: previewStorageKey,
        body: previewImage.body,
        contentType: previewImage.mimeType,
      });
      createdStorageKeys.push(previewStorageKey);

      const result = await registerPhotoAsset(this.deps, {
        photoAssetId: input.photoAssetId,
        projectId: input.projectId,
        name: input.fileName,
        storageKey: originalStorageKey,
        mimeType: originalMetadata.mimeType,
        size: originalMetadata.size,
        width: originalMetadata.width,
        height: originalMetadata.height,
        checksum: originalMetadata.checksum,
        sourceKind: "upload",
        notes: input.notes ?? null,
        usage: input.usage,
      });

      if (!result.ok) {
        await this.cleanup(createdStorageKeys);
      }

      return result;
    } catch (error) {
      await this.cleanup(createdStorageKeys);

      return {
        ok: false,
        error: {
          code: "validation_error",
          message:
            error instanceof Error ? error.message : "Photo upload failed.",
        },
      };
    }
  }

  private async cleanup(storageKeys: string[]): Promise<void> {
    await Promise.all(
      storageKeys.map((storageKey) =>
        this.deps.objectStorage.deleteObject(storageKey),
      ),
    );
  }
}
