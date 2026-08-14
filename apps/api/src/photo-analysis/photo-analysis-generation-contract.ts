import { z } from "zod";

import type {
  PhotoAnalysisGenerationInput,
  PhotoAnalysisGenerationResult,
} from "@gen-story/application";

const PhotoAnalysisSchema = z.object({
  emotionCandidates: z
    .array(
      z.object({
        value: z.string().min(1),
        label: z.string().min(1),
        description: z.string().min(1),
        reason: z.string().min(1),
      }),
    )
    .min(3)
    .max(5),
  photoInsights: z
    .array(
      z.object({
        photoAssetId: z.string().min(1),
        summary: z.string().min(1),
        people: z.string().min(1),
        setting: z.string().min(1),
        event: z.string().min(1),
        atmosphere: z.string().min(1),
      }),
    )
    .min(1),
  storySummary: z.string().min(1),
});

export const PHOTO_ANALYSIS_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    emotionCandidates: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          value: { type: "string" },
          label: { type: "string" },
          description: { type: "string" },
          reason: { type: "string" },
        },
        required: ["value", "label", "description", "reason"],
      },
    },
    photoInsights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          photoAssetId: { type: "string" },
          summary: { type: "string" },
          people: { type: "string" },
          setting: { type: "string" },
          event: { type: "string" },
          atmosphere: { type: "string" },
        },
        required: [
          "photoAssetId",
          "summary",
          "people",
          "setting",
          "event",
          "atmosphere",
        ],
      },
    },
    storySummary: { type: "string" },
  },
  required: ["emotionCandidates", "photoInsights", "storySummary"],
} as const;

function languageDirective(
  language: PhotoAnalysisGenerationInput["language"],
): string {
  if (language === "ja") {
    return 'Respond in Japanese. The emotion candidate `label`, `description`, and `reason` fields, every photo insight free-text field (`summary`, `people`, `setting`, `event`, `atmosphere`), and `storySummary` MUST be written in natural Japanese. Emotion candidate `value` fields MUST remain lowercase snake_case English (e.g., "joy", "nostalgia").';
  }
  return "Respond in English. All free-text fields MUST be English.";
}

export function buildPhotoAnalysisPrompt(
  input: PhotoAnalysisGenerationInput,
): string {
  const photoList = input.photos
    .map(
      (photo, index) =>
        `${index + 1}. id=${photo.id}, name="${photo.name}", usage=${photo.usage}, notes="${photo.notes ?? ""}"`,
    )
    .join("\n");

  return [
    "Analyze these curated project photos for an anniversary-style storyboard.",
    languageDirective(input.language),
    "Return only JSON matching the provided schema.",
    "Use the given photoAssetId exactly for each photo insight.",
    "Emotion candidate values must be lowercase snake_case English strings.",
    "Each candidate should be useful as a storyboard tone.",
    `Project: ${input.project.name}`,
    `Current storyboard tone: ${input.storyboard?.tone ?? "none"}`,
    "Photos:",
    photoList,
  ].join("\n");
}

export function parsePhotoAnalysisResult(
  text: string,
  model: string,
): PhotoAnalysisGenerationResult {
  return {
    ...PhotoAnalysisSchema.parse(JSON.parse(text)),
    model,
  };
}
