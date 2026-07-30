import { describe, expect, it } from "vitest";
import {
  createPhotoAsset,
  createProject,
  createStoryboard,
  createStylePreset,
  createTemplateScene,
} from "@gen-story/domain";

import { LocalSceneFillGenerationAdapter } from "./local-scene-fill-generation";

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
    size: 1,
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

describe("LocalSceneFillGenerationAdapter", () => {
  it("returns deterministic non-empty suggestions", async () => {
    const adapter = new LocalSceneFillGenerationAdapter();
    const input = createInput();

    const first = await adapter.generateSceneFill(input);
    const second = await adapter.generateSceneFill(input);

    expect(first).toEqual(second);
    expect(Object.values(first).every((value) => value.trim().length > 0)).toBe(
      true,
    );
  });

  it("uses photo notes and storyboard tone in the generated text", async () => {
    const adapter = new LocalSceneFillGenerationAdapter();

    const suggestion = await adapter.generateSceneFill(createInput());

    expect(suggestion.description).toContain(
      "grandparents smiling under the trees",
    );
    expect(suggestion.description).toContain("nostalgic");
    expect(suggestion.imagePrompt).toContain("Watercolor");
  });
});
