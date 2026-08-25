import type { AgentTurnEvent, AgentTurnRequest } from "@gen-story/application";
import { describe, expect, it } from "vitest";

import type { ClaudeSessionEvent } from "../agent-runtime/claude-session/claude-session";
import type { CodexSessionEvent } from "../agent-runtime/codex-app-server/codex-session";
import type { AgentRuntimeAvailability } from "../agent-runtime/runtime-config";
import type {
  ClaudeChatSession,
  CodexChatSession,
  ProviderSessionFactory,
  ProviderSessionOptions,
} from "./native-session-runner";
import { NativeSessionAgentTurnRunner } from "./native-session-runner";

const AVAILABLE: AgentRuntimeAvailability = {
  status: "available",
  version: "1.0.0",
  authMethod: "chatgpt",
  subscriptionLabel: "ChatGPT Plus",
};

class FakeCodexSession implements CodexChatSession {
  public readonly sentTurns: string[] = [];
  public readonly interrupted: string[] = [];
  public compacted = 0;
  public closed = false;
  private readonly listeners = new Set<(event: CodexSessionEvent) => void>();
  private nextTurn = 0;
  // Events the provider emits during the next turn.
  public duringTurn: CodexSessionEvent[] = [];
  public turnStatus = "completed";

  constructor(readonly threadId: string) {}

