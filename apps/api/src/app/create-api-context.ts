import type { ApplicationDependencies } from "@gen-story/application";

import { LocalAuthContext } from "../auth/local-auth";
import type { GenStorySqliteClient } from "../db/client";
import { createSqliteRepositories } from "../db/repositories";
import { LocalProgressEvents } from "../jobs/local-progress-events";
import { SqliteJobQueue } from "../jobs/sqlite-job-queue";
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

// The router needs the concrete emitter, not just the port, because the SSE
// route subscribes to it.
export type ApiDependencies = ApplicationDependencies & {
  progressEvents: LocalProgressEvents;
};

export function createApiContext(
  client: GenStorySqliteClient,
): ApiDependencies {
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

  const progressEvents = new LocalProgressEvents();

  return {
    ...repos,
    objectStorage,
    imagePreprocessing,
    imageGeneration,
    sceneFillGeneration,
    complementSceneProposal,
    photoAnalysisGeneration,
    jobQueue: new SqliteJobQueue(repos.aiJobs, progressEvents),
    progressEvents,
    authContext: new LocalAuthContext(repos),
  };
}
