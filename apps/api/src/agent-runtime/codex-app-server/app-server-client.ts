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

export type JsonRpcId = string | number;

export class AppServerRequestError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly data?: unknown,
  ) {
    super(message);
    this.name = "AppServerRequestError";
  }
}

export type ServerRequestResponder = (result: unknown) => void;
export type ServerRequestRejecter = (code: number, message: string) => void;

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
// If nothing answers a server-initiated request (e.g. a command-execution
// approval) within this window, decline it so the App Server never hangs a
// turn waiting on a client that has no UI to answer with yet.
const SERVER_REQUEST_AUTO_DECLINE_MS = 30_000;

/**
 * Low-level JSON-RPC-over-stdio duplex client for `codex app-server`. Frames
 * are newline-delimited JSON (confirmed empirically; the protocol has no
 * Content-Length header framing). One process instance is one connection —
 * callers needing a fresh restart-recovery cycle spawn a new client.
 */
export class CodexAppServerClient extends EventEmitter {
  private readonly child: ChildProcess;
  private readonly sensitiveValues: string[];
  private stdoutBuffer = "";
  private nextRequestId = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private exited = false;

  constructor(input: {
    command?: string;
    args?: readonly string[];
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

    this.child = spawn(input.command ?? "codex", input.args ?? ["app-server"], {
      cwd: input.workingDirectory,
      env: createCliEnvironment(sourceEnvironment),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.child.stdout?.setEncoding("utf8");
    this.child.stdout?.on("data", (chunk: string) => this.handleStdout(chunk));

    this.child.stderr?.setEncoding("utf8");
    this.child.stderr?.on("data", (chunk: string) => {
      this.emit("stderr", this.redact(chunk));
    });

    this.child.on("error", (error) => {
      this.failAllPending(
        new Error(`App Server process error: ${error.message}`),
      );
      this.emit("processError", error);
    });

    this.child.on("exit", (code, signal) => {
      this.exited = true;
      this.failAllPending(
        new Error(
          `App Server process exited before responding (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
        ),
      );
      this.emit("exit", code, signal);
    });
  }

  private redact(text: string): string {
    return redactSensitiveText(text, this.sensitiveValues);
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = this.stdoutBuffer.indexOf("\n")) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIndex);
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;

      let message: Record<string, unknown>;
      try {
        message = JSON.parse(trimmed) as Record<string, unknown>;
      } catch {
        this.emit("malformedLine", this.redact(trimmed));
        continue;
      }
      this.dispatch(message);
    }
  }

  private dispatch(message: Record<string, unknown>): void {
    const hasId = message.id !== undefined;
    const hasMethod = typeof message.method === "string";
    const hasResultOrError =
      message.result !== undefined || message.error !== undefined;

    if (hasId && hasResultOrError && !hasMethod) {
      this.resolvePending(message);
      return;
    }
    if (hasId && hasMethod) {
      this.handleServerRequest(
        message.id as JsonRpcId,
        message.method as string,
        message.params,
      );
      return;
    }
    if (hasMethod) {
      this.emit("notification", message.method as string, message.params);
      return;
    }
    this.emit("malformedLine", this.redact(JSON.stringify(message)));
  }

  private resolvePending(message: Record<string, unknown>): void {
    const id = message.id as JsonRpcId;
    const pending = this.pending.get(id);
    if (pending == null) {
      this.emit(
        "malformedLine",
        this.redact(`unmatched response id=${String(id)}`),
      );
      return;
    }
    this.pending.delete(id);
    clearTimeout(pending.timeout);

    if (message.error !== undefined) {
      const error = message.error as {
        code: number;
        message: string;
        data?: unknown;
      };
      pending.reject(
        new AppServerRequestError(
          this.redact(error.message),
          error.code,
          error.data,
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  private handleServerRequest(
    id: JsonRpcId,
    method: string,
    params: unknown,
  ): void {
    let settled = false;
    const respond: ServerRequestResponder = (result) => {
      if (settled || this.exited) return;
      settled = true;
      clearTimeout(autoDecline);
      this.writeLine({ id, result });
    };
    const reject: ServerRequestRejecter = (code, message) => {
      if (settled || this.exited) return;
      settled = true;
      clearTimeout(autoDecline);
      this.writeLine({ id, error: { code, message } });
    };
    const autoDecline = setTimeout(() => {
      reject(-32000, `No handler responded to ${method} within the timeout.`);
    }, SERVER_REQUEST_AUTO_DECLINE_MS);

    this.emit("request", method, params, respond, reject);
  }

  private failAllPending(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private writeLine(payload: Record<string, unknown>): void {
    if (this.exited || this.child.stdin == null) return;
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  request<T = unknown>(
    method: string,
    params: unknown,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    if (this.exited) {
      return Promise.reject(
        new Error(`Cannot send ${method}: App Server process has exited.`),
      );
    }

    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method} (id=${id}).`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (result: unknown) => void,
        reject,
        timeout,
      });
      this.writeLine({ id, method, params });
    });
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
