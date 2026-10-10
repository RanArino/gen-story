import { describe, expect, it, vi } from "vitest";
import {
  readHostedDatabaseConfig,
  readHostedPersistenceConfig,
} from "./hosted-persistence";
import { createHostedApiContext } from "./create-hosted-api-context";
import { startServer } from "../server";

const env = {
  FIREBASE_PROJECT_ID: "gen-story-496911",
  FIREBASE_TENANT_ID: "staging-tenant",
  FIRESTORE_DATABASE_ID: "gen-story-staging",
};

describe("hosted persistence configuration", () => {
  it("requires the pinned project, explicit tenant and named database", () => {
    expect(readHostedPersistenceConfig(env)).toEqual({
      projectId: "gen-story-496911",
      tenantId: "staging-tenant",
      databaseId: "gen-story-staging",
    });
    expect(
      readHostedPersistenceConfig({
        ...env,
        FIRESTORE_DATABASE_ID: "gen-story-production",
      }).databaseId,
    ).toBe("gen-story-production");
    for (const invalid of [
      {},
      { ...env, FIREBASE_PROJECT_ID: "foreign" },
      { ...env, FIREBASE_TENANT_ID: " " },
      { ...env, FIRESTORE_DATABASE_ID: "(default)" },
      { ...env, GOOGLE_APPLICATION_CREDENTIALS: "private-key.json" },
    ]) {
      expect(() => readHostedPersistenceConfig(invalid)).toThrow();
    }
  });

  it("does not require a browser tenant for database-only commands", () => {
    const database: Partial<typeof env> = { ...env };
    delete database.FIREBASE_TENANT_ID;
    expect(readHostedDatabaseConfig(database)).toEqual({
      projectId: "gen-story-496911",
      databaseId: "gen-story-staging",
    });
    expect(() => readHostedPersistenceConfig(database)).toThrow();
  });

  it("rejects startup despite valid identity and persistence configuration", async () => {
    expect(() => createHostedApiContext(env)).toThrow(
      /R2 media and Cloud Tasks/,
    );
    vi.stubEnv("GEN_STORY_DEPLOY_TARGET", "cloud");
    vi.stubEnv("GEN_STORY_SQLITE_PATH", "/must-not-open.sqlite");
    try {
      await expect(startServer(0)).rejects.toThrow(/Hosted API context/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
