import { describe, expect, it } from "vitest";

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildHealthResponse, loadEnvFile } from "./server";

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

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
