import { describe, expect, it } from "vitest";

import {
  createGeneratedImage,
  createGenerationRequest,
  createPhotoAsset,
  createProject,
  createScene,
  createStoryboard,
  createStylePreset,
  createUser,
} from "./index";

describe("domain factories", () => {
  it("trims and validates a project name", () => {
    expect(
      createProject({
        id: "project_1",
        organizationId: "org_1",
        ownerUserId: "user_1",
        name: " Family Story ",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      }),
    ).toEqual({
      id: "project_1",
      organizationId: "org_1",
      ownerUserId: "user_1",
      name: "Family Story",
      status: "draft",
      deletedAt: null,
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
  });

  it("trims and validates a scene title", () => {
    expect(
      createScene({
        id: "scene_1",
        projectId: "project_1",
        storyboardId: "storyboard_1",
        orderIndex: 2,
        title: " The birthday dinner ",
        description: " A warm family moment ",
        imagePrompt: " A cinematic dinner scene ",
        emotion: "warmth",
        cameraDirection: "wide shot",
        lightingDirection: "golden hour",
        motionDirection: "gentle camera drift",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      }),
    ).toMatchObject({
      title: "The birthday dinner",
      description: "A warm family moment",
      imagePrompt: "A cinematic dinner scene",
      emotion: "warmth",
      cameraDirection: "wide shot",
      lightingDirection: "golden hour",
      motionDirection: "gentle camera drift",
      status: "draft",
      photoAssets: [],
      adoptedGeneratedImageId: null,
      photoFidelity: "off",
    });
  });

  it("defaults a scene's photoFidelity to off and accepts an explicit value", () => {
    const base = {
      id: "scene_1",
      projectId: "project_1",
      storyboardId: "storyboard_1",
      orderIndex: 0,
      title: "",
      description: "",
      imagePrompt: "",
      emotion: "",
      cameraDirection: "",
      lightingDirection: "",
      motionDirection: "",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    };

    expect(createScene(base).photoFidelity).toBe("off");
    expect(createScene({ ...base, photoFidelity: "high" }).photoFidelity).toBe(
      "high",
    );
  });

  it("creates a storyboard with ordered scene ids", () => {
    expect(
      createStoryboard({
        id: "storyboard_1",
        projectId: "project_1",
        tone: "Tender and reflective",
        stylePresetId: "style_1",
        sceneIds: ["scene_2", "scene_1"],
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      }),
    ).toEqual({
      id: "storyboard_1",
      projectId: "project_1",
      status: "draft",
      tone: "Tender and reflective",
      stylePresetId: "style_1",
      commonPrompt: "",
      story: "",
      negativePrompt: "",
      sceneIds: ["scene_2", "scene_1"],
      setupCompletedAt: null,
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
  });

  it("treats a missing or blank storyboard tone as undecided", () => {
    // Blank is the state the guided setup flow gates step 2 on, so it must be
    // representable rather than rejected the way a required field would be.
    expect(
      createStoryboard({
        id: "storyboard_1",
        projectId: "project_1",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      }).tone,
    ).toBe("");

    expect(
      createStoryboard({
        id: "storyboard_1",
        projectId: "project_1",
        tone: "   ",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      }).tone,
    ).toBe("");
  });

  it("trims and preserves a supplied storyboard common prompt", () => {
    const storyboard = createStoryboard({
      id: "storyboard_1",
      projectId: "project_1",
      tone: "Tender and reflective",
      commonPrompt: "  Warm nostalgic family film.  ",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });

    expect(storyboard.commonPrompt).toBe("Warm nostalgic family film.");
  });

  it("trims and preserves a supplied storyboard story", () => {
    const storyboard = createStoryboard({
      id: "storyboard_1",
      projectId: "project_1",
      tone: "Tender and reflective",
      story: "  A family returns to the seaside town where everything began.  ",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });

    expect(storyboard.story).toBe(
      "A family returns to the seaside town where everything began.",
    );
  });

  it("creates a photo asset with candidate usage by default", () => {
    expect(
      createPhotoAsset({
        id: "photo_1",
        projectId: "project_1",
        name: " Snapshot ",
        storageKey: "data/uploads/originals/projects/project_1/photo_1.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        width: 3000,
        height: 2000,
        checksum: "abc123",
        sourceKind: "upload",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      }),
    ).toMatchObject({
      name: "Snapshot",
      usage: "candidate",
    });
  });

  it("creates a style preset and preserves the scope", () => {
    expect(
      createStylePreset({
        id: "style_1",
        scope: "system",
        name: " Cinematic Live Action ",
        description: " Soft contrast ",
        prompt: " filmic, shallow depth of field ",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      }),
    ).toEqual({
      id: "style_1",
      scope: "system",
      name: "Cinematic Live Action",
      description: "Soft contrast",
      prompt: "filmic, shallow depth of field",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
  });

  it("creates a generation request in queued state", () => {
    expect(
      createGenerationRequest({
        id: "request_1",
        projectId: "project_1",
        storyboardId: "storyboard_1",
        sceneId: "scene_1",
        inputJson: { prompt: "a warm family portrait" },
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      }),
    ).toMatchObject({
      status: "queued",
      inputJson: { prompt: "a warm family portrait" },
      errorMessage: null,
      sourceGenerationRequestId: null,
    });
  });

  it("creates a generated image without adoption", () => {
    expect(
      createGeneratedImage({
        id: "image_1",
        projectId: "project_1",
        storyboardId: "storyboard_1",
        sceneId: "scene_1",
        generationRequestId: "request_1",
        storageKey:
          "data/uploads/generated/images/projects/project_1/scenes/scene_1/image_1.jpg",
        mimeType: "image/jpeg",
        size: 2048,
        width: 1024,
        height: 1024,
        checksum: "def456",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      }),
    ).toMatchObject({
      adoptedAt: null,
    });
  });

  it("creates a minimal user record", () => {
    expect(
      createUser({
        id: "user_1",
        organizationId: "org_1",
        displayName: " Ran ",
        email: "ran@example.com",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      }),
    ).toMatchObject({
      displayName: "Ran",
      email: "ran@example.com",
    });
  });
});
