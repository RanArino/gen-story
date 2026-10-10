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
  it("allows only an exact R2 account endpoint for browser images and uploads", () => {
    const origin =
      "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com";
    const csp = buildSecurityHeaders(true, undefined, origin).find(
      (header) => header.key === "Content-Security-Policy",
    )!.value;
    expect(
      csp.split("; ").find((rule) => rule.startsWith("img-src")),
    ).toContain(origin);
    expect(
      csp.split("; ").find((rule) => rule.startsWith("connect-src")),
    ).toContain(origin);
    for (const value of [
      "https://*.r2.cloudflarestorage.com",
      origin + "/",
      origin + "; script-src *",
      "http://localhost:9000",
    ])
      expect(() => buildSecurityHeaders(true, undefined, value)).toThrow(
        "exact R2 endpoint",
      );
  });
});
