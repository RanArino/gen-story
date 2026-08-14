import { z } from "zod";

import type {
  StorySetupGenerationInput,
  StorySetupSuggestion,
} from "@gen-story/application";
import { RECOMMENDED_NEGATIVE_FENCE } from "@gen-story/shared";

const StorySetupSchema = z.object({
  story: z.string().min(1),
  commonPrompt: z.string().min(1),
  negativePrompt: z.string().min(1),
});

export const STORY_SETUP_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    story: { type: "string" },
    commonPrompt: { type: "string" },
    negativePrompt: { type: "string" },
  },
  required: ["story", "commonPrompt", "negativePrompt"],
} as const;

function languageDirective(
  language: StorySetupGenerationInput["language"],
): string {
  if (language === "ja") {
    return "Respond in Japanese. The story must read as natural Japanese prose. The common prompt and negative prompt are fed to an image model, so write those in English.";
  }
  return "Respond in English.";
}

function analysisContext(input: StorySetupGenerationInput): string[] {
  const analysis = input.photoAnalysis;
  if (analysis == null) {
    return [
      "No photo analysis is available; write a story that stays general enough to fit any of the project's photos.",
    ];
  }

  const insights = analysis.photoInsights
    .map(
      (insight, index) =>
        `- Photo ${index + 1}: ${insight.summary} (people: ${insight.people}; setting: ${insight.setting}; event: ${insight.event}; atmosphere: ${insight.atmosphere})`,
    )
    .join("\n");

  return [
    `What the photo analysis established about this project (treat as ground truth): ${analysis.storySummary}`,
    insights ? `Per-photo findings:\n${insights}` : "",
  ].filter(Boolean);
}

export function buildStorySetupPrompt(
  input: StorySetupGenerationInput,
): string {
  return [
    "You are setting up the shared creative direction for an anniversary-style photo storyboard.",
    "Every scene in this storyboard will be written and generated against what you produce here, so it must be specific to these photos and this tone.",
    languageDirective(input.language),
    "Return only JSON matching the provided schema.",
    "",
    `Project: ${input.project.name}`,
    `Chosen emotional tone: ${input.storyboard.tone}`,
    input.stylePreset
      ? `Chosen visual style: ${input.stylePreset.name} — ${input.stylePreset.prompt}`
      : "Visual style: not chosen; keep the visual language consistent with the tone.",
    ...analysisContext(input),
    input.storyPurpose?.trim()
      ? `What the user told us about this project (treat as the strongest signal for the story and common prompt): ${input.storyPurpose.trim()}`
      : undefined,
    "",
    "story: 3-5 sentences describing the narrative arc and world of this video — who it is about, what it moves through, and how it should feel by the end. Concrete, not generic.",
    "commonPrompt: one paragraph of image-generation direction applied to EVERY scene. Cover the visual treatment, palette, and mood that hold the series together. Do not describe any single scene.",
    `negativePrompt: comma-separated phrases to keep OUT of every image, chosen for this tone and style. Do NOT include text, captions, letters, numbers, or any instruction that suppresses visible place names, station names, building names, signs, or other location-identifying text. Start from these and add what this specific project needs: ${RECOMMENDED_NEGATIVE_FENCE}`,
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export function parseStorySetupSuggestion(
  text: string,
  model: string,
): StorySetupSuggestion {
  return {
    ...StorySetupSchema.parse(JSON.parse(text)),
    model,
  };
}
