import { describe, expect, it } from "vitest";

import type { StorySetupGenerationInput } from "@gen-story/application";

import { CodexStorySetupGenerationAdapter } from "./codex-story-setup-generation";

const validStorySetupJson = JSON.stringify({
  story: "A story.",
  commonPrompt: "A consistent visual treatment.",
  negativePrompt: "watermark",
});

describe("CodexStorySetupGenerationAdapter", () => {
  it("maps validated Codex JSON into a story setup suggestion", async () => {
    const adapter = new CodexStorySetupGenerationAdapter(
      async (_request, parse) => parse(validStorySetupJson, "codex-test"),
    );

    const result = await adapter.generateStorySetup({
      language: "en",
      project: { name: "Tokyo memories" },
      storyboard: { tone: "nostalgic" },
      stylePreset: null,
      photoAnalysis: null,
    } as StorySetupGenerationInput);

    expect(result).toEqual({
      story: "A story.",
      commonPrompt: "A consistent visual treatment.",
      negativePrompt: "watermark",
      model: "codex-test",
    });
  });

  it("does not direct the model to suppress location-identifying text", async () => {
    let capturedPrompt = "";
    const adapter = new CodexStorySetupGenerationAdapter(
      async (request, parse) => {
        capturedPrompt = request.prompt;
        return parse(validStorySetupJson, "codex-test");
      },
    );

    await adapter.generateStorySetup({
      language: "en",
      project: { name: "Tokyo memories" },
      storyboard: { tone: "nostalgic" },
      stylePreset: null,
      photoAnalysis: null,
    } as StorySetupGenerationInput);

    expect(capturedPrompt).toContain(
      "Do NOT include text, captions, letters, numbers",
    );
    expect(capturedPrompt).toContain("station names");
    expect(capturedPrompt).toContain("building names");
  });

  it("rejects malformed Codex JSON", async () => {
    const adapter = new CodexStorySetupGenerationAdapter(
      async (_request, parse) => parse(JSON.stringify({ story: "" }), "x"),
    );

    await expect(
      adapter.generateStorySetup({
        language: "en",
        project: { name: "Tokyo memories" },
        storyboard: { tone: "nostalgic" },
        stylePreset: null,
        photoAnalysis: null,
      } as StorySetupGenerationInput),
    ).rejects.toThrow();
  });
});
