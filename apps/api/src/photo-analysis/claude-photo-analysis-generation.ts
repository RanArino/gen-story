import type {
  ObjectStoragePort,
  PhotoAnalysisGenerationInput,
  PhotoAnalysisGenerationPort,
  PhotoAnalysisGenerationResult,
} from "@gen-story/application";

import type { ClaudeJsonGenerationImage } from "../agent-runtime/stateless/claude-json-generation";
import { runClaudeJsonGeneration } from "../agent-runtime/stateless/claude-json-generation";
import { createAiInputImage } from "../images/image-metadata";
import {
  buildPhotoAnalysisPrompt,
  parsePhotoAnalysisResult,
  PHOTO_ANALYSIS_RESPONSE_JSON_SCHEMA,
} from "./photo-analysis-generation-contract";

export class ClaudePhotoAnalysisGenerationAdapter implements PhotoAnalysisGenerationPort {
  constructor(
    private readonly objectStorage: ObjectStoragePort,
    private readonly generate = runClaudeJsonGeneration,
  ) {}

  async analyzeProjectPhotos(
    input: PhotoAnalysisGenerationInput,
  ): Promise<PhotoAnalysisGenerationResult> {
    const images: ClaudeJsonGenerationImage[] = [];
    for (const photo of input.photos) {
      const body = await this.objectStorage.getObject(photo.storageKey);
      if (body == null) {
        throw new Error(`Photo object not found for analysis: ${photo.id}`);
      }
      const normalized = await createAiInputImage(body);
      images.push({ mimeType: normalized.mimeType, body: normalized.body });
    }

    return this.generate(
      {
        prompt: buildPhotoAnalysisPrompt(input),
        jsonSchema: PHOTO_ANALYSIS_RESPONSE_JSON_SCHEMA,
        images,
      },
      (text, model) => parsePhotoAnalysisResult(text, model),
    );
  }
}
