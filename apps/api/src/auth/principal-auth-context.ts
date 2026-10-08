import type { AuthContextPort, AuthPrincipal } from "@gen-story/application";

export class PrincipalAuthContext implements AuthContextPort {
  constructor(private readonly principal: AuthPrincipal | null) {}

  async getCurrentPrincipal(): Promise<AuthPrincipal | null> {
    return this.principal;
  }
}
