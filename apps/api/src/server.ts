import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { failInterruptedAiJobs } from "@gen-story/application";

import { createApiContext } from "./app/create-api-context";
import { seedLocalPrincipal } from "./auth/local-auth";
import { openDatabase, migrateDatabase } from "./db";
import { LocalJobWorker } from "./generation/local-job-worker";
import { buildRouter, handleApiRequest } from "./http/routes";
import { sendJson } from "./http/json";
import { logRequest } from "./http/request-logger";

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
    const startMs = Date.now();
    const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:3000";
    response.setHeader("Access-Control-Allow-Origin", corsOrigin);
    response.setHeader(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      logRequest("OPTIONS", request.url ?? "/", 204, Date.now() - startMs);
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, buildHealthResponse());
      return;
    }

    const handled = await handleApiRequest(request, response, router);
    if (!handled) {
      sendJson(response, 404, {
        error: { code: "not_found", message: "Not found." },
      });
      logRequest(
        request.method ?? "GET",
        request.url ?? "/",
        404,
        Date.now() - startMs,
      );
    }
  };
}

export async function startServer(port = Number(process.env.API_PORT ?? 4000)) {
  const client = openDatabase();
  migrateDatabase(client.db);

  const deps = createApiContext(client);
  await seedLocalPrincipal(deps);

  // Jobs left `running` by a previous process have no worker; fail them so the
  // UI shows a terminal state instead of a spinner that never resolves.
  const interrupted = await failInterruptedAiJobs(deps);
  if (interrupted.ok && interrupted.value > 0) {
    console.log(`[startup] failed ${interrupted.value} interrupted AI job(s)`);
  }

  const worker = new LocalJobWorker(deps);
  worker.start();

  const shutdown = () => {
    worker.stop();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

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
