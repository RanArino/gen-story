import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { pathToFileURL } from "node:url";

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

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

export function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
) {
  if (request.method === "GET" && request.url === "/health") {
    sendJson(response, 200, buildHealthResponse());
    return;
  }

  sendJson(response, 404, { error: "not_found" });
}

export function startServer(port = Number(process.env.API_PORT ?? 4000)) {
  const server = createServer(handleRequest);

  server.listen(port, () => {
    console.log(`gen-story-api listening on http://localhost:${port}`);
  });

  return server;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startServer();
}
