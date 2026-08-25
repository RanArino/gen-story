import { GoogleGenAI } from "@google/genai";

import type {
  ObjectStoragePort,
  PhotoAnalysisGenerationInput,
  PhotoAnalysisGenerationPort,
  PhotoAnalysisGenerationResult,
} from "@gen-story/application";

import { createAiInputImage } from "../images/image-metadata";
import { retryGeminiRateLimit } from "../gemini/gemini-rate-limit";
import {
  buildPhotoAnalysisPrompt,
  parsePhotoAnalysisResult,
  PHOTO_ANALYSIS_RESPONSE_JSON_SCHEMA,
} from "./photo-analysis-generation-contract";

export const DEFAULT_GEMINI_PHOTO_ANALYSIS_MODEL = "gemini-2.5-flash";

type GeminiClient = {
  models: {
    generateContent(input: unknown): Promise<{ text?: string }>;
  };
};

function bytesToBase64(body: Uint8Array): string {
  return Buffer.from(body).toString("base64");
}

export class GeminiPhotoAnalysisGenerationAdapter implements PhotoAnalysisGenerationPort {
  private readonly client: GeminiClient;

  constructor(
    private readonly objectStorage: ObjectStoragePort,
    apiKey: string,
    private readonly model = DEFAULT_GEMINI_PHOTO_ANALYSIS_MODEL,
    client?: GeminiClient,
  ) {
    this.client = client ?? new GoogleGenAI({ apiKey });
  }

  async analyzeProjectPhotos(
    input: PhotoAnalysisGenerationInput,
  ): Promise<PhotoAnalysisGenerationResult> {
    const parts: unknown[] = [{ text: buildPhotoAnalysisPrompt(input) }];

    for (const photo of input.photos) {
      const body = await this.objectStorage.getObject(photo.storageKey);
      if (body == null) {
        throw new Error(`Photo object not found for analysis: ${photo.id}`);
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
      this.client.models.generateContent({
        model: this.model,
        contents: [{ role: "user", parts }],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: PHOTO_ANALYSIS_RESPONSE_JSON_SCHEMA,
        },
      }),
    );
    const text = response.text;

    if (text == null || text.trim().length === 0) {
      throw new Error("Gemini photo analysis returned an empty response.");
    }

    return parsePhotoAnalysisResult(text, this.model);
  }
}
