import {
  checkConcurrencyAllowed,
  markGenerationRequestCompleted,
  markGenerationRequestFailed,
  markGenerationRequestRunning,
} from "@gen-story/application";
import type { ApplicationDependencies } from "@gen-story/application";

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
      if (dispatched.length >= 5) break;
    }

    await Promise.allSettled(dispatched);
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
    console.log(`[Worker] starting job ${requestId} for scene ${request.sceneId}`);

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
        console.log(`[Worker] job ${requestId} already canceled; discarding result`);
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
