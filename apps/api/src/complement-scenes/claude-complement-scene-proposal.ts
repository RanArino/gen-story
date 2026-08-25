import type {
  ComplementSceneProposal,
  ComplementSceneProposalInput,
  ComplementSceneProposalPort,
  ObjectStoragePort,
} from "@gen-story/application";

import type { ClaudeJsonGenerationImage } from "../agent-runtime/stateless/claude-json-generation";
import { runClaudeJsonGeneration } from "../agent-runtime/stateless/claude-json-generation";
import { createAiInputImage } from "../images/image-metadata";
import {
  buildComplementScenePrompt,
  COMPLEMENT_SCENE_RESPONSE_JSON_SCHEMA,
  parseComplementSceneProposals,
} from "./complement-scene-generation-contract";

export class ClaudeComplementSceneProposalAdapter implements ComplementSceneProposalPort {
  constructor(
    private readonly objectStorage: ObjectStoragePort,
    private readonly generate = runClaudeJsonGeneration,
  ) {}

  async proposeComplementScenes(
    input: ComplementSceneProposalInput,
  ): Promise<ComplementSceneProposal[]> {
    const images: ClaudeJsonGenerationImage[] = [];
    for (const photo of input.projectPhotos.filter(
      (candidate) => candidate.deletedAt === null,
    )) {
      const body = await this.objectStorage.getObject(photo.storageKey);
      if (body == null) {
        continue;
      }
      const normalized = await createAiInputImage(body);
      images.push({ mimeType: normalized.mimeType, body: normalized.body });
    }

    return this.generate(
      {
        prompt: buildComplementScenePrompt(input),
        jsonSchema: COMPLEMENT_SCENE_RESPONSE_JSON_SCHEMA,
        images,
      },
      (text) => parseComplementSceneProposals(text),
    );
  }
}
