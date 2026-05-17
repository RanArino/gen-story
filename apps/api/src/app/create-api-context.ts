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
import {
  DEFAULT_GEMINI_PHOTO_ANALYSIS_MODEL,
  GeminiPhotoAnalysisGenerationAdapter,
} from "../photo-analysis/gemini-photo-analysis-generation";
import { LocalPhotoAnalysisGenerationAdapter } from "../photo-analysis/local-photo-analysis-generation";
import {
  DEFAULT_GEMINI_COMPLEMENT_SCENE_MODEL,
  GeminiComplementSceneProposalAdapter,
} from "../complement-scenes/gemini-complement-scene-proposal";
import {
  DEFAULT_GEMINI_SCENE_FILL_MODEL,
  GeminiSceneFillGenerationAdapter,
} from "../scene-fill/gemini-scene-fill-generation";
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
  const geminiApiKey = process.env.GEMINI_API_KEY;
  // Photo-aware AI requires Gemini at runtime; the adapter throws a clear
  // error if GEMINI_API_KEY is unset. Tests inject mock ports instead.
  const sceneFillGeneration = new GeminiSceneFillGenerationAdapter(
    objectStorage,
    geminiApiKey,
    process.env.GEMINI_SCENE_FILL_MODEL ?? DEFAULT_GEMINI_SCENE_FILL_MODEL,
  );
  const complementSceneProposal = new GeminiComplementSceneProposalAdapter(
    objectStorage,
    geminiApiKey,
    process.env.GEMINI_COMPLEMENT_SCENE_MODEL ??
      DEFAULT_GEMINI_COMPLEMENT_SCENE_MODEL,
  );
  const photoAnalysisGeneration = geminiApiKey
    ? new GeminiPhotoAnalysisGenerationAdapter(
        objectStorage,
        geminiApiKey,
        process.env.GEMINI_PHOTO_ANALYSIS_MODEL ??
          DEFAULT_GEMINI_PHOTO_ANALYSIS_MODEL,
      )
    : new LocalPhotoAnalysisGenerationAdapter();

  return {
    ...repos,
    objectStorage,
    imagePreprocessing,
    imageGeneration,
    sceneFillGeneration,
    complementSceneProposal,
    photoAnalysisGeneration,
    jobQueue: new NoOpJobQueue(),
    progressEvents: new NoOpProgressEvents(),
    authContext: new LocalAuthContext(repos),
  };
}
