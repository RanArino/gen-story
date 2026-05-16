import { describe, expect, it } from "vitest";

import { composeImagePrompt } from "./prompt-composer";

describe("composeImagePrompt", () => {
  it("includes the common prompt when one is provided", () => {
    const prompt = composeImagePrompt({
      imagePrompt: "a family at the beach",
      emotion: "Joy",
      cameraDirection: "Medium",
      lightingDirection: "Natural",
      tone: "warm",
      stylePresetPrompt: "photorealistic cinematic film still",
      commonPrompt: "Overall emotional tone: Reflective.",
    });

    expect(prompt).toContain("Overall emotional tone: Reflective.");
  });

  it("omits the common prompt segment when it is empty", () => {
    const prompt = composeImagePrompt({
      imagePrompt: "a family at the beach",
      emotion: "Joy",
      cameraDirection: "Medium",
      lightingDirection: "Natural",
      tone: "warm",
      stylePresetPrompt: null,
      commonPrompt: "",
    });

    expect(prompt).not.toContain("Overall emotional tone");
  });
});
