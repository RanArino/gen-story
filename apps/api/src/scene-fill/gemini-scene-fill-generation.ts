import { GoogleGenAI } from "@google/genai";

import type {
  ObjectStoragePort,
  SceneFillGenerationInput,
  SceneFillGenerationPort,
  SceneFillSuggestion,
} from "@gen-story/application";

import { createAiInputImage } from "../images/image-metadata";
import { retryGeminiRateLimit } from "../gemini/gemini-rate-limit";
import {
  buildSceneFillPrompt,
  parseSceneFillSuggestion,
  SCENE_FILL_RESPONSE_JSON_SCHEMA,
} from "./scene-fill-generation-contract";

export const DEFAULT_GEMINI_SCENE_FILL_MODEL = "gemini-2.5-flash";

type GeminiClient = {
  models: {
    generateContent(input: unknown): Promise<{ text?: string }>;
  };
};

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
    const parts: unknown[] = [{ text: buildSceneFillPrompt(input) }];

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

    const response = await retryGeminiRateLimit(() =>
      client.models.generateContent({
        model: this.model,
        contents: [{ role: "user", parts }],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: SCENE_FILL_RESPONSE_JSON_SCHEMA,
        },
      }),
    );
    const text = response.text;

    if (text == null || text.trim().length === 0) {
      throw new Error("Gemini scene fill returned an empty response.");
    }

    return parseSceneFillSuggestion(text);
  }
}
