import { existsSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { TaskAuthenticator } from "../../auth/task-oidc";
import { FirestoreDeletionDispatch } from "../../firestore/deletion-dispatch";
import { FirestoreMediaDeletionRepository } from "../../firestore/media-deletion-repository";
import { createFirestoreClient } from "../../firestore/repositories";
import { createDeletionTaskHandler } from "../../http/deletion-task-handler";
import { executeMediaDeletion } from "../../media/execute-media-deletion";
import {
  createR2Client,
  R2ObjectStorage,
} from "../../storage/r2-object-storage";
import { LocalTaskQueueClient } from "./local-task-queue";
import { PublicKeyTaskTokenVerifier } from "./task-tokens";

// Acceptance-only composition of the production deletion handler. It swaps the
// Google verifier, Cloud Tasks queue and R2 endpoint for local equivalents and
// can exit once after N object deletes to prove checkpoint resumption.
const env = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
};
const db = createFirestoreClient({
  projectId: env("GCLOUD_PROJECT"),
  databaseId: "(default)",
});
const client = createR2Client({
  endpoint: env("S3_ENDPOINT"),
  accessKeyId: env("S3_ACCESS_KEY_ID"),
  secretAccessKey: env("S3_SECRET_ACCESS_KEY"),
});
const bucket = env("S3_BUCKET");
const inner = new R2ObjectStorage(client, bucket);
const faultAfter = Number(process.env.FAULT_AFTER_OBJECT_DELETES ?? 0);
const faultMarker = "/tmp/worker-faulted";
let deletes = 0;
const storage = Object.assign(Object.create(inner) as R2ObjectStorage, {
  async deleteObject(key: string) {
    await inner.deleteObject(key);
    if (faultAfter && !existsSync(faultMarker) && ++deletes >= faultAfter) {
      writeFileSync(faultMarker, "faulted");
      process.exit(137);
    }
  },
});
const dispatch = new FirestoreDeletionDispatch(
  db,
  new LocalTaskQueueClient(env("QUEUE_URL")),
);
const deletions = new FirestoreMediaDeletionRepository(db, dispatch);
const handler = createDeletionTaskHandler({
  auth: new TaskAuthenticator(
    new PublicKeyTaskTokenVerifier(env("PUBLIC_KEY_PEM")),
    env("AUDIENCE"),
  ),
  taskCaller: { email: env("TASK_EMAIL"), subject: env("TASK_SUBJECT") },
  schedulerCaller: {
    email: env("SCHEDULER_EMAIL"),
    subject: env("SCHEDULER_SUBJECT"),
  },
  execute: (deletionId) =>
    executeMediaDeletion({
      deletionId,
      executorId: randomUUID(),
      deletions,
      storage,
    }),
  repair: () => dispatch.repair(),
  log: (entry) => console.log(JSON.stringify(entry)),
});
createServer(handler).listen(8080, "0.0.0.0");
