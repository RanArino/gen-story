import { GoogleTaskTokenVerifier, TaskAuthenticator } from "../auth/task-oidc";
import { createFirestoreClient } from "../firestore/repositories";
import { FirestoreMediaDeletionRepository } from "../firestore/media-deletion-repository";
import { FirestoreDeletionDispatch } from "../firestore/deletion-dispatch";
import { CloudTasksWorkDispatch } from "../jobs/cloud-tasks-dispatch";
import { executeMediaDeletion } from "../media/execute-media-deletion";
import { createR2Client, R2ObjectStorage } from "../storage/r2-object-storage";
import { readR2StorageConfig } from "./hosted-media";
import {
  readDeletionDispatchConfig,
  readTaskCallerConfig,
} from "./deletion-dispatch-config";

export function readDeletionWorkerConfig(env: NodeJS.ProcessEnv) {
  const dispatch = readDeletionDispatchConfig(env);
  const schedulerCaller = readTaskCallerConfig(
    env,
    "GEN_STORY_DELETION_SCHEDULER",
  );
  if (
    dispatch.taskCaller.email === schedulerCaller.email ||
    dispatch.taskCaller.subject === schedulerCaller.subject
  )
    throw new Error("Task and scheduler identities must differ.");
  return {
    ...dispatch,
    schedulerCaller,
    r2: readR2StorageConfig(env),
  };
}

export function createDeletionWorkerContext(env: NodeJS.ProcessEnv) {
  const config = readDeletionWorkerConfig(env);
  const db = createFirestoreClient(config);
  const client = createR2Client(config.r2);
  const storage = new R2ObjectStorage(client, config.r2.bucket);
  const queue = new CloudTasksWorkDispatch({
    ...config,
    callerEmail: config.taskCaller.email,
  });
  const dispatch = new FirestoreDeletionDispatch(db, queue);
  const deletions = new FirestoreMediaDeletionRepository(db, dispatch);
  return {
    auth: new TaskAuthenticator(new GoogleTaskTokenVerifier(), config.audience),
    taskCaller: config.taskCaller,
    schedulerCaller: config.schedulerCaller,
    execute: (deletionId: string, executorId: string) =>
      executeMediaDeletion({ deletionId, executorId, deletions, storage }),
    repair: () => dispatch.repair(),
    retryExhausted: (id: string) => dispatch.retryExhausted(id),
    async close() {
      client.destroy();
      await Promise.all([db.terminate(), queue.close()]);
    },
  };
}
