import { describe, expect, it } from "vitest";

import { buildHealthResponse } from "./server";

describe("buildHealthResponse", () => {
  it("returns a stable health payload", () => {
    expect(buildHealthResponse()).toEqual({
      status: "ok",
      service: "gen-story-api",
    });
  });
});
