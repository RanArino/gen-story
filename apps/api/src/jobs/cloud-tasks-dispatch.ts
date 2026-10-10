import { createHash } from "node:crypto";
import { CloudTasksClient } from "@google-cloud/tasks";
import type {
  PersistedDeletionDispatch,
  PersistedDeletionWork,
} from "./persisted-work";

export interface DeletionTaskQueue extends PersistedDeletionDispatch {
  taskName(work: PersistedDeletionWork): string;
  exists(name: string): Promise<boolean>;
}
export type DeletionTaskConfig = {
  projectId: string;
  location: string;
  queue: string;
  audience: string;
  callerEmail: string;
};

export class CloudTasksWorkDispatch implements DeletionTaskQueue {
  constructor(
    readonly config: DeletionTaskConfig,
    private readonly client: CloudTasksClient = new CloudTasksClient(),
  ) {}
  taskName(work: PersistedDeletionWork) {
    const hash = createHash("sha256")
      .update(JSON.stringify([work.workType, work.workId, work.generation]))
      .digest("hex");
    return `${this.client.queuePath(this.config.projectId, this.config.location, this.config.queue)}/tasks/${hash}`;
  }
  async dispatch(work: PersistedDeletionWork) {
    if (
      work.workType !== "media_deletion" ||
      !/^[A-Za-z0-9_-]{1,200}$/.test(work.workId) ||
      !Number.isSafeInteger(work.generation) ||
      work.generation < 0 ||
      !Number.isFinite(Date.parse(work.notBefore))
    )
      throw new Error("Invalid persisted work.");
    try {
      await this.client.createTask(
        {
          parent: this.client.queuePath(
            this.config.projectId,
            this.config.location,
            this.config.queue,
          ),
          task: {
            name: this.taskName(work),
            scheduleTime: {
              seconds: Math.floor(Date.parse(work.notBefore) / 1000),
              nanos: (Date.parse(work.notBefore) % 1000) * 1_000_000,
            },
            dispatchDeadline: { seconds: 300 },
            httpRequest: {
              httpMethod: "POST",
              url: `${this.config.audience}/internal/tasks/work`,
              oidcToken: {
                serviceAccountEmail: this.config.callerEmail,
                audience: this.config.audience,
              },
              headers: { "Content-Type": "application/json" },
              body: Buffer.from(
                JSON.stringify({
                  workType: work.workType,
                  workId: work.workId,
                }),
              ),
            },
          },
        },
        { timeout: 15_000 },
      );
    } catch (error) {
      if (!hasCode(error, 6)) throw new Error("Task enqueue failed.");
    }
  }
  async exists(name: string) {
    try {
      await this.client.getTask({ name }, { timeout: 15_000 });
      return true;
    } catch (error) {
      if (hasCode(error, 5)) return false;
      throw new Error("Task lookup failed.");
    }
  }
  close() {
    return this.client.close();
  }
}
function hasCode(error: unknown, code: number) {
  return (
    error != null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === code
  );
}
