import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { calculateSha256Hex } from "../storage/checksum";
import {
  createEmulatorClient,
  clearEmulatorData,
} from "../test-support/firestore-emulator";
import {
  mediaNow,
  seedMedia,
  sessionFixture,
} from "../test-support/private-media-fixture";
import { FirestoreUploadSessionRepository } from "../firestore/upload-session-repository";
import { createSignedStorageFixture } from "../test-support/signed-storage-fixture";
import { executeUploadCompletion } from "./complete-upload";
import type { BoundedImageDecoder } from "./bounded-image-decoder";
import { MediaError } from "./upload-session";

const png = () =>
  sharp({ create: { width: 120, height: 80, channels: 3, background: "red" } })
    .png()
    .toBuffer();
const fixtureDecoder: BoundedImageDecoder = {
  async decode(body) {
    const data = await sharp(body).raw().toBuffer({ resolveWithObject: true });
    const jpeg = await sharp(body).jpeg().toBuffer();
    return {
      mimeType: "image/png",
      extension: "png",
      width: data.info.width,
      height: data.info.height,
      preview: jpeg,
      agentPreview: jpeg,
    };
  },
};

describe.runIf(process.env.FIRESTORE_EMULATOR_HOST != null)(
  "immutable upload completion with Firestore",
  () => {
    let db: ReturnType<typeof createEmulatorClient>;
    let sessions: FirestoreUploadSessionRepository;
    let fixture: Awaited<ReturnType<typeof createSignedStorageFixture>>;
    beforeEach(async () => {
      await clearEmulatorData();
      db = createEmulatorClient();
      await seedMedia(db);
      sessions = new FirestoreUploadSessionRepository(db);
      fixture = await createSignedStorageFixture(() => new Date(mediaNow));
    });
    afterEach(async () => {
      await fixture?.close();
      await db?.terminate();
    });
    async function issue(id = "upload", body?: Uint8Array) {
      const bytes = body ?? (await png());
      const session = {
        ...sessionFixture(id, calculateSha256Hex(bytes)),
        size: bytes.length,
      };
      await sessions.issue(session);
      await fixture.storage.putObject({
        key: session.temporaryKey,
        body: bytes,
        contentType: "image/png",
      });
      await sessions.accept("user-a", "project-a", id, mediaNow);
      return { bytes, session };
    }
    const execute = (
      uploadId = "upload",
      decoder = fixtureDecoder,
      storage = fixture.storage,
    ) =>
      executeUploadCompletion({
        uploadId,
        executorId: "worker",
        sessions,
        storage,
        decoder,
        clock: () => new Date(mediaNow),
      });
    it("finalizes only the validated snapshot despite temporary rewrites during and after decoding", async () => {
      const { bytes, session } = await issue();
      await execute("upload", {
        async decode(snapshot) {
          await fixture.storage.putObject({
            key: session.temporaryKey,
            body: Buffer.from("rewritten"),
            contentType: "image/png",
          });
          return fixtureDecoder.decode(snapshot);
        },
      });
      const durable = (await sessions.find("upload"))!;
      expect(durable.status).toBe("completed");
      expect(
        calculateSha256Hex(
          (await fixture.storage.getObject(durable.manifest!.original))!,
        ),
      ).toBe(calculateSha256Hex(bytes));
      await fixture.storage.putObject({
        key: session.temporaryKey,
        body: Buffer.from("late"),
        contentType: "image/png",
      });
      expect(
        calculateSha256Hex(
          (await fixture.storage.getObject(durable.manifest!.original))!,
        ),
      ).toBe(session.sha256);
      expect((await db.collection("scenes").get()).size).toBe(1);
      await expect(
        sessions.accept("user-a", "project-a", "upload", mediaNow),
      ).rejects.toMatchObject({ code: "conflict" });
    });
    it.each(["original", "preview", "agentPreview"] as const)(
      "resumes after the %s object write fails",
      async (failing) => {
        await issue();
        let writes = 0;
        const boundary = { original: 1, preview: 2, agentPreview: 3 }[failing];
        const storage = {
          ...fixture.storage,
          async putObject(
            input: Parameters<typeof fixture.storage.putObject>[0],
          ) {
            if (++writes === boundary) throw new Error("Interrupted");
            await fixture.storage.putObject(input);
          },
        };
        await expect(
          execute("upload", fixtureDecoder, storage),
        ).rejects.toThrow("interrupted");
        expect((await sessions.find("upload"))?.status).toBe("processing");
        expect((await execute()).status).toBe("completed");
        const status = await sessions.find("upload");
        expect(status?.retiredManifests).toHaveLength(1);
        expect((await db.collection("photo_assets").get()).size).toBe(1);
      },
    );
    it("resolves uncertain publication before cleanup and keeps committed outputs", async () => {
      await issue();
      const publish = sessions.publish.bind(sessions);
      sessions.publish = async (...args) => {
        await publish(...args);
        throw new Error("Response lost");
      };
      expect((await execute()).status).toBe("completed");
      const session = (await sessions.find("upload"))!;
      expect(
        await fixture.storage.getObject(session.manifest!.original),
      ).not.toBeNull();
    });
    it("rejects byte/hash/type/decode failures without visible media", async () => {
      await issue();
      const session = (await sessions.find("upload"))!;
      await fixture.storage.putObject({
        key: session.temporaryKey,
        body: Buffer.from("bad"),
        contentType: "image/png",
      });
      expect((await execute()).status).toBe("failed");
      expect((await db.collection("photo_assets").get()).empty).toBe(true);
      await issue("bad-decode");
      expect(
        (
          await execute("bad-decode", {
            async decode() {
              throw new MediaError("validation_error");
            },
          })
        ).status,
      ).toBe("failed");
      await issue("wrong-type");
      expect(
        (
          await execute("wrong-type", {
            async decode(body) {
              return {
                ...(await fixtureDecoder.decode(body)),
                mimeType: "image/jpeg",
              };
            },
          })
        ).status,
      ).toBe("failed");
      expect((await db.collection("scenes").get()).empty).toBe(true);
    });
    it("publishes one source checksum under simultaneous independent completions", async () => {
      const bytes = await png();
      await issue("one", bytes);
      await issue("two", bytes);
      // The Emulator can invalidate a losing transaction; interrupted work is
      // persisted and retried, so retry it as the worker queue would.
      const retried = async (uploadId: string) => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await execute(uploadId);
          } catch (error) {
            if (attempt >= 3) throw error;
          }
        }
      };
      const results = await Promise.all([retried("one"), retried("two")]);
      expect(results.map((r) => r.status).sort()).toEqual([
        "completed",
        "failed",
      ]);
      expect((await db.collection("photo_assets").get()).size).toBe(1);
      expect((await db.collection("scenes").get()).size).toBe(1);
    }, 30_000);
  },
);
