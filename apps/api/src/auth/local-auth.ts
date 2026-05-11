import { createOrganization, createUser } from "@gen-story/domain";
import type {
  ApplicationDependencies,
  AuthContextPort,
  AuthPrincipal,
} from "@gen-story/application";

export const LOCAL_USER_ID = "local-user-1";
export const LOCAL_ORGANIZATION_ID = "local-org-1";

const SEEDED_AT = "2026-01-01T00:00:00.000Z";

export async function seedLocalPrincipal(
  deps: Pick<ApplicationDependencies, "users" | "organizations">,
): Promise<void> {
  const existingOrg = await deps.organizations.findById(LOCAL_ORGANIZATION_ID);

  if (existingOrg == null) {
    const org = createOrganization({
      id: LOCAL_ORGANIZATION_ID,
      name: "Local Organization",
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });
    await deps.organizations.save(org);
  }

  const existingUser = await deps.users.findById(LOCAL_USER_ID);

  if (existingUser == null) {
    const user = createUser({
      id: LOCAL_USER_ID,
      organizationId: LOCAL_ORGANIZATION_ID,
      displayName: "Local User",
      email: null,
      createdAt: SEEDED_AT,
      updatedAt: SEEDED_AT,
    });
    await deps.users.save(user);
  }
}

export class LocalAuthContext implements AuthContextPort {
  constructor(
    private readonly deps: Pick<
      ApplicationDependencies,
      "users" | "organizations"
    >,
  ) {}

  async getCurrentPrincipal(): Promise<AuthPrincipal | null> {
    const organization = await this.deps.organizations.findById(
      LOCAL_ORGANIZATION_ID,
    );

    if (organization == null) {
      return null;
    }

    const user = await this.deps.users.findById(LOCAL_USER_ID);

    if (user == null) {
      return null;
    }

    return { user, organization };
  }
}
