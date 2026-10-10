import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import {
  DEFAULT_AGENT_RUNTIME_SELECTION,
  DEFAULT_LANGUAGE,
  type AuthPrincipal,
} from "@gen-story/application";
import { createOrganization, createUser } from "@gen-story/domain";
import { getApps, initializeApp, type App } from "firebase-admin/app";
import {
  getAuth,
  type DecodedIdToken,
  type TenantAwareAuth,
} from "firebase-admin/auth";

import type { ApiDependencies } from "../app/api-dependencies";
import type {
  HttpRequestContext,
  HttpRequestContextFactory,
} from "../http/router";
import { PrincipalAuthContext } from "./principal-auth-context";

export const HOSTED_SESSION_COOKIE = "__Host-gen_story_session";

export type FirebaseIdentity = {
  uid: string;
  tenantId: string;
  email: string | null;
  displayName: string | null;
};

export interface FirebaseTokenVerifier {
  verifyIdToken(token: string): Promise<FirebaseIdentity>;
  verifySessionCookie(cookie: string): Promise<FirebaseIdentity>;
}

export interface FirebaseSessionManager extends FirebaseTokenVerifier {
  createSessionCookie(idToken: string): Promise<string>;
  revokeSessionCookie(cookie: string): Promise<void>;
}

type PrincipalRepositories = Pick<
  ApiDependencies,
  "users" | "organizations" | "userPreferences"
>;

export function createFirebaseRequestContextFactory(
  baseDependencies: ApiDependencies,
  verifier: FirebaseTokenVerifier,
  options?: {
    provision?: (identity: FirebaseIdentity) => Promise<AuthPrincipal | null>;
    scope?: (
      principal: AuthPrincipal,
      dependencies: ApiDependencies,
    ) => ApiDependencies;
  },
): HttpRequestContextFactory {
  return async (request, routeIdentity): Promise<HttpRequestContext> => {
    const identity = await authenticateFirebaseRequest(request, verifier);
    const principal =
      identity == null
        ? null
        : await (options?.provision?.(identity) ??
            provisionFirebasePrincipal(baseDependencies, identity));

    return {
      requestId: randomUUID(),
      routeIdentity,
      principal,
      dependencies: {
        ...(principal != null && options?.scope
          ? options.scope(principal, baseDependencies)
          : baseDependencies),
        authContext: new PrincipalAuthContext(principal),
      },
    };
  };
}

export async function authenticateFirebaseRequest(
  request: IncomingMessage,
  verifier: FirebaseTokenVerifier,
): Promise<FirebaseIdentity | null> {
  const authorization = request.headers.authorization;
  const bearer = parseBearerToken(authorization);
  const sessionCookie = parseCookieHeader(request.headers.cookie).get(
    HOSTED_SESSION_COOKIE,
  );

  try {
    if (bearer != null) return await verifier.verifyIdToken(bearer);
    if (sessionCookie != null) {
      return await verifier.verifySessionCookie(sessionCookie);
    }
  } catch {
    return null;
  }

  return null;
}

export function parseCookieHeader(
  header: string | undefined,
): Map<string, string> {
  const cookies = new Map<string, string>();
  if (header == null) return cookies;

  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator <= 0) continue;
    const name = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (name.length === 0 || value.length === 0) continue;
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      // Ignore malformed cookies rather than accepting a partially decoded
      // authentication value.
    }
  }
  return cookies;
}

function parseBearerToken(header: string | undefined): string | null {
  if (header == null) return null;
  const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header);
  return match?.[1] ?? null;
}

export class FirebaseTenantTokenVerifier implements FirebaseTokenVerifier {
  private readonly auth: TenantAwareAuth;

  constructor(
    projectId: string,
    private readonly tenantId: string,
    app: App = firebaseAdminApp(projectId),
  ) {
    this.auth = getAuth(app).tenantManager().authForTenant(tenantId);
  }

  async verifyIdToken(token: string): Promise<FirebaseIdentity> {
    return this.toIdentity(await this.auth.verifyIdToken(token, true));
  }

  async verifySessionCookie(cookie: string): Promise<FirebaseIdentity> {
    return this.toIdentity(await this.auth.verifySessionCookie(cookie, true));
  }

  async createSessionCookie(idToken: string): Promise<string> {
    await this.verifyIdToken(idToken);
    return this.auth.createSessionCookie(idToken, {
      expiresIn: HOSTED_SESSION_MAX_AGE_SECONDS * 1_000,
    });
  }

  async revokeSessionCookie(cookie: string): Promise<void> {
    const identity = await this.verifySessionCookie(cookie);
    await this.auth.revokeRefreshTokens(identity.uid);
  }

  private toIdentity(decoded: DecodedIdToken): FirebaseIdentity {
    const tokenTenantId = decoded.firebase?.tenant;
    if (tokenTenantId !== this.tenantId) {
      throw new Error("Firebase token tenant does not match this deployment.");
    }

    return {
      uid: decoded.uid,
      tenantId: tokenTenantId,
      email: decoded.email ?? null,
      displayName: decoded.name ?? null,
    };
  }
}

export const HOSTED_SESSION_MAX_AGE_SECONDS = 5 * 24 * 60 * 60;

export async function provisionFirebasePrincipal(
  repositories: PrincipalRepositories,
  identity: FirebaseIdentity,
  now = new Date().toISOString(),
): Promise<AuthPrincipal> {
  const identityKey = `${identity.tenantId}:${identity.uid}`;
  const digest = createHash("sha256").update(identityKey).digest("hex");
  const userId = `firebase-user-${digest}`;
  const organizationId = `firebase-org-${digest}`;

  let organization = await repositories.organizations.findById(organizationId);
  if (organization == null) {
    organization = createOrganization({
      id: organizationId,
      name: personalOrganizationName(identity),
      createdAt: now,
      updatedAt: now,
    });
    await repositories.organizations.save(organization);
  }

  let user = await repositories.users.findById(userId);
  if (user == null) {
    user = createUser({
      id: userId,
      organizationId,
      displayName: identity.displayName ?? identity.email ?? "Gen Story User",
      email: identity.email,
      createdAt: now,
      updatedAt: now,
    });
    await repositories.users.save(user);
  }

  const preference = await repositories.userPreferences.findByUserId(userId);
  if (preference == null) {
    await repositories.userPreferences.upsert({
      userId,
      language: DEFAULT_LANGUAGE,
      agentRuntime: DEFAULT_AGENT_RUNTIME_SELECTION,
      updatedAt: now,
    });
  }

  return { user, organization };
}

function personalOrganizationName(identity: FirebaseIdentity): string {
  const owner = identity.displayName ?? identity.email;
  return owner == null ? "Personal Organization" : `${owner}'s Organization`;
}

function firebaseAdminApp(projectId: string): App {
  const existing = getApps().find((app) => app.name === projectId);
  if (existing != null) return existing;

  // Cloud Run supplies Application Default Credentials through its attached,
  // keyless service account. A JSON service-account key is never accepted.
  return initializeApp({ projectId }, projectId);
}

export function rejectServiceAccountKeyEnvironment(
  env: NodeJS.ProcessEnv,
): void {
  if (env.GOOGLE_APPLICATION_CREDENTIALS != null) {
    throw new Error(
      "GOOGLE_APPLICATION_CREDENTIALS is not allowed in hosted mode. Use the attached keyless Cloud Run service account.",
    );
  }
}
