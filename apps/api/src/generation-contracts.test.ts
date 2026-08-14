import { describe, expect, it } from "vitest";

import type {
  ComplementSceneProposalInput,
  PhotoAnalysisGenerationInput,
  SceneFillGenerationInput,
  StorySetupGenerationInput,
} from "@gen-story/application";

import {
  buildComplementScenePrompt,
  parseComplementSceneProposals,
} from "./complement-scenes/complement-scene-generation-contract";
import {
  buildPhotoAnalysisPrompt,
  parsePhotoAnalysisResult,
} from "./photo-analysis/photo-analysis-generation-contract";
import {
  buildSceneFillPrompt,
  parseSceneFillSuggestion,
} from "./scene-fill/scene-fill-generation-contract";
import {
  buildStorySetupPrompt,
  parseStorySetupSuggestion,
} from "./story-setup/story-setup-generation-contract";

const sceneFields = {
  title: "Bridge moment",
  description: "A quiet transition.",
  imagePrompt: "A soft connecting shot.",
  emotion: "Calm",
  cameraDirection: "Wide",
  lightingDirection: "Natural",
  motionDirection: "Slow pan",
};

const photoAnalysisJson = JSON.stringify({
  emotionCandidates: [
    {
      value: "warm_nostalgia",
      label: "Warm nostalgia",
      description: "Tender.",
      reason: "Warm memories.",
    },
    {
      value: "quiet_gratitude",
      label: "Quiet gratitude",
      description: "Calm.",
      reason: "Reflective moments.",
    },
    {
      value: "joyful_connection",
      label: "Joyful connection",
      description: "Bright.",
      reason: "Shared happiness.",
    },
  ],
  photoInsights: [
    {
      photoAssetId: "photo_1",
      summary: "A family reunion.",
      people: "Two family members.",
      setting: "Tokyo Station.",
      event: "A reunion.",
      atmosphere: "Warm.",
    },
  ],
  storySummary: "A reunion told through warm city memories.",
});

describe("generation prompt and output contracts", () => {
  it("locks the photo-analysis prompt context and result shape", () => {
    const prompt = buildPhotoAnalysisPrompt({
      language: "ja",
      project: { name: "Tokyo memories" },
      storyboard: { tone: "warm_nostalgia" },
      photos: [
        {
          id: "photo_1",
          name: "station.png",
          usage: "primary",
          notes: "Meeting under the clock",
        },
      ],
    } as unknown as PhotoAnalysisGenerationInput);

    expect(prompt).toContain("Respond in Japanese");
    expect(prompt).toContain("Current storyboard tone: warm_nostalgia");
    expect(prompt).toContain(
      'id=photo_1, name="station.png", usage=primary, notes="Meeting under the clock"',
    );

    expect(
      parsePhotoAnalysisResult(photoAnalysisJson, "provider-test"),
    ).toMatchObject({
      model: "provider-test",
      storySummary: "A reunion told through warm city memories.",
    });
    expect(() =>
      parsePhotoAnalysisResult(
        JSON.stringify({ emotionCandidates: [], photoInsights: [] }),
        "provider-test",
      ),
    ).toThrow();
  });

  it("locks the story-setup grounding and result shape", () => {
    const prompt = buildStorySetupPrompt({
      language: "en",
      project: { name: "Tokyo memories" },
      storyboard: { tone: "warm_nostalgia" },
      stylePreset: { name: "Watercolor", prompt: "Soft paper texture" },
      photoAnalysis: JSON.parse(photoAnalysisJson),
      storyPurpose: "Celebrate rebuilding a life together",
    } as unknown as StorySetupGenerationInput);

    expect(prompt).toContain("Chosen emotional tone: warm_nostalgia");
    expect(prompt).toContain(
      "Chosen visual style: Watercolor — Soft paper texture",
    );
    expect(prompt).toContain("treat as ground truth");
    expect(prompt).toContain("Celebrate rebuilding a life together");
    expect(prompt).toContain("station names");

    expect(
      parseStorySetupSuggestion(
        JSON.stringify({
          story: "A specific story.",
          commonPrompt: "A coherent visual direction.",
          negativePrompt: "watermark",
        }),
        "provider-test",
      ),
    ).toEqual({
      story: "A specific story.",
      commonPrompt: "A coherent visual direction.",
      negativePrompt: "watermark",
      model: "provider-test",
    });
    expect(() =>
      parseStorySetupSuggestion(
        JSON.stringify({ story: "", commonPrompt: "x", negativePrompt: "x" }),
        "provider-test",
      ),
    ).toThrow();
  });

  it("locks the scene-fill photo grounding and result shape", () => {
    const prompt = buildSceneFillPrompt({
      language: "ja",
      project: { name: "Tokyo memories" },
      storyboard: { tone: "warm_nostalgia", commonPrompt: "Warm watercolor" },
      scene: { id: "scene_1", orderIndex: 0 },
      primaryPhoto: {
        id: "photo_1",
        name: "station.png",
        notes: "Meeting under the clock",
      },
      stylePreset: { name: "Watercolor", prompt: "Soft paper texture" },
      siblingScenes: [
        { id: "scene_1", orderIndex: 0, title: "" },
        { id: "scene_2", orderIndex: 1, title: "Dinner" },
      ],
      photoAnalysis: JSON.parse(photoAnalysisJson),
    } as unknown as SceneFillGenerationInput);

    expect(prompt).toContain("Respond in Japanese");
    expect(prompt).toContain("Story summary from the project photo analysis");
    expect(prompt).toContain(
      "Established facts about THIS scene's primary photo",
    );
    expect(prompt).toContain(
      'Other scenes in the storyboard:\n- Scene 2: "Dinner"',
    );
    expect(prompt).toContain("Visual style: Watercolor — Soft paper texture");

    expect(parseSceneFillSuggestion(JSON.stringify(sceneFields))).toEqual(
      sceneFields,
    );
    expect(() =>
      parseSceneFillSuggestion(JSON.stringify({ ...sceneFields, title: "" })),
    ).toThrow();
  });

  it("locks the complement-scene bridge context and result shape", () => {
    const prompt = buildComplementScenePrompt({
      language: "en",
      project: { name: "Tokyo memories" },
      storyboard: { tone: "warm_nostalgia", commonPrompt: "Warm watercolor" },
      stylePreset: { name: "Watercolor", prompt: "Soft paper texture" },
      fromScene: { title: "Arrival", description: "They meet at the station." },
      toScene: { title: "Dinner", description: "They celebrate together." },
    } as unknown as ComplementSceneProposalInput);

    expect(prompt).toContain(
      'Bridge from scene "Arrival": They meet at the station.',
    );
    expect(prompt).toContain(
      'Bridge to scene "Dinner": They celebrate together.',
    );
    expect(prompt).toContain("Visual style: Watercolor — Soft paper texture");

    expect(
      parseComplementSceneProposals(
        JSON.stringify({ proposals: [sceneFields] }),
      ),
    ).toEqual([sceneFields]);
    expect(() =>
      parseComplementSceneProposals(JSON.stringify({ proposals: [] })),
    ).toThrow();
  });
});
