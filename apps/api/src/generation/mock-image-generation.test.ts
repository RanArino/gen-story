import { describe, expect, it } from "vitest";

import { MockImageGenerationAdapter } from "./mock-image-generation";

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

describe("MockImageGenerationAdapter", () => {
  it("writes a JPEG to object storage and returns correct metadata", async () => {
    const storage = new MemoryObjectStorage();
    const adapter = new MockImageGenerationAdapter(storage);

    const result = await adapter.generate({
      requestId: "req-1",
      inputJson: { projectId: "proj-1", sceneId: "scene-1" },
    });

    expect(result.mimeType).toBe("image/jpeg");
    expect(result.width).toBe(1);
    expect(result.height).toBe(1);
    expect(result.size).toBeGreaterThan(0);
    expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.storageKey).toContain("proj-1");
    expect(result.storageKey).toContain("scene-1");
    expect(result.storageKey).toContain("mock-req-1");

    const stored = await storage.getObject(result.storageKey);
    expect(stored).not.toBeNull();
    expect(stored!.byteLength).toBe(result.size);
  });

  it("produces a deterministic storage key for the same requestId", async () => {
    const storage = new MemoryObjectStorage();
    const adapter = new MockImageGenerationAdapter(storage);

    const a = await adapter.generate({
      requestId: "req-x",
      inputJson: { projectId: "p", sceneId: "s" },
    });
    const b = await adapter.generate({
      requestId: "req-x",
      inputJson: { projectId: "p", sceneId: "s" },
    });

    expect(a.storageKey).toBe(b.storageKey);
    expect(a.checksum).toBe(b.checksum);
  });
});
