import type {
  StorySetupGenerationInput,
  StorySetupGenerationPort,
  StorySetupSuggestion,
} from "@gen-story/application";
import { composeCommonPrompt } from "@gen-story/domain";
import { RECOMMENDED_NEGATIVE_FENCE } from "@gen-story/shared";

export const LOCAL_STORY_SETUP_MODEL = "local-deterministic";

// The no-key fallback for setup step 4. Tone and style are already decided by
// the time this runs, so the deterministic template still produces a usable
// common prompt and the flow is not blocked on having a Gemini key. The model
// name is reported back so the UI can say plainly that no AI was involved.
export class LocalStorySetupGenerationAdapter implements StorySetupGenerationPort {
  async generateStorySetup(
    input: StorySetupGenerationInput,
  ): Promise<StorySetupSuggestion> {
    return {
      story: input.photoAnalysis?.storySummary.trim() ?? "",
      commonPrompt: composeCommonPrompt({
        tone: input.storyboard.tone,
        stylePresetName: input.stylePreset?.name ?? null,
        stylePresetPrompt: input.stylePreset?.prompt ?? null,
      }),
      negativePrompt: RECOMMENDED_NEGATIVE_FENCE,
      model: LOCAL_STORY_SETUP_MODEL,
    };
  }
}
