import { randomUUID } from "node:crypto";

import {
  ClaudeSessionProcess,
  type ClaudeStreamEvent,
} from "./claude-process-client";

export type ClaudeSessionEvent =
  | { type: "session-ready"; sessionId: string }
  | { type: "assistant-text"; text: string }
  // A tool the assistant invoked, by its raw name (MCP tools arrive as
  // `mcp__<server>__<tool>`). Emitted so a long turn shows progress instead
  // of looking hung while the agent works.
  | { type: "tool-use"; toolName: string }
  | {
      type: "turn-completed";
      isError: boolean;
      subtype: string;
      resultText: string | null;
    }
  | { type: "rate-limit"; info: unknown }
  | { type: "raw"; event: ClaudeStreamEvent };

export type ClaudeSessionEventListener = (event: ClaudeSessionEvent) => void;

/**
 * Which *built-in* tools a session may use. Empty (the default) means none.
 * `mcpConfig` is the `--mcp-config` document; combined with
 * `--strict-mcp-config` it is the *only* MCP configuration the process sees.
 */
export type ClaudeSessionToolOptions = {
  tools?: readonly string[];
  mcpConfig?: Record<string, unknown>;
};

export class ClaudeSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeSessionError";
  }
}

const DEFAULT_TURN_TIMEOUT_MS = 180_000;
// How long start()/resume() waits to see the process fail before treating it
// as usable. `system/init` is NOT waited for — see waitUntilStarted.
const STARTUP_GRACE_MS = 1_500;

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
    // A process that dies mid-turn would otherwise leave sendTurn waiting out
    // its full timeout. Emitting the terminal event the caller is already
    // listening for turns that hang into a prompt failure.
    process.once(
      "exit",
      (code: number | null, signal: NodeJS.Signals | null) => {
        const wasDeliberate = this.closed;
        this.closed = true;
        if (wasDeliberate) return;
        this.emit({
          type: "turn-completed",
          isError: true,
          subtype: "process_exited",
          resultText: `Claude process exited (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
        });
      },
    );
  }

  private static spawn(input: {
    args: readonly string[];
    workingDirectory: string;
    allowedWorkingDirectoryRoot: string;
    environment?: NodeJS.ProcessEnv;
  }): ClaudeSessionProcess {
    return new ClaudeSessionProcess(input);
  }

  private static baseArgs(options: ClaudeSessionToolOptions = {}): string[] {
    return [
      "-p",
      "--input-format",
      "stream-json",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "bypassPermissions",
      // Built-in tools only: `--tools` does not govern MCP tools. Empty means
      // no Read/Bash/Edit at all, matching CodexNativeSession's
      // sandbox: "read-only" posture, and M3 chat sessions keep it empty —
      // their tools come from `--mcp-config` instead.
      "--tools",
      (options.tools ?? []).join(","),
      "--setting-sources",
      "",
      // With --strict-mcp-config only this config is honoured, so the
      // operator's own MCP servers cannot leak into a Gen Story chat.
      ...(options.mcpConfig
        ? ["--mcp-config", JSON.stringify(options.mcpConfig)]
        : []),
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
    tools?: readonly string[];
    mcpConfig?: Record<string, unknown>;
  }): Promise<ClaudeNativeSession> {
    const sessionId = input.sessionId ?? randomUUID();
    const process = ClaudeNativeSession.spawn({
      args: [
        ...ClaudeNativeSession.baseArgs({
          tools: input.tools,
          mcpConfig: input.mcpConfig,
        }),
        "--session-id",
        sessionId,
        ...(input.model ? ["--model", input.model] : []),
      ],
      workingDirectory: input.workingDirectory,
      allowedWorkingDirectoryRoot: input.allowedWorkingDirectoryRoot,
      environment: input.environment,
    });

    const session = new ClaudeNativeSession(process, sessionId);
    await session.waitUntilStarted();
    return session;
  }

  static async resume(input: {
    sessionId: string;
    workingDirectory: string;
    allowedWorkingDirectoryRoot: string;
    environment?: NodeJS.ProcessEnv;
    tools?: readonly string[];
    mcpConfig?: Record<string, unknown>;
  }): Promise<ClaudeNativeSession> {
    const process = ClaudeNativeSession.spawn({
      args: [
        ...ClaudeNativeSession.baseArgs({
          tools: input.tools,
          mcpConfig: input.mcpConfig,
        }),
        "--resume",
        input.sessionId,
      ],
      workingDirectory: input.workingDirectory,
      allowedWorkingDirectoryRoot: input.allowedWorkingDirectoryRoot,
      environment: input.environment,
    });

    const session = new ClaudeNativeSession(process, input.sessionId);
    await session.waitUntilStarted();
    return session;
  }

  /**
   * Resolves once the process is usable; rejects only if it exits first.
   *
   * It deliberately does NOT wait for `system/init`. Under
   * `--input-format stream-json`, Claude Code emits **nothing at all** until
   * the first user message arrives (confirmed against 2.1.224), so a start
   * that blocks on `init` before sending a message deadlocks until the turn
   * timeout — which is exactly how M3's first live Claude chat failed. The
   * session id is client-chosen, so there is nothing in `init` that start()
   * actually needs.
   *
   * A CLI that dies immediately (not installed, not logged in, bad flag)
   * still fails fast: that path exits well inside the grace window.
   */
  private waitUntilStarted(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, STARTUP_GRACE_MS);

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        reject(
          new ClaudeSessionError(
            `Claude process exited before starting (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
          ),
        );
      };
      // An early `init` means the process is up; no reason to wait out the
      // rest of the grace window.
      const unsubscribeEvent = this.onEvent((event) => {
        if (event.type === "session-ready") {
          cleanup();
          resolve();
        }
      });
      const cleanup = () => {
        clearTimeout(timer);
        unsubscribeEvent();
        this.process.off("exit", onExit);
      };
      this.process.once("exit", onExit);
    });
  }

  /** True once interrupt()/close() killed the process: this instance cannot send further turns. */
  get isClosed(): boolean {
    return this.closed;
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
        | { content?: Array<{ type?: string; text?: string; name?: string }> }
        | undefined;
      // Every block, not just the first text one: a single assistant message
      // can carry thinking, several text blocks, and tool calls, and dropping
      // all but the first loses reply text the operator was shown nothing of.
      for (const block of message?.content ?? []) {
        if (block.type === "text" && typeof block.text === "string") {
          this.emit({ type: "assistant-text", text: block.text });
        } else if (
          block.type === "tool_use" &&
          typeof block.name === "string"
        ) {
          this.emit({ type: "tool-use", toolName: block.name });
        }
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

  /**
   * Resolves once the next `result` event arrives, marking this turn done.
   *
   * The timeout measures *silence*, not the turn's total length: it restarts
   * on every event. A turn that references several fields legitimately runs
   * for minutes while streaming tool calls and text, and a wall-clock limit
   * killed exactly those turns — the agent was working and visibly producing
   * output right up to the moment it was declared timed out.
   */
  sendTurn(
    text: string,
    idleTimeoutMs = DEFAULT_TURN_TIMEOUT_MS,
  ): Promise<{ isError: boolean; subtype: string; resultText: string | null }> {
    if (this.closed) {
      return Promise.reject(
        new ClaudeSessionError(
          "Cannot send a turn: this session was interrupted or closed. Call resume() for a new session.",
        ),
      );
    }

    return new Promise((resolve, reject) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const armTimeout = () => {
        timeout = setTimeout(() => {
          unsubscribe();
          reject(
            new ClaudeSessionError(
              `Timed out after ${idleTimeoutMs}ms with no output from the provider.`,
            ),
          );
        }, idleTimeoutMs);
      };

      const unsubscribe = this.onEvent((event) => {
        clearTimeout(timeout);
        if (event.type === "turn-completed") {
          unsubscribe();
          resolve({
            isError: event.isError,
            subtype: event.subtype,
            resultText: event.resultText,
          });
          return;
        }
        armTimeout();
      });

      armTimeout();

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
