import { describe, expect, it } from "vitest";

import type { ObjectStoragePort } from "@gen-story/application";
import {
  createPhotoAsset,
  createProject,
  createStoryboard,
  createStylePreset,
  createTemplateScene,
} from "@gen-story/domain";

import { CodexSceneFillGenerationAdapter } from "./codex-scene-fill-generation";

class MemoryObjectStorage implements ObjectStoragePort {
  constructor(private readonly body: Uint8Array | null) {}
  async putObject(): Promise<void> {}
  async getObject(): Promise<Uint8Array | null> {
    return this.body;
  }
  async deleteObject(): Promise<void> {}
}

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

const now = "2026-05-02T00:00:00.000Z";

function createInput() {
  const project = createProject({
    id: "project_1",
    organizationId: "org_1",
    ownerUserId: "user_1",
    name: "Family Story",
    createdAt: now,
    updatedAt: now,
  });
  const storyboard = createStoryboard({
    id: "storyboard_1",
    projectId: "project_1",
    tone: "nostalgic",
    stylePresetId: "style_1",
    createdAt: now,
    updatedAt: now,
  });
  const primaryPhoto = createPhotoAsset({
    id: "photo_1",
    projectId: "project_1",
    name: "summer picnic.jpg",
    storageKey: "photos/summer-picnic.jpg",
    mimeType: "image/jpeg",
    size: onePixelPng.byteLength,
    checksum: "checksum_1",
    sourceKind: "upload",
    notes: "grandparents smiling under the trees",
    createdAt: now,
    updatedAt: now,
  });
  const scene = createTemplateScene({
    id: "scene_1",
    projectId: "project_1",
    storyboardId: "storyboard_1",
    orderIndex: 1,
    photoAssetId: "photo_1",
    createdAt: now,
    updatedAt: now,
  });
  const stylePreset = createStylePreset({
    id: "style_1",
    scope: "system",
    name: "Watercolor",
    description: "Soft illustrated look",
    prompt: "soft paper texture and gentle color washes",
    createdAt: now,
    updatedAt: now,
  });

  return {
    project,
    storyboard,
    scene,
    primaryPhoto,
    stylePreset,
    referencePhotos: [],
    siblingScenes: [scene],
    photoAnalysis: null,
    language: "en" as const,
  };
}

const validSceneFillJson = JSON.stringify({
  title: "Picnic under the trees",
  description: "A quiet family picnic.",
  imagePrompt: "A soft, sunlit picnic scene.",
  emotion: "Joy",
  cameraDirection: "Wide",
  lightingDirection: "Soft",
  motionDirection: "Still",
});

describe("CodexSceneFillGenerationAdapter", () => {
  it("maps validated Codex JSON into a scene fill suggestion", async () => {
    const adapter = new CodexSceneFillGenerationAdapter(
      new MemoryObjectStorage(onePixelPng),
      async (_request, parse) => parse(validSceneFillJson, "codex-test"),
    );

    const result = await adapter.generateSceneFill(createInput());

    expect(result.title).toBe("Picnic under the trees");
  });

  it("sends the primary photo as an image and grounds the prompt in it", async () => {
    let capturedPrompt = "";
    let capturedImageCount = -1;
    const adapter = new CodexSceneFillGenerationAdapter(
      new MemoryObjectStorage(onePixelPng),
      async (request, parse) => {
        capturedPrompt = request.prompt;
        capturedImageCount = request.images?.length ?? 0;
        return parse(validSceneFillJson, "codex-test");
      },
    );

    await adapter.generateSceneFill(createInput());

    expect(capturedImageCount).toBe(1);
    expect(capturedPrompt).toContain("grandparents smiling under the trees");
    expect(capturedPrompt).toContain("nostalgic");
    expect(capturedPrompt).toContain("Watercolor");
  });

  it("rejects malformed Codex JSON", async () => {
    const adapter = new CodexSceneFillGenerationAdapter(
      new MemoryObjectStorage(onePixelPng),
      async (_request, parse) => parse(JSON.stringify({ title: "" }), "x"),
    );

    await expect(adapter.generateSceneFill(createInput())).rejects.toThrow();
  });
});
