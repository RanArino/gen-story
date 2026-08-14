import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

import {
  assertConfinedWorkingDirectory,
  createCliEnvironment,
} from "../cli-process";
import {
  collectSensitiveEnvironmentValues,
  redactSensitiveText,
} from "../redaction";

export type ClaudeStreamEvent = Record<string, unknown>;

/**
 * Low-level duplex client for a long-lived `claude -p --input-format
 * stream-json --output-format stream-json` process. Unlike Codex's App
 * Server, this protocol has no JSON-RPC request/response correlation:
 * messages sent on stdin are fire-and-forget, and stdout is a stream of
 * typed events (`system`, `assistant`, `user`, `result`, ...) terminated
 * per turn by a `result` event. Confirmed live: one process handles
 * multiple sequential turns; killing it (SIGTERM) gracefully records a
 * "[Request interrupted by user]" marker and an `is_error` result before
 * exiting, and the session remains cleanly resumable afterward.
 */
export class ClaudeSessionProcess extends EventEmitter {
  private readonly child: ChildProcess;
  private readonly sensitiveValues: string[];
  private stdoutBuffer = "";
  private exited = false;

  constructor(input: {
    args: readonly string[];
    workingDirectory: string;
    allowedWorkingDirectoryRoot: string;
    environment?: NodeJS.ProcessEnv;
  }) {
    super();

    assertConfinedWorkingDirectory(
      input.workingDirectory,
      input.allowedWorkingDirectoryRoot,
    );

    const sourceEnvironment = input.environment ?? process.env;
    this.sensitiveValues = collectSensitiveEnvironmentValues(sourceEnvironment);

    this.child = spawn("claude", [...input.args], {
      cwd: input.workingDirectory,
      env: createCliEnvironment(sourceEnvironment),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout?.setEncoding("utf8");
    this.child.stdout?.on("data", (chunk: string) => this.handleStdout(chunk));

    this.child.stderr?.setEncoding("utf8");
    this.child.stderr?.on("data", (chunk: string) => {
      this.emit("stderr", redactSensitiveText(chunk, this.sensitiveValues));
    });

    this.child.on("error", (error) => {
      this.exited = true;
      this.emit("processError", error);
    });

    this.child.on("exit", (code, signal) => {
      this.exited = true;
      this.emit("exit", code, signal);
    });
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = this.stdoutBuffer.indexOf("\n")) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      let event: ClaudeStreamEvent;
      try {
        event = JSON.parse(trimmed) as ClaudeStreamEvent;
      } catch {
        this.emit(
          "malformedLine",
          redactSensitiveText(trimmed, this.sensitiveValues),
        );
        continue;
      }
      this.emit("event", event);
    }
  }

  sendMessage(text: string): void {
    if (this.exited || this.child.stdin == null) {
      throw new Error("Cannot send a message: Claude process has exited.");
    }
    const payload = {
      type: "user",
      message: { role: "user", content: [{ type: "text", text }] },
    };
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    this.child.kill(signal);
  }

  waitForExit(): Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }> {
    if (this.exited && this.child.exitCode !== null) {
      return Promise.resolve({
        code: this.child.exitCode,
        signal: this.child.signalCode,
      });
    }
    return new Promise((resolve) => {
      this.child.once("exit", (code, signal) => resolve({ code, signal }));
    });
  }
}
