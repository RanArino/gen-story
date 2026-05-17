import { describe, expect, it } from "vitest";

import type { ObjectStoragePort } from "@gen-story/application";
import { createPhotoAsset, createProject } from "@gen-story/domain";

import { GeminiPhotoAnalysisGenerationAdapter } from "./gemini-photo-analysis-generation";

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
  };
}

describe("GeminiPhotoAnalysisGenerationAdapter", () => {
  it("maps validated Gemini JSON into the application port result", async () => {
    const client = {
      models: {
        async generateContent() {
          return {
            text: JSON.stringify({
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
            }),
          };
        },
      },
    };
    const adapter = new GeminiPhotoAnalysisGenerationAdapter(
      new MemoryObjectStorage(onePixelPng),
      "test-key",
      "gemini-test",
      client,
    );

    const result = await adapter.analyzeProjectPhotos(input());

    expect(result.model).toBe("gemini-test");
    expect(result.emotionCandidates).toHaveLength(3);
    expect(result.photoInsights[0]?.photoAssetId).toBe("photo_1");
  });

  it("rejects malformed Gemini JSON", async () => {
    const client = {
      models: {
        async generateContent() {
          return { text: JSON.stringify({ emotionCandidates: [] }) };
        },
      },
    };
    const adapter = new GeminiPhotoAnalysisGenerationAdapter(
      new MemoryObjectStorage(onePixelPng),
      "test-key",
      "gemini-test",
      client,
    );

    await expect(adapter.analyzeProjectPhotos(input())).rejects.toThrow();
  });
});
