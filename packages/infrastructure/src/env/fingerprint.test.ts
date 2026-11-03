import { expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { readFingerprint } from "./fingerprint.js";
vi.mock("./chrome.js", () => ({ resolveChromePath: () => "/detected/chrome" }));
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn((bin: string) =>
    bin === "/detected/chrome"
      ? "Google Chrome 156.0.8078.74"
      : "ffmpeg version 8.0",
  ),
}));
it("pins the detected Chrome executable and version in the render environment", () => {
  expect(readFingerprint().chrome).toEqual({
    path: "/detected/chrome",
    version: "156.0.8078.74",
  });
  expect(execFileSync).toHaveBeenCalledWith("/detected/chrome", ["--version"], {
    encoding: "utf8",
  });
});
