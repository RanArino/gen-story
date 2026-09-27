import {
  isAgentRuntimeSelection,
  markAiJobFailed,
  markAiJobRunning,
  markAiJobSucceeded,
  markGenerationRequestCompleted,
  markGenerationRequestFailed,
  markGenerationRequestRunning,
  runCharacterSheetGenerationJob,
  runComplementSceneProposalsJob,
  runPhotoAnalysisJob,
  runSceneAiFillJob,
  runStorySetupJob,
} from "@gen-story/application";
import type {
  AgentRuntimeSelection,
  ApplicationDependencies,
  UseCaseResult,
} from "@gen-story/application";
import type { AiJob } from "@gen-story/domain";

export type PersistedJobExecutionDependencies = ApplicationDependencies & {
  textVisionGenerationPorts?: (
    selection: AgentRuntimeSelection,
  ) => Pick<
    ApplicationDependencies,
    | "sceneFillGeneration"
    | "complementSceneProposal"
    | "photoAnalysisGeneration"
    | "storySetupGeneration"
  >;
};

const AI_JOB_RUNNERS: Record<
  AiJob["kind"],
  (
    deps: ApplicationDependencies,
    job: AiJob,
  ) => Promise<UseCaseResult<Record<string, unknown>>>
> = {
  photo_analysis: runPhotoAnalysisJob,
  story_setup: runStorySetupJob,
  scene_ai_fill: runSceneAiFillJob,
  complement_scene_proposals: runComplementSceneProposalsJob,
  character_sheet_generation: runCharacterSheetGenerationJob,
};

function now(): string {
  return new Date().toISOString();
}

export async function executePersistedAiJob(
  deps: PersistedJobExecutionDependencies,
  job: AiJob,
): Promise<void> {
  const startedAt = now();
  const runningResult = await markAiJobRunning(deps, {
    aiJobId: job.id,
    startedAt,
  });

  if (!runningResult.ok) return;

  console.log(`[Worker] starting AI job ${job.id} (${job.kind})`);

  try {
    const selected = runningResult.value.inputJson.agentRuntime;
    const selection: AgentRuntimeSelection = isAgentRuntimeSelection(selected)
      ? selected
      : "claude";
    const runtimeDeps: ApplicationDependencies = {
      ...deps,
      ...(deps.textVisionGenerationPorts?.(selection) ?? {}),
    };
    const result = await AI_JOB_RUNNERS[job.kind](
      runtimeDeps,
      runningResult.value,
    );

    if (!result.ok) {
      await markAiJobFailed(deps, {
        aiJobId: job.id,
        errorMessage: result.error.message.slice(0, 500),
        completedAt: now(),
      });
      console.log(`[Worker] failed AI job ${job.id}: ${result.error.message}`);
      return;
    }

    const succeeded = await markAiJobSucceeded(deps, {
      aiJobId: job.id,
      resultJson: result.value,
      completedAt: now(),
    });

    if (!succeeded.ok) {
      console.log(
        `[Worker] AI job ${job.id} already canceled; discarding result`,
      );
      return;
    }

    const durationMs = Date.now() - new Date(startedAt).getTime();
    console.log(`[Worker] succeeded AI job ${job.id} in ${durationMs}ms`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markAiJobFailed(deps, {
      aiJobId: job.id,
      errorMessage: message.slice(0, 500),
      completedAt: now(),
    });
    console.log(`[Worker] failed AI job ${job.id}: ${message}`);
  }
}

export async function executePersistedGenerationRequest(
  deps: PersistedJobExecutionDependencies,
  requestId: string,
  inputJson: Record<string, unknown>,
): Promise<void> {
  const startedAt = now();
  const runningResult = await markGenerationRequestRunning(deps, {
    generationRequestId: requestId,
    startedAt,
  });

  if (!runningResult.ok) return;

  const request = runningResult.value;
  console.log(
    `[Worker] starting job ${requestId} for scene ${request.sceneId}`,
  );

  try {
    const result = await deps.imageGeneration.generate({
      requestId,
      inputJson,
    });
    const completedAt = now();
    const durationMs = Date.now() - new Date(startedAt).getTime();

    const completedResult = await markGenerationRequestCompleted(deps, {
      generationRequestId: requestId,
      generatedImageId: `img-${requestId}-${Date.now()}`,
      storageKey: result.storageKey,
      mimeType: result.mimeType,
      size: result.size,
      width: result.width,
      height: result.height,
      checksum: result.checksum,
      completedAt,
    });

    if (!completedResult.ok) {
      console.log(
        `[Worker] job ${requestId} already canceled; discarding result`,
      );
      return;
    }

    console.log(`[Worker] succeeded job ${requestId} in ${durationMs}ms`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markGenerationRequestFailed(deps, {
      generationRequestId: requestId,
      errorMessage: message.slice(0, 500),
      completedAt: now(),
    });
    console.log(`[Worker] failed job ${requestId}: ${message}`);
  }
}
