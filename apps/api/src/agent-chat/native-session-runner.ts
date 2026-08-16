import type {
  AgentRunnerAvailability,
  AgentTurnEvent,
  AgentTurnRequest,
  AgentTurnRunnerPort,
} from "@gen-story/application";
import type { AgentProvider } from "@gen-story/domain";

import type { ClaudeSessionEvent } from "../agent-runtime/claude-session/claude-session";
import { ClaudeNativeSession } from "../agent-runtime/claude-session/claude-session";
import type { CodexSessionEvent } from "../agent-runtime/codex-app-server/codex-session";
import { CodexNativeSession } from "../agent-runtime/codex-app-server/codex-session";
import type {
  AgentRuntimeAvailability,
  AgentRuntimeSelection,
} from "../agent-runtime/runtime-config";
import { composeSessionPreamble, composeTurnInput } from "./turn-input";

const MCP_SERVER_NAME = "gen_story";

/**
 * Only what this runner uses of a provider session. `CodexNativeSession` and
 * `ClaudeNativeSession` satisfy these structurally; naming the subsets is what
 * lets the runner's own logic be tested without spawning a CLI.
 */
export interface CodexChatSession {
  readonly threadId: string;
  onEvent(listener: (event: CodexSessionEvent) => void): () => void;
  sendTurn(text: string): Promise<{ turnId: string }>;
  waitForTurnCompletion(turnId: string): Promise<{ status: string }>;
  interruptTurn(turnId: string): Promise<void>;
  compact(): Promise<void>;
  close(): Promise<void>;
}

export interface ClaudeChatSession {
  readonly sessionId: string;
  readonly isClosed: boolean;
  onEvent(listener: (event: ClaudeSessionEvent) => void): () => void;
  sendTurn(
    text: string,
    timeoutMs?: number,
  ): Promise<{ isError: boolean; subtype: string; resultText: string | null }>;
  compact(): Promise<unknown>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

export type ProviderSessionOptions = {
  workingDirectory: string;
  allowedWorkingDirectoryRoot: string;
  environment?: NodeJS.ProcessEnv;
  model: string | null;
  mcpUrl: string;
};

export type ProviderSessionFactory = {
  startCodex(options: ProviderSessionOptions): Promise<CodexChatSession>;
  resumeCodex(
    options: ProviderSessionOptions & { threadId: string },
  ): Promise<CodexChatSession>;
  startClaude(options: ProviderSessionOptions): Promise<ClaudeChatSession>;
  resumeClaude(
    options: ProviderSessionOptions & { sessionId: string },
  ): Promise<ClaudeChatSession>;
};

// Codex has no per-thread MCP parameter, so the server is attached as a
// config override on the process; Claude takes a `--mcp-config` document plus
// an explicit allowlist of the tool names it exposes.
export const NATIVE_PROVIDER_SESSIONS: ProviderSessionFactory = {
  startCodex: (options) =>
    CodexNativeSession.start({
      workingDirectory: options.workingDirectory,
      allowedWorkingDirectoryRoot: options.allowedWorkingDirectoryRoot,
      environment: options.environment,
      cwd: options.workingDirectory,
      ...(options.model ? { model: options.model } : {}),
      mcpServers: { [MCP_SERVER_NAME]: { url: options.mcpUrl } },
    }),
  resumeCodex: (options) =>
    CodexNativeSession.resume({
      workingDirectory: options.workingDirectory,
      allowedWorkingDirectoryRoot: options.allowedWorkingDirectoryRoot,
      environment: options.environment,
      threadId: options.threadId,
      mcpServers: { [MCP_SERVER_NAME]: { url: options.mcpUrl } },
    }),
  startClaude: (options) =>
    ClaudeNativeSession.start({
      workingDirectory: options.workingDirectory,
      allowedWorkingDirectoryRoot: options.allowedWorkingDirectoryRoot,
      environment: options.environment,
      ...(options.model ? { model: options.model } : {}),
      // Claude's `--tools` selects from the *built-in* set only (verified
      // against `claude --help`, 2.1.224), so the empty list disables Read,
      // Bash and friends. MCP tools are a separate channel: with
      // `--strict-mcp-config` the only ones that exist are Gen Story's.
      tools: [],
      mcpConfig: {
        mcpServers: {
          [MCP_SERVER_NAME]: { type: "http", url: options.mcpUrl },
        },
      },
    }),
  resumeClaude: (options) =>
    ClaudeNativeSession.resume({
      workingDirectory: options.workingDirectory,
      allowedWorkingDirectoryRoot: options.allowedWorkingDirectoryRoot,
      environment: options.environment,
      sessionId: options.sessionId,
      tools: [],
      mcpConfig: {
        mcpServers: {
          [MCP_SERVER_NAME]: { type: "http", url: options.mcpUrl },
        },
      },
    }),
};

/** One live provider session, plus what the runner needs to drive it. */
type LiveSession =
  | {
      provider: "codex";
      session: CodexChatSession;
      activeTurnId: string | null;
    }
  | {
      provider: "claude";
      session: ClaudeChatSession;
      activeTurnId: string | null;
    };

export type NativeSessionRunnerOptions = {
  selection: AgentRuntimeSelection;
  // Read at call time, not captured: server.ts resolves the real availability
  // asynchronously after the context is built.
  availability: () => AgentRuntimeAvailability;
  model: string | null;
  workingDirectory: string;
  allowedWorkingDirectoryRoot: string;
  // Where the provider reaches this API's project-scoped MCP endpoint.
  apiBaseUrl: string;
  environment?: NodeJS.ProcessEnv;
  turnTimeoutMs?: number;
  // Overridden in tests; production always uses the real CLI sessions.
  sessions?: ProviderSessionFactory;
};

export class AgentTurnRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentTurnRunnerError";
  }
}

