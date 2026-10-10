import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Firestore } from "@google-cloud/firestore";
import { FirestoreDeletionDispatch } from "../../firestore/deletion-dispatch";
import { createFirestorePrincipalProvisioner } from "../../firestore/firebase-principal-provisioner";
import { FirestoreMediaDeletionRepository } from "../../firestore/media-deletion-repository";
import { createFirestoreRepositories } from "../../firestore/repositories";
import { detectMediaOrphans } from "../../media/detect-media-orphans";
import { R2ObjectStorage } from "../../storage/r2-object-storage";
import { mediaPrefix, temporaryUploadKey } from "../../storage/r2-storage-keys";
import { clearEmulatorData, createEmulatorClient } from "../firestore-emulator";
import { seedMedia } from "../private-media-fixture";
import { docker, freePort, startS3 } from "./docker";
import { LocalTaskQueue } from "./local-task-queue";
import { createTokenSigner } from "./task-tokens";

// Docker acceptance for the private deletion worker: Firestore Emulator, an
// S3-compatible container for R2, the worker as a container, a local delivery
// and retry queue, and signature-verified test identity tokens.
const enabled =
  process.env.GEN_STORY_DOCKER_ACCEPTANCE === "1" &&
  process.env.FIRESTORE_EMULATOR_HOST != null;
const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const audience = "https://gen-story-staging-deletion-worker.example.run.app";
const taskCaller = {
  email: "gs-staging-task-caller@gen-story-496911.iam.gserviceaccount.com",
  subject: "100000000000000000001",
};
const schedulerCaller = {
  email: "gs-staging-delete-scheduler@gen-story-496911.iam.gserviceaccount.com",
  subject: "100000000000000000002",
};
const DAY = 86_400_000;
const historical = () => new Date(Date.now() - 8 * DAY).toISOString();
const current = () => new Date().toISOString();

