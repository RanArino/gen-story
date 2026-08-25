import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { CodexNativeSession } from "./codex-session";

// These tests spawn real subprocesses; under heavy parallel test load the
// default 5s per-test timeout can be too tight.
vi.setConfig({ testTimeout: 30_000 });

const temporaryRoot = mkdtempSync(join(tmpdir(), "gen-story-codex-session-"));
const binDir = join(temporaryRoot, "bin");
const homeDir = join(temporaryRoot, "home");
const workingDirectory = join(temporaryRoot, "work");
mkdirSync(binDir);
mkdirSync(homeDir);
mkdirSync(workingDirectory);

afterAll(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

// Fake `codex` shadows the real CLI via PATH; its shebang still needs the
// real `node` resolvable alongside it.
const fakeCliPath = `${binDir}${delimiter}${dirname(process.execPath)}`;

/**
 * A fake `codex app-server` that implements just enough of the real
 * protocol (verified live against the real CLI beforehand) for
 * CodexNativeSession's lifecycle: initialize, thread/start, thread/resume,
 * turn/start (streams a delta then completes after a short delay unless
 * interrupted first), turn/interrupt, and thread/compact/start. Thread
 * identity persists across restarts via a file under HOME so resume tests
 * can spawn a second process and see the same thread id.
 */
function writeFakeCodexAppServer(): void {
  const path = join(binDir, "codex");
  writeFileSync(
    path,
    [
      "#!/usr/bin/env node",
      "const fs = require('fs');",
      "const readline = require('readline');",
      "const rl = readline.createInterface({ input: process.stdin });",
      "function write(payload) { process.stdout.write(JSON.stringify(payload) + '\\n'); }",
      "const threadFile = process.env.HOME + '/thread-id.txt';",
      "let threadId = fs.existsSync(threadFile) ? fs.readFileSync(threadFile, 'utf8') : null;",
      "let turnCounter = 0;",
      "const pendingTimers = new Map();",
      "rl.on('line', (raw) => {",
      "  if (raw.trim().length === 0) return;",
      "  const line = JSON.parse(raw);",
      "  if (line.method === 'initialize') {",
      "    write({ id: line.id, result: { codexHome: '/tmp', platformFamily: 'unix', platformOs: 'macos', userAgent: 'fake' } });",
      "  } else if (line.method === 'thread/start') {",
      "    threadId = threadId || 'thread-' + Math.random().toString(36).slice(2);",
      "    fs.writeFileSync(threadFile, threadId);",
      "    write({ id: line.id, result: { thread: { id: threadId } } });",
      "    write({ method: 'thread/started', params: { threadId } });",
      "  } else if (line.method === 'thread/resume') {",
      "    write({ id: line.id, result: { thread: { id: line.params.threadId } } });",
      "  } else if (line.method === 'turn/start') {",
      "    turnCounter += 1;",
      "    const turnId = 'turn-' + turnCounter;",
      "    write({ id: line.id, result: { turn: { id: turnId } } });",
      "    write({ method: 'turn/started', params: { turn: { id: turnId } } });",
      "    write({ method: 'item/started', params: { item: { type: 'agentMessage', id: 'item-' + turnId } } });",
      "    const timer = setTimeout(() => {",
      "      write({ method: 'item/agentMessage/delta', params: { itemId: 'item-' + turnId, delta: 'hello' } });",
      "      write({ method: 'item/completed', params: { item: { type: 'agentMessage', id: 'item-' + turnId, text: 'hello' } } });",
      "      write({ method: 'turn/completed', params: { turn: { id: turnId, status: 'completed' } } });",
      "      pendingTimers.delete(turnId);",
      "    }, 150);",
      "    pendingTimers.set(turnId, timer);",
      "  } else if (line.method === 'turn/interrupt') {",
      "    const timer = pendingTimers.get(line.params.turnId);",
      "    if (timer) { clearTimeout(timer); pendingTimers.delete(line.params.turnId); }",
      "    write({ id: line.id, result: {} });",
      "    write({ method: 'turn/completed', params: { turn: { id: line.params.turnId, status: 'interrupted' } } });",
      "  } else if (line.method === 'thread/compact/start') {",
      "    write({ id: line.id, result: {} });",
      "    write({ method: 'thread/compacted', params: {} });",
      "  } else {",
      "    write({ id: line.id, error: { code: -32601, message: 'unhandled method ' + line.method } });",
      "  }",
      "});",
    ].join("\n"),
    { mode: 0o755 },
  );
}

function startInput() {
  return {
    workingDirectory,
    allowedWorkingDirectoryRoot: temporaryRoot,
    cwd: workingDirectory,
    environment: { PATH: fakeCliPath, HOME: homeDir },
  };
}

describe("CodexNativeSession", () => {
  it("starts a thread and exposes its id", async () => {
    writeFakeCodexAppServer();
    const session = await CodexNativeSession.start(startInput());

    expect(session.threadId).toMatch(/^thread-/);

    await session.close();
  });

  it("streams agent-message-delta and item-completed, then turn-completed", async () => {
    writeFakeCodexAppServer();
    const session = await CodexNativeSession.start(startInput());
    const events: string[] = [];
    let deltaText = "";
    session.onEvent((event) => {
      events.push(event.type);
      if (event.type === "agent-message-delta") deltaText += event.delta;
    });

    const { turnId } = await session.sendTurn("say hello");
    const completion = await session.waitForTurnCompletion(turnId);

    expect(completion.status).toBe("completed");
    expect(deltaText).toBe("hello");
    expect(events).toEqual(
      expect.arrayContaining([
        "turn-started",
        "item-started",
        "agent-message-delta",
        "item-completed",
        "turn-completed",
      ]),
    );

    await session.close();
  });

  it("reports status interrupted after interruptTurn", async () => {
    writeFakeCodexAppServer();
    const session = await CodexNativeSession.start(startInput());

    const { turnId } = await session.sendTurn("say something long");
    // Register the completion listener before interrupting: the fake
    // server's `turn/completed` notification can be written (and dispatched
    // to listeners) synchronously alongside the `turn/interrupt` response,
    // racing ahead of `waitForTurnCompletion` if it were called afterwards.
    const completionPromise = session.waitForTurnCompletion(turnId);
    await session.interruptTurn(turnId);
    const completion = await completionPromise;

    expect(completion.status).toBe("interrupted");

    await session.close();
  });

  it("emits context-compacted after compact()", async () => {
    writeFakeCodexAppServer();
    const session = await CodexNativeSession.start(startInput());
    const compacted = new Promise<void>((resolve) => {
      session.onEvent((event) => {
        if (event.type === "context-compacted") resolve();
      });
    });

    await session.compact();
    await compacted;

    await session.close();
  });

  it("resumes the same thread id after the process restarts", async () => {
    writeFakeCodexAppServer();
    const first = await CodexNativeSession.start(startInput());
    const originalThreadId = first.threadId;
    await first.close();

    const resumed = await CodexNativeSession.resume({
      threadId: originalThreadId,
      workingDirectory,
      allowedWorkingDirectoryRoot: temporaryRoot,
      environment: { PATH: fakeCliPath, HOME: homeDir },
    });

    expect(resumed.threadId).toBe(originalThreadId);
    expect(readFileSync(join(homeDir, "thread-id.txt"), "utf8")).toBe(
      originalThreadId,
    );

    await resumed.close();
  });

  it("forwards server-initiated requests and auto-declines if unhandled", async () => {
    const path = join(binDir, "codex");
    writeFileSync(
      path,
      [
        "#!/usr/bin/env node",
        "const readline = require('readline');",
        "const rl = readline.createInterface({ input: process.stdin });",
        "function write(payload) { process.stdout.write(JSON.stringify(payload) + '\\n'); }",
        "rl.on('line', (raw) => {",
        "  if (raw.trim().length === 0) return;",
        "  const line = JSON.parse(raw);",
        "  if (line.method === 'initialize') {",
        "    write({ id: line.id, result: {} });",
        "  } else if (line.method === 'thread/start') {",
        "    write({ id: line.id, result: { thread: { id: 'thread-approval' } } });",
        "  } else if (line.method === 'turn/start') {",
        // The approval request is sent from turn/start, not thread/start:
        // CodexNativeSession only wires up its event listeners once
        // thread/start's response settles (in its constructor), so a
        // request arriving bundled with that very response can race ahead
        // of the listener being attached. A real App Server cannot approve
        // anything before a turn exists, so this also matches production.
        "    write({ id: line.id, result: { turn: { id: 'turn-1' } } });",
        "    write({ id: 'srv-1', method: 'execCommandApproval', params: { command: 'ls' } });",
        "  } else if (line.id === 'srv-1') {",
        "    write({ method: 'approvalEcho', params: { result: line.result, error: line.error } });",
        "  }",
        "});",
      ].join("\n"),
      { mode: 0o755 },
    );

    const session = await CodexNativeSession.start(startInput());
    const serverRequestPromise = new Promise<{ method: string }>((resolve) => {
      session.onEvent((event) => {
        if (event.type === "server-request") {
          resolve({ method: event.method });
          event.respond({ decision: "approved" });
        }
      });
    });
    await session.sendTurn("do something that needs approval");
    const serverRequest = await serverRequestPromise;

    expect(serverRequest.method).toBe("execCommandApproval");

    await session.close();
  });
});
