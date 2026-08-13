import {
  MAX_CONCURRENT_PER_PROJECT,
  markAiJobFailed,
  markAiJobRunning,
  markAiJobSucceeded,
  markGenerationRequestCompleted,
  markGenerationRequestFailed,
  markGenerationRequestRunning,
  runComplementSceneProposalsJob,
  runCharacterSheetGenerationJob,
  runPhotoAnalysisJob,
  runSceneAiFillJob,
  runStorySetupJob,
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
  story_setup: runStorySetupJob,
  scene_ai_fill: runSceneAiFillJob,
  complement_scene_proposals: runComplementSceneProposalsJob,
  character_sheet_generation: runCharacterSheetGenerationJob,
};

// Caps how many new items one scan may start, so a backlog spread over many
// projects ramps up instead of launching everything at once.
const MAX_DISPATCH_PER_TICK = 5;

function now(): string {
  return new Date().toISOString();
}

export class LocalJobWorker {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly pollIntervalMs: number;
  private scanning = false;
  // Everything this worker currently has in flight, as id -> projectId. The
  // worker is the only thing that starts work in this process, so this is an
  // exact per-project count: no database read, and no race against a `running`
  // status write that has not landed yet.
  private readonly inFlight = new Map<string, string>();

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

  // Only the scan is serialized. It deliberately does not wait for the work it
  // starts: waiting meant a slot freed by an early finisher stayed idle until
  // the slowest job in the batch completed, which on an eight-scene fill left
  // three of five slots unused for six seconds.
  private async tick(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const [requests, jobs] = await Promise.all([
        this.deps.generationRequests.findQueued(),
        this.deps.aiJobs.findQueued(),
      ]);

      let started = 0;
      for (const request of requests) {
        if (started >= MAX_DISPATCH_PER_TICK) break;
        if (!this.claimSlot(request.id, request.projectId)) continue;
        this.track(request.id, this.executeJob(request.id, request.inputJson));
        started += 1;
      }
      for (const job of jobs) {
        if (started >= MAX_DISPATCH_PER_TICK) break;
        if (!this.claimSlot(job.id, job.projectId)) continue;
        this.track(job.id, this.executeAiJob(job));
        started += 1;
      }
    } finally {
      this.scanning = false;
    }
  }

  // Reserves a slot for this item, or reports that it cannot run yet. Reserving
  // up front is what keeps the cap exact once dispatch stopped being awaited.
  private claimSlot(id: string, projectId: string): boolean {
    if (this.inFlight.has(id)) return false;

    let used = 0;
    for (const owner of this.inFlight.values()) {
      if (owner === projectId) used += 1;
    }
    if (used >= MAX_CONCURRENT_PER_PROJECT) return false;

    this.inFlight.set(id, projectId);
    return true;
  }

  // The slot must be released on failure too, and the rejection must stop here:
  // nothing awaits this promise any more, and an unhandled rejection takes the
  // whole API process down.
  private track(id: string, work: Promise<void>): void {
    void work
      .catch((err) => {
        console.error(`[LocalJobWorker] Unhandled error for ${id}:`, err);
      })
      .finally(() => this.inFlight.delete(id));
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
