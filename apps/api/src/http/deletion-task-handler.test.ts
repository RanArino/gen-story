import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskAuthenticator } from "../auth/task-oidc";
import { createDeletionTaskHandler } from "./deletion-task-handler";
import {
  createEmulatorClient,
  clearEmulatorData,
} from "../test-support/firestore-emulator";
import { seedMedia, mediaNow } from "../test-support/private-media-fixture";
import {
  createSignedStorageFixture,
  listen,
} from "../test-support/signed-storage-fixture";
import {
  FirestoreMediaDeletionRepository,
  MEDIA_RECOVERY_MS,
} from "../firestore/media-deletion-repository";
import { FirestoreDeletionDispatch } from "../firestore/deletion-dispatch";
import { executeMediaDeletion } from "../media/execute-media-deletion";

const taskCaller = { email: "task@example.test", subject: "task" };
const schedulerCaller = {
  email: "scheduler@example.test",
  subject: "scheduler",
};
const audience = "https://worker.run.app";
describe.runIf(process.env.FIRESTORE_EMULATOR_HOST != null)(
  "private deletion task HTTP",
  () => {
    let db: ReturnType<typeof createEmulatorClient>;
    let fixture: Awaited<ReturnType<typeof createSignedStorageFixture>>;
    let deletions: FirestoreMediaDeletionRepository;
    let server: Server;
    let base: string;
    let now: Date;
    let tasks: Set<string>;
    beforeEach(async () => {
      await clearEmulatorData();
      db = createEmulatorClient();
      await seedMedia(db);
      fixture = await createSignedStorageFixture();
      now = new Date(mediaNow);
      tasks = new Set();
      const dispatch = new FirestoreDeletionDispatch(
        db,
        {
          taskName: (work) => work.workId,
          exists: async (name) => tasks.has(name),
          dispatch: async (work) => {
            tasks.add(work.workId);
          },
        },
        () => now,
      );
      deletions = new FirestoreMediaDeletionRepository(db, dispatch, () => now);
      const auth = new TaskAuthenticator(
        {
          async verify(token) {
            const caller = token.startsWith("scheduler.")
              ? schedulerCaller
              : token.startsWith("task.")
                ? taskCaller
                : { email: "foreign", subject: "foreign" };
            const seconds = Math.floor(now.getTime() / 1000);
            return {
              iss: "https://accounts.google.com",
              aud: audience,
              sub: caller.subject,
              email: caller.email,
              email_verified: true,
              iat: seconds,
              exp: seconds + 3600,
            };
          },
        },
        audience,
        () => now,
      );
      server = createServer(
        createDeletionTaskHandler({
          auth,
          taskCaller,
          schedulerCaller,
          execute: (id, executorId) =>
            executeMediaDeletion({
              deletionId: id,
              executorId,
              deletions,
              storage: fixture.storage,
              clock: () => now,
            }),
          repair: () => dispatch.repair(),
        }),
      );
      base = await listen(server);
    });
    afterEach(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await fixture.close();
      await db.terminate();
    });
    const request = (token: string | null, path: string, body: unknown) =>
      fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token
            ? { Authorization: `Bearer ${token}.payload.signature` }
            : {}),
          "X-CloudTasks-QueueName": "trusted",
        },
        body: JSON.stringify(body),
      });
    const schedule = () =>
      deletions.schedule(
        { kind: "project", userId: "user-a", projectId: "project-a" },
        "org-a",
        mediaNow,
      );

    it("executes persisted deletion through HTTP and safely acknowledges duplicates", async () => {
      const key = "media/users/user-a/projects/project-a/original.jpg";
      await fixture.storage.putObject({
        key,
        body: Buffer.from("private"),
        contentType: "image/jpeg",
      });
      const record = await schedule();
      expect(tasks.has(record.id)).toBe(true);
      const work = { workType: "media_deletion", workId: record.id };
      expect((await request("task", "/internal/tasks/work", work)).status).toBe(
        503,
      );
      expect(await fixture.storage.head(key)).not.toBeNull();
      now = new Date(Date.parse(mediaNow) + MEDIA_RECOVERY_MS + 1);
      expect((await request("task", "/internal/tasks/work", work)).status).toBe(
        204,
      );
      expect((await request("task", "/internal/tasks/work", work)).status).toBe(
        204,
      );
      expect(await fixture.storage.head(key)).toBeNull();
      expect((await db.doc("projects/project-a").get()).exists).toBe(false);
      expect((await db.doc("projects/project-b").get()).exists).toBe(true);
      expect(
        (
          await request("task", "/internal/tasks/work", {
            workType: "media_deletion",
            workId: "absent",
          })
        ).status,
      ).toBe(204);
    });
    it("rejects forged callers, crossed identities, unsupported work and extra fields before execution", async () => {
      const record = await schedule();
      const work = { workType: "media_deletion", workId: record.id };
      for (const token of [null, "foreign", "scheduler"])
        expect(
          (await request(token, "/internal/tasks/work", work)).status,
        ).toBe(401);
      expect(
        (await request("task", "/internal/tasks/deletion-dispatch/repair", {}))
          .status,
      ).toBe(401);
      expect(
        (await request("scheduler", "/internal/tasks/repair-deletions", {}))
          .status,
      ).toBe(404);
      for (const body of [
        { ...work, ownerUserId: "foreign" },
        { ...work, workType: "generation" },
        { ...work, workId: "../foreign" },
      ])
        expect(
          (await request("task", "/internal/tasks/work", body)).status,
        ).toBe(400);
      expect((await deletions.find(record.id))?.state).toBe("recoverable");
    });
    it("restoration cancels delivery and scheduler-only repair rejects arbitrary input", async () => {
      const record = await schedule();
      await deletions.restore(record.id, "user-a", mediaNow);
      now = new Date(Date.parse(mediaNow) + MEDIA_RECOVERY_MS + 1);
      expect(
        (
          await request("task", "/internal/tasks/work", {
            workType: "media_deletion",
            workId: record.id,
          })
        ).status,
      ).toBe(204);
      expect(
        (await db.doc("projects/project-a").get()).data()?.deletedAt,
      ).toBeNull();
      expect(
        (
          await request(
            "scheduler",
            "/internal/tasks/deletion-dispatch/repair",
            { deletionId: record.id },
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await request(
            "scheduler",
            "/internal/tasks/deletion-dispatch/repair",
            {},
          )
        ).status,
      ).toBe(204);
      expect((await fetch(base + "/api/me")).status).toBe(404);
      expect((await fetch(base + "/health")).status).toBe(200);
    });
  },
);
