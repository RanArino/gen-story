import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  ObjectStoragePort,
  StoryboardExportData,
} from "@gen-story/application";

type ExportedAsset = {
  storageKey: string;
  relativePath: string;
};

export type LocalStoryboardAssetExportResult = {
  exportPath: string;
  manifestPath: string;
};

export type AssetSelection = "both" | "original_only" | "generated_only";

export async function exportStoryboardAssetBundle(input: {
  storyboard: StoryboardExportData;
  objectStorage: ObjectStoragePort;
  assetSelection: AssetSelection;
  exportRoot?: string;
}): Promise<LocalStoryboardAssetExportResult> {
  const exportRoot = resolve(
    input.exportRoot ?? resolve(process.cwd(), "../../data/exports"),
  );
  const exportPath = resolve(
    exportRoot,
    `storyboard-${input.storyboard.storyboardId}-${Date.now()}`,
  );
  const assetsPath = resolve(exportPath, "assets");
  await mkdir(assetsPath, { recursive: true });

  const scenes = await Promise.all(
    input.storyboard.scenes.map(async (scene) => {
      const sourcePhoto =
        input.assetSelection === "generated_only"
          ? null
          : await writeAsset({
              objectStorage: input.objectStorage,
              storageKey: scene.sourcePhotoStorageKey,
              mimeType: scene.sourcePhotoMimeType,
              destinationPath: assetsPath,
              filename: `scene-${scene.orderIndex + 1}-source`,
            });
      const adoptedImage =
        input.assetSelection === "original_only"
          ? null
          : await writeAsset({
              objectStorage: input.objectStorage,
              storageKey: scene.adoptedImageStorageKey,
              mimeType: scene.adoptedImageMimeType,
              destinationPath: assetsPath,
              filename: `scene-${scene.orderIndex + 1}-generated`,
            });

      return {
        ...scene,
        sourcePhotoPath: sourcePhoto?.relativePath ?? null,
        adoptedImagePath: adoptedImage?.relativePath ?? null,
      };
    }),
  );

  const manifestPath = resolve(exportPath, "storyboard.json");
  await writeFile(
    manifestPath,
    JSON.stringify({ ...input.storyboard, scenes }, null, 2),
  );

  return { exportPath, manifestPath };
}

async function writeAsset(input: {
  objectStorage: ObjectStoragePort;
  storageKey: string | null;
  mimeType: string | null;
  destinationPath: string;
  filename: string;
}): Promise<ExportedAsset | null> {
  if (input.storageKey == null) return null;

  const body = await input.objectStorage.getObject(input.storageKey);
  if (body == null) return null;

  const relativePath = `assets/${input.filename}${extensionFor(input.mimeType)}`;
  await writeFile(
    resolve(
      input.destinationPath,
      `${input.filename}${extensionFor(input.mimeType)}`,
    ),
    body,
  );
  return { storageKey: input.storageKey, relativePath };
}

function extensionFor(mimeType: string | null): string {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return ".png";
  }
}
