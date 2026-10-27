import { createHash } from "node:crypto";
import type { ObjectStoragePort } from "@gen-story/application";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

import { AutomaticImageGenerationAdapter } from "./automatic-image-generation";
import { AutomaticCharacterSheetGenerationAdapter } from "./character-sheet-generation";
import { CodexImageGenerationAdapter } from "./codex-image-generation";
import { GeminiImageGenerationAdapter } from "./gemini-image-generation";
import { buildCharacterSheetStorageKey } from "../storage/storage-keys";

function storage(): ObjectStoragePort & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async getObject(key) {
      return objects.get(key) ?? null;
    },
    async putObject(input) {
      objects.set(input.key, input.body);
    },
    async deleteObject(key) {
      objects.delete(key);
    },
  };
}

async function png() {
  return sharp({
    create: { width: 3, height: 2, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
}

describe("Codex image adapters", () => {
  it.each(["low", "high"])(
    "forwards every reference in order at %s fidelity and stores valid metadata",
    async (photoFidelity) => {
      const objects = storage();
      const first = await png();
      const second = await png();
      objects.objects.set("primary", first);
      objects.objects.set("reference", second);
      const generate = vi.fn().mockResolvedValue(first);
      const adapter = new CodexImageGenerationAdapter(objects, { generate });
      const result = await adapter.generate({
        requestId: "req-1",
        inputJson: {
          projectId: "project-1",
          sceneId: "scene-1",
          prompt: "Keep the same people",
          photoFidelity,
          normalizedInputImages: [
            { storageKey: "primary" },
            { storageKey: "reference" },
          ],
        },
      });
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: "Keep the same people",
          images: [first, second],
        }),
      );
      expect(result).toMatchObject({
        width: 3,
        height: 2,
        mimeType: "image/png",
      });
      expect(result.storageKey).toContain("/scenes/scene-1/codex-req-1.png");
      expect(result.checksum).toBe(
        createHash("sha256")
          .update(objects.objects.get(result.storageKey)!)
          .digest("hex"),
      );
    },
  );

  it("does not read or attach photos when fidelity is off", async () => {
    const objects = storage();
    const generate = vi.fn().mockResolvedValue(await png());
    const adapter = new CodexImageGenerationAdapter(objects, { generate });
    await adapter.generate({
      requestId: "req-1",
      inputJson: {
        photoFidelity: "off",
        normalizedInputImages: [{ storageKey: "missing" }],
      },
    });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ images: [] }),
    );
  });

  it("reports missing reference images before invoking Codex", async () => {
    const generate = vi.fn();
    const adapter = new CodexImageGenerationAdapter(storage(), { generate });
    await expect(
      adapter.generate({
        requestId: "req-1",
        inputJson: {
          photoFidelity: "high",
          normalizedInputImages: [{ storageKey: "missing" }],
        },
      }),
    ).rejects.toThrow("Input photo not found");
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "preserves character-sheet storage and landscape framing (fallback=%s)",
    async (fallback) => {
      const objects = storage();
      const bytes = await png();
      const generate = vi.fn().mockResolvedValue(bytes);
      if (fallback) generate.mockRejectedValue(new Error("quota exceeded"));
      const storageKeyForInput = (input: {
        requestId: string;
        inputJson: Record<string, unknown>;
      }) =>
        buildCharacterSheetStorageKey({
          jobId: input.requestId,
          projectId: String(input.inputJson.projectId),
          storyboardId: String(input.inputJson.storyboardId),
        });
      const generateContent = vi.fn().mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { data: bytes.toString("base64") } }],
            },
          },
        ],
      });
      const codex = new CodexImageGenerationAdapter(objects, {
        generate,
        storageKeyForInput,
      });
      const gemini = new GeminiImageGenerationAdapter(
        objects,
        { models: { generateContent } },
        storageKeyForInput,
      );
      const adapter = new AutomaticCharacterSheetGenerationAdapter(
        new AutomaticImageGenerationAdapter(codex, gemini),
      );
      const result = await adapter.generate({
        jobId: "sheet-1",
        projectId: "project-1",
        storyboardId: "storyboard-1",
        prompt: "One recurring character",
      });
      expect(result.storageKey).toBe(
        "data/uploads/generated/character-sheets/projects/project-1/storyboards/storyboard-1/sheet-1.png",
      );
      expect(result).toMatchObject({ width: 3, height: 2 });
      expect(objects.objects.size).toBe(1);
      expect(generate).toHaveBeenCalledWith(
        expect.objectContaining({
          size: "1536x1024",
          quality: "high",
          prompt: "One recurring character",
        }),
      );
      if (fallback)
        expect(generateContent).toHaveBeenCalledWith(
          expect.objectContaining({
            model: "gemini-3.1-flash-image",
            config: expect.objectContaining({
              imageConfig: { aspectRatio: "3:2" },
            }),
          }),
        );
      else expect(generateContent).not.toHaveBeenCalled();
    },
  );
});