describe.runIf(enabled)("Docker deletion worker acceptance", () => {
  const signer = createTokenSigner();
  const wrongSigner = createTokenSigner();
  let db: Firestore;
  let s3: Awaited<ReturnType<typeof startS3>>;
  let storage: R2ObjectStorage;
  let queue: LocalTaskQueue;
  let queuePort: number;
  let workerUrl = "";
  let dispatch: FirestoreDeletionDispatch;
  let deletions: FirestoreMediaDeletionRepository;
  const containers: string[] = [];
  const emulatorPort = () => process.env.FIRESTORE_EMULATOR_HOST!.split(":")[1];

  const bearer = (
    identity = taskCaller,
    overrides: Record<string, unknown> = {},
    key = signer,
  ) => `Bearer ${key.sign(identity, audience, overrides)}`;
  const post = (path: string, body: unknown, authorization?: string) =>
    fetch(`${workerUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authorization ? { Authorization: authorization } : {}),
      },
      body: JSON.stringify(body),
    });
  const repair = (authorization = bearer(schedulerCaller)) =>
    post("/internal/tasks/deletion-dispatch/repair", {}, authorization);

  async function startWorker(options: { fault?: number } = {}) {
    const port = await freePort();
    const name = `gen-story-accept-worker-${randomBytes(3).toString("hex")}`;
    const host = "host.docker.internal";
    await docker(
      "run",
      "-d",
      "--name",
      name,
      "--add-host",
      `${host}:host-gateway`,
      "-p",
      `127.0.0.1:${port}:8080`,
      "-e",
      `FIRESTORE_EMULATOR_HOST=${host}:${emulatorPort()}`,
      "-e",
      "GCLOUD_PROJECT=demo-gen-story",
      "-e",
      `S3_ENDPOINT=http://${host}:${s3.port}`,
      "-e",
      `S3_ACCESS_KEY_ID=${s3.accessKeyId}`,
      "-e",
      `S3_SECRET_ACCESS_KEY=${s3.secretAccessKey}`,
      "-e",
      `S3_BUCKET=${s3.bucket}`,
      "-e",
      `QUEUE_URL=http://${host}:${queuePort}`,
      "-e",
      `PUBLIC_KEY_PEM=${signer.publicKeyPem}`,
      "-e",
      `AUDIENCE=${audience}`,
      "-e",
      `TASK_EMAIL=${taskCaller.email}`,
      "-e",
      `TASK_SUBJECT=${taskCaller.subject}`,
      "-e",
      `SCHEDULER_EMAIL=${schedulerCaller.email}`,
      "-e",
      `SCHEDULER_SUBJECT=${schedulerCaller.subject}`,
      "-e",
      `FAULT_AFTER_OBJECT_DELETES=${options.fault ?? 0}`,
      "gen-story-deletion-worker-acceptance:local",
    );
    containers.push(name);
    const url = `http://127.0.0.1:${port}`;
    await waitHealthy(url);
    return { name, url };
  }
  async function waitHealthy(url: string) {
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        if ((await fetch(`${url}/health`)).ok) return;
      } catch {
        /* still starting */
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Worker did not become healthy.");
  }

  async function allObjects() {
    const found: Record<string, unknown> = {};
    for (const prefix of ["media/", "tmp/"]) {
      let cursor: string | undefined;
      do {
        const page = await storage.list(prefix, cursor);
        for (const object of page.objects) found[object.key] = object;
        cursor = page.cursor;
      } while (cursor);
    }
    return found;
  }
  async function firestoreSnapshot(exclude = (_path: string) => false) {
    const found: Record<string, unknown> = {};
    for (const collection of await db.listCollections())
      for (const doc of (await collection.get()).docs)
        if (!exclude(doc.ref.path)) found[doc.ref.path] = doc.data();
    return found;
  }
  const withoutDeletionState = (path: string) =>
    /^(media_deletion|account_deletion)/.test(path);

  async function putObjects(keys: string[]) {
    for (let index = 0; index < keys.length; index += 25)
      await Promise.all(
        keys.slice(index, index + 25).map((key) =>
          storage.putObject({
            key,
            body: Buffer.from(key),
            contentType: "image/jpeg",
          }),
        ),
      );
  }
  // 105 flat scenes (two manifest pages), a linked child without projectId,
  // three referenced originals and 201 objects below one owned prefix.
  async function seedOwned(userId = "user-a", projectId = "project-a") {
    const prefix = mediaPrefix(userId, projectId);
    const writes: [string, Record<string, unknown>][] = [];
    for (let index = 0; index < 105; index++)
      writes.push([
        `scenes/${projectId}-scene-${index}`,
        {
          id: `${projectId}-scene-${index}`,
          projectId,
          storyboardId: "storyboard-a",
          deletedAt: null,
        },
      ]);
    for (let index = 0; index < 3; index++)
      writes.push([
        `photo_assets/${projectId}-photo-${index}`,
        {
          id: `${projectId}-photo-${index}`,
          projectId,
          storageKey: `${prefix}photo-${index}/original.jpg`,
          deletedAt: null,
        },
      ]);
    writes.push([
      `generated_images/${projectId}-image`,
      { id: `${projectId}-image`, sceneId: `${projectId}-scene-0` },
    ]);
    for (let index = 0; index < writes.length; index += 400) {
      const batch = db.batch();
      for (const [path, data] of writes.slice(index, index + 400))
        batch.set(db.doc(path), data);
      await batch.commit();
    }
    const keys = [0, 1, 2].map((i) => `${prefix}photo-${i}/original.jpg`);
    for (let index = 0; keys.length < 201; index++)
      keys.push(`${prefix}extra-${String(index).padStart(3, "0")}.jpg`);
    await putObjects(keys);
    return { prefix, keys };
  }
  async function seedForeign() {
    await db.doc("scenes/foreign-scene").set({
      id: "foreign-scene",
      projectId: "project-b",
      storyboardId: "storyboard-a",
      deletedAt: null,
    });
    const keys = Array.from(
      { length: 5 },
      (_, i) => `${mediaPrefix("user-b", "project-b")}foreign-${i}.jpg`,
    );
    await putObjects(keys);
  }
  const foreignState = async () => {
    const snapshot = await firestoreSnapshot();
    const objects = await allObjects();
    return {
      docs: Object.fromEntries(
        Object.entries(snapshot).filter(([path]) =>
          [
            "users/user-b",
            "projects/project-b",
            "scenes/foreign-scene",
          ].includes(path),
        ),
      ),
      objects: Object.fromEntries(
        Object.entries(objects).filter(([key]) => key.includes("/user-b/")),
      ),
    };
  };
  const projectTarget = {
    kind: "project" as const,
    userId: "user-a",
    projectId: "project-a",
  };
  const accountTarget = {
    kind: "account" as const,
    userId: "user-a",
    projectId: null,
  };
  const taskNameFor = (record: { id: string }, generation = 0) =>
    queue.taskName({
      workType: "media_deletion",
      workId: record.id,
      generation,
      notBefore: "",
    });
  async function completed(id: string) {
    await queue.settled(150_000);
    expect((await deletions.find(id))?.state).toBe("completed");
  }

  beforeAll(async () => {
    await docker(
      "build",
      "-q",
      "-t",
      "gen-story-deletion-worker:hp44",
      "-f",
      `${root}apps/api/deletion-worker.Dockerfile`,
      root,
    );
    await docker(
      "build",
      "-q",
      "-t",
      "gen-story-deletion-worker-acceptance:local",
      "-f",
      `${root}apps/api/src/test-support/docker-deletion/deletion-worker-acceptance.Dockerfile`,
      root,
    );
    s3 = await startS3();
    storage = new R2ObjectStorage(s3.client, s3.bucket);
    queue = new LocalTaskQueue({
      deliver: async (work) => {
        try {
          return (
            await post(
              "/internal/tasks/work",
              { workType: work.workType, workId: work.workId },
              bearer(),
            )
          ).status;
        } catch {
          return 0;
        }
      },
      maxAttempts: 40,
      backoffMs: 250,
    });
    queuePort = await queue.listen();
    workerUrl = (await startWorker()).url;
  }, 600_000);
  afterAll(async () => {
    await queue?.close();
    for (const name of containers)
      await docker("rm", "-f", name).catch(() => {});
    await s3?.stop();
  }, 120_000);
  beforeEach(async () => {
    queue.reset();
    await clearEmulatorData();
    db = createEmulatorClient();
    await seedMedia(db);
    for (const prefix of ["media/", "tmp/"]) {
      let page = await storage.list(prefix);
      while (page.objects.length) {
        for (const object of page.objects)
          await storage.deleteObject(object.key);
        page = await storage.list(prefix);
      }
    }
    dispatch = new FirestoreDeletionDispatch(db, queue);
    deletions = new FirestoreMediaDeletionRepository(db, dispatch);
    return async () => {
      await db.terminate();
    };
  });

  it("keeps data during recovery and never deletes restored work on redelivery", async () => {
    await seedOwned();
    await seedForeign();
    queue.paused = true;
    const record = await deletions.schedule(projectTarget, "org-a", current());
    const before = {
      docs: await firestoreSnapshot(withoutDeletionState),
      objects: await allObjects(),
    };
    expect(await queue.run(taskNameFor(record))).toBe(503);
    expect(await firestoreSnapshot(withoutDeletionState)).toEqual({
      ...before.docs,
      "projects/project-a": expect.objectContaining({
        deletedAt: expect.any(String),
      }),
    });
    expect(await allObjects()).toEqual(before.objects);
    await deletions.restore(record.id, "user-a", current());
    expect(await queue.run(taskNameFor(record))).toBe(204);
    expect(
      (await db.doc("projects/project-a").get()).data()?.deletedAt,
    ).toBeNull();
    expect(await allObjects()).toEqual(before.objects);
    // A completed or canceled task replayed later acknowledges without deleting.
    expect(
      (
        await post(
          "/internal/tasks/work",
          { workType: "media_deletion", workId: record.id },
          bearer(),
        )
      ).status,
    ).toBe(204);
    expect(await allObjects()).toEqual(before.objects);
  }, 120_000);

  it("deletes through delivery across more than 100 records and 201 objects", async () => {
    const { prefix, keys } = await seedOwned();
    await seedForeign();
    const foreignBefore = await foreignState();
    expect(keys).toHaveLength(201);
    expect((await storage.list(prefix)).cursor).toBeDefined();
    const record = await deletions.schedule(
      projectTarget,
      "org-a",
      historical(),
    );
    await completed(record.id);
    expect(queue.deliveries.at(-1)?.status).toBe(204);
    const remaining = await allObjects();
    expect(
      Object.keys(remaining).filter((key) => key.startsWith(prefix)),
    ).toEqual([]);
    const snapshot = await firestoreSnapshot();
    expect(
      Object.keys(snapshot).filter((path) =>
        /(scenes|photo_assets|generated_images)\/project-a-/.test(path),
      ),
    ).toEqual([]);
    expect(snapshot["projects/project-a"]).toBeUndefined();
    expect(await foreignState()).toEqual(foreignBefore);
  }, 180_000);

  it("resumes after a worker interruption that follows a persisted checkpoint", async () => {
    const { prefix } = await seedOwned();
    const fault = await startWorker({ fault: 2 });
    const previousWorker = workerUrl;
    workerUrl = fault.url;
    try {
      const record = await deletions.schedule(
        projectTarget,
        "org-a",
        historical(),
      );
      for (let attempt = 0; attempt < 120; attempt++) {
        if (
          (await docker("inspect", "-f", "{{.State.Running}}", fault.name)) ===
          "false"
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      expect(
        await docker("inspect", "-f", "{{.State.Running}}", fault.name),
      ).toBe("false");
      const pages = (await db.collection("media_deletion_items").get()).docs;
      expect(
        pages.reduce(
          (sum, doc) => sum + Number(doc.data().objectIndex ?? 0),
          0,
        ),
      ).toBeGreaterThanOrEqual(1);
      expect((await deletions.find(record.id))?.state).not.toBe("completed");
      expect(
        Object.keys(await allObjects()).some((key) => key.startsWith(prefix)),
      ).toBe(true);
      await docker("start", fault.name);
      await waitHealthy(fault.url);
      await completed(record.id);
      expect(
        Object.keys(await allObjects()).some((key) => key.startsWith(prefix)),
      ).toBe(false);
    } finally {
      workerUrl = previousWorker;
    }
  }, 240_000);

  it("repairs a missing task and exhausts three generations until a trusted retry", async () => {
    await seedOwned();
    queue.paused = true;
    const record = await deletions.schedule(
      projectTarget,
      "org-a",
      historical(),
    );
    expect(queue.tasks.has(taskNameFor(record, 0))).toBe(true);
    queue.drop(taskNameFor(record, 0));
    expect((await repair()).status).toBe(204);
    expect(queue.tasks.has(taskNameFor(record, 1))).toBe(true);
    queue.drop(taskNameFor(record, 1));
    await repair();
    queue.drop(taskNameFor(record, 2));
    await repair();
    expect((await deletions.find(record.id))?.dispatch?.state).toBe(
      "exhausted",
    );
    expect(queue.dispatched.map((work) => work.generation)).toEqual([0, 1, 2]);
    await repair();
    expect(queue.dispatched).toHaveLength(3);
    await dispatch.retryExhausted(record.id);
    expect(queue.dispatched.at(-1)?.generation).toBe(4);
    queue.resume();
    await completed(record.id);
  }, 180_000);

  it("serializes competing account and project purges without touching another owner", async () => {
    await seedOwned();
    await seedForeign();
    const foreignBefore = await foreignState();
    queue.paused = true;
    const project = await deletions.schedule(
      projectTarget,
      "org-a",
      historical(),
    );
    const account = await deletions.schedule(
      accountTarget,
      "org-a",
      historical(),
    );
    queue.resume();
    await queue.settled(170_000);
    // The account purge also removes the owner's project deletion record.
    expect([undefined, "completed"]).toContain(
      (await deletions.find(project.id))?.state,
    );
    expect(queue.tasks.size).toBe(0);
    expect((await deletions.find(account.id))?.state).toBe("completed");
    const snapshot = await firestoreSnapshot();
    expect(snapshot["users/user-a"]).toBeUndefined();
    expect(snapshot["account_deletion_guards/user-a"]).toEqual({
      state: "purged",
    });
    expect(
      Object.keys(await allObjects()).some((key) => key.includes("/user-a/")),
    ).toBe(false);
    expect(await foreignState()).toEqual(foreignBefore);
  }, 200_000);

  it("rejects writes and reprovisioning behind an account guard", async () => {
    const provision = createFirestorePrincipalProvisioner(db);
    const identity = {
      uid: "guard-user",
      tenantId: "test",
      email: null,
      displayName: null,
    };
    const principal = (await provision(identity))!;
    const userId = principal.user.id;
    await db.doc("projects/guarded").set({
      id: "guarded",
      organizationId: principal.organization.id,
      ownerUserId: userId,
      name: "Guarded",
      deletedAt: null,
    });
    queue.paused = true;
    const record = await deletions.schedule(
      { kind: "account", userId, projectId: null },
      principal.organization.id,
      historical(),
    );
    const repositories = createFirestoreRepositories(db);
    const late = {
      id: "late",
      projectId: "guarded",
      createdAt: current(),
      updatedAt: current(),
      deletedAt: null,
    };
    await expect(
      repositories.photoAssets.save(late as never),
    ).rejects.toThrow();
    await expect(repositories.aiJobs.save(late as never)).rejects.toThrow();
    expect(await provision(identity)).toBeNull();
    queue.resume();
    await completed(record.id);
    expect(
      (await db.doc(`account_deletion_guards/${userId}`).get()).data(),
    ).toEqual({ state: "purged" });
    expect(await provision(identity)).toBeNull();
    await expect(
      repositories.photoAssets.save(late as never),
    ).rejects.toThrow();
    expect((await db.doc("photo_assets/late").get()).exists).toBe(false);
    expect((await db.doc(`users/${userId}`).get()).exists).toBe(false);
  }, 180_000);

  it("rejects absent, tampered, mis-scoped, and expired identities without changing data", async () => {
    await seedOwned();
    await seedForeign();
    queue.paused = true;
    const record = await deletions.schedule(
      projectTarget,
      "org-a",
      historical(),
    );
    const work = { workType: "media_deletion", workId: record.id };
    const nowSeconds = Math.floor(Date.now() / 1000);
    const valid = signer.sign(taskCaller, audience);
    const [header, body, signature] = valid.split(".");
    const tamperedBody = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body!, "base64url").toString()),
        email: schedulerCaller.email,
      }),
    ).toString("base64url");
    const before = {
      docs: await firestoreSnapshot(),
      objects: await allObjects(),
    };
    const attempts: [string, string, unknown, string | undefined][] = [
      ["absent", "/internal/tasks/work", work, undefined],
      ["malformed", "/internal/tasks/work", work, "Bearer not-a-token"],
      [
        "tampered",
        "/internal/tasks/work",
        work,
        `Bearer ${header}.${tamperedBody}.${signature}`,
      ],
      [
        "other key",
        "/internal/tasks/work",
        work,
        bearer(taskCaller, {}, wrongSigner),
      ],
      [
        "wrong audience",
        "/internal/tasks/work",
        work,
        bearer(taskCaller, { aud: "https://other.example.run.app" }),
      ],
      [
        "wrong subject",
        "/internal/tasks/work",
        work,
        bearer(taskCaller, { sub: "100000000000000000099" }),
      ],
      [
        "wrong email",
        "/internal/tasks/work",
        work,
        bearer(taskCaller, {
          email: "gs-other@gen-story-496911.iam.gserviceaccount.com",
        }),
      ],
      [
        "unverified email",
        "/internal/tasks/work",
        work,
        bearer(taskCaller, { email_verified: false }),
      ],
      [
        "expired",
        "/internal/tasks/work",
        work,
        bearer(taskCaller, { iat: nowSeconds - 7200, exp: nowSeconds - 3600 }),
      ],
      [
        "scheduler on work",
        "/internal/tasks/work",
        work,
        bearer(schedulerCaller),
      ],
      [
        "task on repair",
        "/internal/tasks/deletion-dispatch/repair",
        {},
        bearer(taskCaller),
      ],
    ];
    for (const [label, path, payload, authorization] of attempts) {
      const response = await post(path, payload, authorization);
      expect(response.status, label).toBe(401);
    }
    const queueHeaders = await fetch(`${workerUrl}/internal/tasks/work`, {
      method: "POST",
      headers: {
        "X-CloudTasks-QueueName": "gen-story-staging-deletions",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(work),
    });
    expect(queueHeaders.status).toBe(401);
    expect(
      (await post("/internal/tasks/work", { ...work, extra: true }, bearer()))
        .status,
    ).toBe(400);
    expect((await post("/internal/tasks/other", work, bearer())).status).toBe(
      404,
    );
    expect({
      docs: await firestoreSnapshot(),
      objects: await allObjects(),
    }).toEqual(before);
    // Positive control: the same request with the exact identity does execute.
    expect((await post("/internal/tasks/work", work, bearer())).status).toBe(
      204,
    );
    expect((await deletions.find(record.id))?.state).toBe("completed");
  }, 180_000);

  it("leaves data and object metadata identical across orphan reporting", async () => {
    const { prefix } = await seedOwned();
    await seedForeign();
    await putObjects([
      `${prefix}unreferenced.jpg`,
      temporaryUploadKey("user-a", "project-a", "stale-upload"),
    ]);
    await deletions.schedule(
      { kind: "project", userId: "user-b", projectId: "project-b" },
      "org-b",
      current(),
    );
    const before = {
      docs: await firestoreSnapshot(),
      objects: await allObjects(),
    };
    const findings = await detectMediaOrphans({
      db,
      storage: {
        list: storage.list.bind(storage),
        head: storage.head.bind(storage),
      },
      now: new Date(Date.now() + 2 * DAY).toISOString(),
    });
    expect(findings.length).toBeGreaterThan(0);
    expect(Object.keys(before.objects).length).toBeGreaterThan(200);
    expect({
      docs: await firestoreSnapshot(),
      objects: await allObjects(),
    }).toEqual(before);
  }, 120_000);
});
