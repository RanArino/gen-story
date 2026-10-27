import { describe, expect, it, vi } from "vitest";
import { DEFAULT_IMAGE_GENERATION_MODEL } from "@gen-story/shared";

import { AutomaticImageGenerationAdapter } from "./automatic-image-generation";
import { RoutingImageGenerationAdapter } from "./routing-image-generation";

const result = {
  storageKey: "data/uploads/generated/result.png",
  mimeType: "image/png",
  size: 10,
  width: 1,
  height: 1,
  checksum: "checksum",
};
const input = { requestId: "request-1", inputJson: { prompt: "A scene" } };

function provider() {
  return { generate: vi.fn().mockResolvedValue(result) };
}

describe("Automatic image generation", () => {
  it("defaults new requests to Automatic and preserves explicit API choices", async () => {
    expect(DEFAULT_IMAGE_GENERATION_MODEL).toBe("auto");
    const gemini = provider();
    const openai = provider();
    const automatic = provider();
    const router = new RoutingImageGenerationAdapter(gemini, openai, automatic);
    await router.generate(input);
    await router.generate({
      ...input,
      inputJson: { model: "gemini-3.1-flash-image" },
    });
    await router.generate({
      ...input,
      inputJson: { model: "gpt-image-2.5-flare-2026-09-08" },
    });
    expect(automatic.generate).toHaveBeenCalledOnce();
    expect(gemini.generate).toHaveBeenCalledOnce();
    expect(openai.generate).toHaveBeenCalledOnce();
  });

  it("does not call Gemini after Codex succeeds", async () => {
    const codex = provider();
    const gemini = provider();
    const adapter = new AutomaticImageGenerationAdapter(codex, gemini);
    expect(await adapter.generate(input)).toEqual(result);
    expect(gemini.generate).not.toHaveBeenCalled();
  });

  it.each([
    "missing CLI",
    "login required",
    "quota exceeded",
    "timed out",
    "invalid image",
    "tool unavailable",
  ])(
    "falls back on %s and tries Codex again for the next image",
    async (message) => {
      const codex = provider();
      codex.generate.mockRejectedValueOnce(new Error(message));
      const gemini = provider();
      const adapter = new AutomaticImageGenerationAdapter(codex, gemini);
      await adapter.generate(input);
      await adapter.generate({ ...input, requestId: "request-2" });
      expect(codex.generate).toHaveBeenCalledTimes(2);
      expect(gemini.generate).toHaveBeenCalledOnce();
      expect(gemini.generate).toHaveBeenCalledWith({
        ...input,
        inputJson: { ...input.inputJson, model: "gemini-3.1-flash-image" },
      });
    },
  );

  it("reports both errors with secrets redacted", async () => {
    const codex = provider();
    codex.generate.mockRejectedValue(new Error("quota exceeded"));
    const gemini = provider();
    gemini.generate.mockRejectedValue(
      new Error("failed using private-key-value"),
    );
    const adapter = new AutomaticImageGenerationAdapter(codex, gemini, {
      environment: { GEMINI_API_KEY: "private-key-value" },
    });
    await expect(adapter.generate(input)).rejects.toThrow(
      "Codex: quota exceeded; Gemini: failed using [REDACTED]",
    );
  });

  it("fails rather than returning a placeholder when fallback credentials are absent", async () => {
    const codex = provider();
    codex.generate.mockRejectedValue(new Error("not logged in"));
    const adapter = new AutomaticImageGenerationAdapter(codex, null);
    await expect(adapter.generate(input)).rejects.toThrow(
      "Gemini image generation is not configured",
    );
  });

  it("skips Codex outside local deployment", async () => {
    const gemini = provider();
    const adapter = new AutomaticImageGenerationAdapter(null, gemini);
    expect(await adapter.generate(input)).toEqual(result);
    expect(gemini.generate).toHaveBeenCalledOnce();
  });

  it("does not start fallback after cancellation", async () => {
    const codex = provider();
    codex.generate.mockRejectedValue(new Error("timed out"));
    const gemini = provider();
    const canFallback = vi.fn().mockResolvedValue(false);
    const adapter = new AutomaticImageGenerationAdapter(codex, gemini, {
      canFallback,
    });
    await expect(adapter.generate(input)).rejects.toThrow("canceled");
    expect(canFallback).toHaveBeenCalledWith("request-1");
    expect(gemini.generate).not.toHaveBeenCalled();
  });
});
