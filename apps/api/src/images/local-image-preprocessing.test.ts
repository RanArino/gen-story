import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { createGenerationRequestUseCase } from "@gen-story/application";
import {
  createOrganization,
  createPhotoAsset,
  createProject,
  createScene,
  createStoryboard,
  createUser,
} from "@gen-story/domain";

import { LocalObjectStorage } from "../storage/local-object-storage";
import { buildPhotoAiInputStorageKey } from "../storage/storage-keys";
import { createInMemoryApplicationDependencies } from "../test-support/in-memory-application";
import { LocalImagePreprocessingAdapter } from "./local-image-preprocessing";

const now = "2026-05-02T00:00:00.000Z";

describe("LocalImagePreprocessingAdapter", () => {
  it("adds normalized input image metadata when generation requests are created", async () => {
    const directory = mkdtempSync(join(tmpdir(), "gen-story-preprocess-"));
    const storage = new LocalObjectStorage(directory);
    const originalBody = await sharp({
      create: {
        width: 2400,
        height: 1200,
        channels: 3,
        background: "#f8d8b8",
      },
    })
      .jpeg()
      .toBuffer();
    const originalStorageKey =
      "data/uploads/originals/projects/project_1/photo_1.jpg";
    const aiInputStorageKey = buildPhotoAiInputStorageKey({
      projectId: "project_1",
      photoAssetId: "photo_1",
    });

    try {
      await storage.putObject({
        key: originalStorageKey,
        body: originalBody,
        contentType: "image/jpeg",
      });

      const deps = createInMemoryApplicationDependencies(
        {
          users: [
            createUser({
              id: "user_1",
              organizationId: "organization_1",
              displayName: "Test User",
              createdAt: now,
              updatedAt: now,
            }),
          ],
          organizations: [
            createOrganization({
              id: "organization_1",
              name: "Test Organization",
              createdAt: now,
              updatedAt: now,
            }),
          ],
          projects: [
            createProject({
              id: "project_1",
              organizationId: "organization_1",
              ownerUserId: "user_1",
              name: "Family Story",
              createdAt: now,
              updatedAt: now,
            }),
          ],
          storyboards: [
            createStoryboard({
              id: "storyboard_1",
              projectId: "project_1",
              tone: "warm",
              createdAt: now,
              updatedAt: now,
            }),
          ],
          photoAssets: [
            createPhotoAsset({
              id: "photo_1",
              projectId: "project_1",
              name: "family.jpg",
              storageKey: originalStorageKey,
              mimeType: "image/jpeg",
              size: originalBody.byteLength,
              width: 2400,
              height: 1200,
              checksum: "original-checksum",
              sourceKind: "upload",
              createdAt: now,
              updatedAt: now,
            }),
          ],
          scenes: [
            createScene({
              id: "scene_1",
              projectId: "project_1",
              storyboardId: "storyboard_1",
              orderIndex: 0,
              title: "Scene 1",
              description: "A quiet memory.",
              imagePrompt: "Create a warm family scene.",
              emotion: "warm",
              cameraDirection: "medium shot",
              lightingDirection: "soft light",
              motionDirection: "still",
              photoAssets: [{ photoAssetId: "photo_1", role: "primary" }],
              createdAt: now,
              updatedAt: now,
            }),
          ],
        },
        { objectStorage: storage },
      );

      deps.imagePreprocessing = new LocalImagePreprocessingAdapter(deps);

      const result = await createGenerationRequestUseCase(deps, {
        generationRequestId: "request_1",
        projectId: "project_1",
        storyboardId: "storyboard_1",
        sceneId: "scene_1",
        inputJson: { prompt: "scene prompt" },
      });

      expect(result.ok).toBe(true);

      const generationRequest =
        await deps.generationRequests.findById("request_1");
      const normalizedInputImages = generationRequest?.inputJson
        .normalizedInputImages as Array<Record<string, unknown>>;

      expect(normalizedInputImages).toHaveLength(1);
      expect(normalizedInputImages[0]).toMatchObject({
        photoAssetId: "photo_1",
        role: "primary",
        storageKey: aiInputStorageKey,
        mimeType: "image/jpeg",
        preset: "ai-input",
      });
      expect(JSON.stringify(generationRequest?.inputJson)).not.toContain(
        directory,
      );

      const aiInputBody = await storage.getObject(aiInputStorageKey);

      expect(aiInputBody).not.toBeNull();

      const aiInputMetadata = await sharp(aiInputBody ?? undefined).metadata();

      expect(aiInputMetadata.format).toBe("jpeg");
      expect(aiInputMetadata.width).toBe(1536);
      expect(aiInputMetadata.height).toBeLessThanOrEqual(1536);
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
