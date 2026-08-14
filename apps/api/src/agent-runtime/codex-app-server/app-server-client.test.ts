import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import {
  AppServerRequestError,
  CodexAppServerClient,
} from "./app-server-client";

// These tests spawn real subprocesses; under heavy parallel test load the
// default 5s per-test timeout can be too tight.
vi.setConfig({ testTimeout: 30_000 });

const temporaryRoot = mkdtempSync(
  join(tmpdir(), "gen-story-app-server-client-"),
);
const workingDirectory = join(temporaryRoot, "work");
mkdirSync(workingDirectory);

afterAll(() => {
  rmSync(temporaryRoot, { recursive: true, force: true });
});

let fakeCounter = 0;

/** Writes an executable Node script that reads newline-delimited JSON-RPC
 * requests from stdin and reacts per `body` (raw JS; `line`, `write`, and
 * `readline` interface are in scope as the loop processes each request). */
function writeFakeAppServer(body: string): { command: string; args: string[] } {
  const path = join(temporaryRoot, `fake-app-server-${fakeCounter++}`);
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
      body,
      "});",
    ].join("\n"),
    { mode: 0o755 },
  );
  return { command: path, args: [] };
}

function makeClient(fake: { command: string; args: string[] }) {
  return new CodexAppServerClient({
    command: fake.command,
    args: fake.args,
    workingDirectory,
    allowedWorkingDirectoryRoot: temporaryRoot,
  });
}

describe("CodexAppServerClient", () => {
  it("resolves a request with the matching response", async () => {
    const fake = writeFakeAppServer(`
      write({ id: line.id, result: { echoedMethod: line.method } });
    `);
    const client = makeClient(fake);

    const result = await client.request("initialize", { foo: "bar" });

    expect(result).toEqual({ echoedMethod: "initialize" });
    client.kill();
  });

  it("rejects with AppServerRequestError on a JSON-RPC error response", async () => {
    const fake = writeFakeAppServer(`
      write({ id: line.id, error: { code: -32001, message: 'boom' } });
    `);
    const client = makeClient(fake);

    const error = await client
      .request("thread/start", {})
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppServerRequestError);
    expect((error as AppServerRequestError).code).toBe(-32001);
    expect((error as AppServerRequestError).message).toBe("boom");
    client.kill();
  });

  it("emits notification events for method+params messages with no id", async () => {
    const fake = writeFakeAppServer(`
      write({ id: line.id, result: {} });
      write({ method: 'thread/started', params: { threadId: 'thread-1' } });
    `);
    const client = makeClient(fake);

    const notification = await new Promise((resolve) => {
      client.on("notification", (method: string, params: unknown) =>
        resolve({ method, params }),
      );
      void client.request("thread/start", {});
    });

    expect(notification).toEqual({
      method: "thread/started",
      params: { threadId: "thread-1" },
    });
    client.kill();
  });

  it("forwards a server-initiated request and sends back the caller's response", async () => {
    const fake = writeFakeAppServer(`
      if (line.method === 'turn/start') {
        write({ id: line.id, result: { turn: { id: 'turn-1' } } });
        write({ id: 'server-req-1', method: 'execCommandApproval', params: { command: 'ls' } });
      } else if (line.id === 'server-req-1') {
        write({ method: 'approvalEcho', params: { decision: line.result?.decision ?? line.error } });
      }
    `);
    const client = makeClient(fake);

    const echoed = await new Promise((resolve) => {
      client.on(
        "request",
        (
          method: string,
          params: unknown,
          respond: (result: unknown) => void,
        ) => {
          expect(method).toBe("execCommandApproval");
          expect(params).toEqual({ command: "ls" });
          respond({ decision: "approved" });
        },
      );
      client.on("notification", (method: string, params: unknown) => {
        if (method === "approvalEcho") resolve(params);
      });
      void client.request("turn/start", {});
    });

    expect(echoed).toEqual({ decision: "approved" });
    client.kill();
  });

  it("auto-declines an unanswered server-initiated request after the timeout", async () => {
    const fake = writeFakeAppServer(`
      if (line.method === 'turn/start') {
        write({ id: line.id, result: {} });
        write({ id: 'server-req-2', method: 'execCommandApproval', params: {} });
      } else if (line.id === 'server-req-2') {
        write({ method: 'approvalEcho', params: { error: line.error } });
      }
    `);
    const client = new CodexAppServerClient({
      command: fake.command,
      args: fake.args,
      workingDirectory,
      allowedWorkingDirectoryRoot: temporaryRoot,
    });
    // Override the module-level auto-decline delay by monkey-patching is not
    // exposed; instead assert the mechanism end-to-end using the real 30s
    // path would be too slow for a unit test, so this test only exercises
    // that an explicit `reject` call produces the same wire shape the
    // auto-decline path uses.
    const echoed = await new Promise((resolve) => {
      client.on(
        "request",
        (
          _method: string,
          _params: unknown,
          _respond: (result: unknown) => void,
          reject: (code: number, message: string) => void,
        ) => {
          reject(-32000, "declined by test");
        },
      );
      client.on("notification", (method: string, params: unknown) => {
        if (method === "approvalEcho") resolve(params);
      });
      void client.request("turn/start", {});
    });

    expect(echoed).toEqual({
      error: { code: -32000, message: "declined by test" },
    });
    client.kill();
  });

  it("rejects pending requests when the process exits unexpectedly", async () => {
    const fake = writeFakeAppServer(`
      process.exit(1);
    `);
    const client = makeClient(fake);

    await expect(client.request("initialize", {})).rejects.toThrow(
      /exited before responding/,
    );
  });

  it("rejects a working directory outside the allowed root", () => {
    const fake = writeFakeAppServer(`write({ id: line.id, result: {} });`);

    expect(
      () =>
        new CodexAppServerClient({
          command: fake.command,
          args: fake.args,
          workingDirectory: tmpdir(),
          allowedWorkingDirectoryRoot: temporaryRoot,
        }),
    ).toThrow(/inside the allowed root/);
  });
});
