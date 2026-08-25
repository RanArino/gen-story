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
 * A fake `claude -p --input-format stream-json --output-format stream-json`
 * that mirrors the real protocol proven live: emits `system/init`
 * immediately on startup (not gated on any input), then for each user turn
 * either answers `/compact` with a canned decline or echoes the text back
 * with an `assistant` event followed by a `result` event. Captures its own
 * argv to a file under HOME so tests can assert on it.
 */
function writeFakeClaude(): void {
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
      "write({ type: 'system', subtype: 'init' });",
      "rl.on('line', (raw) => {",
      "  if (raw.trim().length === 0) return;",
      "  const line = JSON.parse(raw);",
      "  const text = line.message.content[0].text;",
      "  if (text === '/compact') {",
      "    write({ type: 'result', is_error: false, subtype: 'success', result: 'Not enough messages to compact.' });",
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

  it("prevents sending further turns after interrupt, requiring resume", async () => {
    writeFakeClaude();
    const session = await ClaudeNativeSession.start(startInput());

    await session.interrupt();

    await expect(session.sendTurn("anything")).rejects.toBeInstanceOf(
      ClaudeSessionError,
    );
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
