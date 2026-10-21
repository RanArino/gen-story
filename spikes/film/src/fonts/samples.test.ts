import { describe, expect, it } from "vitest";
import { JA_SAMPLE_SET } from "./samples.js";

describe("Japanese sample set", () => {
  it("has exactly 200 distinct characters", () => {
    expect(JA_SAMPLE_SET).toHaveLength(200);
    expect(new Set(JA_SAMPLE_SET).size).toBe(200);
  });
});
