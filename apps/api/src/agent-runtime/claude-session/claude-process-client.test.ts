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

import { ClaudeSessionProcess } from "./claude-process-client";

vi.setConfig({ testTimeout: 20_000 });

const temporaryRoot = mkdtempSync(
  join(tmpdir(), "gen-story-claude-process-client-"),
);
const binDir = join(temporaryRoot, "bin");
const homeDir = join(temporaryRoot, "home");
const workingDirectory = join(temporaryRoot, "work");
mkdirSync(binDir);
mkdirSync(homeDir);
mkdirSync(workingDirectory);

// Fake `claude` scripts use a `#!/usr/bin/env node` shebang, so PATH must
// still resolve the real `node` alongside the shadowed `claude` binary.
const fakeCliPath = `${binDir}${delimiter}${dirname(process.execPath)}`;

afterAll(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

function writeFakeClaude(body: string): void {
  const path = join(binDir, "claude");
  writeFileSync(
    path,
    [
      "#!/usr/bin/env node",
      "const fs = require('fs');",
      "const readline = require('readline');",
      "const rl = readline.createInterface({ input: process.stdin });",
      "function write(payload) { process.stdout.write(JSON.stringify(payload) + '\\n'); }",
      body,
      "rl.on('line', (raw) => {",
      "  if (raw.trim().length === 0) return;",
      "  const line = JSON.parse(raw);",
      "  const text = line.message.content[0].text;",
      "  write({ type: 'assistant', message: { content: [{ type: 'text', text: 'echo:' + text }] } });",
      "  write({ type: 'result', is_error: false, subtype: 'success', result: 'echo:' + text });",
      "});",
    ].join("\n"),
    { mode: 0o755 },
  );
}

function makeProcess(args: string[] = []) {
  return new ClaudeSessionProcess({
    args,
    workingDirectory,
    allowedWorkingDirectoryRoot: temporaryRoot,
    environment: { PATH: fakeCliPath, HOME: homeDir },
  });
}

describe("ClaudeSessionProcess", () => {
  it("emits a parsed event for each JSON line on stdout", async () => {
    writeFakeClaude(`write({ type: 'system', subtype: 'init' });`);
    const process = makeProcess();

    const event = await new Promise((resolve) => {
      process.on("event", resolve);
    });

    expect(event).toEqual({ type: "system", subtype: "init" });
    process.kill();
  });

  it("writes the message as a stream-json user turn on stdin", async () => {
    writeFakeClaude(``);
    const process = makeProcess();

    const events: unknown[] = [];
    const resultPromise = new Promise((resolve) => {
      process.on("event", (event: Record<string, unknown>) => {
        events.push(event);
        if (event.type === "result") resolve(event);
      });
    });
    process.sendMessage("hello there");
    const result = await resultPromise;

    expect(result).toEqual({
      type: "result",
      is_error: false,
      subtype: "success",
      result: "echo:hello there",
    });
    process.kill();
  });

  it("tolerates non-JSON lines by emitting malformedLine instead of crashing", async () => {
    writeFakeClaude(`process.stdout.write('not json at all\\n');`);
    const process = makeProcess();

    const malformed = await new Promise((resolve) => {
      process.on("malformedLine", resolve);
    });

    expect(malformed).toBe("not json at all");
    process.kill();
  });

  it("emits exit with the process's exit code", async () => {
    writeFakeClaude(``);
    const process = makeProcess();

    const exit = await new Promise((resolve) => {
      process.on("exit", (code: number | null, signal: unknown) =>
        resolve({ code, signal }),
      );
      process.kill("SIGTERM");
    });

    expect(exit).toEqual({ code: null, signal: "SIGTERM" });
  });

  it("throws when sendMessage is called after the process has exited", async () => {
    writeFakeClaude(``);
    const process = makeProcess();
    process.kill("SIGTERM");
    await process.waitForExit();

    expect(() => process.sendMessage("too late")).toThrow(/has exited/);
  });

  it("rejects a working directory outside the allowed root", () => {
    writeFakeClaude(``);

    expect(
      () =>
        new ClaudeSessionProcess({
          args: [],
          workingDirectory: tmpdir(),
          allowedWorkingDirectoryRoot: temporaryRoot,
          environment: { PATH: fakeCliPath, HOME: homeDir },
        }),
    ).toThrow(/inside the allowed root/);
  });

  it("redacts sensitive environment values from stderr", async () => {
    // The child's own env never receives SESSION_TOKEN (createCliEnvironment
    // strips anything outside the allowlist) — sensitiveValues comes from
    // the *source* environment passed to the constructor instead, so the
    // literal secret text must appear in the script's own output directly.
    const secret = "operator-secret-value";
    writeFakeClaude(`process.stderr.write('token=${secret}');`);
    const process = new ClaudeSessionProcess({
      args: [],
      workingDirectory,
      allowedWorkingDirectoryRoot: temporaryRoot,
      environment: {
        PATH: fakeCliPath,
        HOME: homeDir,
        SESSION_TOKEN: secret,
      },
    });

    const stderr = await new Promise((resolve) => {
      process.on("stderr", resolve);
    });

    expect(stderr).toBe("token=[REDACTED]");
    process.kill();
  });
});

// Sanity check that the fixture file itself is well-formed (executable, has
// a shebang) — guards against silently writing a broken fake CLI.
describe("writeFakeClaude fixture", () => {
  it("produces an executable script with a node shebang", () => {
    writeFakeClaude(``);
    const contents = readFileSync(join(binDir, "claude"), "utf8");
    expect(contents.startsWith("#!/usr/bin/env node")).toBe(true);
  });
});
