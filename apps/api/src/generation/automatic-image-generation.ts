import type { ImageGenerationPort } from "@gen-story/application";
import {
  DEFAULT_GEMINI_IMAGE_MODEL,
  UKIYO_E_STYLE_PRESET_ID,
} from "@gen-story/shared";

import {
  collectSensitiveEnvironmentValues,
  redactSensitiveText,
} from "../agent-runtime/redaction";

export class AutomaticImageGenerationAdapter implements ImageGenerationPort {
  constructor(
    private readonly codex: ImageGenerationPort | null,
    private readonly gemini: ImageGenerationPort | null,
    private readonly options: {
      canFallback?: (requestId: string) => Promise<boolean>;
      environment?: NodeJS.ProcessEnv;
    } = {},
  ) {}

  async generate(input: Parameters<ImageGenerationPort["generate"]>[0]) {
    const sensitive = collectSensitiveEnvironmentValues(
      this.options.environment ?? process.env,
    );
    const message = (error: unknown) =>
      redactSensitiveText(
        error instanceof Error ? error.message : String(error),
        sensitive,
      ).slice(0, 300);
    let codexError = "Codex is disabled outside local deployment";
    if (this.codex) {
      try {
        const result = await this.codex.generate(input);
        console.log(`[Image generation] ${input.requestId}: Codex succeeded`);
        return result;
      } catch (error) {
        codexError = message(error);
      }
    }

    if (input.inputJson.stylePresetId === UKIYO_E_STYLE_PRESET_ID) {
      const detail = `Ukiyo-e Woodblock uses Codex for Automatic generation. Codex: ${codexError}. Check Codex and retry.`;
      console.log(`[Image generation] ${input.requestId}: failed; ${detail}`);
      throw new Error(detail);
    }

    if (
      this.options.canFallback &&
      !(await this.options.canFallback(input.requestId))
    ) {
      throw new Error("Image generation was canceled; API fallback skipped.");
    }
    console.log(
      `[Image generation] ${input.requestId}: Gemini fallback; Codex: ${codexError}`,
    );
    try {
      if (!this.gemini)
        throw new Error("Gemini image generation is not configured.");
      const result = await this.gemini.generate({
        ...input,
        inputJson: { ...input.inputJson, model: DEFAULT_GEMINI_IMAGE_MODEL },
      });
      console.log(`[Image generation] ${input.requestId}: Gemini succeeded`);
      return result;
    } catch (error) {
      const detail = `Codex: ${codexError}; Gemini: ${message(error)}`;
      console.log(`[Image generation] ${input.requestId}: failed; ${detail}`);
      throw new Error(detail);
    }
  }
}
