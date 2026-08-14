import { z } from "zod";

import { CliProcessError, runCliProcess } from "./cli-process";

export type AgentRuntimeProvider = "codex" | "claude";

export type RuntimeUnavailableReason =
  | "binary_not_found"
  | "version_command_timed_out"
  | "version_command_failed"
  | "version_unparseable"
  | "unsupported_version"
  | "login_command_timed_out"
  | "login_command_failed"
  | "not_logged_in"
  | "subscription_login_required"
  | "login_status_unrecognized";

export type RuntimeDetectionResult =
  | {
      status: "available";
      provider: AgentRuntimeProvider;
      version: string;
      authMethod: string;
      subscriptionLabel: string;
    }
  | {
      status: "unavailable";
      provider: AgentRuntimeProvider;
      reason: RuntimeUnavailableReason;
      message: string;
    };

export type DetectAgentRuntimeInput = {
  provider: AgentRuntimeProvider;
  workingDirectory: string;
  allowedWorkingDirectoryRoot: string;
  timeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
  /** Overrides the binary name; only used by tests to point at a fake CLI. */
  binary?: string;
};

const DEFAULT_DETECTION_TIMEOUT_MS = 10_000;

type LoginStatus =
  | { kind: "subscription"; authMethod: string; subscriptionLabel: string }
  | { kind: "api_key_only" }
  | { kind: "logged_out" }
  | { kind: "unrecognized" };

type LoginStepOutput = { stdout: string; stderr: string };

type ProviderDetectionConfig = {
  binary: string;
  versionArgs: readonly string[];
  loginArgs: readonly string[];
  /** Lowest version verified to work with this integration; see the M1 ExecPlan Discoveries. */
  minimumSupportedVersion: string;
  parseLoginStatus: (output: LoginStepOutput) => LoginStatus;
};

// `codex login status` writes its result to stderr, not stdout, when run as
// a piped (non-TTY) child process — confirmed empirically against the real
// CLI during M1-10's end-to-end smoke test, which is exactly the gap
// fake-CLI unit tests (which controlled the stream directly) could not
// catch. stdout is checked first in case a future Codex version changes
// this back.
function parseCodexLoginStatus({
  stdout,
  stderr,
}: LoginStepOutput): LoginStatus {
  const text = stdout.trim() || stderr.trim();
  if (/logged in using chatgpt/i.test(text)) {
    return {
      kind: "subscription",
      authMethod: "ChatGPT",
      subscriptionLabel: "ChatGPT subscription",
    };
  }
  if (/logged in using (an )?api key/i.test(text)) {
    return { kind: "api_key_only" };
  }
  if (/not logged in/i.test(text)) {
    return { kind: "logged_out" };
  }
  return { kind: "unrecognized" };
}

const claudeAuthStatusSchema = z.object({
  loggedIn: z.boolean(),
  authMethod: z.string().optional(),
  subscriptionType: z.string().optional(),
});

// Confirmed empirically: always plain JSON on stdout, never stderr.
function parseClaudeLoginStatus({ stdout }: LoginStepOutput): LoginStatus {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return { kind: "unrecognized" };
  }

  const result = claudeAuthStatusSchema.safeParse(parsed);
  if (!result.success) {
    return { kind: "unrecognized" };
  }

  const { loggedIn, authMethod, subscriptionType } = result.data;
  if (!loggedIn) {
    return { kind: "logged_out" };
  }
  if (authMethod !== "claude.ai") {
    return { kind: "api_key_only" };
  }

  const subscriptionLabel = subscriptionType
    ? `Claude ${subscriptionType.charAt(0).toUpperCase()}${subscriptionType.slice(1)} subscription`
    : "Claude subscription";
  return { kind: "subscription", authMethod, subscriptionLabel };
}

const PROVIDER_DETECTION_CONFIG: Record<
  AgentRuntimeProvider,
  ProviderDetectionConfig
> = {
  codex: {
    binary: "codex",
    versionArgs: ["--version"],
    loginArgs: ["login", "status"],
    minimumSupportedVersion: "0.147.0",
    parseLoginStatus: parseCodexLoginStatus,
  },
  claude: {
    binary: "claude",
    versionArgs: ["--version"],
    loginArgs: ["auth", "status", "--json"],
    minimumSupportedVersion: "2.1.220",
    parseLoginStatus: parseClaudeLoginStatus,
  },
};

