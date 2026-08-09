import { createHash } from "node:crypto";

import type {
  ImageGenerationPort,
  ObjectStoragePort,
} from "@gen-story/application";
import OpenAI, { toFile } from "openai";

import { buildGeneratedImageStorageKey } from "../storage/storage-keys";

type NormalizedInputImageRef = { storageKey: string };

export type ImageGenerationMode =
  | { kind: "generate" }
  | {
      kind: "edit";
      inputFidelity: "low" | "high";
      storageKeys: string[];
    };

// Pure and separately testable from the OpenAI network call it feeds, so the
// off/low/high branching can be verified without spending money. "off" (or a
// scene with no assigned photos) reproduces the original prompt-only
// behavior exactly; "low"/"high" map straight onto OpenAI's input_fidelity,
// which is the full range images.edit exposes — there is no continuous value
// to interpolate toward.
export function selectImageGenerationMode(input: {
  photoFidelity?: string;
  normalizedInputImages?: NormalizedInputImageRef[];
}): ImageGenerationMode {
  const images = input.normalizedInputImages ?? [];

  if (
    (input.photoFidelity === "low" || input.photoFidelity === "high") &&
    images.length > 0
  ) {
    return {
      kind: "edit",
      inputFidelity: input.photoFidelity,
      storageKeys: images.map((image) => image.storageKey),
    };
  }

  return { kind: "generate" };
}

// Verified against a live 400 from the API ("The model 'gpt-image-2' does not
// support the 'input_fidelity' parameter") and against OpenAI's image
// generation guide: "For gpt-image-2, omit this parameter; the API doesn't
// allow changing it because the model processes every image input at high
// fidelity automatically." gpt-image-2 is this adapter's default and, absent
// a way to configure a different model, its only model in practice — every
// edit call therefore already runs at maximum fidelity, with no lower setting
// exposed by the API, regardless of what the scene's photoFidelity is set to.
//
// Only gpt-image-1 is confirmed (via OpenAI's own cookbook) to accept
// input_fidelity. gpt-image-1.5's support is inconsistently documented across
// secondary sources, so it is treated as unsupported rather than guessed —
// the failure mode of guessing wrong here is a paid call that 400s.
const MODELS_SUPPORTING_INPUT_FIDELITY = new Set(["gpt-image-1"]);

export function supportsInputFidelity(model: string): boolean {
  return MODELS_SUPPORTING_INPUT_FIDELITY.has(model);
}

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
      quality = "auto",
      projectId = "unknown-project",
      sceneId = "unknown-scene",
      photoFidelity,
      normalizedInputImages,
    } = input.inputJson as {
      prompt?: string;
      model?: string;
      size?: string;
      quality?: string;
      projectId?: string;
      sceneId?: string;
      photoFidelity?: string;
      normalizedInputImages?: NormalizedInputImageRef[];
    };

    const mode = selectImageGenerationMode({
      photoFidelity,
      normalizedInputImages,
    });

    let b64: string;

    if (mode.kind === "edit") {
      const imageFiles = await Promise.all(
        mode.storageKeys.map(async (key, i) => {
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
        image: imageFiles,
        prompt: String(prompt),
        size: size as Parameters<typeof this.client.images.edit>[0]["size"],
        // Omitted entirely (not sent as undefined) for models that reject it —
        // gpt-image-2 400s on the mere presence of this field.
        ...(supportsInputFidelity(model)
          ? { input_fidelity: mode.inputFidelity }
          : {}),
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
