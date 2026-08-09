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
  appendAdjustmentsToCommonPrompt,
  assertAdjustmentsValid,
  canStartTestGeneration,
  completeTestGenerationBatch,
  composeCommonPrompt,
  computeStoryboardSetupStep,
  createTestGenerationBatch,
  isVisibleInSceneHistory,
  replaceScenePhotoAssets,
  retryGenerationRequest,
  setSceneAdoptedGeneratedImage,
  sortScenesByOrderIndex,
  transitionGenerationRequestStatus,
  unconfirmTestGenerationBatch,
  updatePhotoUsage,
  updateStylePreset,
} from "./index";
import type { TestAdjustmentId } from "./index";

const FAKE_SUFFIXES: Record<TestAdjustmentId, string> = {
  warmer: "warmer color temperature, amber tones",
  cooler: "cooler color temperature, blue tones",
  more_cinematic: "stronger cinematic grade",
  darker: "lower-key lighting",
  brighter: "higher-key lighting",
  more_candid: "candid documentary feel",
};

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

  it("composes a common prompt from tone and style preset", () => {
    const prompt = composeCommonPrompt({
      tone: "Tender and reflective",
      stylePresetName: "Cinematic",
      stylePresetPrompt: "photorealistic cinematic film still",
    });

    expect(prompt).toContain("Tender and reflective");
    expect(prompt).toContain("Cinematic");
    expect(prompt).toContain("photorealistic cinematic film still");
    expect(prompt).toContain("consistent across every scene");
  });

  it("composes a tone-only common prompt when no style preset is given", () => {
    const prompt = composeCommonPrompt({
      tone: "Joyful",
      stylePresetName: null,
      stylePresetPrompt: null,
    });

    expect(prompt).toContain("Joyful");
    expect(prompt).not.toContain("Visual style:");
  });

  it("composes the common prompt deterministically", () => {
    const input = {
      tone: "Calm",
      stylePresetName: "Watercolor",
      stylePresetPrompt: "soft watercolor illustration",
    };

    expect(composeCommonPrompt(input)).toBe(composeCommonPrompt(input));
  });
});

describe("assertAdjustmentsValid", () => {
  it("accepts an empty list", () => {
    expect(() => assertAdjustmentsValid([])).not.toThrow();
  });

  it("accepts up to 3 unique adjustments", () => {
    expect(() =>
      assertAdjustmentsValid(["warmer", "more_cinematic", "darker"]),
    ).not.toThrow();
  });

  it("rejects more than 3 adjustments", () => {
    expect(() =>
      assertAdjustmentsValid(["warmer", "cooler", "more_cinematic", "darker"]),
    ).toThrow(/At most 3 adjustments/);
  });

  it("rejects duplicate adjustments", () => {
    expect(() => assertAdjustmentsValid(["warmer", "warmer"])).toThrow(
      /Duplicate adjustment/,
    );
  });

  it("rejects unknown ids", () => {
    expect(() =>
      assertAdjustmentsValid(["not_a_real_id" as TestAdjustmentId]),
    ).toThrow(/Unknown adjustment/);
  });
});

describe("appendAdjustmentsToCommonPrompt", () => {
  it("returns the original prompt when no adjustments are given", () => {
    expect(
      appendAdjustmentsToCommonPrompt("base prompt", [], FAKE_SUFFIXES),
    ).toBe("base prompt");
  });

  it("appends a suffix to the common prompt", () => {
    expect(
      appendAdjustmentsToCommonPrompt(
        "base prompt.",
        ["warmer"],
        FAKE_SUFFIXES,
      ),
    ).toBe("base prompt. warmer color temperature, amber tones");
  });

  it("appends multiple suffixes in order", () => {
    expect(
      appendAdjustmentsToCommonPrompt(
        "base.",
        ["warmer", "more_cinematic"],
        FAKE_SUFFIXES,
      ),
    ).toBe(
      "base. warmer color temperature, amber tones stronger cinematic grade",
    );
  });

  it("de-duplicates suffixes already present in the prompt", () => {
    const once = appendAdjustmentsToCommonPrompt(
      "base.",
      ["warmer"],
      FAKE_SUFFIXES,
    );
    const twice = appendAdjustmentsToCommonPrompt(
      once,
      ["warmer"],
      FAKE_SUFFIXES,
    );
    expect(twice).toBe(once);
  });

  it("handles an empty base common prompt", () => {
    expect(appendAdjustmentsToCommonPrompt("", ["cooler"], FAKE_SUFFIXES)).toBe(
      "cooler color temperature, blue tones",
    );
  });
});

