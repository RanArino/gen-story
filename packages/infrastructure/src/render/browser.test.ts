import { afterEach, expect, it, vi } from "vitest";
import puppeteer from "puppeteer-core";
import { launch } from "./browser.js";
vi.mock("puppeteer-core", () => ({
  default: { launch: vi.fn(async () => ({})) },
}));
vi.mock("node:os", () => ({
  platform: () => "darwin",
  homedir: () => "/home/test",
}));
vi.mock("node:fs", () => ({
  accessSync: vi.fn(),
  constants: { X_OK: 1, F_OK: 0 },
}));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
it("launches installed Chrome without requiring CHROME_PATH", async () => {
  vi.stubEnv("CHROME_PATH", "");
  await launch();
  expect(puppeteer.launch).toHaveBeenCalledWith(
    expect.objectContaining({
      executablePath:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    }),
  );
});
