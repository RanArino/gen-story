import { describe, expect, it } from "vitest";

import {
  collectSensitiveEnvironmentValues,
  redactSensitiveText,
} from "./redaction";

describe("CLI output redaction", () => {
  it("collects secret-like environment values without collecting normal values", () => {
    expect(
      collectSensitiveEnvironmentValues({
        PATH: "/usr/bin",
        OPENAI_API_KEY: "openai-secret-value",
        SESSION_TOKEN: "session-secret-value",
        SHORT_SECRET: "abc",
      }),
    ).toEqual(["session-secret-value", "openai-secret-value"]);
  });

  it("redacts explicit secrets and common provider token forms", () => {
    const text = [
      "known=openai-secret-value",
      "openai=sk-abcdefghijklmnopqrstuvwxyz",
      "google=AIzaabcdefghijklmnopqrstuvwxyz123456",
      "authorization=Bearer abc.def-ghi_jkl",
    ].join("\n");

    const redacted = redactSensitiveText(text, ["openai-secret-value"]);

    expect(redacted).not.toContain("openai-secret-value");
    expect(redacted).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    expect(redacted).not.toContain("AIzaabcdefghijklmnopqrstuvwxyz123456");
    expect(redacted).not.toContain("abc.def-ghi_jkl");
    expect(redacted.match(/\[REDACTED\]/g)).toHaveLength(4);
  });
});
