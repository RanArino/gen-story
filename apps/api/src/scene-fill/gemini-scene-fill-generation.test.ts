import { describe, expect, it } from "vitest";

import type { ObjectStoragePort } from "@gen-story/application";
import {
  createPhotoAsset,
  createScene,
  createStoryboard,
  createProject,
} from "@gen-story/domain";

import { GeminiSceneFillGenerationAdapter } from "./gemini-scene-fill-generation";

class MemoryObjectStorage implements ObjectStoragePort {
  constructor(private readonly body: Uint8Array | null) {}
  async putObject(): Promise<void> {}
  async getObject(): Promise<Uint8Array | null> {
    return this.body;
  }
  async deleteObject(): Promise<void> {}
}

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64",
);

const ts = "2026-05-02T00:00:00.000Z";

function input() {
  const primaryPhoto = createPhotoAsset({
    id: "photo_1",
    projectId: "project_1",
    name: "family.png",
    storageKey: "family.png",
    mimeType: "image/png",
    size: onePixelPng.byteLength,
    checksum: "checksum",
    sourceKind: "upload",
    createdAt: ts,
    updatedAt: ts,
  });
  return {
    project: createProject({
      id: "project_1",
      organizationId: "org_1",
      ownerUserId: "user_1",
      name: "Anniversary",
      createdAt: ts,
      updatedAt: ts,
    }),
    storyboard: createStoryboard({
      id: "storyboard_1",
      projectId: "project_1",
      tone: "warm",
      createdAt: ts,
      updatedAt: ts,
    }),
    scene: createScene({
      id: "scene_1",
      projectId: "project_1",
      storyboardId: "storyboard_1",
      orderIndex: 0,
      title: "",
      description: "",
      imagePrompt: "",
      emotion: "",
      cameraDirection: "",
      lightingDirection: "",
      motionDirection: "",
      createdAt: ts,
      updatedAt: ts,
    }),
    primaryPhoto,
    stylePreset: null,
    projectPhotos: [primaryPhoto],
    siblingScenes: [],
    photoAnalysis: null,
    language: "en" as const,
  };
}

const validResponse = {
  text: JSON.stringify({
    title: "Morning Light",
    description: "The family gathers in soft morning light.",
    imagePrompt: "A warm cinematic shot of a family at home.",
    emotion: "Warm",
    cameraDirection: "Medium",
    lightingDirection: "Natural",
    motionDirection: "Slow pan",
  }),
};

describe("GeminiSceneFillGenerationAdapter", () => {
  it("maps validated Gemini JSON into a scene fill suggestion", async () => {
    const client = {
      models: {
        async generateContent() {
          return validResponse;
        },
      },
    };
    const adapter = new GeminiSceneFillGenerationAdapter(
      new MemoryObjectStorage(onePixelPng),
      "test-key",
      "gemini-test",
      client,
    );

    const result = await adapter.generateSceneFill(input());

    expect(result.title).toBe("Morning Light");
    expect(result.motionDirection).toBe("Slow pan");
  });

  it("throws a clear error when GEMINI_API_KEY is unset", async () => {
    const adapter = new GeminiSceneFillGenerationAdapter(
      new MemoryObjectStorage(onePixelPng),
      undefined,
      "gemini-test",
    );

    await expect(adapter.generateSceneFill(input())).rejects.toThrow(
      /GEMINI_API_KEY/,
    );
  });

  it("rejects malformed Gemini JSON", async () => {
    const client = {
      models: {
        async generateContent() {
          return { text: JSON.stringify({ title: "" }) };
        },
      },
    };
    const adapter = new GeminiSceneFillGenerationAdapter(
      new MemoryObjectStorage(onePixelPng),
      "test-key",
      "gemini-test",
      client,
    );

    await expect(adapter.generateSceneFill(input())).rejects.toThrow();
  });

  it("injects a Japanese language directive when language=ja", async () => {
    let capturedPrompt = "";
    const client = {
      models: {
        async generateContent(req: {
          contents: Array<{ parts: Array<{ text?: string }> }>;
        }) {
          const text = req.contents[0]?.parts[0]?.text;
          capturedPrompt = typeof text === "string" ? text : "";
          return validResponse;
        },
      },
    };
    const adapter = new GeminiSceneFillGenerationAdapter(
      new MemoryObjectStorage(onePixelPng),
      "test-key",
      "gemini-test",
      client,
    );

    await adapter.generateSceneFill({ ...input(), language: "ja" });

    expect(capturedPrompt).toMatch(/Respond in Japanese/);
    expect(capturedPrompt).toMatch(/remain in English/);
  });

  it("injects an English language directive when language=en", async () => {
    let capturedPrompt = "";
    const client = {
      models: {
        async generateContent(req: {
          contents: Array<{ parts: Array<{ text?: string }> }>;
        }) {
          const text = req.contents[0]?.parts[0]?.text;
          capturedPrompt = typeof text === "string" ? text : "";
          return validResponse;
        },
      },
    };
    const adapter = new GeminiSceneFillGenerationAdapter(
      new MemoryObjectStorage(onePixelPng),
      "test-key",
      "gemini-test",
      client,
    );

    await adapter.generateSceneFill(input());

    expect(capturedPrompt).toMatch(/Respond in English/);
  });
});
