import type { ApiDependencies } from "./api-dependencies";
import { rejectServiceAccountKeyEnvironment } from "../auth/firebase-auth";
import { readHostedPersistenceConfig } from "./hosted-persistence";

export function createHostedApiContext(
  env: NodeJS.ProcessEnv,
): ApiDependencies {
  rejectServiceAccountKeyEnvironment(env);
  // Validate configured persistence without creating clients before the
  // required media and dispatch adapters exist.
  if (
    env.FIREBASE_PROJECT_ID != null ||
    env.FIREBASE_TENANT_ID != null ||
    env.FIRESTORE_DATABASE_ID != null
  ) {
    readHostedPersistenceConfig(env);
  }
  throw new Error(
    "Hosted API context is not configured: R2 media and Cloud Tasks dispatch adapters are missing. Refusing to fall back to local SQLite, files, authentication, workers, MCP routes, or agent CLIs.",
  );
}
