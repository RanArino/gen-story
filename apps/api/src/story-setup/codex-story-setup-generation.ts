import type {
  StorySetupGenerationInput,
  StorySetupGenerationPort,
  StorySetupSuggestion,
} from "@gen-story/application";

import { runCodexJsonGeneration } from "../agent-runtime/stateless/codex-json-generation";
import {
  buildStorySetupPrompt,
  parseStorySetupSuggestion,
  STORY_SETUP_RESPONSE_JSON_SCHEMA,
} from "./story-setup-generation-contract";

export class CodexStorySetupGenerationAdapter implements StorySetupGenerationPort {
  constructor(private readonly generate = runCodexJsonGeneration) {}

  async generateStorySetup(
    input: StorySetupGenerationInput,
  ): Promise<StorySetupSuggestion> {
    return this.generate(
      {
        prompt: buildStorySetupPrompt(input),
        jsonSchema: STORY_SETUP_RESPONSE_JSON_SCHEMA,
      },
      (text, model) => parseStorySetupSuggestion(text, model),
    );
  }
}
