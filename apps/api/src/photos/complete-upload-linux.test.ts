import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import {
  createEmulatorClient,
  clearEmulatorData,
} from "../test-support/firestore-emulator";
import {
  seedMedia,
  mediaNow,
  sessionFixture,
} from "../test-support/private-media-fixture";
import { createSignedStorageFixture } from "../test-support/signed-storage-fixture";
import { FirestoreUploadSessionRepository } from "../firestore/upload-session-repository";
import { calculateSha256Hex } from "../storage/checksum";
import { LinuxContainerImageDecoder } from "./bounded-image-decoder";
import { executeUploadCompletion } from "./complete-upload";

describe.runIf(
  process.env.GEN_STORY_MEDIA_LINUX_TEST === "1" &&
    process.env.FIRESTORE_EMULATOR_HOST != null,
)("Linux decoding with durable publication", () => {
  it.each(["jpg", "png", "webp", "heic", "heif"] as const)(
    "retains exact %s bytes and publishes its derivatives and primary scene atomically",
    async (extension) => {
      await clearEmulatorData();
      const db = createEmulatorClient();
      const fixture = await createSignedStorageFixture(
        () => new Date(mediaNow),
      );
      try {
        await seedMedia(db);
        const body =
          extension === "webp"
            ? await sharp(
                await readFile(
                  new URL(
                    "../test-support/fixtures/source.png",
                    import.meta.url,
                  ),
                ),
              )
                .webp()
                .toBuffer()
            : await readFile(
                new URL(
                  `../test-support/fixtures/${extension === "png" ? "source.png" : `valid.${extension}`}`,
                  import.meta.url,
                ),
              );
        const mimeType = `image/${extension === "jpg" ? "jpeg" : extension}`;
        const sessions = new FirestoreUploadSessionRepository(db);
        const session = {
          ...sessionFixture("upload", calculateSha256Hex(body)),
          size: body.length,
          mimeType,
        };
        await sessions.issue(session);
        await fixture.storage.putObject({
          key: session.temporaryKey,
          body,
          contentType: mimeType,
        });
        await sessions.accept("user-a", "project-a", session.id, mediaNow);
        expect(
          (
            await executeUploadCompletion({
              uploadId: session.id,
              executorId: "linux-test",
              sessions,
              storage: fixture.storage,
              decoder: new LinuxContainerImageDecoder(),
              clock: () => new Date(mediaNow),
            })
          ).status,
        ).toBe("completed");
        const status = await sessions.status("user-a", "project-a", session.id);
        expect(status.photo?.checksum).toBe(session.sha256);
        expect(status.photo?.mimeType).toBe(mimeType);
        expect(
          calculateSha256Hex(
            (await fixture.storage.getObject(
              status.session.manifest!.original,
            ))!,
          ),
        ).toBe(session.sha256);
        for (const key of [
          status.session.manifest!.preview,
          status.session.manifest!.agentPreview,
        ]) {
          const metadata = await sharp(
            (await fixture.storage.getObject(key))!,
          ).metadata();
          expect(metadata.exif).toBeUndefined();
          expect(metadata.format).toBe("jpeg");
        }
        expect((await db.collection("scenes").get()).size).toBe(1);
        expect(
          await fixture.storage.getObject(session.temporaryKey),
        ).toBeNull();
      } finally {
        await fixture.close();
        await db.terminate();
      }
    },
    30_000,
  );
});
