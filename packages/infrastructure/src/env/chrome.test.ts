import { afterEach, describe, expect, it, vi } from "vitest";
import { accessSync } from "node:fs";
import { resolveChromePath } from "./chrome.js";

vi.mock("node:fs", () => ({
  accessSync: vi.fn(() => {
    throw new Error("missing");
  }),
  constants: { X_OK: 1, F_OK: 0 },
}));
vi.mock("node:os", () => ({
  platform: () => "darwin",
  homedir: () => "/home/test",
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
describe("Film Chrome resolution", () => {
  it("uses installed Chrome when CHROME_PATH is blank", () => {
    vi.stubEnv("CHROME_PATH", "");
    vi.mocked(accessSync).mockImplementation((path) => {
      if (
        path !== "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      )
        throw new Error("missing");
    });
    expect(resolveChromePath()).toBe(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    );
  });
  it("honors an explicit executable", () => {
    vi.mocked(accessSync).mockImplementation(() => undefined);
    expect(resolveChromePath("/custom/chrome")).toBe("/custom/chrome");
  });
  it("does not silently replace an invalid explicit executable", () => {
    vi.mocked(accessSync).mockImplementation(() => {
      throw new Error("missing");
    });
    expect(() => resolveChromePath("/bad/chrome")).toThrow(/CHROME_PATH/);
    expect(accessSync).toHaveBeenCalledTimes(1);
  });
  it("explains how to recover when Chrome is unavailable", () => {
    vi.stubEnv("PATH", "");
    vi.mocked(accessSync).mockImplementation(() => {
      throw new Error("missing");
    });
    expect(() => resolveChromePath("")).toThrow(
      /Install Google Chrome.*CHROME_PATH/,
    );
  });
});
