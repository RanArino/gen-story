import { randomUUID } from "node:crypto";

import {
  ClaudeSessionProcess,
  type ClaudeStreamEvent,
} from "./claude-process-client";

export type ClaudeSessionEvent =
  | { type: "session-ready"; sessionId: string }
  | { type: "assistant-text"; text: string }
  | {
      type: "turn-completed";
      isError: boolean;
      subtype: string;
      resultText: string | null;
    }
  | { type: "rate-limit"; info: unknown }
  | { type: "raw"; event: ClaudeStreamEvent };

export type ClaudeSessionEventListener = (event: ClaudeSessionEvent) => void;

export class ClaudeSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeSessionError";
  }
}

const DEFAULT_TURN_TIMEOUT_MS = 180_000;
const STARTUP_TIMEOUT_MS = 30_000;

/**
 * A single `claude -p` conversational process bound to one session id. M1
 * scope only: start/resume, send a turn, interrupt, and compact — the
 * Claude counterpart to `CodexNativeSession`, adapted to a materially
 * different lifecycle proven by live probe:
 *
 * - The session id is client-chosen (`--session-id <uuid>`), not learned
 *   from a response, so there is no id-not-yet-known race to guard against.
 * - There is no request/response correlation; a turn is "done" when the
 *   next `result` event arrives on the event stream.
 * - There is no in-process cancel: killing the process is how you cancel a
 *   turn. Claude Code catches SIGTERM gracefully — it records a
 *   "[Request interrupted by user]" marker and an `is_error` result before
 *   exiting — and the session remains resumable afterward, so `interrupt()`
 *   kills this process; continuing the conversation means calling
 *   `resume()` for a new instance, not reusing this one.
 * - Compaction has no dedicated RPC method; sending the literal text
 *   `/compact` as a turn is the documented, working mechanism (proven live:
 *   it declines gracefully when there is not enough context, and otherwise
 *   compacts) — so `compact()` is `sendTurn("/compact")`.
 */
export class ClaudeNativeSession {
  private readonly listeners = new Set<ClaudeSessionEventListener>();
  private closed = false;

  private constructor(
    private readonly process: ClaudeSessionProcess,
    readonly sessionId: string,
  ) {
    process.on("event", (event: ClaudeStreamEvent) => this.handleEvent(event));
  }

  private static spawn(input: {
    args: readonly string[];
    workingDirectory: string;
    allowedWorkingDirectoryRoot: string;
    environment?: NodeJS.ProcessEnv;
  }): ClaudeSessionProcess {
    return new ClaudeSessionProcess(input);
  }

  private static baseArgs(): string[] {
    return [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "bypassPermissions",
      // No built-in tools during M1: there is no approval/handling surface
      // yet, matching CodexNativeSession's sandbox: "read-only" posture.
      "--tools",
      "",
      "--setting-sources",
      "",
      "--strict-mcp-config",
      // Deliberately NOT --disable-slash-commands: /compact must work.
    ];
  }

  static async start(input: {
    workingDirectory: string;
    allowedWorkingDirectoryRoot: string;
    environment?: NodeJS.ProcessEnv;
    model?: string;
    sessionId?: string;
  }): Promise<ClaudeNativeSession> {
    const sessionId = input.sessionId ?? randomUUID();
    const process = ClaudeNativeSession.spawn({
      args: [
        ...ClaudeNativeSession.baseArgs(),
        "--session-id",
        sessionId,
        ...(input.model ? ["--model", input.model] : []),
      ],
      workingDirectory: input.workingDirectory,
      allowedWorkingDirectoryRoot: input.allowedWorkingDirectoryRoot,
      environment: input.environment,
    });

    const session = new ClaudeNativeSession(process, sessionId);
    await session.waitUntilReady();
    return session;
  }

