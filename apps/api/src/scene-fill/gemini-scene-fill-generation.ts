import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import type {
  ObjectStoragePort,
  SceneFillGenerationInput,
  SceneFillGenerationPort,
  SceneFillSuggestion,
} from "@gen-story/application";

import { createAiInputImage } from "../images/image-metadata";

export const DEFAULT_GEMINI_SCENE_FILL_MODEL = "gemini-2.5-flash";

const SceneFillSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  imagePrompt: z.string().min(1),
  emotion: z.string().min(1),
  cameraDirection: z.string().min(1),
  lightingDirection: z.string().min(1),
  motionDirection: z.string().min(1),
});

type GeminiClient = {
  models: {
    generateContent(input: unknown): Promise<{ text?: string }>;
  };
};

const responseJsonSchema = {
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

// The project-level vision pass already described every photo and summarized the
// story. Feeding the relevant slice back in keeps each scene consistent with the
// others and with the emotion the user picked, instead of the model re-reading
// one photo in isolation.
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

function buildPrompt(input: SceneFillGenerationInput): string {
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

function bytesToBase64(body: Uint8Array): string {
  return Buffer.from(body).toString("base64");
}

export class GeminiSceneFillGenerationAdapter implements SceneFillGenerationPort {
  private client: GeminiClient | null;

  constructor(
    private readonly objectStorage: ObjectStoragePort,
    private readonly apiKey: string | undefined,
    private readonly model = DEFAULT_GEMINI_SCENE_FILL_MODEL,
    client?: GeminiClient,
  ) {
    this.client = client ?? null;
  }

  private getClient(): GeminiClient {
    if (this.client != null) {
      return this.client;
    }
    if (this.apiKey == null || this.apiKey.length === 0) {
      throw new Error(
        "GEMINI_API_KEY is required for photo-aware AI scene fill.",
      );
    }
    this.client = new GoogleGenAI({ apiKey: this.apiKey });
    return this.client;
  }

  async generateSceneFill(
    input: SceneFillGenerationInput,
  ): Promise<SceneFillSuggestion> {
    const client = this.getClient();
    const parts: unknown[] = [{ text: buildPrompt(input) }];

    // The primary photo, then whatever this scene named as a reference. The
    // project's other photos are deliberately not sent: what the vision pass
    // learned about them already arrives as text in `analysisContext`.
    const photoOrder = [
      input.primaryPhoto,
      ...input.referencePhotos.filter(
        (photo) => photo.id !== input.primaryPhoto.id,
      ),
    ];

    for (const photo of photoOrder) {
      const body = await this.objectStorage.getObject(photo.storageKey);
      if (body == null) {
        continue;
      }
      const normalized = await createAiInputImage(body);
      parts.push({
        inlineData: {
          mimeType: normalized.mimeType,
          data: bytesToBase64(normalized.body),
        },
      });
    }

    const response = await client.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json",
        responseJsonSchema,
      },
    });
    const text = response.text;

    if (text == null || text.trim().length === 0) {
      throw new Error("Gemini scene fill returned an empty response.");
    }

    return SceneFillSchema.parse(JSON.parse(text));
  }
}