/**
 * Drives one provider-native session per conversation (M3-02).
 *
 * The rule this class exists to keep: after a session is created, a turn
 * sends only the operator's new message and the resolved values of the fields
 * they referenced. Gen Story's stored transcript is never replayed — the
 * provider continues (and compacts) its own context, which is exactly what
 * `nativeSessionId` is for.
 *
 * Sessions are held in memory keyed by conversation. After an API restart the
 * map is empty, so the first turn resumes the provider session recorded on the
 * binding. If that resume fails, the turn fails with a recoverable error
 * rather than starting a fresh session that silently lost the context the
 * operator can still see in the transcript.
 */
export class NativeSessionAgentTurnRunner implements AgentTurnRunnerPort {
  private readonly sessions = new Map<string, LiveSession>();

  constructor(private readonly options: NativeSessionRunnerOptions) {}

  availability(): AgentRunnerAvailability {
    if (this.options.selection === "api") {
      return {
        available: false,
        reason:
          'Chat requires a CLI runtime. Set GEN_STORY_AGENT_RUNTIME to "codex" or "claude".',
      };
    }

    const runtime = this.options.availability();
    if (runtime.status === "available") {
      return {
        available: true,
        provider: this.options.selection,
        model: this.options.model,
      };
    }
    if (runtime.status === "unchecked") {
      return { available: false, reason: "The runtime check has not run yet." };
    }
    if (runtime.status === "not_applicable") {
      return { available: false, reason: "No CLI runtime is selected." };
    }
    return { available: false, reason: runtime.message };
  }

  private requireProvider(): AgentProvider {
    const availability = this.availability();
    if (!availability.available) {
      throw new AgentTurnRunnerError(availability.reason);
    }
    return availability.provider;
  }

  private mcpUrl(projectId: string, provider: AgentProvider): string {
    const base = this.options.apiBaseUrl.replace(/\/+$/, "");
    return `${base}/api/mcp/projects/${projectId}?provider=${provider}`;
  }

  private async openSession(
    request: AgentTurnRequest,
    provider: AgentProvider,
    onEvent: (event: AgentTurnEvent) => void,
  ): Promise<LiveSession> {
    const existing = this.sessions.get(request.conversationId);
    if (existing != null) return existing;

    const factory = this.options.sessions ?? NATIVE_PROVIDER_SESSIONS;
    const options: ProviderSessionOptions = {
      workingDirectory: this.options.workingDirectory,
      allowedWorkingDirectoryRoot: this.options.allowedWorkingDirectoryRoot,
      environment: this.options.environment,
      model: this.options.model,
      mcpUrl: this.mcpUrl(request.projectId, provider),
    };

    // A conversation that already has a native session id continues it. The
    // preamble is only sent when a session is genuinely new, so resuming
    // after an API restart costs one turn, not a replay.
    const isNew = request.nativeSessionId == null;

    if (provider === "codex") {
      const session = isNew
        ? await factory.startCodex(options)
        : await factory.resumeCodex({
            ...options,
            threadId: request.nativeSessionId as string,
          });

      const live: LiveSession = {
        provider: "codex",
        session,
        activeTurnId: null,
      };
      this.sessions.set(request.conversationId, live);
      onEvent({ type: "session-started", nativeSessionId: session.threadId });

      if (isNew) {
        await this.sendCodexTurn(
          live,
          composeSessionPreamble({
            projectId: request.projectId,
            language: request.language,
          }),
          () => {},
        );
      }
      return live;
    }

    const session = isNew
      ? await factory.startClaude(options)
      : await factory.resumeClaude({
          ...options,
          sessionId: request.nativeSessionId as string,
        });

    const live: LiveSession = {
      provider: "claude",
      session,
      activeTurnId: null,
    };
    this.sessions.set(request.conversationId, live);
    onEvent({ type: "session-started", nativeSessionId: session.sessionId });

    if (isNew) {
      await session.sendTurn(
        composeSessionPreamble({
          projectId: request.projectId,
          language: request.language,
        }),
        this.options.turnTimeoutMs,
      );
    }
    return live;
  }

