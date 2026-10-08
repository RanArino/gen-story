import { MAX_CONCURRENT_PER_PROJECT } from "@gen-story/application";
import {
  executePersistedAiJob,
  executePersistedGenerationRequest,
} from "../jobs/execute-persisted-job";
import type { PersistedJobExecutionDependencies } from "../jobs/execute-persisted-job";

// Caps how many new items one scan may start, so a backlog spread over many
// projects ramps up instead of launching everything at once.
const MAX_DISPATCH_PER_TICK = 5;

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
    private readonly deps: PersistedJobExecutionDependencies,
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
        this.track(
          request.id,
          executePersistedGenerationRequest(
            this.deps,
            request.id,
            request.inputJson,
          ),
        );
        started += 1;
      }
      for (const job of jobs) {
        if (started >= MAX_DISPATCH_PER_TICK) break;
        if (!this.claimSlot(job.id, job.projectId)) continue;
        this.track(job.id, executePersistedAiJob(this.deps, job));
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
}
