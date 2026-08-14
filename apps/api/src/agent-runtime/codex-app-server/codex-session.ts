import {
  CodexAppServerClient,
  type ServerRequestRejecter,
  type ServerRequestResponder,
} from "./app-server-client";

export type CodexSessionEvent =
  | { type: "thread-started"; threadId: string }
  | { type: "turn-started"; turnId: string }
  | { type: "item-started"; item: unknown }
  | { type: "agent-message-delta"; itemId: string; delta: string }
  | { type: "item-completed"; item: unknown }
  | { type: "turn-completed"; turnId: string; status: string }
  | { type: "context-compacted" }
  | { type: "status-changed"; status: unknown }
  | {
      type: "server-request";
      method: string;
      params: unknown;
      respond: ServerRequestResponder;
      reject: ServerRequestRejecter;
    }
  | { type: "notification"; method: string; params: unknown };

export type CodexSessionEventListener = (event: CodexSessionEvent) => void;

export class CodexSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexSessionError";
  }
}

const CLIENT_INFO = { name: "gen-story", version: "0.1.0" };

/**
 * A single Codex App Server connection bound to one thread. M1 scope only:
 * start/resume, send a turn, interrupt, and explicit compact — enough to
 * prove the provider lifecycle M3 will build conversational chat on top of.
 * Approval/user-input requests from the server are forwarded as
 * `server-request` events; if nothing responds, the underlying client
 * auto-declines them so a turn can never hang forever waiting on a UI that
 * does not exist yet.
 */
export class CodexNativeSession {
  private readonly listeners = new Set<CodexSessionEventListener>();
  private resolvedThreadId: string | null;

  // `thread/started` (and in principle any other early notification) can
  // arrive bundled in the same stdout chunk as the request that triggered
  // it, dispatched synchronously before that request's own `await`
  // continuation runs. So listeners must be attached the moment the client
  // exists, before any request is sent — never after awaiting one — or
  // early events are silently dropped.
  private constructor(
    private readonly client: CodexAppServerClient,
    knownThreadId: string | null,
  ) {
    this.resolvedThreadId = knownThreadId;
    client.on("notification", (method: string, params: unknown) =>
      this.handleNotification(method, params),
    );
    client.on(
      "request",
      (
        method: string,
        params: unknown,
        respond: ServerRequestResponder,
        reject: ServerRequestRejecter,
      ) =>
        this.emit({ type: "server-request", method, params, respond, reject }),
    );
  }

  get threadId(): string {
    if (this.resolvedThreadId == null) {
      throw new CodexSessionError(
        "threadId accessed before the session finished starting.",
      );
    }
    return this.resolvedThreadId;
  }

  static async start(input: {
    workingDirectory: string;
    allowedWorkingDirectoryRoot: string;
    cwd: string;
    environment?: NodeJS.ProcessEnv;
    model?: string;
  }): Promise<CodexNativeSession> {
    const client = new CodexAppServerClient({
      workingDirectory: input.workingDirectory,
      allowedWorkingDirectoryRoot: input.allowedWorkingDirectoryRoot,
      environment: input.environment,
    });
    const session = new CodexNativeSession(client, null);

    await client.request("initialize", {
      clientInfo: CLIENT_INFO,
      capabilities: { experimentalApi: true },
    });

    const result = await client.request<{ thread: { id: string } }>(
      "thread/start",
      {
        cwd: input.cwd,
        sandbox: "read-only",
        approvalPolicy: "never",
        ...(input.model ? { model: input.model } : {}),
      },
    );
    session.resolvedThreadId ??= result.thread.id;

    return session;
  }

  static async resume(input: {
    threadId: string;
    workingDirectory: string;
    allowedWorkingDirectoryRoot: string;
    environment?: NodeJS.ProcessEnv;
  }): Promise<CodexNativeSession> {
    const client = new CodexAppServerClient({
      workingDirectory: input.workingDirectory,
      allowedWorkingDirectoryRoot: input.allowedWorkingDirectoryRoot,
      environment: input.environment,
    });
    // Unlike `start`, the thread id is already known, so it is safe to pass
    // it in immediately rather than waiting on `thread/resume`'s response.
    const session = new CodexNativeSession(client, input.threadId);

    await client.request("initialize", {
      clientInfo: CLIENT_INFO,
      capabilities: { experimentalApi: true },
    });

    await client.request<{ thread: { id: string } }>("thread/resume", {
      threadId: input.threadId,
    });

    return session;
  }

  onEvent(listener: CodexSessionEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: CodexSessionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private handleNotification(method: string, params: unknown): void {
    const record = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case "thread/started": {
        // May arrive before `thread/start`'s response is assigned to
        // `resolvedThreadId` (see the constructor note); the notification
        // carries the thread id itself, so prefer that.
        const fromParams = (record.thread as { id?: unknown } | undefined)?.id;
        const threadId =
          typeof fromParams === "string" ? fromParams : this.resolvedThreadId;
        if (threadId == null) return;
        this.resolvedThreadId ??= threadId;
        this.emit({ type: "thread-started", threadId });
        return;
      }
      case "turn/started":
        this.emit({
          type: "turn-started",
          turnId: String((record.turn as { id?: unknown })?.id ?? ""),
        });
        return;
      case "item/started":
        this.emit({ type: "item-started", item: record.item });
        return;
      case "item/agentMessage/delta":
        this.emit({
          type: "agent-message-delta",
          itemId: String(record.itemId ?? ""),
          delta: String(record.delta ?? ""),
        });
        return;
      case "item/completed":
        this.emit({ type: "item-completed", item: record.item });
        return;
      case "turn/completed": {
        const turn = record.turn as { id?: unknown; status?: unknown };
        this.emit({
          type: "turn-completed",
          turnId: String(turn?.id ?? ""),
          status: String(turn?.status ?? "unknown"),
        });
        return;
      }
      case "thread/compacted":
        this.emit({ type: "context-compacted" });
        return;
      case "thread/status/changed":
        this.emit({ type: "status-changed", status: record.status });
        return;
      default:
        this.emit({ type: "notification", method, params });
    }
  }

  async sendTurn(text: string): Promise<{ turnId: string }> {
    const result = await this.client.request<{ turn: { id: string } }>(
      "turn/start",
      {
        threadId: this.threadId,
        input: [{ type: "text", text }],
      },
    );
    return { turnId: result.turn.id };
  }

  /** Resolves once `turn/completed` (or `thread/compacted`) arrives for this turn. */
  waitForTurnCompletion(turnId: string): Promise<{ status: string }> {
    return new Promise((resolve) => {
      const unsubscribe = this.onEvent((event) => {
        if (event.type === "turn-completed" && event.turnId === turnId) {
          unsubscribe();
          resolve({ status: event.status });
        }
      });
    });
  }

  async interruptTurn(turnId: string): Promise<void> {
    await this.client.request("turn/interrupt", {
      threadId: this.threadId,
      turnId,
    });
  }

  async compact(): Promise<void> {
    await this.client.request("thread/compact/start", {
      threadId: this.threadId,
    });
  }

  async close(): Promise<void> {
    this.client.kill("SIGTERM");
    await this.client.waitForExit();
  }
}