  private async sendCodexTurn(
    live: Extract<LiveSession, { provider: "codex" }>,
    text: string,
    onEvent: (event: AgentTurnEvent) => void,
  ): Promise<{ status: string; providerTurnId: string }> {
    const unsubscribe = live.session.onEvent((event) => {
      switch (event.type) {
        case "agent-message-delta":
          return;
        case "item-completed": {
          const item = event.item as { type?: unknown; text?: unknown };
          if (item?.type === "agentMessage" && typeof item.text === "string") {
            onEvent({ type: "assistant-text", text: item.text });
          }
          return;
        }
        case "item-started": {
          // Codex names the tool in `tool` (with the server in `server`);
          // there is no `name` field on an mcpToolCall item.
          const item = event.item as { type?: unknown; tool?: unknown };
          if (item?.type === "mcpToolCall" && typeof item.tool === "string") {
            onEvent({ type: "tool-activity", toolName: item.tool });
          }
          return;
        }
        case "context-compacted":
          onEvent({ type: "compacted" });
          return;
        default:
          return;
      }
    });

    try {
      const { turnId } = await live.session.sendTurn(text);
      live.activeTurnId = turnId;
      const { status } = await live.session.waitForTurnCompletion(turnId);
      return { status, providerTurnId: turnId };
    } finally {
      live.activeTurnId = null;
      unsubscribe();
    }
  }

  async startTurn(
    request: AgentTurnRequest,
    onEvent: (event: AgentTurnEvent) => void,
  ): Promise<void> {
    const provider = this.requireProvider();

    let live: LiveSession;
    try {
      live = await this.openSession(request, provider, onEvent);
    } catch (error) {
      // A failed resume leaves the transcript intact; the caller marks the
      // binding recoverable so the operator can fork deliberately.
      onEvent({
        type: "turn-completed",
        status: "failed",
        errorMessage:
          error instanceof Error
            ? error.message
            : "Could not open the provider session.",
      });
      return;
    }

    const text = composeTurnInput(request);

    try {
      if (live.provider === "codex") {
        const { status, providerTurnId } = await this.sendCodexTurn(
          live,
          text,
          onEvent,
        );
        onEvent({
          type: "turn-completed",
          status:
            status === "completed" || status === "interrupted"
              ? status
              : "failed",
          providerTurnId,
        });
        return;
      }

      const unsubscribe = live.session.onEvent((event) => {
        if (event.type === "assistant-text") {
          onEvent({ type: "assistant-text", text: event.text });
        }
      });
      live.activeTurnId = request.turnId;
      try {
        const result = await live.session.sendTurn(
          text,
          this.options.turnTimeoutMs,
        );
        onEvent({
          type: "turn-completed",
          status: result.isError
            ? result.subtype === "error_during_execution"
              ? "interrupted"
              : "failed"
            : "completed",
          errorMessage: result.isError
            ? (result.resultText ?? undefined)
            : undefined,
        });
      } finally {
        live.activeTurnId = null;
        unsubscribe();
        // Claude's cancel kills the process, so a session that was cancelled
        // is not reusable; drop it and let the next turn resume by id.
        if (live.session.isClosed) {
          this.sessions.delete(request.conversationId);
        }
      }
    } catch (error) {
      onEvent({
        type: "turn-completed",
        status: "failed",
        errorMessage:
          error instanceof Error ? error.message : "The provider turn failed.",
      });
    }
  }

  async cancelTurn(input: {
    conversationId: string;
    turnId: string;
  }): Promise<boolean> {
    const live = this.sessions.get(input.conversationId);
    if (live == null || live.activeTurnId == null) return false;

    if (live.provider === "codex") {
      await live.session.interruptTurn(live.activeTurnId);
      return true;
    }

    // Killing the process is Claude's only cancel; the session id stays
    // resumable, so the next turn reopens it.
    await live.session.interrupt();
    this.sessions.delete(input.conversationId);
    return true;
  }

  async compact(input: { conversationId: string }): Promise<boolean> {
    const live = this.sessions.get(input.conversationId);
    if (live == null) return false;

    if (live.provider === "codex") {
      await live.session.compact();
      return true;
    }
    await live.session.compact();
    return true;
  }

  async release(input: { conversationId: string }): Promise<void> {
    const live = this.sessions.get(input.conversationId);
    if (live == null) return;
    this.sessions.delete(input.conversationId);
    await live.session.close();
  }
}
