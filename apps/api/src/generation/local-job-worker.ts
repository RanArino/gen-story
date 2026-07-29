import {
  checkConcurrencyAllowed,
  markAiJobFailed,
  markAiJobRunning,
  markAiJobSucceeded,
  markGenerationRequestCompleted,
  markGenerationRequestFailed,
  markGenerationRequestRunning,
  runComplementSceneProposalsJob,
  runPhotoAnalysisJob,
  runSceneAiFillJob,
} from "@gen-story/application";
import type {
  ApplicationDependencies,
  UseCaseResult,
} from "@gen-story/application";
import type { AiJob } from "@gen-story/domain";

const AI_JOB_RUNNERS: Record<
  AiJob["kind"],
  (
    deps: ApplicationDependencies,
    job: AiJob,
  ) => Promise<UseCaseResult<Record<string, unknown>>>
> = {
  photo_analysis: runPhotoAnalysisJob,
  scene_ai_fill: runSceneAiFillJob,
  complement_scene_proposals: runComplementSceneProposalsJob,
};

const MAX_DISPATCH_PER_TICK = 5;

function now(): string {
  return new Date().toISOString();
}

export class LocalJobWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs: number;
  private running = false;

  constructor(
    private readonly deps: ApplicationDependencies,
    options?: { pollIntervalMs?: number },
  ) {
    this.pollIntervalMs = options?.pollIntervalMs ?? 500;
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        console.error("[LocalJobWorker] Unhandled tick error:", err);
      });
    }, this.pollIntervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.processQueued();
      await this.processQueuedAiJobs();
    } finally {
      this.running = false;
    }
  }

  private async processQueued(): Promise<void> {
    const queued = await this.deps.generationRequests.findQueued();
    if (queued.length === 0) return;

    const dispatched: Promise<void>[] = [];

    for (const request of queued) {
      const allowed = await checkConcurrencyAllowed(
        this.deps,
        request.projectId,
      );
      if (!allowed) continue;

      dispatched.push(this.executeJob(request.id, request.inputJson));

      // Stop dispatching once we have reached the global cap for this tick
      if (dispatched.length >= MAX_DISPATCH_PER_TICK) break;
    }

    await Promise.allSettled(dispatched);
  }

  private async processQueuedAiJobs(): Promise<void> {
    const queued = await this.deps.aiJobs.findQueued();
    if (queued.length === 0) return;

    const dispatched: Promise<void>[] = [];

    for (const job of queued) {
      const allowed = await checkConcurrencyAllowed(this.deps, job.projectId);
      if (!allowed) continue;

      dispatched.push(this.executeAiJob(job));

      if (dispatched.length >= MAX_DISPATCH_PER_TICK) break;
    }

    await Promise.allSettled(dispatched);
  }

  private async executeAiJob(job: AiJob): Promise<void> {
    const startedAt = now();

    const runningResult = await markAiJobRunning(this.deps, {
      aiJobId: job.id,
      startedAt,
    });

    if (!runningResult.ok) {
      // Already transitioned by another worker tick, or canceled — skip.
      return;
    }

    console.log(`[Worker] starting AI job ${job.id} (${job.kind})`);

    try {
      const result = await AI_JOB_RUNNERS[job.kind](
        this.deps,
        runningResult.value,
      );

      if (!result.ok) {
        await markAiJobFailed(this.deps, {
          aiJobId: job.id,
          errorMessage: result.error.message.slice(0, 500),
          completedAt: now(),
        });
        console.log(
          `[Worker] failed AI job ${job.id}: ${result.error.message}`,
        );
        return;
      }

      const succeeded = await markAiJobSucceeded(this.deps, {
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markAiJobFailed(this.deps, {
        aiJobId: job.id,
        errorMessage: message.slice(0, 500),
        completedAt: now(),
      });
      console.log(`[Worker] failed AI job ${job.id}: ${message}`);
    }
  }

  private async executeJob(
    requestId: string,
    inputJson: Record<string, unknown>,
  ): Promise<void> {
    const startedAt = now();

    const runningResult = await markGenerationRequestRunning(this.deps, {
      generationRequestId: requestId,
      startedAt,
    });

    if (!runningResult.ok) {
      // Already transitioned by another worker tick — skip.
      return;
    }

    const request = runningResult.value;
    console.log(
      `[Worker] starting job ${requestId} for scene ${request.sceneId}`,
    );

    try {
      const result = await this.deps.imageGeneration.generate({
        requestId,
        inputJson,
      });

      const completedAt = now();
      const generatedImageId = `img-${requestId}-${Date.now()}`;
      const durationMs = Date.now() - new Date(startedAt).getTime();

      const completedResult = await markGenerationRequestCompleted(this.deps, {
        generationRequestId: requestId,
        generatedImageId,
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
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await markGenerationRequestFailed(this.deps, {
        generationRequestId: requestId,
        errorMessage: message.slice(0, 500),
        completedAt: now(),
      });
      console.log(`[Worker] failed job ${requestId}: ${message}`);
    }
  }
}
