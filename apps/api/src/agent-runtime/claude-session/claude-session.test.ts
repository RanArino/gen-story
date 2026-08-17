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

import { ClaudeNativeSession, ClaudeSessionError } from "./claude-session";

vi.setConfig({ testTimeout: 20_000 });

const temporaryRoot = mkdtempSync(join(tmpdir(), "gen-story-claude-session-"));
const binDir = join(temporaryRoot, "bin");
const homeDir = join(temporaryRoot, "home");
const workingDirectory = join(temporaryRoot, "work");
mkdirSync(binDir);
mkdirSync(homeDir);
mkdirSync(workingDirectory);

afterAll(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

// Fake `claude` shadows the real CLI via PATH; its shebang still needs the
// real `node` resolvable alongside it.
const fakeCliPath = `${binDir}${delimiter}${dirname(process.execPath)}`;

/**
 * A fake `claude -p --input-format stream-json --output-format stream-json`.
 *
 * `initEagerly` mirrors the two behaviors seen in the wild: older CLIs write
 * `system/init` as soon as they start, while Claude Code 2.1.224 writes
 * **nothing** until the first user message arrives. The gated variant is the
 * default because it is what the installed CLI actually does — assuming the
 * eager one is what made M3's first live Claude chat hang until its timeout.
 * Either way, each user turn answers `/compact` with a canned decline or
 * echoes the text back with an `assistant` event followed by a `result`.
 * Captures its own argv to a file under HOME so tests can assert on it.
 */
function writeFakeClaude(
  options: { initEagerly?: boolean; heartbeats?: number } = {},
): void {
  const eager = options.initEagerly ?? true;
  // When set, the fake keeps emitting assistant messages before its result,
  // standing in for an agent that works for minutes while streaming output.
  const heartbeats = options.heartbeats ?? 0;
  const path = join(binDir, "claude");
  writeFileSync(
    path,
    [
      "#!/usr/bin/env node",
      "const fs = require('fs');",
      "const readline = require('readline');",
      "fs.writeFileSync(process.env.HOME + '/argv.json', JSON.stringify(process.argv.slice(2)));",
      "const rl = readline.createInterface({ input: process.stdin });",
      "function write(payload) { process.stdout.write(JSON.stringify(payload) + '\\n'); }",
      eager
        ? "write({ type: 'system', subtype: 'init' });"
        : "let started = false;",
      "rl.on('line', (raw) => {",
      "  if (raw.trim().length === 0) return;",
      eager
        ? ""
        : "  if (!started) { started = true; write({ type: 'system', subtype: 'init' }); }",
      "  const line = JSON.parse(raw);",
      "  const text = line.message.content[0].text;",
      "  if (text === '/compact') {",
      "    write({ type: 'result', is_error: false, subtype: 'success', result: 'Not enough messages to compact.' });",
      "    return;",
      "  }",
      `  const beats = ${heartbeats};`,
      "  if (beats > 0) {",
      "    let sent = 0;",
      "    const tick = setInterval(() => {",
      "      sent += 1;",
      "      if (sent <= beats) {",
      "        write({ type: 'assistant', message: { content: [{ type: 'text', text: 'working ' + sent }] } });",
      "        return;",
      "      }",
      "      clearInterval(tick);",
      "      write({ type: 'result', is_error: false, subtype: 'success', result: 'echo:' + text });",
      "    }, 100);",
      "    return;",
      "  }",
      "  write({ type: 'assistant', message: { content: [{ type: 'text', text: 'echo:' + text }] } });",
      "  write({ type: 'rate_limit_event', rate_limit_info: { status: 'allowed' } });",
      "  write({ type: 'result', is_error: false, subtype: 'success', result: 'echo:' + text });",
      "});",
    ].join("\n"),
    { mode: 0o755 },
  );
}

function startInput(overrides: Record<string, unknown> = {}) {
  return {
    workingDirectory,
    allowedWorkingDirectoryRoot: temporaryRoot,
    environment: { PATH: fakeCliPath, HOME: homeDir },
    ...overrides,
  };
}

describe("ClaudeNativeSession", () => {
  it("starts with a generated session id once session-ready fires", async () => {
    writeFakeClaude();
    const session = await ClaudeNativeSession.start(startInput());

    expect(session.sessionId).toMatch(/^[0-9a-f-]{36}$/);

    await session.close();
  });

  it("starts with an explicitly provided session id", async () => {
    writeFakeClaude();
    const session = await ClaudeNativeSession.start(
      startInput({ sessionId: "fixed-session-id" }),
    );

    expect(session.sessionId).toBe("fixed-session-id");

    await session.close();
  });

  it("passes --session-id on start and --resume on resume", async () => {
    writeFakeClaude();
    const started = await ClaudeNativeSession.start(
      startInput({ sessionId: "argv-check-id" }),
    );
    await started.close();
    const startArgs = JSON.parse(
      readFileSync(join(homeDir, "argv.json"), "utf8"),
    );
    expect(startArgs).toEqual(
      expect.arrayContaining(["--session-id", "argv-check-id"]),
    );
    expect(startArgs).not.toEqual(expect.arrayContaining(["--resume"]));

    const resumed = await ClaudeNativeSession.resume({
      sessionId: "argv-check-id",
      workingDirectory,
      allowedWorkingDirectoryRoot: temporaryRoot,
      environment: { PATH: fakeCliPath, HOME: homeDir },
    });
    await resumed.close();
    const resumeArgs = JSON.parse(
      readFileSync(join(homeDir, "argv.json"), "utf8"),
    );
    expect(resumeArgs).toEqual(
      expect.arrayContaining(["--resume", "argv-check-id"]),
    );
  });

  it("resolves sendTurn with the result and emits assistant-text along the way", async () => {
    writeFakeClaude();
    const session = await ClaudeNativeSession.start(startInput());
    const texts: string[] = [];
    session.onEvent((event) => {
      if (event.type === "assistant-text") texts.push(event.text);
    });

    const result = await session.sendTurn("hello there");

    expect(result).toEqual({
      isError: false,
      subtype: "success",
      resultText: "echo:hello there",
    });
    expect(texts).toEqual(["echo:hello there"]);

    await session.close();
  });

  it("translates rate_limit_event notifications", async () => {
    writeFakeClaude();
    const session = await ClaudeNativeSession.start(startInput());
    const rateLimitPromise = new Promise((resolve) => {
      session.onEvent((event) => {
        if (event.type === "rate-limit") resolve(event.info);
      });
    });

    await session.sendTurn("hi");

    expect(await rateLimitPromise).toEqual({ status: "allowed" });
    await session.close();
  });

  it("sends /compact as a normal turn", async () => {
    writeFakeClaude();
    const session = await ClaudeNativeSession.start(startInput());

    const result = await session.compact();

    expect(result.resultText).toBe("Not enough messages to compact.");
    await session.close();
  });

  it("keeps a turn alive while the provider streams, timing out only on silence", async () => {
    // 20 beats 100ms apart run ~2s, well past the 800ms limit, while never
    // going quiet for more than ~100ms. A turn that references several fields
    // behaves this way for minutes, and a wall-clock limit killed exactly
    // those turns mid-work. The margins are deliberately wide in both
    // directions so scheduling jitter cannot decide the outcome.
    writeFakeClaude({ heartbeats: 20 });
    const session = await ClaudeNativeSession.start(startInput());

    const result = await session.sendTurn("long job", 800);

    expect(result.resultText).toBe("echo:long job");
    await session.close();
  });

  it("times out when the provider produces nothing at all", async () => {
    const path = join(binDir, "claude");
    writeFileSync(
      path,
      [
        "#!/usr/bin/env node",
        "process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init' }) + '\\n');",
        "setInterval(() => {}, 1000);",
      ].join("\n"),
      { mode: 0o755 },
    );
    const session = await ClaudeNativeSession.start(startInput());

    await expect(session.sendTurn("silence", 200)).rejects.toThrow(
      /no output from the provider/,
    );

    await session.close();
  });

  it("prevents sending further turns after interrupt, requiring resume", async () => {
    writeFakeClaude();
    const session = await ClaudeNativeSession.start(startInput());

    await session.interrupt();

    await expect(session.sendTurn("anything")).rejects.toBeInstanceOf(
      ClaudeSessionError,
    );
  });

  it("starts even when the CLI withholds system/init until the first message", async () => {
    // Claude Code 2.1.224: nothing is written under --input-format stream-json
    // until a user message arrives. Blocking start() on `init` deadlocks.
    writeFakeClaude({ initEagerly: false });

    const session = await ClaudeNativeSession.start(startInput());
    const result = await session.sendTurn("hello");

    expect(result.resultText).toBe("echo:hello");
    await session.close();
  });

  it("rejects start() if the process exits before becoming ready", async () => {
    const path = join(binDir, "claude");
    writeFileSync(
      path,
      ["#!/usr/bin/env node", "process.exit(1);"].join("\n"),
      { mode: 0o755 },
    );

    await expect(ClaudeNativeSession.start(startInput())).rejects.toThrow(
      /exited before starting/,
    );
  });
});
