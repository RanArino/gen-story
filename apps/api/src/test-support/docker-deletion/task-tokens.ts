import {
  createSign,
  createVerify,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import type { TokenPayload } from "google-auth-library";
import type { TaskTokenVerifier } from "../../auth/task-oidc";

// Test-only RS256 identity tokens. The worker verifies the signature with the
// public key, so tampering is rejected the same way a Google signature check would.
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

export function createTokenSigner() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    sign(
      identity: { email: string; subject: string },
      audience: string,
      overrides: Record<string, unknown> = {},
      now = new Date(),
    ) {
      const iat = Math.floor(now.getTime() / 1000);
      const payload = {
        iss: "https://accounts.google.com",
        aud: audience,
        sub: identity.subject,
        email: identity.email,
        email_verified: true,
        iat,
        exp: iat + 3600,
        ...overrides,
      };
      const input = `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}`;
      const signature = createSign("RSA-SHA256")
        .update(input)
        .sign(privateKey)
        .toString("base64url");
      return `${input}.${signature}`;
    },
  };
}

export class PublicKeyTaskTokenVerifier implements TaskTokenVerifier {
  constructor(private readonly publicKey: KeyObject | string) {}
  async verify(token: string, _audience: string): Promise<TokenPayload> {
    const [header, body, signature] = token.split(".");
    if (!header || !body || !signature) throw new Error("Malformed token.");
    const parsed = JSON.parse(Buffer.from(header, "base64url").toString());
    if (parsed.alg !== "RS256") throw new Error("Unsupported algorithm.");
    const valid = createVerify("RSA-SHA256")
      .update(`${header}.${body}`)
      .verify(this.publicKey, Buffer.from(signature, "base64url"));
    if (!valid) throw new Error("Invalid signature.");
    return JSON.parse(Buffer.from(body, "base64url").toString());
  }
}
