import { describe, expect, it } from "vitest";

import {
  createGeneratedImage,
  createGenerationRequest,
  createPhotoAsset,
  createScene,
  createStylePreset,
  createStoryboard,
} from "./index";
import {
  replaceScenePhotoAssets,
  retryGenerationRequest,
  setSceneAdoptedGeneratedImage,
  sortScenesByOrderIndex,
  transitionGenerationRequestStatus,
  updatePhotoUsage,
  updateStylePreset,
} from "./index";

describe("domain rules", () => {
  it("sorts scenes by order index with a deterministic tiebreaker", () => {
    const scenes = [
      createScene({
        id: "scene_b",
        projectId: "project_1",
        storyboardId: "storyboard_1",
        orderIndex: 1,
        title: "Second",
        description: "desc",
        imagePrompt: "prompt",
        emotion: "warm",
        cameraDirection: "wide",
        lightingDirection: "soft",
        motionDirection: "still",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      }),
      createScene({
        id: "scene_a",
        projectId: "project_1",
        storyboardId: "storyboard_1",
        orderIndex: 1,
        title: "First",
        description: "desc",
        imagePrompt: "prompt",
        emotion: "warm",
        cameraDirection: "wide",
        lightingDirection: "soft",
        motionDirection: "still",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      }),
      createScene({
        id: "scene_c",
        projectId: "project_1",
        storyboardId: "storyboard_1",
        orderIndex: 0,
        title: "Prelude",
        description: "desc",
        imagePrompt: "prompt",
        emotion: "warm",
        cameraDirection: "wide",
        lightingDirection: "soft",
        motionDirection: "still",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      }),
    ];

    expect(sortScenesByOrderIndex(scenes).map((scene) => scene.id)).toEqual([
      "scene_c",
      "scene_a",
      "scene_b",
    ]);
  });

  it("updates photo usage independently of scene assignments", () => {
    const photoAsset = createPhotoAsset({
      id: "photo_1",
      projectId: "project_1",
      name: "Photo",
      storageKey: "storage/photo_1.jpg",
      mimeType: "image/jpeg",
      size: 1,
      checksum: "checksum",
      sourceKind: "upload",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });

    expect(
      updatePhotoUsage(photoAsset, "reference", "2026-05-02T01:00:00.000Z"),
    ).toMatchObject({
      usage: "reference",
      updatedAt: "2026-05-02T01:00:00.000Z",
    });
  });

  it("rejects more than one primary photo in a scene", () => {
    const scene = createScene({
      id: "scene_1",
      projectId: "project_1",
      storyboardId: "storyboard_1",
      orderIndex: 0,
      title: "Scene",
      description: "desc",
      imagePrompt: "prompt",
      emotion: "warm",
      cameraDirection: "wide",
      lightingDirection: "soft",
      motionDirection: "still",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });

    expect(() =>
      replaceScenePhotoAssets(
        scene,
        [
          { photoAssetId: "photo_1", role: "primary" },
          { photoAssetId: "photo_2", role: "primary" },
        ],
        "2026-05-02T01:00:00.000Z",
      ),
    ).toThrow("A scene can have at most one primary photo.");
  });

  it("adopts one generated image at a time for a scene", () => {
    const scene = createScene({
      id: "scene_1",
      projectId: "project_1",
      storyboardId: "storyboard_1",
      orderIndex: 0,
      title: "Scene",
      description: "desc",
      imagePrompt: "prompt",
      emotion: "warm",
      cameraDirection: "wide",
      lightingDirection: "soft",
      motionDirection: "still",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    const images = [
      createGeneratedImage({
        id: "image_1",
        projectId: "project_1",
        storyboardId: "storyboard_1",
        sceneId: "scene_1",
        generationRequestId: "request_1",
        storageKey: "storage/image_1.jpg",
        mimeType: "image/jpeg",
        size: 1,
        checksum: "checksum_1",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      }),
      createGeneratedImage({
        id: "image_2",
        projectId: "project_1",
        storyboardId: "storyboard_1",
        sceneId: "scene_1",
        generationRequestId: "request_2",
        storageKey: "storage/image_2.jpg",
        mimeType: "image/jpeg",
        size: 1,
        checksum: "checksum_2",
        adoptedAt: "2026-05-02T00:30:00.000Z",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:30:00.000Z",
      }),
    ];

    const result = setSceneAdoptedGeneratedImage(
      scene,
      images,
      "image_1",
      "2026-05-02T01:00:00.000Z",
      "2026-05-02T01:00:00.000Z",
    );

    expect(result.scene.adoptedGeneratedImageId).toBe("image_1");
    expect(
      result.generatedImages.map((generatedImage) => ({
        id: generatedImage.id,
        adoptedAt: generatedImage.adoptedAt,
      })),
    ).toEqual([
      { id: "image_1", adoptedAt: "2026-05-02T01:00:00.000Z" },
      { id: "image_2", adoptedAt: null },
    ]);
  });

  it("permits valid generation request transitions and rejects invalid ones", () => {
    const request = createGenerationRequest({
      id: "request_1",
      projectId: "project_1",
      storyboardId: "storyboard_1",
      sceneId: "scene_1",
      inputJson: { prompt: "prompt" },
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });

    const runningRequest = transitionGenerationRequestStatus(
      request,
      "running",
      "2026-05-02T01:00:00.000Z",
    );
    const failedRequest = transitionGenerationRequestStatus(
      {
        ...runningRequest,
        status: "running",
      },
      "failed",
      "2026-05-02T02:00:00.000Z",
      "OpenAI timed out",
    );

    expect(runningRequest.status).toBe("running");
    expect(failedRequest.status).toBe("failed");
    expect(failedRequest.errorMessage).toBe("OpenAI timed out");
    expect(() =>
      transitionGenerationRequestStatus(
        {
          ...request,
          status: "succeeded",
        },
        "running",
        "2026-05-02T01:00:00.000Z",
      ),
    ).toThrow(
      "Cannot transition generation request from succeeded to running.",
    );
  });

  it("blocks direct edits to system style presets", () => {
    const stylePreset = createStylePreset({
      id: "style_1",
      scope: "system",
      name: "Cinematic",
      prompt: "filmic",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });

    expect(() =>
      updateStylePreset(
        stylePreset,
        { name: "Updated" },
        "2026-05-02T01:00:00.000Z",
      ),
    ).toThrow("System style presets cannot be edited directly.");
  });

  it("creates a retry request from a failed generation request", () => {
    const failedRequest = createGenerationRequest({
      id: "request_1",
      projectId: "project_1",
      storyboardId: "storyboard_1",
      sceneId: "scene_1",
      inputJson: { prompt: "prompt" },
      status: "failed",
      errorMessage: "timed out",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:30:00.000Z",
    });

    const retryRequest = retryGenerationRequest(
      failedRequest,
      "request_2",
      "2026-05-02T01:00:00.000Z",
      "2026-05-02T01:00:00.000Z",
    );

    expect(retryRequest).toMatchObject({
      id: "request_2",
      status: "queued",
      sourceGenerationRequestId: "request_1",
      errorMessage: null,
      inputJson: { prompt: "prompt" },
    });
  });

  it("keeps storyboard state independent from request failure", () => {
    const storyboard = createStoryboard({
      id: "storyboard_1",
      projectId: "project_1",
      tone: "Reflective",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });

    const request = createGenerationRequest({
      id: "request_1",
      projectId: "project_1",
      storyboardId: "storyboard_1",
      sceneId: "scene_1",
      inputJson: { prompt: "prompt" },
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    const failedRequest = transitionGenerationRequestStatus(
      {
        ...request,
        status: "running",
      },
      "failed",
      "2026-05-02T01:00:00.000Z",
      "timed out",
    );

    expect(failedRequest.status).toBe("failed");
    expect(storyboard.status).toBe("draft");
  });
});
