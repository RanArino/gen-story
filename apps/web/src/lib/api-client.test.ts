import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, getMe } from "./api-client";

describe("request", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // A dead API server surfaced as the browser's bare "Failed to fetch", which
  // names neither the server nor the port.
  it("reports an unreachable API instead of the raw fetch failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;

    await expect(getMe()).rejects.toMatchObject({
      code: "API_UNREACHABLE",
      status: 0,
    });
    await expect(getMe()).rejects.toBeInstanceOf(ApiError);
    await expect(getMe()).rejects.toThrow(/Cannot reach the API server at/);
  });
});
