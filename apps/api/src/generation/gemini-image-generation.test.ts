import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  aspectRatioForSize,
  GeminiImageGenerationAdapter,
} from "./gemini-image-generation";
import { RoutingImageGenerationAdapter } from "./routing-image-generation";

class MemoryObjectStorage {
  readonly objects = new Map<string, Uint8Array>();

  async putObject(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<void> {
    this.objects.set(input.key, input.body);
  }

  async getObject(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

async function pngBase64(): Promise<string> {
  const png = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#fff" },
  })
    .png()
    .toBuffer();
  return png.toString("base64");
}

function fakeClient(b64: string | undefined) {
  const calls: unknown[] = [];
  return {
    calls,
    models: {
      async generateContent(input: unknown) {
        calls.push(input);
        return {
          candidates: [
            {
              content: {
                parts: [
                  { text: "here you go" },
                  ...(b64
                    ? [{ inlineData: { mimeType: "image/png", data: b64 } }]
                    : []),
                ],
              },
            },
          ],
        };
      },
    },
  };
}

describe("GeminiImageGenerationAdapter", () => {
  it("stores the returned image as PNG under a gemini-prefixed key", async () => {
    const storage = new MemoryObjectStorage();
    const client = fakeClient(await pngBase64());
    const adapter = new GeminiImageGenerationAdapter(storage, client);

    const result = await adapter.generate({
      requestId: "req-1",
      inputJson: {
        projectId: "proj-1",
        sceneId: "scene-1",
        prompt: "a lighthouse",
        model: "gemini-3.1-flash-image",
      },
    });

    expect(result.mimeType).toBe("image/png");
    expect(result.storageKey).toContain("gemini-req-1");
    expect(storage.objects.get(result.storageKey)?.byteLength).toBe(
      result.size,
    );
    expect(client.calls[0]).toMatchObject({
      model: "gemini-3.1-flash-image",
      config: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "1:1" },
      },
    });
  });

  it("attaches input photos only when photo fidelity is on", async () => {
    const storage = new MemoryObjectStorage();
    storage.objects.set("photo-1", new Uint8Array([1, 2, 3]));
    const client = fakeClient(await pngBase64());
    const adapter = new GeminiImageGenerationAdapter(storage, client);
    const inputJson = {
      prompt: "p",
      normalizedInputImages: [{ storageKey: "photo-1" }],
    };

    await adapter.generate({
      requestId: "a",
      inputJson: { ...inputJson, photoFidelity: "high" },
    });
    await adapter.generate({
      requestId: "b",
      inputJson: { ...inputJson, photoFidelity: "off" },
    });

    const partsOf = (call: unknown) =>
      (call as { contents: Array<{ parts: unknown[] }> }).contents[0]!.parts;
    expect(partsOf(client.calls[0])).toHaveLength(2);
    expect(partsOf(client.calls[1])).toHaveLength(1);
  });

  it("throws when Gemini returns no image", async () => {
    const adapter = new GeminiImageGenerationAdapter(
      new MemoryObjectStorage(),
      fakeClient(undefined),
    );
    await expect(
      adapter.generate({ requestId: "r", inputJson: {} }),
    ).rejects.toThrow(/empty image/);
  });

  it("maps OpenAI-style sizes to aspect ratios", () => {
    expect(aspectRatioForSize("1536x1024")).toBe("3:2");
    expect(aspectRatioForSize("1024x1536")).toBe("2:3");
    expect(aspectRatioForSize(undefined)).toBe("1:1");
  });
});

describe("RoutingImageGenerationAdapter", () => {
  function recorder(name: string) {
    const models: unknown[] = [];
    return {
      models,
      async generate(input: {
        requestId: string;
        inputJson: Record<string, unknown>;
      }) {
        models.push(input.inputJson.model);
        return {
          storageKey: name,
          mimeType: "image/png",
          size: 0,
          width: null,
          height: null,
          checksum: "",
        };
      },
    };
  }

  it("defaults to Nano Banana and routes gpt-image models to OpenAI", async () => {
    const gemini = recorder("gemini");
    const openai = recorder("openai");
    const router = new RoutingImageGenerationAdapter(gemini, openai);

    await router.generate({ requestId: "1", inputJson: {} });
    await router.generate({
      requestId: "2",
      inputJson: { model: "gpt-image-2.5-flare-2026-09-08" },
    });

    expect(gemini.models).toEqual(["gemini-3.1-flash-image"]);
    expect(openai.models).toEqual(["gpt-image-2.5-flare-2026-09-08"]);
  });
});
