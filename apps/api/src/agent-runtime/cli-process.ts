import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { isAbsolute, relative } from "node:path";

import {
  collectSensitiveEnvironmentValues,
  redactSensitiveText,
} from "./redaction";

export const CLI_ENVIRONMENT_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
  "NO_COLOR",
  "XDG_CONFIG_HOME",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
] as const;

export type CliProcessFailureReason =
  | "canceled"
  | "failed"
  | "spawn_failed"
  | "timed_out";

export type CliProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
};

export class CliProcessError extends Error {
  constructor(
    message: string,
    readonly reason: CliProcessFailureReason,
    readonly stdout: string,
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "CliProcessError";
  }
}

export function createCliEnvironment(
  source: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};

  for (const key of CLI_ENVIRONMENT_ALLOWLIST) {
    const value = source[key];
    if (value !== undefined) {
      environment[key] = value;
    }
  }

  return environment;
}

export function assertConfinedWorkingDirectory(
  workingDirectory: string,
  allowedWorkingDirectoryRoot: string,
): void {
  const root = realpathSync(allowedWorkingDirectoryRoot);
  const working = realpathSync(workingDirectory);
  const pathFromRoot = relative(root, working);

  if (
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) ||
    isAbsolute(pathFromRoot)
  ) {
    throw new Error("CLI working directory must be inside the allowed root.");
  }
}

export async function runCliProcess(input: {
  command: string;
  args: readonly string[];
  workingDirectory: string;
  allowedWorkingDirectoryRoot: string;
  timeoutMs: number;
  killGraceMs?: number;
  stdin?: string;
  signal?: AbortSignal;
  environment?: NodeJS.ProcessEnv;
}): Promise<CliProcessResult> {
  if (input.command.trim().length === 0) {
    throw new Error("CLI command is required.");
  }
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) {
    throw new Error("CLI timeout must be a positive number.");
  }

  assertConfinedWorkingDirectory(
    input.workingDirectory,
    input.allowedWorkingDirectoryRoot,
  );

  const sourceEnvironment = input.environment ?? process.env;
  const childEnvironment = createCliEnvironment(sourceEnvironment);
  const sensitiveValues = collectSensitiveEnvironmentValues(sourceEnvironment);
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    if (input.signal?.aborted) {
      reject(
        new CliProcessError(
          "CLI process was canceled before it started.",
          "canceled",
          "",
          "",
          null,
        ),
      );
      return;
    }

    const child = spawn(input.command, [...input.args], {
      cwd: input.workingDirectory,
      env: childEnvironment,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let canceled = false;
    let settled = false;
    let forceKillTimeout: ReturnType<typeof setTimeout> | undefined;

    const sanitize = (value: string) =>
      redactSensitiveText(value, sensitiveValues);

    const finishWithError = (
      reason: CliProcessFailureReason,
      message: string,
      exitCode: number | null,
    ) => {
      if (settled) return;
      settled = true;
      reject(
        new CliProcessError(
          sanitize(message),
          reason,
          sanitize(stdout),
          sanitize(stderr),
          exitCode,
        ),
      );
    };

    const terminate = () => {
      child.kill("SIGTERM");
      if (forceKillTimeout) return;
      forceKillTimeout = setTimeout(() => {
        child.kill("SIGKILL");
      }, input.killGraceMs ?? 1_000);
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, input.timeoutMs);

    const cancel = () => {
      canceled = true;
      terminate();
    };
    input.signal?.addEventListener("abort", cancel, { once: true });

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      input.signal?.removeEventListener("abort", cancel);
      finishWithError("spawn_failed", error.message, null);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      input.signal?.removeEventListener("abort", cancel);
      if (settled) return;

      if (timedOut) {
        finishWithError(
          "timed_out",
          `CLI process timed out after ${input.timeoutMs}ms.`,
          exitCode,
        );
        return;
      }
      if (canceled) {
        finishWithError("canceled", "CLI process was canceled.", exitCode);
        return;
      }
      if (exitCode !== 0) {
        finishWithError(
          "failed",
          `CLI process exited with code ${exitCode ?? "unknown"}.`,
          exitCode,
        );
        return;
      }

      settled = true;
      resolve({
        stdout: sanitize(stdout),
        stderr: sanitize(stderr),
        exitCode: 0,
        durationMs: Date.now() - startedAt,
      });
    });

    child.stdin.end(input.stdin);
  });
}
