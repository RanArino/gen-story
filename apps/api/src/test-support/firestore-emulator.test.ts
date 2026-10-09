import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEmulatorClient,
  requireFirestoreEmulator,
} from "./firestore-emulator";

afterEach(() => vi.unstubAllEnvs());

describe("Firestore test isolation", () => {
  it.each([
    undefined,
    "firestore.googleapis.com:443",
    "10.0.0.1:8080",
    "localhost:8080/path",
  ])("refuses unsafe emulator host %s before client creation", (host) => {
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", host);
    vi.stubEnv("GCLOUD_PROJECT", "demo-gen-story");
    expect(() => createEmulatorClient()).toThrow(/loopback emulator/);
  });
  it("rejects a live project even with a loopback host", () => {
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080");
    vi.stubEnv("GCLOUD_PROJECT", "gen-story-496911");
    expect(() => createEmulatorClient()).toThrow(/demo-gen-story/);
  });
  it("accepts only the isolated demo configuration", () => {
    vi.stubEnv("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080");
    vi.stubEnv("GCLOUD_PROJECT", "demo-gen-story");
    expect(() => requireFirestoreEmulator()).not.toThrow();
  });
});
