import { createServer, type Server } from "node:http";
import type { DeletionTaskQueue } from "../../jobs/cloud-tasks-dispatch";
import type { PersistedDeletionWork } from "../../jobs/persisted-work";

export const localTaskName = (work: PersistedDeletionWork) =>
  `${work.workType}-${work.workId}-${work.generation}`;
type Task = { work: PersistedDeletionWork; attempts: number };

// A local stand-in for Cloud Tasks: deterministic task names, idempotent
// creation, scheduled delivery, and bounded retries to an HTTP worker.
export class LocalTaskQueue implements DeletionTaskQueue {
  readonly tasks = new Map<string, Task>();
  readonly deliveries: { name: string; status: number }[] = [];
  readonly dispatched: PersistedDeletionWork[] = [];
  paused = false;
  private server?: Server;
  private timers = new Set<NodeJS.Timeout>();
  constructor(
    private readonly options: {
      deliver: (work: PersistedDeletionWork) => Promise<number>;
      maxAttempts?: number;
      backoffMs?: number;
      clock?: () => Date;
    },
  ) {}
  taskName = localTaskName;
  async exists(name: string) {
    return this.tasks.has(name);
  }
  async dispatch(work: PersistedDeletionWork) {
    const name = this.taskName(work);
    if (this.tasks.has(name)) return;
    this.dispatched.push(work);
    this.tasks.set(name, { work, attempts: 0 });
    this.schedule(name);
  }
  reset() {
    this.tasks.clear();
    this.deliveries.length = 0;
    this.dispatched.length = 0;
    this.paused = false;
  }
  drop(name: string) {
    this.tasks.delete(name);
  }
  // Mirrors the Cloud Tasks "run task" operation: ignores the schedule time.
  async run(name: string) {
    const task = this.tasks.get(name);
    if (!task) throw new Error("Task not found.");
    task.attempts++;
    const status = await this.options.deliver(task.work);
    this.deliveries.push({ name, status });
    if (status >= 200 && status < 300) this.tasks.delete(name);
    return status;
  }
  private schedule(name: string, delayMs?: number) {
    const task = this.tasks.get(name);
    if (!task || this.paused) return;
    const now = (this.options.clock ?? (() => new Date()))().getTime();
    const wait = delayMs ?? Math.max(0, Date.parse(task.work.notBefore) - now);
    if (wait > 2_147_000_000) return;
    const timer = setTimeout(async () => {
      this.timers.delete(timer);
      if (!this.tasks.has(name) || this.paused) return;
      const attempts = this.tasks.get(name)!.attempts;
      let status = 0;
      try {
        status = await this.run(name);
      } catch {
        this.deliveries.push({ name, status: 0 });
      }
      if (
        (status < 200 || status >= 300) &&
        this.tasks.has(name) &&
        attempts + 1 < (this.options.maxAttempts ?? 10)
      )
        this.schedule(name, (this.options.backoffMs ?? 200) * (attempts + 1));
    }, wait);
    this.timers.add(timer);
  }
  resume() {
    this.paused = false;
    for (const name of this.tasks.keys()) this.schedule(name);
  }
  async settled(timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    while (this.tasks.size && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100));
  }
  // HTTP surface so a containerised worker can run its repair against this queue.
  async listen() {
    this.server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://queue");
      const name = decodeURIComponent(url.pathname.slice(1));
      if (req.method === "GET") {
        res.writeHead(this.tasks.has(name) ? 200 : 404).end();
        return;
      }
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        await this.dispatch(JSON.parse(Buffer.concat(chunks).toString()));
        res.writeHead(204).end();
        return;
      }
      res.writeHead(405).end();
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(0, "127.0.0.1", resolve),
    );
    return (this.server.address() as { port: number }).port;
  }
  async close() {
    this.timers.forEach(clearTimeout);
    await new Promise<void>((resolve) =>
      this.server ? this.server.close(() => resolve()) : resolve(),
    );
  }
}

export class LocalTaskQueueClient implements DeletionTaskQueue {
  constructor(private readonly base: string) {}
  taskName = localTaskName;
  async exists(name: string) {
    return (await fetch(`${this.base}/${encodeURIComponent(name)}`)).ok;
  }
  async dispatch(work: PersistedDeletionWork) {
    const response = await fetch(this.base, {
      method: "POST",
      body: JSON.stringify(work),
    });
    if (!response.ok) throw new Error("Task enqueue failed.");
  }
}
