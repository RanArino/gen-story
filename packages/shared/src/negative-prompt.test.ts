import { describe, expect, it } from "vitest";

import {
  BASE_NEGATIVE_PROMPT,
  RECOMMENDED_NEGATIVE_FENCE,
  composeNegativePrompt,
} from "./negative-prompt";

describe("composeNegativePrompt", () => {
  it("does not suppress text that identifies a place", () => {
    expect(BASE_NEGATIVE_PROMPT).not.toMatch(
      /\b(text|captions|letters|numbers)\b/i,
    );
  });

  it("drops text-suppression phrases from previously saved fences", () => {
    expect(
      composeNegativePrompt(
        "watermark, text, letters",
        "no captions, no extra people",
        "numbers, signature",
      ),
    ).toBe("watermark, no extra people, signature");
  });

  it("returns just the base when project and scene are empty", () => {
    expect(composeNegativePrompt(BASE_NEGATIVE_PROMPT, "", "")).toBe(
      BASE_NEGATIVE_PROMPT,
    );
  });

  it("appends project and scene phrases after the base, in order", () => {
    const result = composeNegativePrompt(
      "watermark",
      "no balloons",
      "no extra people",
    );

    expect(result).toBe("watermark, no balloons, no extra people");
  });

  it("de-duplicates exact phrases across layers", () => {
    const result = composeNegativePrompt(
      "watermark",
      "watermark, no balloons",
      "no balloons, watermark",
    );

    expect(result).toBe("watermark, no balloons");
  });

  it("trims whitespace and drops empty phrases", () => {
    const result = composeNegativePrompt(
      "watermark ",
      " , no balloons , ",
      "",
    );

    expect(result).toBe("watermark, no balloons");
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
