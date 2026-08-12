import { describe, expect, it } from "vitest";

import {
  isGeminiRateLimitError,
  retryGeminiRateLimit,
} from "./gemini-rate-limit";

describe("Gemini rate-limit retry", () => {
  it("recognizes Gemini's 429 status and RESOURCE_EXHAUSTED error code", () => {
    expect(isGeminiRateLimitError({ status: 429 })).toBe(true);
    expect(isGeminiRateLimitError(new Error("RESOURCE_EXHAUSTED"))).toBe(true);
    expect(isGeminiRateLimitError(new Error("network unavailable"))).toBe(
      false,
    );
  });

  it("honors the provider retry delay before retrying a 429", async () => {
    const waits: number[] = [];
    let attempts = 0;

    const result = await retryGeminiRateLimit(
      async () => {
        attempts += 1;
        if (attempts === 1) {
          throw { status: 429, details: [{ retryDelay: "39.4s" }] };
        }
        return "recovered";
      },
      { wait: async (milliseconds) => void waits.push(milliseconds) },
    );

    expect(result).toBe("recovered");
    expect(attempts).toBe(2);
    expect(waits).toEqual([39_400]);
  });

  it("uses exponential backoff only for 429s and reports an actionable failure after exhaustion", async () => {
    const waits: number[] = [];
    let attempts = 0;

    await expect(
      retryGeminiRateLimit(
        async () => {
          attempts += 1;
          throw new Error("429 RESOURCE_EXHAUSTED");
        },
        { wait: async (milliseconds) => void waits.push(milliseconds) },
      ),
    ).rejects.toThrow(/Retry this AI task in a moment/);

    expect(attempts).toBe(3);
    expect(waits).toEqual([1_000, 2_000]);

    await expect(
      retryGeminiRateLimit(async () => {
        throw new Error("network unavailable");
      }),
    ).rejects.toThrow("network unavailable");
  });
});
