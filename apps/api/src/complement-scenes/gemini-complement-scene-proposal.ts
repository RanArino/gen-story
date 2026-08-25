import { GoogleGenAI } from "@google/genai";

import type {
  ComplementSceneProposal,
  ComplementSceneProposalInput,
  ComplementSceneProposalPort,
  ObjectStoragePort,
} from "@gen-story/application";

import { createAiInputImage } from "../images/image-metadata";
import { retryGeminiRateLimit } from "../gemini/gemini-rate-limit";
import {
  buildComplementScenePrompt,
  COMPLEMENT_SCENE_RESPONSE_JSON_SCHEMA,
  parseComplementSceneProposals,
} from "./complement-scene-generation-contract";

export const DEFAULT_GEMINI_COMPLEMENT_SCENE_MODEL = "gemini-2.5-flash";

type GeminiClient = {
  models: {
    generateContent(input: unknown): Promise<{ text?: string }>;
  };
};

function bytesToBase64(body: Uint8Array): string {
  return Buffer.from(body).toString("base64");
}

export class GeminiComplementSceneProposalAdapter implements ComplementSceneProposalPort {
  private client: GeminiClient | null;

  constructor(
    private readonly objectStorage: ObjectStoragePort,
    private readonly apiKey: string | undefined,
    private readonly model = DEFAULT_GEMINI_COMPLEMENT_SCENE_MODEL,
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
        "GEMINI_API_KEY is required for AI complement-scene proposals.",
      );
    }
    this.client = new GoogleGenAI({ apiKey: this.apiKey });
    return this.client;
  }

  async proposeComplementScenes(
    input: ComplementSceneProposalInput,
  ): Promise<ComplementSceneProposal[]> {
    const client = this.getClient();
    const parts: unknown[] = [{ text: buildComplementScenePrompt(input) }];

    for (const photo of input.projectPhotos.filter(
      (candidate) => candidate.deletedAt === null,
    )) {
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
          responseJsonSchema: COMPLEMENT_SCENE_RESPONSE_JSON_SCHEMA,
        },
      }),
    );
    const text = response.text;

    if (text == null || text.trim().length === 0) {
      throw new Error(
        "Gemini complement-scene proposal returned an empty response.",
      );
    }

    return parseComplementSceneProposals(text);
  }
}
