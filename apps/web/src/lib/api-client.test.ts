import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  awaitAiJob,
  getMe,
  subscribeToProjectEvents,
} from "./api-client";

type Listener = (message: { data: string }) => void;

// Minimal stand-in for the browser EventSource, recording how many were opened
// so the sharing behaviour can be asserted.
class FakeEventSource {
  static instances: FakeEventSource[] = [];

  public closed = false;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(public readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(kind: string, listener: Listener): void {
    const set = this.listeners.get(kind) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(kind, set);
  }

  removeEventListener(kind: string, listener: Listener): void {
    this.listeners.get(kind)?.delete(listener);
  }

  close(): void {
    this.closed = true;
  }

  emit(kind: string, payload: unknown): void {
    this.emitRaw(kind, JSON.stringify(payload));
  }

  emitRaw(kind: string, data: string): void {
    for (const listener of this.listeners.get(kind) ?? []) {
      listener({ data });
    }
  }
}

const originalEventSource = globalThis.EventSource;

beforeEach(() => {
  FakeEventSource.instances = [];
  (globalThis as { EventSource: unknown }).EventSource = FakeEventSource;
});

afterEach(() => {
  (globalThis as { EventSource?: unknown }).EventSource = originalEventSource;
});

describe("subscribeToProjectEvents", () => {
  // Waiting on a batch of jobs used to open one connection per job, so a
  // five-scene bulk fill held five streams to the same endpoint.
  it("shares one connection across subscribers to the same project", () => {
    const seenByFirst: unknown[] = [];
    const seenBySecond: unknown[] = [];

    const unsubscribeFirst = subscribeToProjectEvents("project_1", (event) =>
      seenByFirst.push(event),
    );
    const unsubscribeSecond = subscribeToProjectEvents("project_1", (event) =>
      seenBySecond.push(event),
    );

    expect(FakeEventSource.instances).toHaveLength(1);

    FakeEventSource.instances[0]!.emit("ai-job.succeeded", {
      kind: "ai-job.succeeded",
      entityType: "aiJob",
      entityId: "job_1",
    });

    // Both subscribers see the event from the single stream.
    expect(seenByFirst).toHaveLength(1);
    expect(seenBySecond).toHaveLength(1);

    // The stream stays open while any subscriber remains.
    unsubscribeFirst();
    expect(FakeEventSource.instances[0]!.closed).toBe(false);

    unsubscribeSecond();
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
  });

  it("opens a separate connection per project", () => {
    const unsubscribeA = subscribeToProjectEvents("project_a", () => undefined);
    const unsubscribeB = subscribeToProjectEvents("project_b", () => undefined);

    expect(FakeEventSource.instances).toHaveLength(2);

    unsubscribeA();
    unsubscribeB();
  });

  it("reopens after the last subscriber has left", () => {
    subscribeToProjectEvents("project_1", () => undefined)();
    expect(FakeEventSource.instances).toHaveLength(1);

    subscribeToProjectEvents("project_1", () => undefined)();
    expect(FakeEventSource.instances).toHaveLength(2);
  });

  it("survives a malformed frame and keeps delivering later ones", () => {
    const seen: unknown[] = [];
    const unsubscribe = subscribeToProjectEvents("project_1", (event) =>
      seen.push(event),
    );
    const source = FakeEventSource.instances[0]!;

    source.emitRaw("ai-job.running", "not json");
    source.emit("ai-job.succeeded", { kind: "ai-job.succeeded" });

    expect(seen).toEqual([{ kind: "ai-job.succeeded" }]);
    unsubscribe();
  });
});

describe("request", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // A dead API server surfaced as the browser's bare "Failed to fetch", which
  // names neither the server nor the port.
  it("reports an unreachable API instead of the raw fetch failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    await expect(getMe()).rejects.toMatchObject({
      code: "API_UNREACHABLE",
      status: 0,
    });
    await expect(getMe()).rejects.toBeInstanceOf(ApiError);
    await expect(getMe()).rejects.toThrow(/Cannot reach the API server at/);
  });
});

describe("awaitAiJob", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function stubFetch(job: Record<string, unknown>) {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(job), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  // The transition events already carry status, result and errorMessage, so a
  // completion needs no follow-up request. Fetching again on every event is
  // what filled the API log during a bulk fill.
  it("resolves from the event payload without a follow-up request", async () => {
    const fetchMock = stubFetch({
      id: "job_1",
      status: "running",
      errorMessage: null,
      resultJson: null,
    });

    const pending = awaitAiJob("job_1", { projectId: "project_1" });

    // Let the one opening request settle, then finish the job over the stream.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    FakeEventSource.instances[0]!.emit("ai-job.succeeded", {
      kind: "ai-job.succeeded",
      entityType: "aiJob",
      entityId: "job_1",
      payload: {
        aiJobId: "job_1",
        projectId: "project_1",
        status: "succeeded",
        result: { filledFields: ["title"] },
        errorMessage: null,
      },
    });

    await expect(pending).resolves.toEqual({
      jobId: "job_1",
      status: "succeeded",
      errorMessage: null,
      resultJson: { filledFields: ["title"] },
    });
    // Only the opening request: the completion came from the stream.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // And the shared stream was released.
    expect(FakeEventSource.instances[0]!.closed).toBe(true);
  });

  it("still resolves for a job that finished before the stream was joined", async () => {
    stubFetch({
      id: "job_2",
      status: "failed",
      errorMessage: "boom",
      resultJson: null,
    });

    await expect(
      awaitAiJob("job_2", { projectId: "project_1" }),
    ).resolves.toMatchObject({ status: "failed", errorMessage: "boom" });
  });

  it("reports status changes once each", async () => {
    stubFetch({
      id: "job_3",
      status: "queued",
      errorMessage: null,
      resultJson: null,
    });

    const statuses: string[] = [];
    const pending = awaitAiJob("job_3", {
      projectId: "project_1",
      onStatus: (status) => statuses.push(status),
    });

    await vi.waitFor(() => expect(statuses).toEqual(["queued"]));
    const source = FakeEventSource.instances[0]!;
    const event = (status: string) => ({
      kind: `ai-job.${status}`,
      entityType: "aiJob",
      entityId: "job_3",
      payload: { aiJobId: "job_3", projectId: "project_1", status },
    });

    // A repeat of the current status must not be reported again.
    source.emit("ai-job.queued", event("queued"));
    source.emit("ai-job.running", event("running"));
    source.emit("ai-job.succeeded", event("succeeded"));

    await pending;
    expect(statuses).toEqual(["queued", "running", "succeeded"]);
  });
});
