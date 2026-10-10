import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createEmulatorClient,
  clearEmulatorData,
} from "../test-support/firestore-emulator";
import {
  seedMedia,
  mediaNow,
  sessionFixture,
} from "../test-support/private-media-fixture";
import {
  FirestoreMediaDeletionRepository,
  MEDIA_RECOVERY_MS,
} from "./media-deletion-repository";
import { executeMediaDeletion } from "../media/execute-media-deletion";
import { createSignedStorageFixture } from "../test-support/signed-storage-fixture";
import {
  ENTITY_COLLECTIONS,
  AUXILIARY_COLLECTIONS,
  MEDIA_COLLECTIONS,
} from "../media/media-inventory";
import { mediaPrefix } from "../storage/r2-storage-keys";
import { createFirestorePrincipalProvisioner } from "./firebase-principal-provisioner";
import { createOwnedStylePresetRepository } from "./owned-style-presets";

const afterRecovery = new Date(
  Date.parse(mediaNow) + MEDIA_RECOVERY_MS + 1,
).toISOString();
const hash = (...parts: string[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex");

describe.runIf(process.env.FIRESTORE_EMULATOR_HOST != null)(
  "recoverable media deletion",
  () => {
    let db: ReturnType<typeof createEmulatorClient>;
    let deletions: FirestoreMediaDeletionRepository;
    let fixture: Awaited<ReturnType<typeof createSignedStorageFixture>>;
    beforeEach(async () => {
      await clearEmulatorData();
      db = createEmulatorClient();
      await seedMedia(db);
      deletions = new FirestoreMediaDeletionRepository(db);
      fixture = await createSignedStorageFixture(() => new Date(mediaNow));
    });
    afterEach(async () => {
      await fixture?.close();
      await db?.terminate();
    });
    const run = (id: string, now = afterRecovery, storage = fixture.storage) =>
      executeMediaDeletion({
        deletionId: id,
        executorId: "purger",
        deletions,
        storage,
        clock: () => new Date(now),
      });
    it("preserves bytes during recovery and restoration cancels deletion", async () => {
      const key = `${mediaPrefix("user-a", "project-a")}original.jpg`;
      await fixture.storage.putObject({
        key,
        body: Buffer.from("original"),
        contentType: "image/jpeg",
      });
      const record = await deletions.schedule(
        { kind: "project", userId: "user-a", projectId: "project-a" },
        "org-a",
        mediaNow,
      );
      expect((await run(record.id, mediaNow)).status).toBe("deferred");
      expect(await fixture.storage.getObject(key)).not.toBeNull();
      await deletions.restore(record.id, "user-a", mediaNow);
      expect((await run(record.id)).status).toBe("canceled");
      expect(
        (await db.collection("projects").doc("project-a").get()).data()
          ?.deletedAt,
      ).toBeNull();
      expect(await fixture.storage.getObject(key)).not.toBeNull();
    });
    it("removes all flat descendants, hashed reservations, pages, and owned prefixes while preserving foreign fixtures", async () => {
      const ownedPaths: string[] = [];
      async function set(
        name: string,
        id: string,
        data: Record<string, unknown>,
      ) {
        const path = `${name}/${id}`;
        ownedPaths.push(path);
        await db.doc(path).set({ id, ...data });
      }
      await db
        .collection("organizations")
        .doc("org-a")
        .set({ id: "org-a", name: "Shared" });
      for (const name of [
        "photo_assets",
        "generation_requests",
        "ai_jobs",
        "project_photo_analyses",
        "change_proposals",
      ])
        await set(name, "owned", {
          projectId: "project-a",
          clientRequestId: "request",
          status: "succeeded",
        });
      await set("scenes", "scene-a", {
        projectId: "project-a",
        storyboardId: "storyboard-a",
      });
      await set("generated_images", "image-a", { sceneId: "scene-a" });
      await set("test_generation_batches", "batch-a", {
        storyboardId: "storyboard-a",
      });
      await set("agent_conversations", "conversation-a", {
        projectId: "project-a",
      });
      for (const name of [
        "agent_provider_bindings",
        "agent_conversation_turns",
        "agent_conversation_messages",
      ])
        await set(name, "child", {
          conversationId: "conversation-a",
          clientRequestId: "request",
          sequence: 1,
        });
      await set("change_proposal_request_keys", hash("project-a", "request"), {
        proposalId: "owned",
      });
      await set("agent_turn_request_keys", hash("conversation-a", "request"), {
        turnId: "child",
      });
      await set("agent_message_sequence_keys", hash("conversation-a", "1"), {
        messageId: "child",
      });
      await set("agent_conversation_counters", "conversation-a", {
        lastSequence: 1,
      });
      await set("upload_sessions", "upload", sessionFixture());
      await set("media_deletions", "older", {
        userId: "user-a",
        projectId: "project-a",
        state: "canceled",
      });
      await set("media_deletion_items", "old-page", {
        deletionId: "older",
        items: [],
      });
      // Cross both manifest and storage page boundaries.
      for (let index = 0; index < 105; index++)
        await set("photo_assets", `page-${index}`, { projectId: "project-a" });
      for (const key of ["media", "tmp"])
        for (let index = 0; index < 5; index++)
          await fixture.storage.putObject({
            key: `${mediaPrefix("user-a", "project-a", key === "tmp")}object-${index}`,
            body: Buffer.from("bytes"),
            contentType: "image/png",
          });
      const foreign = `${mediaPrefix("user-b", "project-b")}foreign.jpg`;
      await fixture.storage.putObject({
        key: foreign,
        body: Buffer.from("foreign"),
        contentType: "image/jpeg",
      });
      for (const name of [...ENTITY_COLLECTIONS, ...AUXILIARY_COLLECTIONS])
        await db.collection(name).doc("foreign").set({
          id: "foreign",
          projectId: "project-b",
          conversationId: "foreign",
          scope: "system",
        });
      const record = await deletions.schedule(
        { kind: "project", userId: "user-a", projectId: "project-a" },
        "org-a",
        mediaNow,
      );
      let count = 0;
      const interrupted = {
        ...fixture.storage,
        async deleteObject(key: string) {
          if (++count === 4) throw new Error("Page boundary interruption");
          await fixture.storage.deleteObject(key);
        },
      };
      await expect(run(record.id, afterRecovery, interrupted)).rejects.toThrow(
        "interrupted",
      );
      expect(
        (await db.collection("projects").doc("project-a").get()).exists,
      ).toBe(true);
      expect((await run(record.id)).status).toBe("completed");
      for (const path of ownedPaths)
        expect((await db.doc(path).get()).exists, path).toBe(false);
      expect(
        (await db.collection("projects").doc("project-a").get()).exists,
      ).toBe(false);
      expect(
        (await fixture.storage.list(mediaPrefix("user-a", "project-a")))
          .objects,
      ).toEqual([]);
      expect(
        (await fixture.storage.list(mediaPrefix("user-a", "project-a", true)))
          .objects,
      ).toEqual([]);
      expect(await fixture.storage.getObject(foreign)).not.toBeNull();
      for (const name of [...ENTITY_COLLECTIONS, ...AUXILIARY_COLLECTIONS])
        expect(
          (await db.collection(name).doc("foreign").get()).exists,
          name,
        ).toBe(true);
      expect(
        (await db.collection("organizations").doc("org-a").get()).exists,
      ).toBe(true);
      expect((await db.collection("media_deletion_items").get()).empty).toBe(
        true,
      );
    }, 30_000);
    it("checkpoints descendants created after inventory and resumes without losing earlier pages", async () => {
      await db
        .collection("photo_assets")
        .doc("early")
        .set({ projectId: "project-a" });
      const record = await deletions.schedule(
        { kind: "project", userId: "user-a", projectId: "project-a" },
        "org-a",
        mediaNow,
      );
      const remove = deletions.removePage.bind(deletions);
      let inserted = false;
      deletions.removePage = async (...args) => {
        await remove(...args);
        if (!inserted) {
          inserted = true;
          await db
            .collection("photo_assets")
            .doc("late")
            .set({ projectId: "project-a" });
        }
      };
      await expect(run(record.id)).rejects.toThrow("interrupted");
      expect(
        (await db.collection("projects").doc("project-a").get()).exists,
      ).toBe(true);
      expect((await run(record.id)).status).toBe("completed");
      expect(
        (await db.collection("photo_assets").doc("late").get()).exists,
      ).toBe(false);
    });
    it("resumes after uncertain manifest and descendant batch commits", async () => {
      const batch = db.batch();
      for (let index = 0; index < 110; index++)
        batch.set(db.collection("photo_assets").doc(`batch-${index}`), {
          projectId: "project-a",
        });
      await batch.commit();
      const record = await deletions.schedule(
        { kind: "project", userId: "user-a", projectId: "project-a" },
        "org-a",
        mediaNow,
      );
      const save = deletions.savePage.bind(deletions);
      let failSave = true;
      deletions.savePage = async (...args) => {
        await save(...args);
        if (failSave) {
          failSave = false;
          throw new Error("Uncertain manifest commit");
        }
      };
      await expect(run(record.id)).rejects.toThrow("interrupted");
      expect((await db.collection("photo_assets").get()).size).toBe(110);
      const remove = deletions.removePage.bind(deletions);
      let failRemove = true;
      deletions.removePage = async (...args) => {
        await remove(...args);
        if (failRemove) {
          failRemove = false;
          throw new Error("Uncertain batch commit");
        }
      };
      await expect(run(record.id)).rejects.toThrow("interrupted");
      expect(
        (await db.collection("projects").doc("project-a").get()).exists,
      ).toBe(true);
      expect((await run(record.id)).status).toBe("completed");
      expect((await db.collection("photo_assets").get()).empty).toBe(true);
    }, 30_000);
    it("settles upload capabilities and active claims before irreversible purge", async () => {
      const issued = {
        ...sessionFixture(),
        expiresAt: new Date(Date.parse(afterRecovery) + 1000).toISOString(),
      };
      await db.collection("upload_sessions").doc(issued.id).set(issued);
      const record = await deletions.schedule(
        { kind: "project", userId: "user-a", projectId: "project-a" },
        "org-a",
        mediaNow,
      );
      expect((await run(record.id)).status).toBe("deferred");
      await db
        .collection("upload_sessions")
        .doc(issued.id)
        .update({ expiresAt: mediaNow, leaseUntil: afterRecovery });
      expect((await run(record.id)).status).toBe("deferred");
      await db
        .collection("upload_sessions")
        .doc(issued.id)
        .update({ leaseUntil: null });
      expect((await run(record.id)).status).toBe("completed");
    });
    it("account purge removes preferences and owned private presets, preserves shared records, and blocks login reprovisioning", async () => {
      const identity = {
        uid: "account-fixture",
        tenantId: "test",
        email: null,
        displayName: null,
      };
      const provision = createFirestorePrincipalProvisioner(db);
      const principal = (await provision(identity))!;
      await createOwnedStylePresetRepository(db, principal.user.id).save({
        id: "owned-style",
        scope: "user",
        name: "Private",
        description: "",
        prompt: "Style",
        createdAt: mediaNow,
        updatedAt: mediaNow,
      });
      await db
        .collection("style_presets")
        .doc("shared")
        .set({ id: "shared", scope: "system" });
      await db
        .collection("style_presets")
        .doc("foreign-user")
        .set({ id: "foreign-user", scope: "user", ownerUserId: "user-b" });
      const record = await deletions.schedule(
        { kind: "account", userId: principal.user.id, projectId: null },
        principal.organization.id,
        mediaNow,
      );
      expect(await provision(identity)).toBeNull();
      expect((await run(record.id)).status).toBe("completed");
      expect(
        (await db.collection("users").doc(principal.user.id).get()).exists,
      ).toBe(false);
      expect(
        (await db.collection("user_preferences").doc(principal.user.id).get())
          .exists,
      ).toBe(false);
      expect(
        (await db.collection("style_presets").doc("owned-style").get()).exists,
      ).toBe(false);
      expect(
        (await db.collection("style_presets").doc("shared").get()).exists,
      ).toBe(true);
      expect(
        (await db.collection("style_presets").doc("foreign-user").get()).exists,
      ).toBe(true);
      expect(
        (
          await db
            .collection("organizations")
            .doc(principal.organization.id)
            .get()
        ).exists,
      ).toBe(true);
      expect(await provision(identity)).toBeNull();
      expect(
        (
          await db
            .collection("account_deletion_guards")
            .doc(principal.user.id)
            .get()
        ).data(),
      ).toEqual({ state: "purged" });
      expect(MEDIA_COLLECTIONS).toContain("account_deletion_guards");
    });
  },
);
