import { describe, expect, it } from "vitest";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { buildHealthResponse, loadEnvFile, makeHandleRequest } from "./server";
import { Router } from "./http/router";
import { HOSTED_SESSION_COOKIE } from "./auth/firebase-auth";

describe("buildHealthResponse", () => {
  it("returns a stable health payload", () => {
    expect(buildHealthResponse()).toEqual({
      status: "ok",
      service: "gen-story-api",
    });
  });
});

describe("loadEnvFile", () => {
  it("loads API_PORT from an env file", () => {
    const envDirectory = mkdtempSync(join(tmpdir(), "gen-story-api-env-"));
    const envPath = join(envDirectory, ".env");
    const originalApiPort = process.env.API_PORT;

    delete process.env.API_PORT;
    writeFileSync(envPath, "API_PORT=4100\n");

    try {
      expect(loadEnvFile(envPath)).toBe(true);
      expect(process.env.API_PORT).toBe("4100");
    } finally {
      restoreEnv("API_PORT", originalApiPort);
      rmSync(envDirectory, { force: true, recursive: true });
    }
  });

  it("does not override exported environment variables", () => {
    const envDirectory = mkdtempSync(join(tmpdir(), "gen-story-api-env-"));
    const envPath = join(envDirectory, ".env");
    const originalApiPort = process.env.API_PORT;

    process.env.API_PORT = "4200";
    writeFileSync(envPath, "API_PORT=4100\n");

    try {
      expect(loadEnvFile(envPath)).toBe(true);
      expect(process.env.API_PORT).toBe("4200");
    } finally {
      restoreEnv("API_PORT", originalApiPort);
      rmSync(envDirectory, { force: true, recursive: true });
    }
  });
});

describe("HTTP origin policy", () => {
  it("rejects an unconfigured browser origin without reflecting it", async () => {
    const server = createServer(makeHandleRequest(new Router()));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { Origin: "https://attacker.example" },
      });
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("vary")).toContain("Origin");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("allows the configured exact origin with credentials", async () => {
    const original = process.env.CORS_ORIGINS;
    process.env.CORS_ORIGINS = "https://staging.example";
    const server = createServer(makeHandleRequest(new Router()));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { Origin: "https://staging.example" },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(
        "https://staging.example",
      );
      expect(response.headers.get("access-control-allow-credentials")).toBe(
        "true",
      );
    } finally {
      if (original === undefined) delete process.env.CORS_ORIGINS;
      else process.env.CORS_ORIGINS = original;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it("rejects a cookie-authenticated mutation without a CSRF token", async () => {
    const server = createServer(makeHandleRequest(new Router()));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;

    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/projects`, {
        method: "POST",
        headers: { Cookie: `${HOSTED_SESSION_COOKIE}=session` },
      });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "forbidden" },
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
