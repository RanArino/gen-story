import type { ApiDependencies } from "./api-dependencies";
import { rejectServiceAccountKeyEnvironment } from "../auth/firebase-auth";

export function createHostedApiContext(
  env: NodeJS.ProcessEnv,
): ApiDependencies {
  rejectServiceAccountKeyEnvironment(env);
  throw new Error(
    "Hosted API context is not configured. Refusing to fall back to local SQLite, files, authentication, workers, MCP routes, or agent CLIs.",
  );
}
