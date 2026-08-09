import type {
  SceneFillGenerationInput,
  SceneFillGenerationPort,
  SceneFillSuggestion,
} from "@gen-story/application";

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function normalize(value: string, fallback: string): string {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function titleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

export class LocalSceneFillGenerationAdapter implements SceneFillGenerationPort {
  async generateSceneFill(
    input: SceneFillGenerationInput,
  ): Promise<SceneFillSuggestion> {
    const subject = normalize(
      titleCase(stripExtension(input.primaryPhoto.name)),
      `Scene ${input.scene.orderIndex + 1}`,
    );
    const tone = normalize(input.storyboard.tone, "warm");
    const photoNotes = normalize(input.primaryPhoto.notes ?? "", subject);
    const styleName = normalize(input.stylePreset?.name ?? "", "cinematic");
    const stylePrompt = normalize(input.stylePreset?.prompt ?? "", styleName);
    const projectContext = normalize(input.project.name, "the story");
    const sceneNumber = input.scene.orderIndex + 1;
    const photoCount = 1 + input.referencePhotos.length;
    const siblingCount = input.siblingScenes.filter(
      (scene) => scene.id !== input.scene.id,
    ).length;

    return {
      title: normalize(`${subject} Moment`, `Scene ${sceneNumber}`),
      description: normalize(
        `Scene ${sceneNumber} highlights ${photoNotes} with a ${tone} feeling for ${projectContext}.`,
        `Scene ${sceneNumber} captures a ${tone} moment.`,
      ),
      imagePrompt: normalize(
        `Create a ${styleName} image of ${photoNotes}. Keep the mood ${tone}, preserve the primary photo's subject, and make it feel connected to ${photoCount} project photo${photoCount === 1 ? "" : "s"} and ${siblingCount} other storyboard scene${siblingCount === 1 ? "" : "s"}. Style guidance: ${stylePrompt}.`,
        `Create a ${tone} cinematic image for scene ${sceneNumber}.`,
      ),
      emotion: normalize(tone, "Warm"),
      cameraDirection: "Medium",
      lightingDirection: "Natural",
      motionDirection: "Slow pan",
    };
  }
}
