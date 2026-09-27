import type { ImageGenerationPort } from "@gen-story/application";
import {
  DEFAULT_IMAGE_GENERATION_MODEL,
  isGeminiImageModel,
} from "@gen-story/shared";

// Picks the provider per request from `inputJson.model`, which the GUI sets.
// A request without a model (older rows, API callers) uses the default, so a
// retry of such a request also lands on the default provider.
export class RoutingImageGenerationAdapter implements ImageGenerationPort {
  constructor(
    private readonly gemini: ImageGenerationPort,
    private readonly openai: ImageGenerationPort,
  ) {}

  generate(input: {
    requestId: string;
    inputJson: Record<string, unknown>;
  }): ReturnType<ImageGenerationPort["generate"]> {
    const model =
      typeof input.inputJson.model === "string" && input.inputJson.model
        ? input.inputJson.model
        : DEFAULT_IMAGE_GENERATION_MODEL;
    const adapter = isGeminiImageModel(model) ? this.gemini : this.openai;
    return adapter.generate({
      ...input,
      inputJson: { ...input.inputJson, model },
    });
  }
}
