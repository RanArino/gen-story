import { describe, expect, it } from "vitest";

import type { StorySetupGenerationInput } from "@gen-story/application";

import { GeminiStorySetupGenerationAdapter } from "./gemini-story-setup-generation";

describe("GeminiStorySetupGenerationAdapter", () => {
  it("does not direct the model to suppress location-identifying text", async () => {
    let request: unknown;
    const adapter = new GeminiStorySetupGenerationAdapter(
      undefined,
      undefined,
      {
        models: {
          async generateContent(input: unknown) {
            request = input;
            return {
              text: JSON.stringify({
                story: "A story.",
                commonPrompt: "A consistent visual treatment.",
                negativePrompt: "watermark",
              }),
            };
          },
        },
      },
    );

    await adapter.generateStorySetup({
      language: "en",
      project: { name: "Tokyo memories" },
      storyboard: { tone: "nostalgic" },
      stylePreset: null,
      photoAnalysis: null,
    } as StorySetupGenerationInput);

    const generatedRequest = (
      request as { contents: Array<{ parts: Array<{ text: string }> }> }
    );
    const prompt = generatedRequest.contents[0]!.parts[0]!.text;

    expect(prompt).toContain("Do NOT include text, captions, letters, numbers");
    expect(prompt).toContain("station names");
    expect(prompt).toContain("building names");
  });
});
