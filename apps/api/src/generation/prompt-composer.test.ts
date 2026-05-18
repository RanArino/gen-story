import { describe, expect, it } from "vitest";

import { composeImagePrompt } from "./prompt-composer";

describe("composeImagePrompt", () => {
  it("includes the common prompt when one is provided", () => {
    const prompt = composeImagePrompt({
      imagePrompt: "a family at the beach",
      emotion: "Joy",
      cameraDirection: "Medium",
      lightingDirection: "Natural",
      motionDirection: "",
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
      motionDirection: "",
      tone: "warm",
      stylePresetPrompt: null,
      commonPrompt: "",
    });

    expect(prompt).not.toContain("Overall emotional tone");
  });

  it("includes the motion direction descriptor for a known value", () => {
    const prompt = composeImagePrompt({
      imagePrompt: "a child running through a field",
      emotion: "Joy",
      cameraDirection: "Medium",
      lightingDirection: "Natural",
      motionDirection: "Slow pan",
      tone: "warm",
      stylePresetPrompt: null,
      commonPrompt: "",
    });

    expect(prompt).toContain("slow lateral camera sweep");
  });

  it("omits the motion direction segment when the value is empty or unknown", () => {
    const prompt = composeImagePrompt({
      imagePrompt: "a child running through a field",
      emotion: "Joy",
      cameraDirection: "Medium",
      lightingDirection: "Natural",
      motionDirection: "",
      tone: "warm",
      stylePresetPrompt: null,
      commonPrompt: "",
    });

    expect(prompt).not.toContain("camera sweep");
  });
});
