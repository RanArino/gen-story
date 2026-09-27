import { describe, expect, it } from "vitest";

import {
  HOSTED_CSRF_COOKIE,
  hasValidCsrfToken,
  requiresCookieCsrf,
} from "./firebase-session";
import { HOSTED_SESSION_COOKIE } from "./firebase-auth";

describe("Firebase session CSRF policy", () => {
  it("requires an exact double-submit token", () => {
    expect(
      hasValidCsrfToken({
        headers: {
          cookie: `${HOSTED_CSRF_COOKIE}=token-value`,
          "x-csrf-token": "token-value",
        },
      } as never),
    ).toBe(true);

    expect(
      hasValidCsrfToken({
        headers: {
          cookie: `${HOSTED_CSRF_COOKIE}=token-value`,
          "x-csrf-token": "another-value",
        },
      } as never),
    ).toBe(false);
  });

  it("requires CSRF only for cookie-authenticated mutation requests", () => {
    const cookie = `${HOSTED_SESSION_COOKIE}=session`;
    expect(
      requiresCookieCsrf({ method: "POST", headers: { cookie } } as never),
    ).toBe(true);
    expect(
      requiresCookieCsrf({ method: "GET", headers: { cookie } } as never),
    ).toBe(false);
    expect(requiresCookieCsrf({ method: "POST", headers: {} } as never)).toBe(
      false,
    );
  });
});
