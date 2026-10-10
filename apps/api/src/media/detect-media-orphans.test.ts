import { describe, expect, it } from "vitest";
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
import { detectMediaOrphans } from "./detect-media-orphans";
import { mediaPrefix } from "../storage/r2-storage-keys";

describe.runIf(process.env.FIRESTORE_EMULATOR_HOST != null)(
  "read-only orphan reporting",
  () => {
    it("preserves every collection and object while scanning paged nested manifests and account recovery", async () => {
      await clearEmulatorData();
      const db = createEmulatorClient();
      const fixture = await createSignedStorageFixture(
        () => new Date(mediaNow),
      );
      try {
        await seedMedia(db);
        const batch = db.batch();
        for (let index = 0; index < 105; index++) {
          const key = `${mediaPrefix("user-a", "project-a")}original-${index}`;
          batch.set(db.doc(`photo_assets/paged-${index}`), {
            projectId: "project-a",
            storageKey: key,
          });
          await fixture.storage.putObject({
            key,
            body: Buffer.from("synthetic"),
            contentType: "image/jpeg",
          });
        }
        batch.set(db.doc("media_deletion_items/nested"), {
          deletionId: "record",
          items: [
            { objectKeys: [`${mediaPrefix("user-b", "project-b")}nested`] },
          ],
        });
        batch.set(db.doc("account_deletion_guards/user-a"), {
          state: "recoverable",
          deletionId: "record",
        });
        await batch.commit();
        await fixture.storage.putObject({
          key: `${mediaPrefix("user-b", "project-b")}nested`,
          body: Buffer.from("synthetic"),
          contentType: "image/jpeg",
        });
        const snapshot = async () => {
          const result: Record<string, unknown> = {};
          for (const collection of await db.listCollections())
            result[collection.id] = (
              await collection.orderBy("__name__").get()
            ).docs.map((doc) => ({ id: doc.id, data: doc.data() }));
          return result;
        };
        const before = await snapshot();
        const objects = [...fixture.objects.entries()];
        const readonlyStorage = {
          head: fixture.storage.head,
          list: fixture.storage.list,
        };
        const findings = await detectMediaOrphans({
          db,
          storage: readonlyStorage,
          now: mediaNow,
        });
        expect(
          findings.filter((item) => item.category === "recoverable"),
        ).toHaveLength(105);
        expect(findings.some((item) => item.key.endsWith("nested"))).toBe(
          false,
        );
        expect(await snapshot()).toEqual(before);
        expect([...fixture.objects.entries()]).toEqual(objects);
        await db
          .doc("account_deletion_guards/user-a")
          .update({ state: "purging" });
        const purging = await snapshot();
        expect(
          (
            await detectMediaOrphans({
              db,
              storage: readonlyStorage,
              now: mediaNow,
            })
          ).filter((item) => item.category === "uncertain_concurrent_write"),
        ).toHaveLength(105);
        expect(await snapshot()).toEqual(purging);
        expect([...fixture.objects.entries()]).toEqual(objects);
      } finally {
        await fixture.close();
        await db.terminate();
      }
    }, 30_000);
    it("distinguishes missing, finalized, temporary, recoverable, and concurrent objects across pages without mutation", async () => {
      await clearEmulatorData();
      const db = createEmulatorClient();
      const fixture = await createSignedStorageFixture(
        () => new Date(mediaNow),
      );
      try {
        await seedMedia(db);
        const prefix = mediaPrefix("user-a", "project-a");
        await db
          .collection("photo_assets")
          .doc("photo")
          .set({
            id: "photo",
            projectId: "project-a",
            storageKey: `${prefix}missing.jpg`,
            previewStorageKey: `${prefix}preview.jpg`,
            agentPreviewStorageKey: `${prefix}agent.jpg`,
          });
        for (const name of ["preview.jpg", "agent.jpg", "extra.jpg"])
          await fixture.storage.putObject({
            key: prefix + name,
            body: Buffer.from("bytes"),
            contentType: "image/jpeg",
          });
        const session = sessionFixture();
        await db.collection("upload_sessions").doc(session.id).set(session);
        await fixture.storage.putObject({
          key: session.temporaryKey,
          body: Buffer.from("tmp"),
          contentType: "image/png",
        });
        const expired = `${mediaPrefix("user-a", "project-a", true)}expired`;
        await fixture.storage.putObject({
          key: expired,
          body: Buffer.from("tmp"),
          contentType: "image/png",
        });
        // Independent active and expired uploads use a current observation time.
        const observed = "2026-10-12T00:00:00.000Z";
        await db
          .collection("upload_sessions")
          .doc(session.id)
          .update({ expiresAt: "2026-10-12T00:10:00.000Z" });
        const retired = prefix + "retired.jpg";
        await fixture.storage.putObject({
          key: retired,
          body: Buffer.from("uncommitted"),
          contentType: "image/jpeg",
        });
        await db
          .collection("upload_sessions")
          .doc("failed")
          .set({
            ...sessionFixture("failed"),
            status: "failed",
            manifest: { original: retired },
          });
        const beforeObjects = [...fixture.objects.entries()];
        const beforeDocs = (await db.collection("photo_assets").get()).docs.map(
          (doc) => doc.data(),
        );
        const findings = await detectMediaOrphans({
          db,
          storage: fixture.storage,
          now: observed,
        });
        expect(findings).toEqual(
          expect.arrayContaining([
            { key: prefix + "missing.jpg", category: "missing_reference" },
            { key: prefix + "extra.jpg", category: "unreferenced_finalized" },
            { key: retired, category: "unreferenced_finalized" },
            { key: session.temporaryKey, category: "active_temporary" },
            { key: expired, category: "expired_candidate" },
          ]),
        );
        expect(findings.some((f) => f.key === prefix + "preview.jpg")).toBe(
          false,
        );
        expect([...fixture.objects.entries()]).toEqual(beforeObjects);
        expect(
          (await db.collection("photo_assets").get()).docs.map((doc) =>
            doc.data(),
          ),
        ).toEqual(beforeDocs);
        await db
          .collection("projects")
          .doc("project-a")
          .update({ deletedAt: mediaNow });
        expect(
          await detectMediaOrphans({
            db,
            storage: fixture.storage,
            now: observed,
          }),
        ).toEqual(
          expect.arrayContaining([
            { key: prefix + "preview.jpg", category: "recoverable" },
          ]),
        );
        await db
          .collection("projects")
          .doc("project-a")
          .update({ deletedAt: null });
        await db
          .collection("upload_sessions")
          .doc(session.id)
          .update({ status: "processing" });
        expect(
          await detectMediaOrphans({
            db,
            storage: fixture.storage,
            now: observed,
          }),
        ).toEqual(
          expect.arrayContaining([
            {
              key: prefix + "extra.jpg",
              category: "uncertain_concurrent_write",
            },
          ]),
        );
      } finally {
        await fixture.close();
        await db.terminate();
      }
    });
  },
);
