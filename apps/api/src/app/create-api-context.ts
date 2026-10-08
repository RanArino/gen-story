import { resolveDeployTarget } from "../agent-runtime/runtime-config";
import type { GenStorySqliteClient } from "../db/client";
import { createHostedApiContext } from "./create-hosted-api-context";
import { createLocalApiContext } from "./create-local-api-context";

import type { ApiDependencies } from "./api-dependencies";

export type {
  ApiAgentRuntimeInfo,
  ApiDependencies,
  TextVisionGenerationPorts,
} from "./api-dependencies";
export { createGeminiImageClient } from "./create-local-api-context";

export function createApiContext(
  client: GenStorySqliteClient,
  env: NodeJS.ProcessEnv = process.env,
): ApiDependencies {
  return resolveDeployTarget(env) === "cloud"
    ? createHostedApiContext(env)
    : createLocalApiContext(client, env);
}
