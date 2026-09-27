import { createHash } from "node:crypto";

import type {
  ImageGenerationPort,
  ObjectStoragePort,
} from "@gen-story/application";
import { DEFAULT_IMAGE_GENERATION_MODEL } from "@gen-story/shared";

import { retryGeminiRateLimit } from "../gemini/gemini-rate-limit";
import { ensurePngImage } from "../images/image-metadata";
import { buildGeneratedImageStorageKey } from "../storage/storage-keys";
import {
  selectImageGenerationMode,
  type NormalizedInputImageRef,
} from "./openai-image-generation";

type GeminiInlineData = { mimeType?: string; data?: string };

export type GeminiImageClient = {
  models: {
    generateContent(input: unknown): Promise<{
      candidates?: Array<{
        content?: { parts?: Array<{ inlineData?: GeminiInlineData }> };
      }>;
    }>;
  };
};

// OpenAI-style sizes are what callers already send; Gemini takes an aspect
// ratio instead. Anything unrecognized falls back to square, matching the
// OpenAI adapter's 1024x1024 default.
const ASPECT_RATIO_BY_SIZE: Record<string, string> = {
  "1024x1024": "1:1",
  "1536x1024": "3:2",
  "1024x1536": "2:3",
};

export function aspectRatioForSize(size: string | undefined): string {
  return ASPECT_RATIO_BY_SIZE[size ?? ""] ?? "1:1";
}

// The client is built by the caller so the same adapter runs against either
// the Gemini Developer API (API key) or Vertex AI (gcloud credentials).
export class GeminiImageGenerationAdapter implements ImageGenerationPort {
  constructor(
    private readonly objectStorage: ObjectStoragePort,
    private readonly client: GeminiImageClient,
  ) {}

  async generate(input: {
    requestId: string;
    inputJson: Record<string, unknown>;
  }): Promise<{
    storageKey: string;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
    checksum: string;
  }> {
    const {
      prompt = "A cinematic still image.",
      model = DEFAULT_IMAGE_GENERATION_MODEL,
      size,
      projectId = "unknown-project",
      sceneId = "unknown-scene",
      photoFidelity,
      normalizedInputImages,
    } = input.inputJson as {
      prompt?: string;
      model?: string;
      size?: string;
      projectId?: string;
      sceneId?: string;
      photoFidelity?: string;
      normalizedInputImages?: NormalizedInputImageRef[];
    };

    // Same off/low/high decision as OpenAI: reference photos are attached only
    // when the scene asks for photo fidelity. The low/high distinction itself
    // is carried by the composed prompt's fidelity directive.
    const mode = selectImageGenerationMode({
      photoFidelity,
      normalizedInputImages,
    });

    const parts: unknown[] = [{ text: String(prompt) }];
    if (mode.kind === "edit") {
      for (const key of mode.storageKeys) {
        const bytes = await this.objectStorage.getObject(key);
        if (bytes == null) {
          throw new Error(`Input photo not found in storage: ${key}`);
        }
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: Buffer.from(bytes).toString("base64"),
          },
        });
      }
    }

    const response = await retryGeminiRateLimit(() =>
      this.client.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: aspectRatioForSize(size) },
        },
      }),
    );

    const b64 = response.candidates?.[0]?.content?.parts?.find(
      (part) => part.inlineData?.data,
    )?.inlineData?.data;
    if (!b64) {
      throw new Error("Gemini returned an empty image response.");
    }

    const bytes = await ensurePngImage(
      new Uint8Array(Buffer.from(b64, "base64")),
    );
    const checksum = createHash("sha256").update(bytes).digest("hex");

    const storageKey = buildGeneratedImageStorageKey({
      projectId: String(projectId),
      sceneId: String(sceneId),
      generatedImageId: `gemini-${input.requestId}`,
      extension: "png",
    });

    await this.objectStorage.putObject({
      key: storageKey,
      body: bytes,
      contentType: "image/png",
    });

    return {
      storageKey,
      mimeType: "image/png",
      size: bytes.byteLength,
      width: null,
      height: null,
      checksum,
    };
  }
}
