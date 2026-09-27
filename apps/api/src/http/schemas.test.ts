import { describe, expect, it } from "vitest";

import {
  CreateGenerationRequestSchema,
  CreateProjectSchema,
  PostAgentChatTurnSchema,
  ReviseChangeProposalItemSchema,
  UpsertScenesSchema,
} from "./schemas";

describe("hosted HTTP schema bounds", () => {
  it("rejects unknown fields instead of silently discarding them", () => {
    expect(
      CreateProjectSchema.safeParse({ name: "Project", admin: true }).success,
    ).toBe(false);
  });

  it("rejects excessive text and array sizes", () => {
    expect(
      PostAgentChatTurnSchema.safeParse({
        clientRequestId: "request-1",
        text: "x".repeat(20_001),
      }).success,
    ).toBe(false);
    expect(
      UpsertScenesSchema.safeParse({ scenes: Array(101).fill({}) }).success,
    ).toBe(false);
  });

  it("rejects deeply nested arbitrary proposal values", () => {
    const after = { a: { b: { c: { d: { e: { f: { g: true } } } } } } };
    expect(ReviseChangeProposalItemSchema.safeParse({ after }).success).toBe(
      false,
    );
  });

  it("accepts bounded generation input JSON", () => {
    expect(
      CreateGenerationRequestSchema.safeParse({
        inputJson: { prompt: "A scene", options: [1, true, null] },
      }).success,
    ).toBe(true);
  });
});
