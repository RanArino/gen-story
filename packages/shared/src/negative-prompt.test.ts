import { describe, expect, it } from "vitest";

import {
  BASE_NEGATIVE_PROMPT,
  RECOMMENDED_NEGATIVE_FENCE,
  composeNegativePrompt,
} from "./negative-prompt";

describe("composeNegativePrompt", () => {
  it("returns just the base when project and scene are empty", () => {
    expect(composeNegativePrompt(BASE_NEGATIVE_PROMPT, "", "")).toBe(
      BASE_NEGATIVE_PROMPT,
    );
  });

  it("appends project and scene phrases after the base, in order", () => {
    const result = composeNegativePrompt(
      "text, watermark",
      "no balloons",
      "no extra people",
    );

    expect(result).toBe("text, watermark, no balloons, no extra people");
  });

  it("de-duplicates exact phrases across layers", () => {
    const result = composeNegativePrompt(
      "text, watermark",
      "watermark, no balloons",
      "no balloons, text",
    );

    expect(result).toBe("text, watermark, no balloons");
  });

  it("trims whitespace and drops empty phrases", () => {
    const result = composeNegativePrompt(
      "text ,  watermark ",
      " , no balloons , ",
      "",
    );

    expect(result).toBe("text, watermark, no balloons");
  });

  it("can merge the recommended fence into the base without duplication", () => {
    const result = composeNegativePrompt(
      BASE_NEGATIVE_PROMPT,
      RECOMMENDED_NEGATIVE_FENCE,
      "",
    );

    expect(result.startsWith(BASE_NEGATIVE_PROMPT)).toBe(true);
    expect(result).toContain("anime");
    expect(result).toContain("raw photo");
    // Inserting the fence twice does not double its terms.
    const doubled = composeNegativePrompt(
      BASE_NEGATIVE_PROMPT,
      `${RECOMMENDED_NEGATIVE_FENCE}, ${RECOMMENDED_NEGATIVE_FENCE}`,
      "",
    );
    expect(doubled).toBe(result);
  });
});
