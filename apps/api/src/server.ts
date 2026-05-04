import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createApiContext } from "./app/create-api-context";
import { seedLocalPrincipal } from "./auth/local-auth";
import { openDatabase, migrateDatabase } from "./db";
import { buildRouter, handleApiRequest } from "./http/routes";
import { sendJson } from "./http/json";

import type { Router } from "./http/router";

export type HealthResponse = {
  status: "ok";
  service: "gen-story-api";
};

export function buildHealthResponse(): HealthResponse {
  return {
    status: "ok",
    service: "gen-story-api",
  };
}

export function loadEnvFile(
  envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../.env"),
) {
  if (!existsSync(envPath)) {
    return false;
  }

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();

    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
      Object.hasOwn(process.env, key)
    ) {
      continue;
    }

    process.env[key] = stripEnvValueQuotes(rawValue);
  }

  return true;
}

function stripEnvValueQuotes(value: string) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export function makeHandleRequest(router: Router) {
  return async function handleRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, buildHealthResponse());
      return;
    }

    const handled = await handleApiRequest(request, response, router);
    if (!handled) {
      sendJson(response, 404, {
        error: { code: "not_found", message: "Not found." },
      });
    }
  };
}

export async function startServer(port = Number(process.env.API_PORT ?? 4000)) {
  const client = openDatabase();
  migrateDatabase(client.db);

  const deps = createApiContext(client);
  await seedLocalPrincipal(deps);

  const router = buildRouter(deps);
  const server = createServer(makeHandleRequest(router));

  server.listen(port, () => {
    console.log(`gen-story-api listening on http://localhost:${port}`);
  });

  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  loadEnvFile();
  startServer();
}
