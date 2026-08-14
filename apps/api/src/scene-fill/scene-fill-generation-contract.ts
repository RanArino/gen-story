import { z } from "zod";

import type {
  SceneFillGenerationInput,
  SceneFillSuggestion,
} from "@gen-story/application";

const SceneFillSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  imagePrompt: z.string().min(1),
  emotion: z.string().min(1),
  cameraDirection: z.string().min(1),
  lightingDirection: z.string().min(1),
  motionDirection: z.string().min(1),
});

export const SCENE_FILL_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    imagePrompt: { type: "string" },
    emotion: { type: "string" },
    cameraDirection: { type: "string" },
    lightingDirection: { type: "string" },
    motionDirection: { type: "string" },
  },
  required: [
    "title",
    "description",
    "imagePrompt",
    "emotion",
    "cameraDirection",
    "lightingDirection",
    "motionDirection",
  ],
} as const;

function languageDirective(
  language: SceneFillGenerationInput["language"],
): string {
  if (language === "ja") {
    return 'Respond in Japanese. All title, description, image prompt, and any free-text fields MUST be written in natural Japanese. Selection enum values such as cameraDirection, lightingDirection, motionDirection, and emotion MUST remain in English (e.g., "Wide", "Close-up", "Joy").';
  }
  return "Respond in English. All title, description, image prompt, and any free-text fields MUST be English.";
}

function analysisContext(input: SceneFillGenerationInput): string[] {
  const analysis = input.photoAnalysis;
  if (analysis == null) return [];

  const lines = [
    `Story summary from the project photo analysis: ${analysis.storySummary}`,
  ];

  const primaryInsight = analysis.photoInsights.find(
    (insight) => insight.photoAssetId === input.primaryPhoto.id,
  );
  if (primaryInsight) {
    lines.push(
      [
        "Established facts about THIS scene's primary photo (treat as ground truth):",
        `- Summary: ${primaryInsight.summary}`,
        `- People: ${primaryInsight.people}`,
        `- Setting: ${primaryInsight.setting}`,
        `- Event: ${primaryInsight.event}`,
        `- Atmosphere: ${primaryInsight.atmosphere}`,
      ].join("\n"),
    );
  }

  return lines;
}

export function buildSceneFillPrompt(input: SceneFillGenerationInput): string {
  const siblings = input.siblingScenes
    .filter((scene) => scene.id !== input.scene.id)
    .map(
      (scene) =>
        `- Scene ${scene.orderIndex + 1}: "${scene.title || "(untitled)"}"`,
    )
    .join("\n");

  return [
    "You are drafting one scene of an anniversary-style storyboard.",
    languageDirective(input.language),
    "The FIRST image is this scene's primary photo; any following images are reference photos this scene was given for context.",
    "Generate scene fields grounded in what is actually visible in the primary photo.",
    "Return only JSON matching the provided schema.",
    `Project: ${input.project.name}`,
    `Storyboard tone: ${input.storyboard.tone}`,
    `Common prompt applied to every scene: ${input.storyboard.commonPrompt || "(none)"}`,
    input.stylePreset
      ? `Visual style: ${input.stylePreset.name} — ${input.stylePreset.prompt}`
      : "Visual style: AI's choice, consistent with the tone.",
    `Primary photo: name="${input.primaryPhoto.name}", notes="${input.primaryPhoto.notes ?? ""}"`,
    ...analysisContext(input),
    `This is scene ${input.scene.orderIndex + 1}.`,
    siblings ? `Other scenes in the storyboard:\n${siblings}` : "",
    "emotion/cameraDirection/lightingDirection/motionDirection should be short label-style values (always English).",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseSceneFillSuggestion(text: string): SceneFillSuggestion {
  return SceneFillSchema.parse(JSON.parse(text));
}
