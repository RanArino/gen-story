import { describe, expect, it, vi } from "vitest";

import type {
  OrganizationRepositoryPort,
  UserPreference,
  UserPreferenceRepositoryPort,
  UserRepositoryPort,
} from "@gen-story/application";
import type { Organization, User } from "@gen-story/domain";

import {
  authenticateFirebaseRequest,
  HOSTED_SESSION_COOKIE,
  parseCookieHeader,
  provisionFirebasePrincipal,
  rejectServiceAccountKeyEnvironment,
} from "./firebase-auth";

function repositories() {
  const users = new Map<string, User>();
  const organizations = new Map<string, Organization>();
  const preferences = new Map<string, UserPreference>();

  return {
    users: {
      findById: vi.fn(async (id: string) => users.get(id) ?? null),
      save: vi.fn(async (user: User) => {
        users.set(user.id, user);
      }),
    } satisfies UserRepositoryPort,
    organizations: {
      findById: vi.fn(async (id: string) => organizations.get(id) ?? null),
      save: vi.fn(async (organization: Organization) => {
        organizations.set(organization.id, organization);
      }),
    } satisfies OrganizationRepositoryPort,
    userPreferences: {
      findByUserId: vi.fn(async (id: string) => preferences.get(id) ?? null),
      upsert: vi.fn(async (preference: UserPreference) => {
        preferences.set(preference.userId, preference);
      }),
    } satisfies UserPreferenceRepositoryPort,
  };
}

describe("provisionFirebasePrincipal", () => {
  it("creates one deterministic personal principal and default preference", async () => {
    const repos = repositories();
    const identity = {
      uid: "firebase-uid",
      tenantId: "tenant-staging",
      email: "reviewer@example.test",
      displayName: "Reviewer",
    };

    const first = await provisionFirebasePrincipal(
      repos,
      identity,
      "2026-09-27T00:00:00.000Z",
    );
    const second = await provisionFirebasePrincipal(
      repos,
      identity,
      "2026-09-28T00:00:00.000Z",
    );

    expect(second).toEqual(first);
    expect(first.user.organizationId).toBe(first.organization.id);
    expect(first.user.email).toBe("reviewer@example.test");
    expect(repos.users.save).toHaveBeenCalledTimes(1);
    expect(repos.organizations.save).toHaveBeenCalledTimes(1);
    expect(repos.userPreferences.upsert).toHaveBeenCalledTimes(1);
  });

  it("isolates the same provider uid across tenants", async () => {
    const repos = repositories();
    const base = {
      uid: "same-uid",
      email: null,
      displayName: null,
    };

    const staging = await provisionFirebasePrincipal(repos, {
      ...base,
      tenantId: "staging",
    });
    const production = await provisionFirebasePrincipal(repos, {
      ...base,
      tenantId: "production",
    });

    expect(staging.user.id).not.toBe(production.user.id);
    expect(staging.organization.id).not.toBe(production.organization.id);
  });
});

describe("rejectServiceAccountKeyEnvironment", () => {
  it("accepts attached keyless identity", () => {
    expect(() => rejectServiceAccountKeyEnvironment({})).not.toThrow();
  });

  it("rejects a service-account key file", () => {
    expect(() =>
      rejectServiceAccountKeyEnvironment({
        GOOGLE_APPLICATION_CREDENTIALS: "/tmp/key.json",
      }),
    ).toThrow(/not allowed/);
  });
});

describe("Firebase request authentication", () => {
  const identity = {
    uid: "uid-1",
    tenantId: "tenant-1",
    email: null,
    displayName: null,
  };

  it("verifies an explicit first-party bearer token", async () => {
    const verifier = {
      verifyIdToken: vi.fn(async () => identity),
      verifySessionCookie: vi.fn(async () => identity),
    };
    const request = {
      headers: { authorization: "Bearer header.payload.signature" },
    } as never;

    await expect(authenticateFirebaseRequest(request, verifier)).resolves.toBe(
      identity,
    );
    expect(verifier.verifyIdToken).toHaveBeenCalledWith(
      "header.payload.signature",
    );
    expect(verifier.verifySessionCookie).not.toHaveBeenCalled();
  });

  it("uses the host-only session cookie for normal browser requests", async () => {
    const verifier = {
      verifyIdToken: vi.fn(async () => identity),
      verifySessionCookie: vi.fn(async () => identity),
    };
    const request = {
      headers: { cookie: `${HOSTED_SESSION_COOKIE}=session-value; other=x` },
    } as never;

    await expect(authenticateFirebaseRequest(request, verifier)).resolves.toBe(
      identity,
    );
    expect(verifier.verifySessionCookie).toHaveBeenCalledWith("session-value");
  });

  it("fails closed for malformed or rejected credentials", async () => {
    const verifier = {
      verifyIdToken: vi.fn(async () => {
        throw new Error("invalid");
      }),
      verifySessionCookie: vi.fn(async () => identity),
    };

    await expect(
      authenticateFirebaseRequest(
        { headers: { authorization: "Basic secret" } } as never,
        verifier,
      ),
    ).resolves.toBeNull();
    await expect(
      authenticateFirebaseRequest(
        {
          headers: { authorization: "Bearer header.payload.signature" },
        } as never,
        verifier,
      ),
    ).resolves.toBeNull();
  });

  it("ignores malformed cookie encoding", () => {
    expect(parseCookieHeader("safe=value; broken=%E0%A4%A")).toEqual(
      new Map([["safe", "value"]]),
    );
  });
});
