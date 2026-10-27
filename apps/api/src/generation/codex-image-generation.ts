import { createHash } from "node:crypto";
import type {
  ImageGenerationPort,
  ObjectStoragePort,
} from "@gen-story/application";
import sharp from "sharp";

import { runCodexImageGeneration } from "../agent-runtime/stateless/codex-image-generation";
import { buildGeneratedImageStorageKey } from "../storage/storage-keys";
import {
  selectImageGenerationMode,
  type NormalizedInputImageRef,
} from "./openai-image-generation";

export class CodexImageGenerationAdapter implements ImageGenerationPort {
  constructor(
    private readonly objectStorage: ObjectStoragePort,
    private readonly options: {
      environment?: NodeJS.ProcessEnv;
      generate?: typeof runCodexImageGeneration;
      storageKeyForInput?: (
        input: Parameters<ImageGenerationPort["generate"]>[0],
      ) => string;
    } = {},
  ) {}

  async generate(input: Parameters<ImageGenerationPort["generate"]>[0]) {
    const data = input.inputJson as {
      prompt?: string;
      size?: string;
      quality?: string;
      projectId?: string;
      sceneId?: string;
      photoFidelity?: string;
      normalizedInputImages?: NormalizedInputImageRef[];
    };
    const mode = selectImageGenerationMode(data);
    const images: Uint8Array[] = [];
    if (mode.kind === "edit") {
      for (const key of mode.storageKeys) {
        const body = await this.objectStorage.getObject(key);
        if (!body) throw new Error(`Input photo not found in storage: ${key}`);
        images.push(body);
      }
    }
    const source = await (this.options.generate ?? runCodexImageGeneration)({
      prompt: data.prompt ?? "A cinematic still image.",
      size: data.size,
      quality: data.quality,
      images,
      environment: this.options.environment,
    });
    const bytes = await sharp(Buffer.from(source)).png().toBuffer();
    const metadata = await sharp(bytes).metadata();
    const storageKey =
      this.options.storageKeyForInput?.(input) ??
      buildGeneratedImageStorageKey({
        projectId: data.projectId ?? "unknown-project",
        sceneId: data.sceneId ?? "unknown-scene",
        generatedImageId: `codex-${input.requestId}`,
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
      width: metadata.width ?? null,
      height: metadata.height ?? null,
      checksum: createHash("sha256").update(bytes).digest("hex"),
    };
  }
}
