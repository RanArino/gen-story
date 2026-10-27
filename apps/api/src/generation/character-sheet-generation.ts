import type {
  CharacterSheetGenerationPort,
  ImageGenerationPort,
} from "@gen-story/application";

export class AutomaticCharacterSheetGenerationAdapter implements CharacterSheetGenerationPort {
  constructor(private readonly imageGeneration: ImageGenerationPort) {}

  generate(input: Parameters<CharacterSheetGenerationPort["generate"]>[0]) {
    return this.imageGeneration.generate({
      requestId: input.jobId,
      inputJson: {
        projectId: input.projectId,
        storyboardId: input.storyboardId,
        prompt: input.prompt,
        size: "1536x1024",
        quality: "high",
      },
    });
  }
}
