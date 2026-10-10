import { describe, expect, it } from "vitest";
import { readDeletionDispatchConfig } from "./deletion-dispatch-config";
import { readDeletionWorkerConfig } from "./deletion-worker-context";
const env = {
  FIREBASE_PROJECT_ID: "gen-story-496911",
  FIRESTORE_DATABASE_ID: "gen-story-staging",
  GEN_STORY_TASK_WORKER_AUDIENCE: "https://worker.run.app",
  GEN_STORY_TASK_LOCATION: "asia-northeast1",
  GEN_STORY_DELETION_QUEUE: "gen-story-staging-deletions",
  GEN_STORY_TASK_CALLER_EMAIL:
    "gs-staging-task-caller@gen-story-496911.iam.gserviceaccount.com",
  GEN_STORY_TASK_CALLER_SUBJECT: "123",
  GEN_STORY_DELETION_SCHEDULER_EMAIL:
    "gs-staging-delete-scheduler@gen-story-496911.iam.gserviceaccount.com",
  GEN_STORY_DELETION_SCHEDULER_SUBJECT: "456",
  R2_ACCOUNT_ID: "a".repeat(32),
  R2_BUCKET_NAME: "gen-story-staging-media",
  R2_ACCESS_KEY_ID: "fixture",
  R2_SECRET_ACCESS_KEY: "fixture",
};
describe("deletion worker isolation", () => {
  it("requires complete explicit environment inputs before creating clients", () => {
    expect(readDeletionWorkerConfig(env).databaseId).toBe("gen-story-staging");
    for (const key of Object.keys(env)) {
      const changed = { ...env, [key]: undefined };
      expect(() => readDeletionWorkerConfig(changed), key).toThrow();
    }
  });
  it.each([
    { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/key.json" },
    { FIRESTORE_DATABASE_ID: "gen-story-production" },
    { GEN_STORY_TASK_WORKER_AUDIENCE: "https://worker.run.app/path" },
    { GEN_STORY_TASK_WORKER_AUDIENCE: "http://worker.run.app" },
    { GEN_STORY_TASK_CALLER_SUBJECT: "" },
    { GEN_STORY_DELETION_SCHEDULER_SUBJECT: "123" },
    { GEN_STORY_DELETION_QUEUE: "other" },
  ])("rejects unsafe worker configuration %j", (changed) =>
    expect(() => readDeletionWorkerConfig({ ...env, ...changed })).toThrow(),
  );
  it("requires R2 only for the worker, not dispatch repair", () => {
    const repair: Partial<typeof env> = { ...env };
    delete repair.R2_ACCOUNT_ID;
    delete repair.R2_BUCKET_NAME;
    delete repair.R2_ACCESS_KEY_ID;
    delete repair.R2_SECRET_ACCESS_KEY;
    delete repair.GEN_STORY_DELETION_SCHEDULER_EMAIL;
    delete repair.GEN_STORY_DELETION_SCHEDULER_SUBJECT;
    expect(readDeletionDispatchConfig(repair).queue).toBe(
      "gen-story-staging-deletions",
    );
    expect(() => readDeletionWorkerConfig(repair)).toThrow();
  });
});
