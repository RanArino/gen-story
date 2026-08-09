import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ObjectStoragePort,
  StoryboardExportData,
} from "@gen-story/application";
import { afterEach, describe, expect, it } from "vitest";

import { exportStoryboardAssetBundle } from "./local-storyboard-asset-export";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("exportStoryboardAssetBundle", () => {
  it("writes a manifest with local asset paths and copies available assets", async () => {
    const exportRoot = await mkdtemp(join(tmpdir(), "gen-story-export-"));
    directories.push(exportRoot);
    const storage = new MemoryStorage({
      "data/uploads/source.jpg": new Uint8Array([1, 2]),
      "data/uploads/generated.png": new Uint8Array([3, 4]),
    });

    const result = await createExport(exportRoot, storage, "both");

    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
    expect(result.exportPath).toMatch(
      /gen-story-export-.*\/storyboard-storyboard-1-/,
    );
    expect(manifest.scenes[0]).toMatchObject({
      imagePrompt: "A cinematic reunion.",
      sourcePhotoPath: "assets/scene-1-source.jpg",
      adoptedImagePath: "assets/scene-1-generated.png",
    });
    await expect(
      readFile(join(result.exportPath, "assets/scene-1-source.jpg")),
    ).resolves.toEqual(Buffer.from([1, 2]));
    await expect(
      readFile(join(result.exportPath, "assets/scene-1-generated.png")),
    ).resolves.toEqual(Buffer.from([3, 4]));
  });

  it.each([
    [
      "original_only",
      "assets/scene-1-source.jpg",
      "assets/scene-1-generated.png",
    ],
    [
      "generated_only",
      "assets/scene-1-generated.png",
      "assets/scene-1-source.jpg",
    ],
  ] as const)(
    "copies only the selected %s assets without changing the manifest shape",
    async (assetSelection, includedPath, excludedPath) => {
      const exportRoot = await mkdtemp(join(tmpdir(), "gen-story-export-"));
      directories.push(exportRoot);
      const result = await createExport(
        exportRoot,
        new MemoryStorage({
          "data/uploads/source.jpg": new Uint8Array([1, 2]),
          "data/uploads/generated.png": new Uint8Array([3, 4]),
        }),
        assetSelection,
      );

      const manifest = JSON.parse(await readFile(result.manifestPath, "utf8"));
      expect(manifest.scenes[0]).toHaveProperty("sourcePhotoPath");
      expect(manifest.scenes[0]).toHaveProperty("adoptedImagePath");
      await expect(
        readFile(join(result.exportPath, includedPath)),
      ).resolves.toBeDefined();
      await expect(
        readFile(join(result.exportPath, excludedPath)),
      ).rejects.toThrow();
    },
  );
});

function createExport(
  exportRoot: string,
  objectStorage: ObjectStoragePort,
  assetSelection: "both" | "original_only" | "generated_only",
) {
  return exportStoryboardAssetBundle({
    exportRoot,
    objectStorage,
    assetSelection,
    storyboard: storyboardExportData(),
  });
}

class MemoryStorage implements ObjectStoragePort {
  constructor(private readonly objects: Record<string, Uint8Array>) {}

  async putObject(): Promise<void> {}
  async getObject(key: string): Promise<Uint8Array | null> {
    return this.objects[key] ?? null;
  }
  async deleteObject(): Promise<void> {}
}

function storyboardExportData(): StoryboardExportData {
  return {
    storyboardId: "storyboard-1",
    projectId: "project-1",
    tone: "warm",
    stylePresetName: "Film Photo",
    exportedAt: "2026-08-09T00:00:00.000Z",
    language: "en",
    scenes: [
      {
        id: "scene-1",
        orderIndex: 0,
        title: "Arrival",
        description: "They arrive together.",
        imagePrompt: "A cinematic reunion.",
        emotion: "joy",
        cameraDirection: "wide shot",
        lightingDirection: "golden hour",
        motionDirection: "walking",
        notes: "",
        sourcePhotoStorageKey: "data/uploads/source.jpg",
        sourcePhotoMimeType: "image/jpeg",
        adoptedImageStorageKey: "data/uploads/generated.png",
        adoptedImageMimeType: "image/png",
      },
    ],
  };
}
