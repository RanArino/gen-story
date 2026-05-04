import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  createOrganization,
  createProject,
  createUser,
} from "@gen-story/domain";

import { createInMemoryApplicationDependencies } from "../test-support/in-memory-application";
import { calculateSha256Hex } from "../storage/checksum";
import { LocalObjectStorage } from "../storage/local-object-storage";
import {
  buildOriginalPhotoStorageKey,
  buildPhotoPreviewStorageKey,
} from "../storage/storage-keys";
import { PhotoAssetIngestionService } from "./photo-asset-ingestion";

const now = "2026-05-02T00:00:00.000Z";

describe("PhotoAssetIngestionService", () => {
  it("stores original images, creates previews, and registers metadata", async () => {
    await withIngestionService(async ({ storage, service }) => {
      const body = await createTestImage("jpeg", 1200, 800);

      const result = await service.ingest({
        projectId: "project_1",
        photoAssetId: "photo_1",
        fileName: "family.jpg",
        body,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) {
        return;
      }

      const originalKey =
        "data/uploads/originals/projects/project_1/photo_1.jpg";
      const previewKey =
        "data/uploads/previews/projects/project_1/photo_1_preview_640.jpg";

      expect(result.value).toMatchObject({
        id: "photo_1",
        projectId: "project_1",
        name: "family.jpg",
        storageKey: originalKey,
        mimeType: "image/jpeg",
        size: body.byteLength,
        width: 1200,
        height: 800,
        checksum: calculateSha256Hex(body),
        sourceKind: "upload",
      });
      await expect(storage.getObject(originalKey)).resolves.toEqual(body);

      const previewBody = await storage.getObject(previewKey);
      expect(previewBody).not.toBeNull();

      const previewMetadata = await sharp(previewBody ?? undefined).metadata();
      expect(previewMetadata.format).toBe("jpeg");
      expect(previewMetadata.width).toBe(640);
      expect(previewMetadata.height).toBeLessThanOrEqual(640);
    });
  });

  it("accepts PNG and WebP uploads while retaining original formats", async () => {
    await withIngestionService(async ({ storage, service }) => {
      for (const format of ["png", "webp"] as const) {
        const body = await createTestImage(format, 320, 240);
        const photoAssetId = `photo_${format}`;
        const result = await service.ingest({
          projectId: "project_1",
          photoAssetId,
          fileName: `family.${format}`,
          body,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) {
          continue;
        }

        const originalKey = buildOriginalPhotoStorageKey({
          projectId: "project_1",
          photoAssetId,
          extension: format,
        });
        const previewKey = buildPhotoPreviewStorageKey({
          projectId: "project_1",
          photoAssetId,
        });

        expect(result.value.storageKey).toBe(originalKey);
        await expect(storage.getObject(originalKey)).resolves.toEqual(body);

        const previewBody = await storage.getObject(previewKey);
        const previewMetadata = await sharp(
          previewBody ?? undefined,
        ).metadata();

        expect(previewMetadata.format).toBe("jpeg");
      }
    });
  });

  it("cleans up written files when registration fails", async () => {
    await withIngestionService(
      async ({ storage, service }) => {
        const body = await createTestImage("jpeg", 100, 100);
        const result = await service.ingest({
          projectId: "missing_project",
          photoAssetId: "photo_1",
          fileName: "family.jpg",
          body,
        });
        const originalKey = buildOriginalPhotoStorageKey({
          projectId: "missing_project",
          photoAssetId: "photo_1",
          extension: "jpg",
        });
        const previewKey = buildPhotoPreviewStorageKey({
          projectId: "missing_project",
          photoAssetId: "photo_1",
        });

        expect(result).toMatchObject({
          ok: false,
          error: { code: "not_found" },
        });
        await expect(storage.getObject(originalKey)).resolves.toBeNull();
        await expect(storage.getObject(previewKey)).resolves.toBeNull();
      },
      { includeProject: false },
    );
  });

  it("rejects unsupported uploads without storing files", async () => {
    await withIngestionService(async ({ storage, service }) => {
      const result = await service.ingest({
        projectId: "project_1",
        photoAssetId: "photo_1",
        fileName: "notes.txt",
        body: new TextEncoder().encode("not an image"),
      });

      expect(result).toMatchObject({
        ok: false,
        error: { code: "validation_error" },
      });
      await expect(
        storage.getObject(
          "data/uploads/originals/projects/project_1/photo_1.jpg",
        ),
      ).resolves.toBeNull();
    });
  });
});

async function withIngestionService(
  test: (context: {
    storage: LocalObjectStorage;
    service: PhotoAssetIngestionService;
  }) => Promise<void>,
  options: { includeProject: boolean } = { includeProject: true },
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "gen-story-ingestion-"));
  const storage = new LocalObjectStorage(directory);
  const deps = createInMemoryApplicationDependencies(
    {
      users: [
        createUser({
          id: "user_1",
          organizationId: "organization_1",
          displayName: "Test User",
          createdAt: now,
          updatedAt: now,
        }),
      ],
      organizations: [
        createOrganization({
          id: "organization_1",
          name: "Test Organization",
          createdAt: now,
          updatedAt: now,
        }),
      ],
      projects: options.includeProject
        ? [
            createProject({
              id: "project_1",
              organizationId: "organization_1",
              ownerUserId: "user_1",
              name: "Family Story",
              createdAt: now,
              updatedAt: now,
            }),
          ]
        : [],
    },
    { objectStorage: storage },
  );

  try {
    await test({
      storage,
      service: new PhotoAssetIngestionService(deps),
    });
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

async function createTestImage(
  format: "jpeg" | "png" | "webp",
  width: number,
  height: number,
): Promise<Uint8Array> {
  const image = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: "#f8d8b8",
    },
  });

  if (format === "png") {
    return image.png().toBuffer();
  }

  if (format === "webp") {
    return image.webp().toBuffer();
  }

  return image.jpeg().toBuffer();
}
