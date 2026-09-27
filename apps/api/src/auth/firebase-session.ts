import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import {
  badRequestBody,
  forbiddenBody,
  unauthorizedBody,
} from "../http/errors";
import { bodyErrorStatus, readJsonBody, sendJson } from "../http/json";
import {
  HOSTED_SESSION_COOKIE,
  HOSTED_SESSION_MAX_AGE_SECONDS,
  parseCookieHeader,
  type FirebaseSessionManager,
} from "./firebase-auth";

export const HOSTED_CSRF_COOKIE = "__Host-gen_story_csrf";

const SessionBodySchema = z
  .object({ idToken: z.string().min(1).max(16_384) })
  .strict();

export async function handleFirebaseSessionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  sessions: FirebaseSessionManager,
): Promise<boolean> {
  const path = new URL(request.url ?? "/", "https://api.invalid").pathname;

  if (request.method === "GET" && path === "/api/auth/csrf") {
    const token = newCsrfToken();
    response.setHeader("Set-Cookie", csrfCookie(token));
    sendJson(response, 200, { csrfToken: token });
    return true;
  }

  if (request.method === "POST" && path === "/api/auth/session") {
    if (!hasValidCsrfToken(request)) {
      sendJson(response, 403, forbiddenBody("Invalid CSRF token."));
      return true;
    }

    let parsed: z.infer<typeof SessionBodySchema>;
    try {
      parsed = SessionBodySchema.parse(await readJsonBody(request, 20_000));
    } catch (error) {
      const status = error instanceof z.ZodError ? 422 : bodyErrorStatus(error);
      sendJson(response, status, badRequestBody("Invalid session request."));
      return true;
    }

    try {
      const cookie = await sessions.createSessionCookie(parsed.idToken);
      const rotatedCsrf = newCsrfToken();
      response.setHeader("Set-Cookie", [
        sessionCookie(cookie),
        csrfCookie(rotatedCsrf),
      ]);
      sendJson(response, 200, { csrfToken: rotatedCsrf });
    } catch {
      sendJson(response, 401, unauthorizedBody());
    }
    return true;
  }

  if (request.method === "POST" && path === "/api/auth/logout") {
    if (!hasValidCsrfToken(request)) {
      sendJson(response, 403, forbiddenBody("Invalid CSRF token."));
      return true;
    }

    const cookie = parseCookieHeader(request.headers.cookie).get(
      HOSTED_SESSION_COOKIE,
    );
    if (cookie != null) {
      try {
        await sessions.revokeSessionCookie(cookie);
      } catch {
        // An invalid or already-revoked session is still safe to clear.
      }
    }
    response.setHeader("Set-Cookie", [clearSessionCookie(), clearCsrfCookie()]);
    response.writeHead(204);
    response.end();
    return true;
  }

  return false;
}

export function hasValidCsrfToken(request: IncomingMessage): boolean {
  const header = request.headers["x-csrf-token"];
  if (typeof header !== "string") return false;
  const cookie = parseCookieHeader(request.headers.cookie).get(
    HOSTED_CSRF_COOKIE,
  );
  if (cookie == null) return false;

  const headerBytes = Buffer.from(header);
  const cookieBytes = Buffer.from(cookie);
  return (
    headerBytes.length === cookieBytes.length &&
    headerBytes.length > 0 &&
    timingSafeEqual(headerBytes, cookieBytes)
  );
}

export function requiresCookieCsrf(request: IncomingMessage): boolean {
  const method = request.method ?? "GET";
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return false;
  return parseCookieHeader(request.headers.cookie).has(HOSTED_SESSION_COOKIE);
}

function newCsrfToken(): string {
  return randomBytes(32).toString("base64url");
}

function sessionCookie(value: string): string {
  return `${HOSTED_SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${HOSTED_SESSION_MAX_AGE_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

function csrfCookie(value: string): string {
  return `${HOSTED_CSRF_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${HOSTED_SESSION_MAX_AGE_SECONDS}; Secure; SameSite=Lax`;
}

function clearSessionCookie(): string {
  return `${HOSTED_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function clearCsrfCookie(): string {
  return `${HOSTED_CSRF_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`;
}
