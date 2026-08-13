import { createHash } from "node:crypto";

import type {
  CharacterSheetGenerationPort,
  ObjectStoragePort,
} from "@gen-story/application";
import OpenAI from "openai";
import sharp from "sharp";

import { buildCharacterSheetStorageKey } from "../storage/storage-keys";

const MOCK_IMAGE = Buffer.from(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAP/EABQBAQAAAAAAAAAAAAAAAAAAAAD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwABmX/9k=",
  "base64",
);

async function storeResult(
  objectStorage: ObjectStoragePort,
  input: { jobId: string; projectId: string; storyboardId: string },
  source: Uint8Array,
) {
  const bytes = await sharp(source).png().toBuffer();
  const metadata = await sharp(bytes).metadata();
  const storageKey = buildCharacterSheetStorageKey(input);
  await objectStorage.putObject({
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

export class MockCharacterSheetGenerationAdapter implements CharacterSheetGenerationPort {
  constructor(private readonly objectStorage: ObjectStoragePort) {}

  generate(input: {
    jobId: string;
    projectId: string;
    storyboardId: string;
    prompt: string;
  }) {
    return storeResult(this.objectStorage, input, MOCK_IMAGE);
  }
}

export class OpenAiCharacterSheetGenerationAdapter implements CharacterSheetGenerationPort {
  private readonly client: OpenAI;

  constructor(
    private readonly objectStorage: ObjectStoragePort,
    apiKey: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async generate(input: {
    jobId: string;
    projectId: string;
    storyboardId: string;
    prompt: string;
  }) {
    const response = await this.client.images.generate({
      model: "gpt-image-2",
      prompt: input.prompt,
      size: "1536x1024",
      quality: "high",
      n: 1,
    });
    const encoded = response.data?.[0]?.b64_json;
    if (!encoded) throw new Error("OpenAI returned an empty character sheet.");
    return storeResult(
      this.objectStorage,
      input,
      Buffer.from(encoded, "base64"),
    );
  }
}
