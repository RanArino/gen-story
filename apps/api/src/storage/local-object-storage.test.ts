import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LocalObjectStorage } from "./local-object-storage";

describe("LocalObjectStorage", () => {
  it("writes, reads, and deletes objects by storage key", async () => {
    await withStorage(async ({ directory, storage }) => {
      const key = "data/uploads/originals/projects/project_1/photo_1.jpg";
      const body = new TextEncoder().encode("image-bytes");

      await storage.putObject({
        key,
        body,
        contentType: "image/jpeg",
      });

      await expect(storage.getObject(key)).resolves.toEqual(Buffer.from(body));
      await expect(readFile(join(directory, key))).resolves.toEqual(
        Buffer.from(body),
      );

      await storage.deleteObject(key);
      await expect(storage.getObject(key)).resolves.toBeNull();
      await expect(storage.deleteObject(key)).resolves.toBeUndefined();
    });
  });

  it("rejects invalid or unsafe storage keys", async () => {
    await withStorage(async ({ storage }) => {
      for (const key of [
        "",
        "/data/uploads/photo.jpg",
        "data/uploads/../photo.jpg",
        "data/uploads\\photo.jpg",
        "tmp/uploads/photo.jpg",
        "data/uploads/",
      ]) {
        await expect(
          storage.putObject({
            key,
            body: new Uint8Array([1]),
            contentType: "image/jpeg",
          }),
        ).rejects.toThrow(/storage key/i);
      }
    });
  });
});

async function withStorage(
  test: (context: {
    directory: string;
    storage: LocalObjectStorage;
  }) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "gen-story-storage-"));

  try {
    await test({
      directory,
      storage: new LocalObjectStorage(directory),
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}
