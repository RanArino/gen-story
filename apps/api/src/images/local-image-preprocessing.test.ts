import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { createGenerationRequestUseCase } from "@gen-story/application";
import {
  createOrganization,
  createAiJob,
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
              photoFidelity: "high",
              photoAssets: [{ photoAssetId: "photo_1", role: "primary" }],
              createdAt: now,
              updatedAt: now,
            }),
          ],
          aiJobs: [
            createAiJob({
              id: "sheet_job_1",
              projectId: "project_1",
              kind: "character_sheet_generation",
              status: "succeeded",
              inputJson: { storyboardId: "storyboard_1" },
              resultJson: {
                storageKey: "data/uploads/generated/character-sheet.png",
                mimeType: "image/png",
                size: 42,
                width: 1536,
                height: 1024,
                checksum: "sheet-checksum",
              },
              completedAt: now,
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
        inputJson: {
          promptOverride: "Draw the station sign exactly as written.",
          negativePromptOverride: "watermark",
        },
      });

      expect(result.ok).toBe(true);

      const generationRequest =
        await deps.generationRequests.findById("request_1");
      const normalizedInputImages = generationRequest?.inputJson
        .normalizedInputImages as Array<Record<string, unknown>>;

      expect(normalizedInputImages).toHaveLength(2);
      expect(normalizedInputImages[0]).toMatchObject({
        photoAssetId: "photo_1",
        role: "primary",
        storageKey: aiInputStorageKey,
        mimeType: "image/jpeg",
        preset: "ai-input",
      });
      expect(normalizedInputImages[1]).toMatchObject({
        role: "character_reference",
        storageKey: "data/uploads/generated/character-sheet.png",
        preset: "character-reference-sheet",
      });
      expect(JSON.stringify(generationRequest?.inputJson)).not.toContain(
        directory,
      );
      // The caller sent neither id, and generation adapters build their storage
      // keys from these. Without them the image lands under "unknown-project".
      expect(generationRequest?.inputJson).toMatchObject({
        projectId: "project_1",
        sceneId: "scene_1",
        // Carried through unmodified so the image-generation adapter can
        // decide generate vs. edit without a second lookup of the scene.
        photoFidelity: "high",
        prompt: "Draw the station sign exactly as written., avoid: watermark",
        negativePrompt: "watermark",
      });

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
