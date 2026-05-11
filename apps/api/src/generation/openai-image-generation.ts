import { createHash } from "node:crypto";

import type {
  ImageGenerationPort,
  ObjectStoragePort,
} from "@gen-story/application";
import OpenAI, { toFile } from "openai";

import { buildGeneratedImageStorageKey } from "../storage/storage-keys";

export class OpenAiImageGenerationAdapter implements ImageGenerationPort {
  private readonly client: OpenAI;

  constructor(
    private readonly objectStorage: ObjectStoragePort,
    openaiApiKey: string,
  ) {
    this.client = new OpenAI({ apiKey: openaiApiKey });
  }

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
      model = "gpt-image-2",
      size = "1024x1024",
      quality = "standard",
      projectId = "unknown-project",
      sceneId = "unknown-scene",
      inputPhotoStorageKeys,
    } = input.inputJson as {
      prompt?: string;
      model?: string;
      size?: string;
      quality?: string;
      projectId?: string;
      sceneId?: string;
      inputPhotoStorageKeys?: string[];
    };

    let b64: string;

    if (
      Array.isArray(inputPhotoStorageKeys) &&
      inputPhotoStorageKeys.length > 0
    ) {
      const imageFiles = await Promise.all(
        inputPhotoStorageKeys.map(async (key, i) => {
          const bytes = await this.objectStorage.getObject(key);
          if (bytes == null) {
            throw new Error(`Input photo not found in storage: ${key}`);
          }
          return toFile(Buffer.from(bytes), `input-${i}.jpg`, {
            type: "image/jpeg",
          });
        }),
      );

      const response = await this.client.images.edit({
        model: model as Parameters<typeof this.client.images.edit>[0]["model"],
        image: imageFiles[0]!,
        prompt: String(prompt),
        size: size as Parameters<typeof this.client.images.edit>[0]["size"],
        response_format: "b64_json",
      });

      b64 = response.data?.[0]?.b64_json ?? "";
    } else {
      const response = await this.client.images.generate({
        model: model as Parameters<
          typeof this.client.images.generate
        >[0]["model"],
        prompt: String(prompt),
        size: size as Parameters<typeof this.client.images.generate>[0]["size"],
        quality: quality as Parameters<
          typeof this.client.images.generate
        >[0]["quality"],
        response_format: "b64_json",
        n: 1,
      });

      b64 = response.data?.[0]?.b64_json ?? "";
    }

    if (!b64) {
      throw new Error("OpenAI returned an empty image response.");
    }

    const bytes = new Uint8Array(Buffer.from(b64, "base64"));
    const checksum = createHash("sha256").update(bytes).digest("hex");

    const generatedImageId = `openai-${input.requestId}`;
    const storageKey = buildGeneratedImageStorageKey({
      projectId: String(projectId),
      sceneId: String(sceneId),
      generatedImageId,
      extension: "jpg",
    });

    await this.objectStorage.putObject({
      key: storageKey,
      body: bytes,
      contentType: "image/jpeg",
    });

    return {
      storageKey,
      mimeType: "image/jpeg",
      size: bytes.byteLength,
      width: null,
      height: null,
      checksum,
    };
  }
}
