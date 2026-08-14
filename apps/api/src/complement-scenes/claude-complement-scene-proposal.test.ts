import { describe, expect, it } from "vitest";

import type { ObjectStoragePort } from "@gen-story/application";
import {
  createPhotoAsset,
  createScene,
  createStoryboard,
  createProject,
} from "@gen-story/domain";

import { ClaudeComplementSceneProposalAdapter } from "./claude-complement-scene-proposal";

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

const ts = "2026-05-02T00:00:00.000Z";

function scene(id: string, orderIndex: number) {
  return createScene({
    id,
    projectId: "project_1",
    storyboardId: "storyboard_1",
    orderIndex,
    title: `Scene ${orderIndex + 1}`,
    description: "desc",
    imagePrompt: "prompt",
    emotion: "warm",
    cameraDirection: "wide",
    lightingDirection: "soft",
    motionDirection: "still",
    createdAt: ts,
    updatedAt: ts,
  });
}

function input() {
  const fromScene = scene("scene_1", 0);
  const toScene = scene("scene_2", 1);
  return {
    project: createProject({
      id: "project_1",
      organizationId: "org_1",
      ownerUserId: "user_1",
      name: "Anniversary",
      createdAt: ts,
      updatedAt: ts,
    }),
    storyboard: createStoryboard({
      id: "storyboard_1",
      projectId: "project_1",
      tone: "warm",
      createdAt: ts,
      updatedAt: ts,
    }),
    fromScene,
    toScene,
    stylePreset: null,
    projectPhotos: [
      createPhotoAsset({
        id: "photo_1",
        projectId: "project_1",
        name: "family.png",
        storageKey: "family.png",
        mimeType: "image/png",
        size: onePixelPng.byteLength,
        checksum: "checksum",
        sourceKind: "upload",
        createdAt: ts,
        updatedAt: ts,
      }),
    ],
    siblingScenes: [fromScene, toScene],
    language: "en" as const,
  };
}

const validProposalsJson = JSON.stringify({
  proposals: [
    {
      title: "Bridge moment",
      description: "A quiet transition.",
      imagePrompt: "A soft connecting shot.",
      emotion: "Calm",
      cameraDirection: "Wide",
      lightingDirection: "Natural",
      motionDirection: "Slow pan",
    },
  ],
});

describe("ClaudeComplementSceneProposalAdapter", () => {
  it("maps validated Claude JSON into complement scene proposals", async () => {
    const adapter = new ClaudeComplementSceneProposalAdapter(
      new MemoryObjectStorage(onePixelPng),
      async (_request, parse) => parse(validProposalsJson, "claude-test"),
    );

    const result = await adapter.proposeComplementScenes(input());

    expect(result).toHaveLength(1);
    expect(result[0]?.title).toBe("Bridge moment");
  });

  it("only sends non-deleted project photos as images", async () => {
    let capturedImageCount = -1;
    const adapter = new ClaudeComplementSceneProposalAdapter(
      new MemoryObjectStorage(onePixelPng),
      async (request, parse) => {
        capturedImageCount = request.images?.length ?? 0;
        return parse(validProposalsJson, "claude-test");
      },
    );
    const deletedInput = input();
    deletedInput.projectPhotos = deletedInput.projectPhotos.map((photo) => ({
      ...photo,
      deletedAt: "2026-05-03T00:00:00.000Z",
    }));

    await adapter.proposeComplementScenes(deletedInput);

    expect(capturedImageCount).toBe(0);
  });

  it("rejects malformed Claude JSON", async () => {
    const adapter = new ClaudeComplementSceneProposalAdapter(
      new MemoryObjectStorage(onePixelPng),
      async (_request, parse) => parse(JSON.stringify({ proposals: [] }), "x"),
    );

    await expect(adapter.proposeComplementScenes(input())).rejects.toThrow();
  });
});
