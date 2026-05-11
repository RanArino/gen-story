import type {
  ApplicationDependencies,
  ImageGenerationPort,
  JobQueuePort,
  ProgressEventPort,
} from "@gen-story/application";

import type { GenStorySqliteClient } from "../db/client";
import { createSqliteRepositories } from "../db/repositories";
import { LocalImagePreprocessingAdapter } from "../images/local-image-preprocessing";
import { LocalObjectStorage } from "../storage/local-object-storage";
import { LocalAuthContext } from "../auth/local-auth";

class NoOpJobQueue implements JobQueuePort {
  async enqueue(): Promise<{ jobId: string }> {
    return { jobId: crypto.randomUUID() };
  }
}

class NoOpProgressEvents implements ProgressEventPort {
  async publish(): Promise<void> {}
}

class NoOpImageGeneration implements ImageGenerationPort {
  async generate(): Promise<never> {
    throw new Error("Image generation is not implemented in Phase 5.");
  }
}

export function createApiContext(
  client: GenStorySqliteClient,
): ApplicationDependencies {
  const repos = createSqliteRepositories(client.db);
  const objectStorage = new LocalObjectStorage();
  const imagePreprocessing = new LocalImagePreprocessingAdapter({
    scenes: repos.scenes,
    photoAssets: repos.photoAssets,
    objectStorage,
  });

  return {
    ...repos,
    objectStorage,
    imagePreprocessing,
    imageGeneration: new NoOpImageGeneration(),
    jobQueue: new NoOpJobQueue(),
    progressEvents: new NoOpProgressEvents(),
    authContext: new LocalAuthContext(repos),
  };
}
