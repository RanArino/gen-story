import type {
  ObjectStoragePort,
  SceneFillGenerationInput,
  SceneFillGenerationPort,
  SceneFillSuggestion,
} from "@gen-story/application";

import type { ClaudeJsonGenerationImage } from "../agent-runtime/stateless/claude-json-generation";
import { runClaudeJsonGeneration } from "../agent-runtime/stateless/claude-json-generation";
import { createAiInputImage } from "../images/image-metadata";
import {
  buildSceneFillPrompt,
  parseSceneFillSuggestion,
  SCENE_FILL_RESPONSE_JSON_SCHEMA,
} from "./scene-fill-generation-contract";

export class ClaudeSceneFillGenerationAdapter implements SceneFillGenerationPort {
  constructor(
    private readonly objectStorage: ObjectStoragePort,
    private readonly generate = runClaudeJsonGeneration,
  ) {}

  async generateSceneFill(
    input: SceneFillGenerationInput,
  ): Promise<SceneFillSuggestion> {
    // The primary photo, then whatever this scene named as a reference. The
    // project's other photos are deliberately not sent: what the vision pass
    // learned about them already arrives as text in `analysisContext`.
    const photoOrder = [
      input.primaryPhoto,
      ...input.referencePhotos.filter(
        (photo) => photo.id !== input.primaryPhoto.id,
      ),
    ];

    const images: ClaudeJsonGenerationImage[] = [];
    for (const photo of photoOrder) {
      const body = await this.objectStorage.getObject(photo.storageKey);
      if (body == null) {
        continue;
      }
      const normalized = await createAiInputImage(body);
      images.push({ mimeType: normalized.mimeType, body: normalized.body });
    }

    return this.generate(
      {
        prompt: buildSceneFillPrompt(input),
        jsonSchema: SCENE_FILL_RESPONSE_JSON_SCHEMA,
        images,
      },
      (text) => parseSceneFillSuggestion(text),
    );
  }
}
