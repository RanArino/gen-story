import { GoogleGenAI } from "@google/genai";

import type {
  StorySetupGenerationInput,
  StorySetupGenerationPort,
  StorySetupSuggestion,
} from "@gen-story/application";
import { retryGeminiRateLimit } from "../gemini/gemini-rate-limit";
import {
  buildStorySetupPrompt,
  parseStorySetupSuggestion,
  STORY_SETUP_RESPONSE_JSON_SCHEMA,
} from "./story-setup-generation-contract";

export const DEFAULT_GEMINI_STORY_SETUP_MODEL = "gemini-2.5-flash";

type GeminiClient = {
  models: {
    generateContent(input: unknown): Promise<{ text?: string }>;
  };
};

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

    const response = await retryGeminiRateLimit(() =>
      client.models.generateContent({
        model: this.model,
        contents: [
          { role: "user", parts: [{ text: buildStorySetupPrompt(input) }] },
        ],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: STORY_SETUP_RESPONSE_JSON_SCHEMA,
        },
      }),
    );
    const text = response.text;

    if (text == null || text.trim().length === 0) {
      throw new Error("Gemini story setup returned an empty response.");
    }

    return parseStorySetupSuggestion(text, this.model);
  }
}
