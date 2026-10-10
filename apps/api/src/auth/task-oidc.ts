import type { IncomingMessage } from "node:http";
import { OAuth2Client, type TokenPayload } from "google-auth-library";

export interface TaskTokenVerifier {
  verify(token: string, audience: string): Promise<TokenPayload>;
}
export class GoogleTaskTokenVerifier implements TaskTokenVerifier {
  constructor(private readonly client: OAuth2Client = new OAuth2Client()) {}
  async verify(token: string, audience: string) {
    const ticket = await this.client.verifyIdToken({
      idToken: token,
      audience,
    });
    const payload = ticket.getPayload();
    if (!payload) throw new Error("Invalid task identity.");
    return payload;
  }
}
export type TaskCaller = { email: string; subject: string };
export class TaskAuthenticator {
  constructor(
    private readonly verifier: TaskTokenVerifier,
    private readonly audience: string,
    private readonly clock = () => new Date(),
  ) {}
  async authenticate(req: IncomingMessage, caller: TaskCaller) {
    const authorization = req.headers.authorization;
    if (
      typeof authorization !== "string" ||
      authorization.length > 16_384 ||
      !/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
        authorization,
      )
    )
      return false;
    try {
      const claims = await this.verifier.verify(
        authorization.slice(7),
        this.audience,
      );
      const now = Math.floor(this.clock().getTime() / 1000);
      return (
        claims.iss === "https://accounts.google.com" &&
        claims.aud === this.audience &&
        claims.sub === caller.subject &&
        claims.email === caller.email &&
        claims.email_verified === true &&
        Number.isSafeInteger(claims.iat) &&
        Number.isSafeInteger(claims.exp) &&
        claims.iat <= now + 60 &&
        claims.iat >= now - 3660 &&
        claims.exp > now &&
        claims.exp > claims.iat &&
        claims.exp - claims.iat <= 3600
      );
    } catch {
      return false;
    }
  }
}
