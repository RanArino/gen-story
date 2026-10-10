import { describe, expect, it } from "vitest";
import { readR2Config, readR2StorageConfig } from "./hosted-media";

const env = {
  FIRESTORE_DATABASE_ID: "gen-story-staging",
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_BUCKET_NAME: "gen-story-staging-media",
  R2_ACCESS_KEY_ID: "fixture-only",
  R2_SECRET_ACCESS_KEY: "fixture-only",
  R2_CORS_ORIGINS: "https://staging.example.test",
};
describe("private media configuration", () => {
  it("requires explicit matching environment, account, credentials, and exact origins", () => {
    expect(readR2Config(env).bucket).toBe("gen-story-staging-media");
    for (const change of [
      { R2_ACCOUNT_ID: "" },
      { R2_SECRET_ACCESS_KEY: "" },
      { FIRESTORE_DATABASE_ID: "(default)" },
      { R2_BUCKET_NAME: "gen-story-production-media" },
      { R2_CORS_ORIGINS: "" },
      { R2_CORS_ORIGINS: "https://*.example.test" },
      { R2_CORS_ORIGINS: "https://staging.example.test/path" },
      { R2_CORS_ORIGINS: "http://localhost:3000" },
    ])
      expect(() => readR2Config({ ...env, ...change })).toThrow();
  });
  it("permits localhost only with explicit staging opt-in", () => {
    const local = {
      ...env,
      R2_CORS_ORIGINS: "http://localhost:3000",
      R2_ALLOW_STAGING_LOCALHOST: "true",
    };
    expect(readR2Config(local).origins).toEqual(["http://localhost:3000"]);
    expect(() =>
      readR2Config({
        ...local,
        FIRESTORE_DATABASE_ID: "gen-story-production",
        R2_BUCKET_NAME: "gen-story-production-media",
      }),
    ).toThrow();
  });
  it("keeps browser origins out of server-side R2 configuration", () => {
    const storage: Partial<typeof env> = { ...env };
    delete storage.R2_CORS_ORIGINS;
    expect(readR2StorageConfig(storage).bucket).toBe("gen-story-staging-media");
    expect(() => readR2Config(storage)).toThrow();
  });
});