describe("computeStoryboardSetupStep", () => {
  function storyboardWith(
    overrides: Partial<{
      tone: string;
      stylePresetId: string | null;
      story: string;
      commonPrompt: string;
    }> = {},
  ) {
    return {
      tone: "warm_nostalgia",
      stylePresetId: "style_1",
      story: "A warm family story told across one summer.",
      commonPrompt: "Warm grain, soft highlights, muted color.",
      ...overrides,
    };
  }

  function writtenScene(overrides: Partial<Record<string, string>> = {}) {
    return {
      title: "Arrival",
      description: "The family gathers on the porch.",
      imagePrompt: "A warm porch gathering at golden hour.",
      emotion: "Nostalgia",
      cameraDirection: "Medium",
      lightingDirection: "Golden hour",
      motionDirection: "Static",
      ...overrides,
    };
  }

  it("asks for photos when the project has no analyzable photo", () => {
    expect(
      computeStoryboardSetupStep({
        analyzablePhotoCount: 0,
        storyboard: storyboardWith(),
        scenes: [writtenScene()],
      }),
    ).toBe("photos");
  });

  it("asks for a tone when the tone is blank", () => {
    expect(
      computeStoryboardSetupStep({
        analyzablePhotoCount: 3,
        storyboard: storyboardWith({ tone: "" }),
        scenes: [writtenScene()],
      }),
    ).toBe("tone");
  });

  it("asks for a style when no style preset is chosen", () => {
    expect(
      computeStoryboardSetupStep({
        analyzablePhotoCount: 3,
        storyboard: storyboardWith({ stylePresetId: null }),
        scenes: [writtenScene()],
      }),
    ).toBe("style");
  });

  it("asks for the story when either the story or the common prompt is blank", () => {
    expect(
      computeStoryboardSetupStep({
        analyzablePhotoCount: 3,
        storyboard: storyboardWith({ story: "" }),
        scenes: [writtenScene()],
      }),
    ).toBe("story");

    expect(
      computeStoryboardSetupStep({
        analyzablePhotoCount: 3,
        storyboard: storyboardWith({ commonPrompt: "  " }),
        scenes: [writtenScene()],
      }),
    ).toBe("story");
  });

  it("asks for scenes when there are none, or when one still has a blank field", () => {
    expect(
      computeStoryboardSetupStep({
        analyzablePhotoCount: 3,
        storyboard: storyboardWith(),
        scenes: [],
      }),
    ).toBe("scenes");

    expect(
      computeStoryboardSetupStep({
        analyzablePhotoCount: 3,
        storyboard: storyboardWith(),
        scenes: [writtenScene(), writtenScene({ imagePrompt: "" })],
      }),
    ).toBe("scenes");
  });

  // The placeholder text the web used to write into free-text fields is not
  // real content, so a scene carrying it is still unwritten.
  it("treats legacy placeholder text as a blank free-text field", () => {
    expect(
      computeStoryboardSetupStep({
        analyzablePhotoCount: 3,
        storyboard: storyboardWith(),
        scenes: [writtenScene({ title: "Untitled" })],
      }),
    ).toBe("scenes");

    expect(
      computeStoryboardSetupStep({
        analyzablePhotoCount: 3,
        storyboard: storyboardWith(),
        scenes: [writtenScene({ description: "-" })],
      }),
    ).toBe("scenes");
  });

  // "Natural" and "Slow pan" were also written as placeholders, but they are
  // the first option of their dropdown and a legitimate choice. Treating them
  // as blank would make such a scene impossible to finish.
  it("accepts legitimate dropdown values that were once used as placeholders", () => {
    expect(
      computeStoryboardSetupStep({
        analyzablePhotoCount: 3,
        storyboard: storyboardWith(),
        scenes: [
          writtenScene({
            emotion: "Joy",
            cameraDirection: "Wide",
            lightingDirection: "Natural",
            motionDirection: "Slow pan",
          }),
        ],
      }),
    ).toBe("complete");
  });

  it("reports complete once every step is satisfied", () => {
    expect(
      computeStoryboardSetupStep({
        analyzablePhotoCount: 3,
        storyboard: storyboardWith(),
        scenes: [writtenScene(), writtenScene()],
      }),
    ).toBe("complete");
  });
});

