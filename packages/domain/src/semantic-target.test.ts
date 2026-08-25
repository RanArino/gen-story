import { describe, expect, it } from "vitest";

import { createProjectPhotoAnalysis, createStoryboard } from "./model";
import {
  createSemanticTarget,
  isSemanticField,
  projectSemanticTarget,
  readProjectPhotoAnalysisSemanticTarget,
  readStoryboardSemanticTarget,
  semanticTargetKey,
  storyboardSemanticTarget,
} from "./semantic-target";

describe("semantic targets", () => {
  it("builds project and storyboard targets", () => {
    expect(projectSemanticTarget("project_1", "photoAnalysis")).toEqual({
      entityType: "project",
      entityId: "project_1",
      field: "photoAnalysis",
    });
    expect(storyboardSemanticTarget("storyboard_1", "tone")).toEqual({
      entityType: "storyboard",
      entityId: "storyboard_1",
      field: "tone",
    });
  });

  it("validates untrusted entityType/field tuples", () => {
    expect(
      createSemanticTarget({
        entityType: "storyboard",
        entityId: " storyboard_1 ",
        field: "stylePresetId",
      }),
    ).toEqual({
      entityType: "storyboard",
      entityId: "storyboard_1",
      field: "stylePresetId",
    });

    expect(() =>
      createSemanticTarget({
        entityType: "project",
        entityId: "project_1",
        field: "tone",
      }),
    ).toThrow(/Unsupported semantic target/);

    expect(() =>
      createSemanticTarget({
        entityType: "storyboard",
        entityId: "  ",
        field: "tone",
      }),
    ).toThrow(/entity ID is required/);
  });

  it("rejects unknown fields", () => {
    expect(isSemanticField("tone")).toBe(true);
    expect(isSemanticField("negativePrompt")).toBe(false);
  });

  it("builds a stable string key", () => {
    expect(
      semanticTargetKey(storyboardSemanticTarget("storyboard_1", "tone")),
    ).toBe("storyboard:storyboard_1#tone");
  });

  it("reads a storyboard target with the row's updatedAt as its revision", () => {
    const storyboard = createStoryboard({
      id: "storyboard_1",
      projectId: "project_1",
      tone: "warm nostalgia",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
    });

    expect(readStoryboardSemanticTarget(storyboard, "tone")).toEqual({
      target: storyboardSemanticTarget("storyboard_1", "tone"),
      value: "warm nostalgia",
      revision: "2026-08-10T00:00:00.000Z",
    });
  });

  it("reads a project photo analysis target as a structured value", () => {
    const analysis = createProjectPhotoAnalysis({
      id: "analysis_1",
      projectId: "project_1",
      emotionCandidates: [
        { value: "joy", label: "Joy", description: "d", reason: "r" },
      ],
      photoInsights: [
        {
          photoAssetId: "photo_1",
          summary: "s",
          people: "p",
          setting: "st",
          event: "e",
          atmosphere: "a",
        },
      ],
      storySummary: "A family trip.",
      model: "gemini-test",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-05T00:00:00.000Z",
    });

    expect(readProjectPhotoAnalysisSemanticTarget(analysis)).toEqual({
      target: projectSemanticTarget("project_1", "photoAnalysis"),
      value: {
        emotionCandidates: analysis.emotionCandidates,
        photoInsights: analysis.photoInsights,
        storySummary: "A family trip.",
      },
      revision: "2026-08-05T00:00:00.000Z",
    });
  });
});