  onEvent(listener: (event: CodexSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async sendTurn(text: string): Promise<{ turnId: string }> {
    this.sentTurns.push(text);
    this.nextTurn += 1;
    const turnId = `turn-${this.nextTurn}`;
    for (const event of this.duringTurn) {
      for (const listener of this.listeners) listener(event);
    }
    return { turnId };
  }

  async waitForTurnCompletion(): Promise<{ status: string }> {
    return { status: this.turnStatus };
  }

  async interruptTurn(turnId: string): Promise<void> {
    this.interrupted.push(turnId);
  }

  async compact(): Promise<void> {
    this.compacted += 1;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeClaudeSession implements ClaudeChatSession {
  public readonly sentTurns: string[] = [];
  public isClosed = false;
  public compacted = 0;
  private readonly listeners = new Set<(event: ClaudeSessionEvent) => void>();
  public reply: string | null = "Warmer suits these photos.";
  public result = { isError: false, subtype: "success", resultText: null };

  constructor(readonly sessionId: string) {}

  onEvent(listener: (event: ClaudeSessionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async sendTurn(text: string) {
    this.sentTurns.push(text);
    if (this.reply != null) {
      for (const listener of this.listeners) {
        listener({ type: "assistant-text", text: this.reply });
      }
    }
    return this.result as {
      isError: boolean;
      subtype: string;
      resultText: string | null;
    };
  }

  async compact(): Promise<unknown> {
    this.compacted += 1;
    return {};
  }

  async interrupt(): Promise<void> {
    this.isClosed = true;
  }

  async close(): Promise<void> {
    this.isClosed = true;
  }
}

function fakeFactory() {
  const calls: {
    startCodex: ProviderSessionOptions[];
    resumeCodex: (ProviderSessionOptions & { threadId: string })[];
    startClaude: ProviderSessionOptions[];
    resumeClaude: (ProviderSessionOptions & { sessionId: string })[];
  } = { startCodex: [], resumeCodex: [], startClaude: [], resumeClaude: [] };

  const codex = new FakeCodexSession("thread-1");
  const claude = new FakeClaudeSession("session-1");

  const factory: ProviderSessionFactory = {
    async startCodex(options) {
      calls.startCodex.push(options);
      return codex;
    },
    async resumeCodex(options) {
      calls.resumeCodex.push(options);
      return codex;
    },
    async startClaude(options) {
      calls.startClaude.push(options);
      return claude;
    },
    async resumeClaude(options) {
      calls.resumeClaude.push(options);
      return claude;
    },
  };

  return { factory, calls, codex, claude };
}

function buildRunner(
  provider: "codex" | "claude",
  factory: ProviderSessionFactory,
  availability: AgentRuntimeAvailability = AVAILABLE,
) {
  return new NativeSessionAgentTurnRunner({
    selection: provider,
    availability: () => availability,
    model: null,
    workingDirectory: "/tmp/gen-story",
    allowedWorkingDirectoryRoot: "/tmp/gen-story",
    apiBaseUrl: "http://127.0.0.1:4000/",
    sessions: factory,
  });
}

function request(overrides: Partial<AgentTurnRequest> = {}): AgentTurnRequest {
  return {
    projectId: "project_1",
    conversationId: "conversation_1",
    turnId: "turn_1",
    provider: "codex",
    model: null,
    nativeSessionId: null,
    text: "Should the tone be warmer?",
    mentions: [],
    references: [],
    language: "en",
    ...overrides,
  };
}

async function collect(
  run: (onEvent: (event: AgentTurnEvent) => void) => Promise<void>,
): Promise<AgentTurnEvent[]> {
  const events: AgentTurnEvent[] = [];
  await run((event) => events.push(event));
  return events;
}

describe("NativeSessionAgentTurnRunner availability", () => {
  it("refuses to chat on the API runtime", () => {
    const runner = buildRunner("codex", fakeFactory().factory);
    const apiRunner = new NativeSessionAgentTurnRunner({
      selection: "api",
      availability: () => ({ status: "not_applicable" }),
      model: null,
      workingDirectory: "/tmp",
      allowedWorkingDirectoryRoot: "/tmp",
      apiBaseUrl: "http://127.0.0.1:4000",
    });

    expect(runner.availability()).toEqual({
      available: true,
      provider: "codex",
      model: null,
    });
    expect(apiRunner.availability()).toMatchObject({ available: false });
  });

  it("reports the CLI's own reason when it is unusable", () => {
    const runner = buildRunner("claude", fakeFactory().factory, {
      status: "unavailable",
      reason: "not_logged_in",
      message: "Log in to Claude Code first.",
    });

    expect(runner.availability()).toEqual({
      available: false,
      reason: "Log in to Claude Code first.",
    });
  });
});

describe("NativeSessionAgentTurnRunner codex turns", () => {
  it("starts a session with the project-scoped MCP endpoint and sends the preamble once", async () => {
    const { factory, calls, codex } = fakeFactory();
    const runner = buildRunner("codex", factory);

    const events = await collect((onEvent) =>
      runner.startTurn(request(), onEvent),
    );

    expect(calls.startCodex[0]?.mcpUrl).toBe(
      "http://127.0.0.1:4000/api/mcp/projects/project_1?provider=codex",
    );
    expect(events[0]).toEqual({
      type: "session-started",
      nativeSessionId: "thread-1",
    });
    // Preamble first, then the operator's message — and nothing else.
    expect(codex.sentTurns).toHaveLength(2);
    expect(codex.sentTurns[0]).toContain("Project ID: project_1");
    expect(codex.sentTurns[1]).toBe("Should the tone be warmer?");
  });

  it("resumes the recorded session on a later turn without replaying anything", async () => {
    const { factory, calls, codex } = fakeFactory();
    const runner = buildRunner("codex", factory);

    // A fresh runner is what the API has after a restart: no live session,
    // only the session id stored on the binding.
    await collect((onEvent) =>
      runner.startTurn(
        request({ text: "Now warm up the tone.", nativeSessionId: "thread-1" }),
        onEvent,
      ),
    );

    expect(calls.startCodex).toHaveLength(0);
    expect(calls.resumeCodex[0]?.threadId).toBe("thread-1");
    expect(codex.sentTurns).toEqual(["Now warm up the tone."]);
  });

  it("reports the assistant reply, MCP tool activity, and compaction", async () => {
    const { factory, codex } = fakeFactory();
    codex.duringTurn = [
      {
        type: "item-started",
        // The real item shape, captured from codex-cli 0.147.0: the tool name
        // is in `tool`, not `name`. Reading `name` produced no activity at all.
        item: {
          type: "mcpToolCall",
          server: "gen_story",
          tool: "get_creative_direction",
          status: "inProgress",
        },
      },
      { type: "context-compacted" },
      {
        type: "item-completed",
        item: { type: "agentMessage", text: "Warmer." },
      },
    ];
    const runner = buildRunner("codex", factory);

    const events = await collect((onEvent) =>
      runner.startTurn(request({ nativeSessionId: "thread-1" }), onEvent),
    );

    expect(events).toEqual([
      { type: "session-started", nativeSessionId: "thread-1" },
      { type: "tool-activity", toolName: "get_creative_direction" },
      { type: "compacted" },
      { type: "assistant-text", text: "Warmer." },
      { type: "turn-completed", status: "completed", providerTurnId: "turn-1" },
    ]);
  });

  it("interrupts the in-flight turn without ending the session", async () => {
    const { factory, codex } = fakeFactory();
    const runner = buildRunner("codex", factory);
    await collect((onEvent) =>
      runner.startTurn(request({ nativeSessionId: "thread-1" }), onEvent),
    );

    // No turn is in flight once startTurn resolved.
    await expect(
      runner.cancelTurn({
        conversationId: "conversation_1",
        turnId: "turn_1",
      }),
    ).resolves.toBe(false);

    await expect(
      runner.compact({ conversationId: "conversation_1" }),
    ).resolves.toBe(true);
    expect(codex.compacted).toBe(1);
  });

  it("fails the turn instead of starting a fresh session when a resume fails", async () => {
    const { factory } = fakeFactory();
    const failing: ProviderSessionFactory = {
      ...factory,
      resumeCodex: () => Promise.reject(new Error("thread not found")),
    };
    const runner = buildRunner("codex", failing);

    const events = await collect((onEvent) =>
      runner.startTurn(request({ nativeSessionId: "gone" }), onEvent),
    );

    expect(events).toEqual([
      {
        type: "turn-completed",
        status: "failed",
        errorMessage: "thread not found",
      },
    ]);
  });

  it("releases a conversation's session", async () => {
    const { factory, codex } = fakeFactory();
    const runner = buildRunner("codex", factory);
    await collect((onEvent) =>
      runner.startTurn(request({ nativeSessionId: "thread-1" }), onEvent),
    );

    await runner.release({ conversationId: "conversation_1" });

    expect(codex.closed).toBe(true);
    await expect(
      runner.compact({ conversationId: "conversation_1" }),
    ).resolves.toBe(false);
  });
});

describe("NativeSessionAgentTurnRunner claude turns", () => {
  it("attaches the Gen Story MCP server and only its tools", async () => {
    const { factory, calls, claude } = fakeFactory();
    const runner = buildRunner("claude", factory);

    const events = await collect((onEvent) =>
      runner.startTurn(request({ provider: "claude" }), onEvent),
    );

    expect(calls.startClaude[0]?.mcpUrl).toBe(
      "http://127.0.0.1:4000/api/mcp/projects/project_1?provider=claude",
    );
    expect(events).toEqual([
      { type: "session-started", nativeSessionId: "session-1" },
      { type: "assistant-text", text: "Warmer suits these photos." },
      {
        type: "turn-completed",
        status: "completed",
        errorMessage: undefined,
      },
    ]);
    expect(claude.sentTurns[0]).toContain("Project ID: project_1");
  });

  it("treats a killed process as interrupted and drops the dead session", async () => {
    const { factory, claude } = fakeFactory();
    claude.reply = null;
    claude.result = {
      isError: true,
      subtype: "error_during_execution",
      resultText: null,
    };
    const runner = buildRunner("claude", factory);

    const events = await collect((onEvent) =>
      runner.startTurn(
        request({ provider: "claude", nativeSessionId: "session-1" }),
        onEvent,
      ),
    );

    expect(events.at(-1)).toMatchObject({
      type: "turn-completed",
      status: "interrupted",
    });
  });

  it("cancels by killing the process and lets the next turn resume by id", async () => {
    const { factory, calls, claude } = fakeFactory();
    const runner = buildRunner("claude", factory);
    let release = () => {};
    claude.reply = null;

    // Hold the turn open so there is something to cancel.
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const originalSendTurn = claude.sendTurn.bind(claude);
    claude.sendTurn = async (text: string) => {
      await held;
      return originalSendTurn(text);
    };

    const running = collect((onEvent) =>
      runner.startTurn(
        request({ provider: "claude", nativeSessionId: "session-1" }),
        onEvent,
      ),
    );
    // Let the resume and the turn dispatch settle so the turn is genuinely
    // in flight when the cancel arrives.
    await new Promise((resolve) => setTimeout(resolve, 5));

    await expect(
      runner.cancelTurn({
        conversationId: "conversation_1",
        turnId: "turn_1",
      }),
    ).resolves.toBe(true);
    expect(claude.isClosed).toBe(true);

    release();
    await running;

    await collect((onEvent) =>
      runner.startTurn(
        request({ provider: "claude", nativeSessionId: "session-1" }),
        onEvent,
      ),
    );
    expect(calls.resumeClaude).toHaveLength(2);
  });
});
