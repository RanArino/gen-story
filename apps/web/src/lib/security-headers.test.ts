import { describe, expect, it } from "vitest";

import { buildSecurityHeaders } from "./security-headers";

describe("buildSecurityHeaders", () => {
  it("sets the browser security baseline without unsafe-eval", () => {
    const headers = new Map(
      buildSecurityHeaders(false).map(({ key, value }) => [key, value]),
    );

    expect(headers.get("Content-Security-Policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(headers.get("Content-Security-Policy")).not.toContain("unsafe-eval");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.has("Strict-Transport-Security")).toBe(false);
  });

  it("adds HSTS only for the production HTTPS edge", () => {
    const headers = new Map(
      buildSecurityHeaders(true).map(({ key, value }) => [key, value]),
    );
    expect(headers.get("Strict-Transport-Security")).toContain(
      "max-age=31536000",
    );
  });
});
