import { readHostedDatabaseConfig } from "./hosted-persistence";

export type TaskCallerConfig = { email: string; subject: string };

export function readTaskCallerConfig(
  env: NodeJS.ProcessEnv,
  prefix: string,
): TaskCallerConfig {
  const email = env[`${prefix}_EMAIL`];
  const subject = env[`${prefix}_SUBJECT`];
  if (
    !email ||
    !/^[a-z][a-z0-9-]{4,28}@gen-story-496911\.iam\.gserviceaccount\.com$/.test(
      email,
    ) ||
    !subject ||
    !/^\d{1,30}$/.test(subject)
  )
    throw new Error("Exact task service-account identity is required.");
  return { email, subject };
}

export function readDeletionDispatchConfig(env: NodeJS.ProcessEnv) {
  const database = readHostedDatabaseConfig(env);
  const environment =
    database.databaseId === "gen-story-staging" ? "staging" : "production";
  const audience = env.GEN_STORY_TASK_WORKER_AUDIENCE?.trim();
  try {
    const url = new URL(audience!);
    if (
      url.origin !== audience ||
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".run.app")
    )
      throw new Error();
  } catch {
    throw new Error("Exact Cloud Run task audience is required.");
  }
  if (
    env.GEN_STORY_TASK_LOCATION !== "asia-northeast1" ||
    env.GEN_STORY_DELETION_QUEUE !== `gen-story-${environment}-deletions`
  )
    throw new Error(
      "Deletion queue must match the explicit environment and region.",
    );
  return {
    ...database,
    location: "asia-northeast1",
    queue: env.GEN_STORY_DELETION_QUEUE,
    audience,
    taskCaller: readTaskCallerConfig(env, "GEN_STORY_TASK_CALLER"),
  };
}