const VERSION_PATTERN = /(\d+(?:\.\d+){1,3})/;

export function parseCliVersionOutput(stdout: string): string | null {
  const match = stdout.trim().match(VERSION_PATTERN);
  return match?.[1] ?? null;
}

export function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }
  return 0;
}

type DetectionStepFailure = "binary_not_found" | "timed_out" | "command_failed";

async function runDetectionStep(input: {
  command: string;
  args: readonly string[];
  workingDirectory: string;
  allowedWorkingDirectoryRoot: string;
  timeoutMs: number;
  environment?: NodeJS.ProcessEnv;
}): Promise<
  | { ok: true; stdout: string; stderr: string }
  | { ok: false; failure: DetectionStepFailure; message: string }
> {
  try {
    const result = await runCliProcess(input);
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (error instanceof CliProcessError) {
      if (error.reason === "spawn_failed") {
        return {
          ok: false,
          failure: "binary_not_found",
          message: error.message,
        };
      }
      if (error.reason === "timed_out") {
        return { ok: false, failure: "timed_out", message: error.message };
      }
      return {
        ok: false,
        failure: "command_failed",
        message: error.stderr || error.message,
      };
    }
    throw error;
  }
}

export async function detectAgentRuntime(
  input: DetectAgentRuntimeInput,
): Promise<RuntimeDetectionResult> {
  const config = PROVIDER_DETECTION_CONFIG[input.provider];
  const command = input.binary ?? config.binary;
  const timeoutMs = input.timeoutMs ?? DEFAULT_DETECTION_TIMEOUT_MS;
  const shared = {
    workingDirectory: input.workingDirectory,
    allowedWorkingDirectoryRoot: input.allowedWorkingDirectoryRoot,
    timeoutMs,
    environment: input.environment,
  };

  const versionStep = await runDetectionStep({
    command,
    args: config.versionArgs,
    ...shared,
  });
  if (!versionStep.ok) {
    return unavailable(
      input.provider,
      versionStep.failure === "binary_not_found"
        ? "binary_not_found"
        : versionStep.failure === "timed_out"
          ? "version_command_timed_out"
          : "version_command_failed",
      versionStep.message,
    );
  }

  const version = parseCliVersionOutput(versionStep.stdout);
  if (!version) {
    return unavailable(
      input.provider,
      "version_unparseable",
      `Could not parse a version number from: ${versionStep.stdout.trim()}`,
    );
  }
  if (compareVersions(version, config.minimumSupportedVersion) < 0) {
    return unavailable(
      input.provider,
      "unsupported_version",
      `Installed version ${version} is older than the supported minimum ${config.minimumSupportedVersion}.`,
    );
  }

  const loginStep = await runDetectionStep({
    command,
    args: config.loginArgs,
    ...shared,
  });
  if (!loginStep.ok) {
    return unavailable(
      input.provider,
      loginStep.failure === "binary_not_found"
        ? "binary_not_found"
        : loginStep.failure === "timed_out"
          ? "login_command_timed_out"
          : "login_command_failed",
      loginStep.message,
    );
  }

  const loginStatus = config.parseLoginStatus({
    stdout: loginStep.stdout,
    stderr: loginStep.stderr,
  });
  switch (loginStatus.kind) {
    case "logged_out":
      return unavailable(
        input.provider,
        "not_logged_in",
        `${input.provider} is not logged in. Sign in with your subscription account before selecting this runtime.`,
      );
    case "api_key_only":
      return unavailable(
        input.provider,
        "subscription_login_required",
        `${input.provider} is authenticated with an API key, not a subscription login. This runtime never falls back to model API keys; sign in with your ChatGPT/Claude subscription account instead.`,
      );
    case "unrecognized":
      return unavailable(
        input.provider,
        "login_status_unrecognized",
        `Could not interpret ${input.provider} login status output: ${loginStep.stdout.trim() || loginStep.stderr.trim()}`,
      );
    case "subscription":
      return {
        status: "available",
        provider: input.provider,
        version,
        authMethod: loginStatus.authMethod,
        subscriptionLabel: loginStatus.subscriptionLabel,
      };
  }
}

function unavailable(
  provider: AgentRuntimeProvider,
  reason: RuntimeUnavailableReason,
  message: string,
): RuntimeDetectionResult {
  return { status: "unavailable", provider, reason, message };
}
