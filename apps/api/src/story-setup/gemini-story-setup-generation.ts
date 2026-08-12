import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import type {
  StorySetupGenerationInput,
  StorySetupGenerationPort,
  StorySetupSuggestion,
} from "@gen-story/application";
import { RECOMMENDED_NEGATIVE_FENCE } from "@gen-story/shared";

export const DEFAULT_GEMINI_STORY_SETUP_MODEL = "gemini-2.5-flash";

const StorySetupSchema = z.object({
  story: z.string().min(1),
  commonPrompt: z.string().min(1),
  negativePrompt: z.string().min(1),
});

type GeminiClient = {
  models: {
    generateContent(input: unknown): Promise<{ text?: string }>;
  };
};

const responseJsonSchema = {
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

// This step runs after the project photo analysis, so the photos have already
// been read once. Feeding the summary and per-photo insights back in as text is
// what keeps the story about these photos rather than a generic anniversary
// video, without paying to send the images a second time.
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

function buildPrompt(input: StorySetupGenerationInput): string {
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

export class GeminiStorySetupGenerationAdapter implements StorySetupGenerationPort {
  private client: GeminiClient | null;

  constructor(
    private readonly apiKey: string | undefined,
    private readonly model = DEFAULT_GEMINI_STORY_SETUP_MODEL,
    client?: GeminiClient,
  ) {
    this.client = client ?? null;
  }

  private getClient(): GeminiClient {
    if (this.client != null) {
      return this.client;
    }
    if (this.apiKey == null || this.apiKey.length === 0) {
      throw new Error("GEMINI_API_KEY is required for AI story setup.");
    }
    this.client = new GoogleGenAI({ apiKey: this.apiKey });
    return this.client;
  }

  async generateStorySetup(
    input: StorySetupGenerationInput,
  ): Promise<StorySetupSuggestion> {
    const client = this.getClient();

    const response = await client.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts: [{ text: buildPrompt(input) }] }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema,
      },
    });
    const text = response.text;

    if (text == null || text.trim().length === 0) {
      throw new Error("Gemini story setup returned an empty response.");
    }

    return {
      ...StorySetupSchema.parse(JSON.parse(text)),
      model: this.model,
    };
  }
}