describe("test generation batch rules", () => {
  const batchAt = (createdAt: string) =>
    createTestGenerationBatch({
      id: "batch_1",
      storyboardId: "sb_1",
      status: "pending",
      createdAt,
    });

  // The removed `resetTestGenerationBatch` overwrote createdAt, which pushed an
  // older batch to the front of a newest-first history.
  it("keeps createdAt when a batch loses its confirmation", () => {
    const confirmed = completeTestGenerationBatch(
      batchAt("2026-07-01T00:00:00.000Z"),
      "variant_1",
      "2026-07-02T00:00:00.000Z",
    );

    const unconfirmed = unconfirmTestGenerationBatch(confirmed);

    expect(unconfirmed.createdAt).toBe("2026-07-01T00:00:00.000Z");
    expect(unconfirmed.status).toBe("pending");
    expect(unconfirmed.confirmedGenerationRequestId).toBeNull();
    expect(unconfirmed.completedAt).toBeNull();
  });

  it("allows a first batch and one after a confirmed batch", () => {
    expect(canStartTestGeneration(null)).toBe(true);
    expect(
      canStartTestGeneration(
        completeTestGenerationBatch(
          batchAt("2026-07-01T00:00:00.000Z"),
          "variant_1",
          "2026-07-02T00:00:00.000Z",
        ),
        ["succeeded", "succeeded", "succeeded"],
      ),
    ).toBe(true);
  });

  // Without this, a batch whose samples all failed would need the reset that
  // this change removes, leaving the operator with no way forward.
  it("allows a new batch when a pending batch has no work left in flight", () => {
    expect(
      canStartTestGeneration(batchAt("2026-07-01T00:00:00.000Z"), [
        "failed",
        "failed",
        "failed",
      ]),
    ).toBe(true);
  });

  it("refuses a new batch while a sample is still queued or running", () => {
    expect(
      canStartTestGeneration(batchAt("2026-07-01T00:00:00.000Z"), [
        "succeeded",
        "running",
        "failed",
      ]),
    ).toBe(false);
    expect(
      canStartTestGeneration(batchAt("2026-07-01T00:00:00.000Z"), [
        "queued",
        "queued",
        "queued",
      ]),
    ).toBe(false);
  });

  // Samples are generated from the storyboard's first scene, so all three of
  // them used to show up in that scene's history beside its real generations.
  it("keeps only the confirmed sample in a scene's history", () => {
    const confirmed = new Set(["variant_2"]);

    expect(
      isVisibleInSceneHistory(
        { id: "req_1", testGenerationBatchId: null },
        confirmed,
      ),
    ).toBe(true);
    expect(
      isVisibleInSceneHistory(
        { id: "variant_2", testGenerationBatchId: "batch_1" },
        confirmed,
      ),
    ).toBe(true);
    expect(
      isVisibleInSceneHistory(
        { id: "variant_1", testGenerationBatchId: "batch_1" },
        confirmed,
      ),
    ).toBe(false);
    expect(
      isVisibleInSceneHistory(
        { id: "variant_3", testGenerationBatchId: "batch_1" },
        confirmed,
      ),
    ).toBe(false);
  });

  // A batch nobody confirmed contributes nothing to the scene: those samples
  // are only meaningful inside the test-generation dialog.
  it("hides every sample of a batch that was never confirmed", () => {
    expect(
      isVisibleInSceneHistory(
        { id: "variant_1", testGenerationBatchId: "batch_1" },
        new Set<string>(),
      ),
    ).toBe(false);
  });
});
