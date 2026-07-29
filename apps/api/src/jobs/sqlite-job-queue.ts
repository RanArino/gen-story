import { randomUUID } from "node:crypto";

import { createAiJob } from "@gen-story/domain";
import type { AiJobKind } from "@gen-story/domain";
import type {
  AiJobRepositoryPort,
  JobQueuePort,
  ProgressEventPort,
} from "@gen-story/application";

// Enqueueing writes a `queued` row; LocalJobWorker picks it up on its next
// poll. There is no in-memory queue, so a restart loses nothing.
export class SqliteJobQueue implements JobQueuePort {
  constructor(
    private readonly aiJobs: AiJobRepositoryPort,
    private readonly progressEvents: ProgressEventPort,
  ) {}

  async enqueue(job: {
    kind: AiJobKind;
    projectId: string;
    payload: Record<string, unknown>;
  }): Promise<{ jobId: string }> {
    const timestamp = new Date().toISOString();
    const aiJob = createAiJob({
      id: randomUUID(),
      projectId: job.projectId,
      kind: job.kind,
      inputJson: job.payload,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await this.aiJobs.save(aiJob);
    await this.progressEvents.publish({
      kind: "ai-job.queued",
      entityType: "aiJob",
      entityId: aiJob.id,
      payload: {
        aiJobId: aiJob.id,
        projectId: aiJob.projectId,
        jobKind: aiJob.kind,
        status: aiJob.status,
      },
    });

    return { jobId: aiJob.id };
  }
}
