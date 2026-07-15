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
      story: "",
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
      story: "",
    });

    expect(prompt).not.toContain("Overall emotional tone");
  });

  it("includes the story when one is provided", () => {
    const prompt = composeImagePrompt({
      imagePrompt: "a child running through a field",
      emotion: "Joy",
      cameraDirection: "Medium",
      lightingDirection: "Natural",
      motionDirection: "Slow pan",
      tone: "warm",
      stylePresetPrompt: null,
      commonPrompt: "",
      story:
        "A multi-generation family story set around the same seaside town.",
    });

    expect(prompt).toContain(
      "A multi-generation family story set around the same seaside town.",
    );
  });

  it("omits the story segment when it is empty", () => {
    const prompt = composeImagePrompt({
      imagePrompt: "a family at the beach",
      emotion: "Joy",
      cameraDirection: "Medium",
      lightingDirection: "Natural",
      motionDirection: "",
      tone: "warm",
      stylePresetPrompt: null,
      commonPrompt: "",
      story: "",
    });

    expect(prompt).not.toContain("multi-generation family story");
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
      story: "",
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
      story: "",
    });

    expect(prompt).not.toContain("camera sweep");
  });

  it("appends a trailing avoid clause when a negative prompt is provided", () => {
    const prompt = composeImagePrompt({
      imagePrompt: "a family at the beach",
      emotion: "Joy",
      cameraDirection: "Medium",
      lightingDirection: "Natural",
      motionDirection: "",
      tone: "warm",
      stylePresetPrompt: null,
      commonPrompt: "",
      story: "",
      negativePrompt: "text, watermark, no balloons",
    });

    expect(prompt).toMatch(/, avoid: text, watermark, no balloons$/);
  });

  it("omits the avoid clause when the negative prompt is empty or absent", () => {
    const withEmpty = composeImagePrompt({
      imagePrompt: "a family at the beach",
      emotion: "Joy",
      cameraDirection: "Medium",
      lightingDirection: "Natural",
      motionDirection: "",
      tone: "warm",
      stylePresetPrompt: null,
      commonPrompt: "",
      story: "",
      negativePrompt: "   ",
    });
    const withAbsent = composeImagePrompt({
      imagePrompt: "a family at the beach",
      emotion: "Joy",
      cameraDirection: "Medium",
      lightingDirection: "Natural",
      motionDirection: "",
      tone: "warm",
      stylePresetPrompt: null,
      commonPrompt: "",
      story: "",
    });

    expect(withEmpty).not.toContain("avoid:");
    expect(withAbsent).not.toContain("avoid:");
  });
});
