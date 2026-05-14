import type {
  ApplicationDependencies,
  JobQueuePort,
  ProgressEventPort,
} from "@gen-story/application";

import { LocalAuthContext } from "../auth/local-auth";
import type { GenStorySqliteClient } from "../db/client";
import { createSqliteRepositories } from "../db/repositories";
import { MockImageGenerationAdapter } from "../generation/mock-image-generation";
import { OpenAiImageGenerationAdapter } from "../generation/openai-image-generation";
import { LocalImagePreprocessingAdapter } from "../images/local-image-preprocessing";
import { LocalSceneFillGenerationAdapter } from "../scene-fill/local-scene-fill-generation";
import { LocalObjectStorage } from "../storage/local-object-storage";

class NoOpJobQueue implements JobQueuePort {
  async enqueue(): Promise<{ jobId: string }> {
    return { jobId: crypto.randomUUID() };
  }
}

class NoOpProgressEvents implements ProgressEventPort {
  async publish(): Promise<void> {}
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
    storyboards: repos.storyboards,
    stylePresets: repos.stylePresets,
  });

  const openaiApiKey = process.env.OPENAI_API_KEY;
  const imageGeneration = openaiApiKey
    ? new OpenAiImageGenerationAdapter(objectStorage, openaiApiKey)
    : new MockImageGenerationAdapter(objectStorage);
  const sceneFillGeneration = new LocalSceneFillGenerationAdapter();

  return {
    ...repos,
    objectStorage,
    imagePreprocessing,
    imageGeneration,
    sceneFillGeneration,
    jobQueue: new NoOpJobQueue(),
    progressEvents: new NoOpProgressEvents(),
    authContext: new LocalAuthContext(repos),
  };
}
