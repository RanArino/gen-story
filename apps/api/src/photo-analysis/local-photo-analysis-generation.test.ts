import { describe, expect, it } from "vitest";

import {
  createPhotoAsset,
  createProject,
  createStoryboard,
} from "@gen-story/domain";

import { LocalPhotoAnalysisGenerationAdapter } from "./local-photo-analysis-generation";

describe("LocalPhotoAnalysisGenerationAdapter", () => {
  it("returns deterministic project photo analysis output", async () => {
    const adapter = new LocalPhotoAnalysisGenerationAdapter();

    const result = await adapter.analyzeProjectPhotos({
      project: createProject({
        id: "project_1",
        organizationId: "org_1",
        ownerUserId: "user_1",
        name: "Anniversary",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      }),
      storyboard: createStoryboard({
        id: "storyboard_1",
        projectId: "project_1",
        tone: "warm",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      }),
      photos: [
        createPhotoAsset({
          id: "photo_1",
          projectId: "project_1",
          name: "family.jpg",
          storageKey: "family.jpg",
          mimeType: "image/jpeg",
          size: 1,
          checksum: "checksum",
          sourceKind: "upload",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      language: "en",
    });

    expect(result.model).toBe("local-deterministic");
    expect(result.emotionCandidates).toHaveLength(3);
    expect(result.emotionCandidates[0]?.value).toBe("warm_nostalgia");
    expect(result.photoInsights).toHaveLength(1);
    expect(result.photoInsights[0]?.photoAssetId).toBe("photo_1");
    expect(result.storySummary).toContain("Anniversary");
  });
});
