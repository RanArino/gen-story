import type { Firestore } from "@google-cloud/firestore";
import type { PersistedDeletionDispatch } from "../jobs/persisted-work";
import { FirestoreUploadSessionRepository } from "../firestore/upload-session-repository";
import { FirestoreMediaDeletionRepository } from "../firestore/media-deletion-repository";
import { PrivateMediaService } from "../media/media-service";
import { LinuxContainerImageDecoder } from "../photos/bounded-image-decoder";
import {
  createR2Client,
  R2ObjectStorage,
  R2UploadGrantService,
} from "../storage/r2-object-storage";

export function readR2StorageConfig(env: NodeJS.ProcessEnv) {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const bucket = env.R2_BUCKET_NAME;
  if (!accountId || !/^[a-f0-9]{32}$/.test(accountId))
    throw new Error(
      "R2_ACCOUNT_ID must identify the Gen Story Cloudflare account.",
    );
  const expected =
    env.FIRESTORE_DATABASE_ID === "gen-story-staging"
      ? "gen-story-staging-media"
      : env.FIRESTORE_DATABASE_ID === "gen-story-production"
        ? "gen-story-production-media"
        : null;
  if (!expected || bucket !== expected)
    throw new Error("R2 bucket must match the explicit Firestore environment.");
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY)
    throw new Error("R2 runtime credentials are required.");
  return {
    accountId,
    bucket,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  };
}

export function readR2Config(env: NodeJS.ProcessEnv) {
  const config = readR2StorageConfig(env);
  const origins = env.R2_CORS_ORIGINS?.split(",").map((origin) =>
    origin.trim(),
  );
  if (
    !origins?.length ||
    origins.some((origin) => {
      try {
        const url = new URL(origin);
        return (
          url.origin !== origin ||
          url.hostname.includes("*") ||
          (url.protocol !== "https:" &&
            !(
              config.bucket === "gen-story-staging-media" &&
              env.R2_ALLOW_STAGING_LOCALHOST === "true" &&
              origin === "http://localhost:3000"
            ))
        );
      } catch {
        return true;
      }
    })
  )
    throw new Error("Exact approved R2 browser origins are required.");
  return { ...config, origins };
}

// Explicit composition for extracted M4 execution; the production bootstrap stays closed.
export function createHostedMediaContext(
  db: Firestore,
  env: NodeJS.ProcessEnv,
  dispatch?: PersistedDeletionDispatch,
) {
  const config = readR2Config(env);
  const client = createR2Client(config);
  const storage = new R2ObjectStorage(client, config.bucket);
  const sessions = new FirestoreUploadSessionRepository(db);
  const grants = new R2UploadGrantService(storage);
  return {
    storage,
    sessions,
    grants,
    media: new PrivateMediaService(db, sessions, grants, undefined, dispatch),
    deletions: new FirestoreMediaDeletionRepository(db, dispatch),
    decoder: new LinuxContainerImageDecoder(env.GEN_STORY_MEDIA_DECODER_IMAGE),
    close: () => client.destroy(),
  };
}