  static async resume(input: {
    sessionId: string;
    workingDirectory: string;
    allowedWorkingDirectoryRoot: string;
    environment?: NodeJS.ProcessEnv;
  }): Promise<ClaudeNativeSession> {
    const process = ClaudeNativeSession.spawn({
      args: [...ClaudeNativeSession.baseArgs(), "--resume", input.sessionId],
      workingDirectory: input.workingDirectory,
      allowedWorkingDirectoryRoot: input.allowedWorkingDirectoryRoot,
      environment: input.environment,
    });

    const session = new ClaudeNativeSession(process, input.sessionId);
    await session.waitUntilReady();
    return session;
  }

  /** Resolves on the first `system/init` event; rejects on early exit/error or timeout. */
  private waitUntilReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new ClaudeSessionError(
            "Timed out waiting for the Claude process to start.",
          ),
        );
      }, STARTUP_TIMEOUT_MS);

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        reject(
          new ClaudeSessionError(
            `Claude process exited before starting (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
          ),
        );
      };
      const unsubscribeEvent = this.onEvent((event) => {
        if (event.type === "session-ready") {
          cleanup();
          resolve();
        }
      });
      const cleanup = () => {
        clearTimeout(timeout);
        unsubscribeEvent();
        this.process.off("exit", onExit);
      };
      this.process.once("exit", onExit);
    });
  }

  onEvent(listener: ClaudeSessionEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ClaudeSessionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private handleEvent(event: ClaudeStreamEvent): void {
    const type = event.type;
    if (type === "system" && event.subtype === "init") {
      this.emit({ type: "session-ready", sessionId: this.sessionId });
      return;
    }
    if (type === "assistant") {
      const message = event.message as
        | { content?: Array<{ type?: string; text?: string }> }
        | undefined;
      const text = message?.content?.find(
        (block) => block.type === "text",
      )?.text;
      if (typeof text === "string") {
        this.emit({ type: "assistant-text", text });
      }
      this.emit({ type: "raw", event });
      return;
    }
    if (type === "result") {
      this.emit({
        type: "turn-completed",
        isError: event.is_error === true,
        subtype: typeof event.subtype === "string" ? event.subtype : "",
        resultText: typeof event.result === "string" ? event.result : null,
      });
      return;
    }
    if (type === "rate_limit_event") {
      this.emit({ type: "rate-limit", info: event.rate_limit_info });
      return;
    }
    this.emit({ type: "raw", event });
  }

  /** Resolves once the next `result` event arrives, marking this turn done. */
  sendTurn(
    text: string,
    timeoutMs = DEFAULT_TURN_TIMEOUT_MS,
  ): Promise<{ isError: boolean; subtype: string; resultText: string | null }> {
    if (this.closed) {
      return Promise.reject(
        new ClaudeSessionError(
          "Cannot send a turn: this session was interrupted or closed. Call resume() for a new session.",
        ),
      );
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        unsubscribe();
        reject(new ClaudeSessionError(`Timed out waiting for a turn result.`));
      }, timeoutMs);

      const unsubscribe = this.onEvent((event) => {
        if (event.type === "turn-completed") {
          clearTimeout(timeout);
          unsubscribe();
          resolve({
            isError: event.isError,
            subtype: event.subtype,
            resultText: event.resultText,
          });
        }
      });

      try {
        this.process.sendMessage(text);
      } catch (error) {
        clearTimeout(timeout);
        unsubscribe();
        reject(error);
      }
    });
  }

  /** `/compact` is a normal message, not a dedicated RPC — see class docs. */
  compact(): Promise<{
    isError: boolean;
    subtype: string;
    resultText: string | null;
  }> {
    return this.sendTurn("/compact");
  }

  /**
   * Cancels the in-flight turn by killing the process. Claude Code records
   * an interrupted marker and an error result before exiting, and the
   * session stays resumable — but this instance cannot send further turns;
   * call `resume()` for a new one.
   */
  async interrupt(): Promise<void> {
    this.closed = true;
    this.process.kill("SIGTERM");
    await this.process.waitForExit();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.process.kill("SIGTERM");
    await this.process.waitForExit();
  }
}
