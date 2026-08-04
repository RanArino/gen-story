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
  story?: string;
  sceneNegativePrompt?: string;
  projectNegativePrompt?: string;
  photoFidelity?: Scene["photoFidelity"];
};

// gpt-image-2 has no adjustable input_fidelity parameter — attaching a photo
// to an edit call always applies maximum fidelity at the API level (see
// supportsInputFidelity in apps/api/src/generation/openai-image-generation.ts,
// added after a live 400 confirmed the parameter is rejected outright). This
// directive is the one remaining lever for a "low" vs "high" distinction:
// explicit prompt language, which is OpenAI's own documented technique for
// steering how strictly a model follows a reference image when no numeric
// parameter exists. It is not an enforced setting the way input_fidelity was
// on gpt-image-1 — it is the model's best effort at following an instruction.
// Only applied when the scene actually has a photo to attach; with none
// (photoFidelity "off", or no photoAssets) there is nothing for the directive
// to refer to.
function photoFidelityDirective(
  photoFidelity: Scene["photoFidelity"],
  hasPhotos: boolean,
): string | null {
  if (!hasPhotos || photoFidelity === "off") return null;

  if (photoFidelity === "high") {
    return "Treat the attached reference photo as ground truth: preserve the subject's likeness, pose, framing, and setting precisely rather than reinterpreting them.";
  }

  return "Use the attached reference photo only as loose inspiration for mood and composition — feel free to reinterpret the subject's pose, framing, and setting rather than replicating the photo.";
}

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

  const basePrompt = composeImagePrompt({
    imagePrompt: overrides.imagePrompt ?? scene.imagePrompt ?? "",
    emotion: overrides.emotion ?? scene.emotion ?? "",
    cameraDirection: overrides.cameraDirection ?? scene.cameraDirection ?? "",
    lightingDirection:
      overrides.lightingDirection ?? scene.lightingDirection ?? "",
    motionDirection: overrides.motionDirection ?? scene.motionDirection ?? "",
    tone: storyboard.tone ?? "",
    stylePresetPrompt: stylePreset?.prompt ?? null,
    commonPrompt: overrides.commonPrompt ?? storyboard.commonPrompt ?? "",
    story: overrides.story ?? storyboard.story ?? "",
    negativePrompt,
  });

  const fidelityDirective = photoFidelityDirective(
    overrides.photoFidelity ?? scene.photoFidelity,
    scene.photoAssets.length > 0,
  );
  const prompt = fidelityDirective
    ? `${basePrompt}. ${fidelityDirective}`
    : basePrompt;

  return { prompt, negativePrompt, scene, storyboard, stylePreset };
}
