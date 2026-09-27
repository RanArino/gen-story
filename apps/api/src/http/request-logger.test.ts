import { describe, expect, it, vi } from "vitest";

import { logRequest, sanitizeLogPath } from "./request-logger";

describe("request logging", () => {
  it("removes query strings before a URL reaches the log", () => {
    expect(sanitizeLogPath("/api/projects?p=secret#fragment")).toBe(
      "/api/projects",
    );
  });

  it("never emits query values", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      logRequest("GET", "/mcp?access_token=sensitive", 401, 3);
      expect(spy).toHaveBeenCalledOnce();
      expect(spy.mock.calls[0]?.[0]).not.toContain("sensitive");
      expect(spy.mock.calls[0]?.[0]).toContain('"path":"/mcp"');
    } finally {
      spy.mockRestore();
    }
  });
});
