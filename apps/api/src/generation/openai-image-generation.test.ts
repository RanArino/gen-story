// Real OpenAI API tests must be run manually with OPENAI_API_KEY set.
// This file intentionally contains no automated tests that call the OpenAI API
// — the client is constructed internally by OpenAiImageGenerationAdapter, not
// injected, so there is no network boundary to fake. selectImageGenerationMode
// is the pure decision this adapter makes before touching the network, and it
// is fully covered below.
//
// To smoke-test manually:
//   OPENAI_API_KEY=sk-... pnpm dev:api
//   # Create a generation request via POST /api/scenes/:sceneId/generation-requests
//   # Poll GET /api/scenes/:sceneId/generation-requests until status === "succeeded"
//   # Verify the generated image exists under data/uploads/generated/images/
//   # Repeat with a scene whose photoFidelity is "low" or "high" to exercise
//   # images.edit; compare cost and likeness against the "off" default. Under
//   # the default model uses prompt instructions to distinguish "low" and
//   # "high" because input_fidelity is omitted — see supportsInputFidelity.

import { describe, expect, it } from "vitest";

import {
  OpenAiImageGenerationInterval,
  selectImageGenerationMode,
  supportsInputFidelity,
} from "./openai-image-generation";
import { DEFAULT_OPENAI_IMAGE_MODEL } from "./image-generation-model";

describe("image generation model", () => {
  it("pins the requested GPT Image 2.5 Flare snapshot", () => {
    expect(DEFAULT_OPENAI_IMAGE_MODEL).toBe("gpt-image-2.5-flare-2026-09-08");
  });
});

describe("OpenAiImageGenerationAdapter", () => {
  it("is covered by manual smoke tests only — see file header for instructions", () => {
    // intentionally empty
  });
});

describe("OpenAiImageGenerationInterval", () => {
  it("spaces concurrent request starts by the configured interval", async () => {
    let time = 0;
    const waits: number[] = [];
    const interval = new OpenAiImageGenerationInterval(
      12_000,
      () => time,
      async (milliseconds) => {
        waits.push(milliseconds);
        time += milliseconds;
      },
    );
    const starts: number[] = [];

    await interval.waitForNextStart();
    starts.push(time);
    await Promise.all(
      [1, 2].map(async () => {
        await interval.waitForNextStart();
        starts.push(time);
      }),
    );

    expect(starts[0]).toBe(0);
    expect(waits).toEqual([12_000, 12_000]);
  });
});

describe("selectImageGenerationMode", () => {
  it("selects generate when photoFidelity is off, regardless of attached photos", () => {
    expect(
      selectImageGenerationMode({
        photoFidelity: "off",
        normalizedInputImages: [{ storageKey: "a" }],
      }),
    ).toEqual({ kind: "generate" });
  });

  it("selects generate when photoFidelity is unset", () => {
    expect(
      selectImageGenerationMode({
        normalizedInputImages: [{ storageKey: "a" }],
      }),
    ).toEqual({ kind: "generate" });
  });

  it("selects generate when fidelity is requested but the scene has no photos", () => {
    expect(
      selectImageGenerationMode({
        photoFidelity: "high",
        normalizedInputImages: [],
      }),
    ).toEqual({ kind: "generate" });
  });

  it("selects edit with low input_fidelity and every normalized image", () => {
    expect(
      selectImageGenerationMode({
        photoFidelity: "low",
        normalizedInputImages: [{ storageKey: "a" }, { storageKey: "b" }],
      }),
    ).toEqual({
      kind: "edit",
      inputFidelity: "low",
      storageKeys: ["a", "b"],
    });
  });

  it("selects edit with high input_fidelity", () => {
    expect(
      selectImageGenerationMode({
        photoFidelity: "high",
        normalizedInputImages: [{ storageKey: "a" }],
      }),
    ).toEqual({
      kind: "edit",
      inputFidelity: "high",
      storageKeys: ["a"],
    });
  });

  it("ignores an unrecognized photoFidelity value and falls back to generate", () => {
    expect(
      selectImageGenerationMode({
        photoFidelity: "maximum",
        normalizedInputImages: [{ storageKey: "a" }],
      }),
    ).toEqual({ kind: "generate" });
  });
});

// Some models reject input_fidelity when it is present at all. This guard is
// what stands between a scene's low/high choice and a paid call that fails.
describe("supportsInputFidelity", () => {
  it("allows gpt-image-1, confirmed by OpenAI's own cookbook example", () => {
    expect(supportsInputFidelity("gpt-image-1")).toBe(true);
  });

  it("rejects gpt-image-2, which 400s if the parameter is present", () => {
    expect(supportsInputFidelity("gpt-image-2")).toBe(false);
  });

  it("rejects gpt-image-1.5, whose support is not reliably documented", () => {
    expect(supportsInputFidelity("gpt-image-1.5")).toBe(false);
  });

  it("rejects unknown or unrelated model strings", () => {
    expect(supportsInputFidelity("dall-e-3")).toBe(false);
    expect(supportsInputFidelity("")).toBe(false);
  });
});
