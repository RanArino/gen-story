import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PhotoAsset } from "@gen-story/domain";
import {
  createEmulatorClient,
  clearEmulatorData,
} from "../test-support/firestore-emulator";
import { seedMedia, mediaNow } from "../test-support/private-media-fixture";
import { createSignedStorageFixture } from "../test-support/signed-storage-fixture";
import {
  FirestoreMediaDeletionRepository,
  MEDIA_RECOVERY_MS,
} from "./media-deletion-repository";
import { executeMediaDeletion } from "../media/execute-media-deletion";
import { createFirestoreRepositories } from "./repositories";

const now = new Date(
  Date.parse(mediaNow) + MEDIA_RECOVERY_MS + 1,
).toISOString();
describe.runIf(process.env.FIRESTORE_EMULATOR_HOST != null)(
  "deletion retry safety",
  () => {
    let db: ReturnType<typeof createEmulatorClient>;
    let deletions: FirestoreMediaDeletionRepository;
    let fixture: Awaited<ReturnType<typeof createSignedStorageFixture>>;
    beforeEach(async () => {
      await clearEmulatorData();
      db = createEmulatorClient();
      await seedMedia(db);
      deletions = new FirestoreMediaDeletionRepository(db);
      fixture = await createSignedStorageFixture();
    });
    afterEach(async () => {
      await fixture.close();
      await db.terminate();
    });
    const schedule = () =>
      deletions.schedule(
        { kind: "project", userId: "user-a", projectId: "project-a" },
        "org-a",
        mediaNow,
      );
    const run = (id: string) =>
      executeMediaDeletion({
        deletionId: id,
        executorId: "worker",
        deletions,
        storage: fixture.storage,
        clock: () => new Date(now),
      });

    it("captures late linked children after their parent scene has been removed", async () => {
      await db
        .doc("scenes/scene-a")
        .set({ projectId: "project-a", storyboardId: "storyboard-a" });
      const record = await schedule();
      const remove = deletions.removePage.bind(deletions);
      let inserted = false;
      deletions.removePage = async (...args) => {
        await remove(...args);
        if (!inserted) {
          inserted = true;
          await db.doc("generated_images/late").set({ sceneId: "scene-a" });
        }
      };
      await expect(run(record.id)).rejects.toThrow("interrupted");
      expect((await db.doc("projects/project-a").get()).exists).toBe(true);
      expect((await run(record.id)).status).toBe("completed");
      expect((await db.doc("generated_images/late").get()).exists).toBe(false);
    });

    it("serializes project and account purge claims for the same user", async () => {
      const project = await schedule();
      const account = await deletions.schedule(
        { kind: "account", userId: "user-a", projectId: null },
        "org-a",
        mediaNow,
      );
      const claims = await Promise.all([
        deletions.claim(project.id, "project-worker", now),
        deletions.claim(account.id, "account-worker", now),
      ]);
      expect(claims.filter(Boolean)).toHaveLength(1);
    });

    it("rejects a stale in-flight descendant save after project deletion", async () => {
      const repositories = createFirestoreRepositories(db);
      await schedule();
      await expect(
        repositories.photoAssets.save({
          id: "late",
          projectId: "project-a",
          createdAt: mediaNow,
          deletedAt: null,
        } as PhotoAsset),
      ).rejects.toThrow();
      expect((await db.doc("photo_assets/late").get()).exists).toBe(false);
    });

    it("distinguishes a completed replay from deferred recovery", async () => {
      const record = await schedule();
      expect(
        (
          await executeMediaDeletion({
            deletionId: record.id,
            executorId: "early",
            deletions,
            storage: fixture.storage,
            clock: () => new Date(mediaNow),
          })
        ).status,
      ).toBe("deferred");
      expect((await run(record.id)).status).toBe("completed");
      expect((await run(record.id)).status).toBe("completed");
    });

    it("fences manifest cleanup and release after lease takeover", async () => {
      const record = await schedule();
      const first = (await deletions.claim(record.id, "first", now))!;
      await deletions.savePage(first, 0, []);
      const later = new Date(Date.parse(now) + 61_000).toISOString();
      const second = (await deletions.claim(record.id, "second", later))!;
      const pages = (
        await db.collection("media_deletion_items").get()
      ).docs.map((doc) => doc.ref.path);
      await expect(deletions.cleanupPages(first, pages)).rejects.toThrow();
      await expect(deletions.release(first)).rejects.toThrow();
      expect((await db.doc(pages[0]!).get()).exists).toBe(true);
      expect((await deletions.find(record.id))?.executorId).toBe("second");
      await deletions.cleanupPages(second, pages);
      await deletions.release(second);
      expect((await db.doc("media_deletion_locks/user-a").get()).exists).toBe(
        false,
      );
    });

    it("resumes finalization after an uncertain cleanup commit and parent removal", async () => {
      const record = await schedule();
      const cleanup = deletions.cleanupPages.bind(deletions);
      let fail = true;
      deletions.cleanupPages = async (...args) => {
        await cleanup(...args);
        if (fail) {
          fail = false;
          throw new Error("uncertain cleanup");
        }
      };
      await expect(run(record.id)).rejects.toThrow("interrupted");
      expect((await db.doc("projects/project-a").get()).exists).toBe(false);
      expect((await deletions.find(record.id))?.finalizing).toBe(true);
      expect((await run(record.id)).status).toBe("completed");
      expect((await db.collection("media_deletion_items").get()).empty).toBe(
        true,
      );
    });

    it("yields at its budget and resumes object progress without restarting completed deletes", async () => {
      const prefix = "media/users/user-a/projects/project-a/";
      await db.doc("photo_assets/photo").set({
        projectId: "project-a",
        storageKey: prefix + "original",
        previewStorageKey: prefix + "preview",
      });
      for (const key of [prefix + "original", prefix + "preview"])
        await fixture.storage.putObject({
          key,
          body: Buffer.from("bytes"),
          contentType: "image/jpeg",
        });
      const record = await schedule();
      let observed = new Date(now);
      const removed: string[] = [];
      const storage = {
        ...fixture.storage,
        async deleteObject(key: string) {
          removed.push(key);
          await fixture.storage.deleteObject(key);
          observed = new Date(observed.getTime() + 240_000);
        },
      };
      const result = await executeMediaDeletion({
        deletionId: record.id,
        executorId: "bounded",
        deletions,
        storage,
        clock: () => observed,
      });
      expect(result).toMatchObject({
        status: "deferred",
        reason: "execution_budget",
      });
      expect((await db.doc("projects/project-a").get()).exists).toBe(true);
      const resumed = {
        ...fixture.storage,
        async deleteObject(key: string) {
          removed.push(key);
          await fixture.storage.deleteObject(key);
        },
      };
      expect(
        (
          await executeMediaDeletion({
            deletionId: record.id,
            executorId: "resumed",
            deletions,
            storage: resumed,
            clock: () => observed,
          })
        ).status,
      ).toBe("completed");
      expect(removed).toEqual([prefix + "original", prefix + "preview"]);
    });

    it("keeps every application writer behind the account guard", async () => {
      const repositories = createFirestoreRepositories(db);
      await repositories.agentConversations.save({
        id: "conversation",
        projectId: "project-a",
        title: "Fixture",
        activeBindingId: null,
        createdAt: mediaNow,
        updatedAt: mediaNow,
      });
      await db
        .doc("scenes/scene")
        .set({ projectId: "project-a", storyboardId: "storyboard-a" });
      await deletions.schedule(
        { kind: "account", userId: "user-a", projectId: null },
        "org-a",
        mediaNow,
      );
      const data = {
        id: "late",
        projectId: "project-a",
        createdAt: mediaNow,
        updatedAt: mediaNow,
        deletedAt: null,
      };
      for (const repository of [
        repositories.photoAssets,
        repositories.storyboards,
        repositories.aiJobs,
        repositories.generationRequests,
        repositories.testGenerationBatches,
        repositories.agentConversations,
      ]) {
        await expect(repository.save(data as never)).rejects.toThrow();
      }
      await expect(
        repositories.users.save({
          id: "user-a",
          organizationId: "org-a",
        } as never),
      ).rejects.toThrow();
      await expect(
        repositories.userPreferences.upsert({
          userId: "user-a",
          language: "en",
          agentRuntime: "api",
          updatedAt: mediaNow,
        }),
      ).rejects.toThrow();
      await expect(
        repositories.scenes.save({ ...data, photoAssets: [] } as never),
      ).rejects.toThrow();
      await expect(
        repositories.generatedImages.save({
          ...data,
          sceneId: "scene",
        } as never),
      ).rejects.toThrow();
      await expect(
        repositories.changeProposals.save({
          ...data,
          clientRequestId: "request",
        } as never),
      ).rejects.toThrow();
      await expect(
        repositories.projectPhotoAnalyses.save(data as never),
      ).rejects.toThrow();
      await expect(
        repositories.agentConversations.saveBinding({
          id: "binding",
          conversationId: "conversation",
        } as never),
      ).rejects.toThrow();
      await expect(
        repositories.agentConversations.saveTurn({
          id: "turn",
          conversationId: "conversation",
          clientRequestId: "request",
        } as never),
      ).rejects.toThrow();
      await expect(
        repositories.agentConversations.saveMessage({
          id: "message",
          conversationId: "conversation",
          sequence: 1,
        } as never),
      ).rejects.toThrow();
      await expect(
        repositories.agentConversations.nextMessageSequence("conversation"),
      ).rejects.toThrow();
      expect(
        (await db.doc("agent_conversation_counters/conversation").get()).exists,
      ).toBe(false);
    });

    it("resumes account purge after a committed parent batch removes more than one page of projects", async () => {
      const batch = db.batch();
      for (let index = 0; index < 103; index++) {
        const id = `account-project-${String(index).padStart(3, "0")}`;
        batch.set(db.doc(`projects/${id}`), {
          id,
          ownerUserId: "user-a",
          organizationId: "org-a",
          deletedAt: null,
        });
        batch.set(db.doc(`scenes/${id}`), { id, projectId: id });
        batch.set(db.doc(`generated_images/${id}`), { id, sceneId: id });
      }
      await batch.commit();
      const record = await deletions.schedule(
        { kind: "account", userId: "user-a", projectId: null },
        "org-a",
        mediaNow,
      );
      const remove = deletions.removeParents.bind(deletions);
      let fail = true;
      deletions.removeParents = async (...args) => {
        await remove(...args);
        if (fail) {
          fail = false;
          throw new Error("uncertain parent batch");
        }
      };
      await expect(run(record.id)).rejects.toThrow("interrupted");
      expect(
        (
          await db
            .collection("projects")
            .where("ownerUserId", "==", "user-a")
            .get()
        ).size,
      ).toBeLessThan(104);
      expect((await run(record.id)).status).toBe("completed");
      expect(
        (
          await db
            .collection("projects")
            .where("ownerUserId", "==", "user-a")
            .get()
        ).empty,
      ).toBe(true);
      expect((await db.collection("generated_images").get()).empty).toBe(true);
      expect((await db.doc("users/user-a").get()).exists).toBe(false);
      expect((await db.doc("projects/project-b").get()).exists).toBe(true);
      expect(
        (await db.doc("account_deletion_guards/user-a").get()).data(),
      ).toEqual({ state: "purged" });
    }, 30_000);
  },
);
