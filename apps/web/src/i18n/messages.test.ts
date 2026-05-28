import { describe, expect, it } from "vitest";

import en from "./messages/en.json";
import ja from "./messages/ja.json";

function flattenKeys(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") {
    return [prefix];
  }
  const result: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    result.push(...flattenKeys(child, path));
  }
  return result;
}

describe("i18n message coverage", () => {
  it("en.json and ja.json have the same set of keys", () => {
    const enKeys = new Set(flattenKeys(en));
    const jaKeys = new Set(flattenKeys(ja));

    const onlyInEn = [...enKeys].filter((k) => !jaKeys.has(k));
    const onlyInJa = [...jaKeys].filter((k) => !enKeys.has(k));

    expect(onlyInEn, "keys in en.json missing from ja.json").toEqual([]);
    expect(onlyInJa, "keys in ja.json missing from en.json").toEqual([]);
  });
});
