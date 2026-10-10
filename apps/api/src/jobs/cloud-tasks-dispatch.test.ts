import type { CloudTasksClient } from "@google-cloud/tasks";
import { describe, expect, it, vi } from "vitest";
import { CloudTasksWorkDispatch } from "./cloud-tasks-dispatch";

describe("Cloud Tasks deletion dispatch", () => {
  it("schedules deterministic ID-only work with exact OIDC and bounded deadlines", async () => {
    const createTask = vi.fn().mockResolvedValue([]);
    const getTask = vi.fn().mockResolvedValue([]);
    const client = {
      queuePath: () =>
        "projects/gen-story-496911/locations/asia-northeast1/queues/gen-story-staging-deletions",
      createTask,
      getTask,
    } as unknown as CloudTasksClient;
    const queue = new CloudTasksWorkDispatch(
      {
        projectId: "gen-story-496911",
        location: "asia-northeast1",
        queue: "gen-story-staging-deletions",
        audience: "https://worker.run.app",
        callerEmail: "caller@example.test",
      },
      client,
    );
    const work = {
      workType: "media_deletion" as const,
      workId: "deletion",
      generation: 0,
      notBefore: "2026-10-17T00:00:00.001Z",
    };
    await queue.dispatch(work);
    const input = createTask.mock.calls[0]![0];
    expect(input.task.name).toBe(queue.taskName(work));
    expect(queue.taskName({ ...work, generation: 1 })).not.toBe(
      input.task.name,
    );
    expect(input.task.scheduleTime).toEqual({
      seconds: Date.parse(work.notBefore) / 1000 - 0.001,
      nanos: 1_000_000,
    });
    expect(input.task.dispatchDeadline).toEqual({ seconds: 300 });
    expect(input.task.httpRequest.oidcToken).toEqual({
      serviceAccountEmail: "caller@example.test",
      audience: "https://worker.run.app",
    });
    expect(JSON.parse(input.task.httpRequest.body.toString())).toEqual({
      workType: "media_deletion",
      workId: "deletion",
    });
    createTask.mockRejectedValueOnce({ code: 6 });
    await expect(queue.dispatch(work)).resolves.toBeUndefined();
    getTask.mockRejectedValueOnce({ code: 5 });
    expect(await queue.exists(input.task.name)).toBe(false);
    getTask.mockRejectedValueOnce({ code: 7 });
    await expect(queue.exists(input.task.name)).rejects.toThrow("lookup");
    createTask.mockRejectedValueOnce({ code: 7 });
    await expect(queue.dispatch(work)).rejects.toThrow("enqueue");
  });
});
