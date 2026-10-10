import { generateKeyPairSync, sign } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { OAuth2Client, type TokenPayload } from "google-auth-library";
import { describe, expect, it, vi } from "vitest";
import { GoogleTaskTokenVerifier, TaskAuthenticator } from "./task-oidc";

const audience = "https://deletion-worker.run.app";
const caller = {
  email: "gs-staging-task-caller@gen-story-496911.iam.gserviceaccount.com",
  subject: "12345",
};
const now = Math.floor(Date.now() / 1000);
const claims: TokenPayload = {
  iss: "https://accounts.google.com",
  aud: audience,
  sub: caller.subject,
  email: caller.email,
  email_verified: true,
  iat: now,
  exp: now + 3600,
};
const request = (token = "header.payload.signature", extra = {}) =>
  ({
    headers: { authorization: `Bearer ${token}`, ...extra },
  }) as IncomingMessage;

describe("task OIDC authentication", () => {
  it("verifies real signatures using Google's verifier and rejects tampering", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", kid: "fixture" }),
    ).toString("base64url");
    const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const encoded = `${header}.${body}`;
    const token = `${encoded}.${sign("RSA-SHA256", Buffer.from(encoded), privateKey).toString("base64url")}`;
    const client = new OAuth2Client();
    vi.spyOn(client, "getFederatedSignonCertsAsync").mockResolvedValue({
      format: "PEM" as Awaited<
        ReturnType<OAuth2Client["getFederatedSignonCertsAsync"]>
      >["format"],
      certs: {
        fixture: publicKey.export({ type: "spki", format: "pem" }).toString(),
      },
    });
    const auth = new TaskAuthenticator(
      new GoogleTaskTokenVerifier(client),
      audience,
    );
    expect(await auth.authenticate(request(token), caller)).toBe(true);
    const changed = Buffer.from(
      JSON.stringify({ ...claims, sub: "foreign" }),
    ).toString("base64url");
    expect(
      await auth.authenticate(
        request(`${header}.${changed}.${token.split(".")[2]}`),
        caller,
      ),
    ).toBe(false);
  });
  it.each([
    { iss: "https://securetoken.google.com/gen-story-496911" },
    { aud: "https://other.run.app" },
    { sub: "foreign" },
    { email: "foreign@example.test" },
    { email_verified: false },
    { iat: now - 4000 },
    { iat: now + 61 },
    { exp: now },
    { exp: now + 3601 },
  ])(
    "rejects incorrect claims %j even with forged queue headers",
    async (changed) => {
      const auth = new TaskAuthenticator(
        { verify: async () => ({ ...claims, ...changed }) },
        audience,
        () => new Date(now * 1000),
      );
      expect(
        await auth.authenticate(
          request(undefined, { "x-cloudtasks-queuename": "trusted" }),
          caller,
        ),
      ).toBe(false);
    },
  );
  it("rejects absent/oversized credentials and verifier failures", async () => {
    const verify = vi.fn().mockRejectedValue(new Error("secret error"));
    const auth = new TaskAuthenticator({ verify }, audience);
    expect(
      await auth.authenticate({ headers: {} } as IncomingMessage, caller),
    ).toBe(false);
    expect(await auth.authenticate(request("a".repeat(17000)), caller)).toBe(
      false,
    );
    expect(verify).not.toHaveBeenCalled();
    expect(await auth.authenticate(request(), caller)).toBe(false);
  });
});
