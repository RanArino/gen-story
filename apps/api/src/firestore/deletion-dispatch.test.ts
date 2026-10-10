import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PersistedDeletionWork } from "../jobs/persisted-work";
import {
  createEmulatorClient,
  clearEmulatorData,
} from "../test-support/firestore-emulator";
import { seedMedia, mediaNow } from "../test-support/private-media-fixture";
import { FirestoreMediaDeletionRepository } from "./media-deletion-repository";
import { FirestoreDeletionDispatch } from "./deletion-dispatch";
import type { DeletionTaskQueue } from "../jobs/cloud-tasks-dispatch";

describe.runIf(process.env.FIRESTORE_EMULATOR_HOST != null)(
  "durable deletion dispatch",
  () => {
    let db: ReturnType<typeof createEmulatorClient>;
    let deletions: FirestoreMediaDeletionRepository;
    let dispatch: FirestoreDeletionDispatch;
    let tasks: Set<string>;
    let submitted: PersistedDeletionWork[];
    let mode: "normal" | "failed" | "uncertain" | "reserved";
    beforeEach(async () => {
      await clearEmulatorData();
      db = createEmulatorClient();
      await seedMedia(db);
      tasks = new Set();
      submitted = [];
      mode = "normal";
      const queue: DeletionTaskQueue = {
        taskName: (work) => `${work.workId}-${work.generation}`,
        exists: async (name) => tasks.has(name),
        async dispatch(work) {
          submitted.push(work);
          if (mode === "failed") throw new Error("enqueue failed");
          if (mode !== "reserved") tasks.add(this.taskName(work));
          if (mode === "uncertain") throw new Error("uncertain response");
        },
      };
      dispatch = new FirestoreDeletionDispatch(
        db,
        queue,
        () => new Date(mediaNow),
      );
      deletions = new FirestoreMediaDeletionRepository(db, dispatch);
    });
    afterEach(async () => {
      await db.terminate();
    });
    const schedule = () =>
      deletions.schedule(
        { kind: "project", userId: "user-a", projectId: "project-a" },
        "org-a",
        mediaNow,
      );

    it("commits deletion before enqueue and repairs failure without losing recovery", async () => {
      mode = "failed";
      const record = await schedule();
      expect((await deletions.find(record.id))?.dispatch?.state).toBe(
        "pending",
      );
      expect((await db.doc("projects/project-a").get()).data()?.deletedAt).toBe(
        mediaNow,
      );
      expect(submitted[0]?.notBefore).toBe(record.notBefore);
      mode = "normal";
      expect((await dispatch.repair()).failed).toBe(0);
      expect((await deletions.find(record.id))?.dispatch).toMatchObject({
        state: "enqueued",
        generation: 0,
        leaseUntil: null,
      });
      await Promise.all([dispatch.repair(), dispatch.repair()]);
      expect(tasks.size).toBe(1);
    });
    it("resolves uncertain enqueue through lookup rather than duplicate work", async () => {
      mode = "uncertain";
      const record = await schedule();
      mode = "normal";
      await dispatch.repair();
      expect(submitted).toHaveLength(1);
      expect((await deletions.find(record.id))?.dispatch?.state).toBe(
        "enqueued",
      );
    });
    it("replaces missing tasks for three generations then requires explicit operator recovery", async () => {
      const record = await schedule();
      for (let index = 0; index < 3; index++) {
        tasks.clear();
        await dispatch.repair();
      }
      expect((await deletions.find(record.id))?.dispatch?.state).toBe(
        "exhausted",
      );
      expect(submitted.map((work) => work.generation)).toEqual([0, 1, 2]);
      await dispatch.repair();
      expect(submitted).toHaveLength(3);
      await dispatch.retryExhausted(record.id);
      expect(submitted.at(-1)?.generation).toBe(4);
      expect((await deletions.find(record.id))?.dispatch?.state).toBe(
        "enqueued",
      );
    });
    it("does not reuse a reserved task name and never recreates restored work", async () => {
      mode = "reserved";
      const record = await schedule();
      expect((await deletions.find(record.id))?.dispatch?.generation).toBe(1);
      mode = "normal";
      await dispatch.repair();
      expect(submitted.map((work) => work.generation)).toEqual([0, 1]);
      await deletions.restore(record.id, "user-a", mediaNow);
      tasks.clear();
      await dispatch.repair();
      expect(submitted).toHaveLength(2);
      await expect(dispatch.retryExhausted(record.id)).rejects.toThrow();
    });
    it("enrolls legacy records and crosses query page boundaries", async () => {
      const batch = db.batch();
      for (let index = 0; index < 105; index++)
        batch.set(
          db.doc(`media_deletions/legacy-${String(index).padStart(3, "0")}`),
          {
            kind: "project",
            projectId: "project-a",
            userId: "user-a",
            id: `legacy-${String(index).padStart(3, "0")}`,
            state: "recoverable",
            notBefore: mediaNow,
            leaseUntil: null,
          },
        );
      await batch.commit();
      const result = await dispatch.repair();
      expect(result).toEqual({ examined: 105, failed: 0, yielded: false });
      expect(tasks.size).toBe(105);
    }, 30_000);
  },
);
