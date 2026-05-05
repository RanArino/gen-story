import { createHash } from "node:crypto";

import type {
  ImageGenerationPort,
  ObjectStoragePort,
} from "@gen-story/application";

import { buildGeneratedImageStorageKey } from "../storage/storage-keys";

// Minimal valid 1×1 white JPEG (51 bytes)
const STUB_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U" +
    "HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgN" +
    "DRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy" +
    "MjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAA" +
    "AAAAAAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAA" +
    "AAAA/9oADAMBAAIRAxEAPwCwABmX/9k=",
  "base64",
);

export class MockImageGenerationAdapter implements ImageGenerationPort {
  constructor(private readonly objectStorage: ObjectStoragePort) {}

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
    const projectId =
      typeof input.inputJson.projectId === "string"
        ? input.inputJson.projectId
        : "mock-project";
    const sceneId =
      typeof input.inputJson.sceneId === "string"
        ? input.inputJson.sceneId
        : "mock-scene";

    const generatedImageId = `mock-${input.requestId}`;
    const storageKey = buildGeneratedImageStorageKey({
      projectId,
      sceneId,
      generatedImageId,
      extension: "jpg",
    });

    const bytes = new Uint8Array(STUB_JPEG);
    const checksum = createHash("sha256").update(bytes).digest("hex");

    await this.objectStorage.putObject({
      key: storageKey,
      body: bytes,
      contentType: "image/jpeg",
    });

    return {
      storageKey,
      mimeType: "image/jpeg",
      size: bytes.byteLength,
      width: 1,
      height: 1,
      checksum,
    };
  }
}
