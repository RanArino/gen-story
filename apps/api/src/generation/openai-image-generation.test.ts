// Real OpenAI API tests must be run manually with OPENAI_API_KEY set.
// This file intentionally contains no automated tests that call the OpenAI API.
//
// To smoke-test manually:
//   OPENAI_API_KEY=sk-... pnpm dev:api
//   # Create a generation request via POST /api/scenes/:sceneId/generation-requests
//   # Poll GET /api/scenes/:sceneId/generation-requests until status === "succeeded"
//   # Verify the generated image exists under data/uploads/generated/images/

import { describe, it } from "vitest";

describe("OpenAiImageGenerationAdapter", () => {
  it("is covered by manual smoke tests only — see file header for instructions", () => {
    // intentionally empty
  });
});
