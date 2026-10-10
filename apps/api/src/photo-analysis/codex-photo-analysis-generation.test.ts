import { describe, expect, it } from "vitest";

import type { ObjectStoragePort } from "@gen-story/application";
import { createPhotoAsset, createProject } from "@gen-story/domain";

import { CodexPhotoAnalysisGenerationAdapter } from "./codex-photo-analysis-generation";

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

function input() {
  return {
    project: createProject({
      id: "project_1",
      organizationId: "org_1",
      ownerUserId: "user_1",
      name: "Anniversary",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    }),
    storyboard: null,
    photos: [
      createPhotoAsset({
        id: "photo_1",
        projectId: "project_1",
        name: "family.png",
        storageKey: "family.png",
        mimeType: "image/png",
        size: onePixelPng.byteLength,
        checksum: "checksum",
        sourceKind: "upload",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      }),
    ],
    language: "en" as const,
  };
}

const validPhotoAnalysisJson = JSON.stringify({
  emotionCandidates: [
    {
      value: "warm_nostalgia",
      label: "Warm nostalgia",
      description: "Tender.",
      reason: "The images show warm memories.",
    },
    {
      value: "quiet_gratitude",
      label: "Quiet gratitude",
      description: "Calm.",
      reason: "The images feel reflective.",
    },
    {
      value: "joyful_connection",
      label: "Joyful connection",
      description: "Bright.",
      reason: "The images emphasize connection.",
    },
  ],
  photoInsights: [
    {
      photoAssetId: "photo_1",
      summary: "A family moment.",
      people: "Family members.",
      setting: "Indoor setting.",
      event: "Anniversary memory.",
      atmosphere: "Warm.",
    },
  ],
  storySummary: "A warm anniversary story.",
});

describe("CodexPhotoAnalysisGenerationAdapter", () => {
  it("maps validated Codex JSON into the application port result", async () => {
    const adapter = new CodexPhotoAnalysisGenerationAdapter(
      new MemoryObjectStorage(onePixelPng),
      async (_request, parse) => parse(validPhotoAnalysisJson, "codex-test"),
    );

    const result = await adapter.analyzeProjectPhotos(input());

    expect(result.model).toBe("codex-test");
    expect(result.emotionCandidates).toHaveLength(3);
    expect(result.photoInsights[0]?.photoAssetId).toBe("photo_1");
  });

  it("sends one normalized image per photo and the built prompt", async () => {
    let capturedPrompt = "";
    let capturedImageCount = -1;
    const adapter = new CodexPhotoAnalysisGenerationAdapter(
      new MemoryObjectStorage(onePixelPng),
      async (request, parse) => {
        capturedPrompt = request.prompt;
        capturedImageCount = request.images?.length ?? 0;
        return parse(validPhotoAnalysisJson, "codex-test");
      },
    );

    await adapter.analyzeProjectPhotos(input());

    expect(capturedImageCount).toBe(1);
    expect(capturedPrompt).toContain("Anniversary");
  });

  it("rejects malformed Codex JSON", async () => {
    const adapter = new CodexPhotoAnalysisGenerationAdapter(
      new MemoryObjectStorage(onePixelPng),
      async (_request, parse) =>
        parse(JSON.stringify({ emotionCandidates: [] }), "codex-test"),
    );

    await expect(adapter.analyzeProjectPhotos(input())).rejects.toThrow();
  });

  it("throws a clear error when a photo object is missing from storage", async () => {
    const adapter = new CodexPhotoAnalysisGenerationAdapter(
      new MemoryObjectStorage(null),
      async (_request, parse) => parse(validPhotoAnalysisJson, "codex-test"),
    );

    await expect(adapter.analyzeProjectPhotos(input())).rejects.toThrow(
      /Photo object not found/,
    );
  });
});
