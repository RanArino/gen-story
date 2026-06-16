import type { ApplicationDependencies } from "@gen-story/application";
import type { Scene, Storyboard, StylePreset } from "@gen-story/domain";
import { BASE_NEGATIVE_PROMPT, composeNegativePrompt } from "@gen-story/shared";

import { composeImagePrompt } from "./prompt-composer";

export type ComposeScenePromptDeps = Pick<
  ApplicationDependencies,
  "scenes" | "storyboards" | "stylePresets"
>;

// Optional unsaved-edit overrides. Any omitted field falls back to the
// persisted scene/storyboard value, so the same gather+compose path serves
// both the live preview (current form state) and a real generation.
export type ComposeScenePromptOverrides = {
  imagePrompt?: string;
  emotion?: string;
  cameraDirection?: string;
  lightingDirection?: string;
  motionDirection?: string;
  commonPrompt?: string;
  sceneNegativePrompt?: string;
  projectNegativePrompt?: string;
};

export type ComposeScenePromptResult = {
  prompt: string;
  negativePrompt: string;
  scene: Scene;
  storyboard: Storyboard;
  stylePreset: StylePreset | null;
};

// Single source of truth for "given a scene (+ optional unsaved edits), what
// positive prompt and merged negative prompt will the model receive?". Called
// by both the image preprocessor (real generation) and the preview endpoint so
// the two cannot drift.
export async function composeScenePrompt(
  deps: ComposeScenePromptDeps,
  input: { sceneId: string; overrides?: ComposeScenePromptOverrides },
): Promise<ComposeScenePromptResult> {
  const scene = await deps.scenes.findById(input.sceneId);
  if (scene == null) {
    throw new Error("Scene not found for prompt composition.");
  }

  const storyboard = await deps.storyboards.findById(scene.storyboardId);
  if (storyboard == null) {
    throw new Error("Storyboard not found for prompt composition.");
  }

  const stylePreset = storyboard.stylePresetId
    ? await deps.stylePresets.findById(storyboard.stylePresetId)
    : null;

  const overrides = input.overrides ?? {};

  const negativePrompt = composeNegativePrompt(
    BASE_NEGATIVE_PROMPT,
    overrides.projectNegativePrompt ?? storyboard.negativePrompt ?? "",
    overrides.sceneNegativePrompt ?? scene.negativePrompt ?? "",
  );

  const prompt = composeImagePrompt({
    imagePrompt: overrides.imagePrompt ?? scene.imagePrompt ?? "",
    emotion: overrides.emotion ?? scene.emotion ?? "",
    cameraDirection: overrides.cameraDirection ?? scene.cameraDirection ?? "",
    lightingDirection:
      overrides.lightingDirection ?? scene.lightingDirection ?? "",
    motionDirection: overrides.motionDirection ?? scene.motionDirection ?? "",
    tone: storyboard.tone ?? "",
    stylePresetPrompt: stylePreset?.prompt ?? null,
    commonPrompt: overrides.commonPrompt ?? storyboard.commonPrompt ?? "",
    negativePrompt,
  });

  return { prompt, negativePrompt, scene, storyboard, stylePreset };
}
