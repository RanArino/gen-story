import type { IncomingMessage, ServerResponse } from "node:http";

import { HTTP_BODY_LIMITS } from "./security-policy";

export class HttpBodyError extends Error {
  constructor(
    public readonly statusCode: 400 | 413 | 415,
    message: string,
  ) {
    super(message);
    this.name = "HttpBodyError";
  }
}

export function bodyErrorStatus(error: unknown): 400 | 413 | 415 {
  return error instanceof HttpBodyError ? error.statusCode : 400;
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export async function readJsonBody<T = unknown>(
  req: IncomingMessage,
  maxBytes = HTTP_BODY_LIMITS.standardJsonBytes,
): Promise<T> {
  const contentType = req.headers["content-type"];
  if (!isJsonContentType(contentType)) {
    throw new HttpBodyError(415, "Content-Type must be application/json.");
  }

  const contentLength = parseContentLength(req.headers["content-length"]);
  if (contentLength !== null && contentLength > maxBytes) {
    req.pause();
    throw new HttpBodyError(413, "Request body too large.");
  }

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.byteLength;
      if (total > maxBytes) {
        settled = true;
        req.pause();
        reject(new HttpBodyError(413, "Request body too large."));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (settled) return;
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(text) as T);
      } catch {
        reject(new HttpBodyError(400, "Invalid JSON body."));
      }
    });

    req.on("error", reject);
  });
}

function isJsonContentType(contentType: string | undefined): boolean {
  if (contentType === undefined) return false;
  const mediaType = contentType.split(";", 1)[0]?.trim().toLowerCase();
  return (
    mediaType === "application/json" || mediaType?.endsWith("+json") === true
  );
}

function parseContentLength(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (!/^\d+$/.test(value)) {
    throw new HttpBodyError(400, "Invalid Content-Length header.");
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new HttpBodyError(400, "Invalid Content-Length header.");
  }
  return parsed;
}
