// The selected id is sent as `inputJson.model` on each generation request.
export type ImageGenerationModelOption = {
  id: string;
  label: string;
  provider: "auto" | "gemini" | "openai";
};

export const IMAGE_GENERATION_MODELS: readonly ImageGenerationModelOption[] = [
  {
    id: "auto",
    label: "Automatic (Codex → Gemini API)",
    provider: "auto",
  },
  {
    id: "gemini-3.1-flash-image",
    label: "Nano Banana 2 (Gemini 3.1 Flash Image)",
    provider: "gemini",
  },
  {
    id: "gpt-image-2.5-flare-2026-09-08",
    label: "GPT Image 2.5 (OpenAI)",
    provider: "openai",
  },
];

export const DEFAULT_IMAGE_GENERATION_MODEL = "auto";
export const DEFAULT_GEMINI_IMAGE_MODEL = "gemini-3.1-flash-image";

export function isGeminiImageModel(model: string): boolean {
  return model.startsWith("gemini-");
}
