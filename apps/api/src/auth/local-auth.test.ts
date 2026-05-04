import { describe, expect, it } from "vitest";

import { createInMemoryApplicationDependencies } from "../test-support/in-memory-application";
import {
  LOCAL_ORGANIZATION_ID,
  LOCAL_USER_ID,
  LocalAuthContext,
  seedLocalPrincipal,
} from "./local-auth";

describe("seedLocalPrincipal", () => {
  it("creates the local user and organization", async () => {
    const deps = createInMemoryApplicationDependencies();

    await seedLocalPrincipal(deps);

    const org = await deps.organizations.findById(LOCAL_ORGANIZATION_ID);
    const user = await deps.users.findById(LOCAL_USER_ID);

    expect(org).not.toBeNull();
    expect(org?.id).toBe(LOCAL_ORGANIZATION_ID);
    expect(user).not.toBeNull();
    expect(user?.id).toBe(LOCAL_USER_ID);
    expect(user?.organizationId).toBe(LOCAL_ORGANIZATION_ID);
  });

  it("is idempotent — calling twice does not throw or duplicate", async () => {
    const { stores, ...deps } = createInMemoryApplicationDependencies();

    await seedLocalPrincipal(deps);
    await seedLocalPrincipal(deps);

    expect(
      stores.organizations
        .values()
        .filter((o) => o.id === LOCAL_ORGANIZATION_ID),
    ).toHaveLength(1);
    expect(
      stores.users.values().filter((u) => u.id === LOCAL_USER_ID),
    ).toHaveLength(1);
  });
});

describe("LocalAuthContext", () => {
  it("returns null when the principal has not been seeded", async () => {
    const deps = createInMemoryApplicationDependencies();
    const ctx = new LocalAuthContext(deps);

    const principal = await ctx.getCurrentPrincipal();
    expect(principal).toBeNull();
  });

  it("returns the seeded principal after seeding", async () => {
    const deps = createInMemoryApplicationDependencies();
    await seedLocalPrincipal(deps);

    const ctx = new LocalAuthContext(deps);
    const principal = await ctx.getCurrentPrincipal();

    expect(principal).not.toBeNull();
    expect(principal?.user.id).toBe(LOCAL_USER_ID);
    expect(principal?.organization.id).toBe(LOCAL_ORGANIZATION_ID);
  });
});
