import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type Server, type IncomingMessage } from "node:http";
import {
  createR2Client,
  R2ObjectStorage,
  R2UploadGrantService,
} from "../storage/r2-object-storage";

const accessKeyId = "fixture-key";
const secret = "isolated-fixture-secret";
const bucket = "gen-story-fixture";
function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}
function encode(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

// Verifies real SDK SigV4 grants; storage adapters use its map only for service operations.
export async function createSignedStorageFixture(clock = () => new Date()) {
  const objects = new Map<
    string,
    { body: Uint8Array; contentType: string; modified: string }
  >();
  const requests: {
    method: string;
    key: string;
    credentialsPresent: boolean;
  }[] = [];
  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
    res.setHeader("Access-Control-Allow-Methods", "PUT, GET, HEAD");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, x-amz-meta-sha256",
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const key = decodeURIComponent(url.pathname.slice(`/${bucket}/`.length));
    if (!url.pathname.startsWith(`/${bucket}/`) || !verify(req, url, clock())) {
      res.writeHead(403);
      res.end();
      return;
    }
    requests.push({
      method: req.method!,
      key,
      credentialsPresent: Boolean(
        req.headers.cookie ||
        req.headers.authorization ||
        req.headers["x-csrf-token"],
      ),
    });
    if (req.method === "PUT") {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += (chunk as Buffer).length;
        if (size > 11 * 1024 * 1024) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk as Buffer);
      }
      objects.set(key, {
        body: Buffer.concat(chunks),
        contentType: req.headers["content-type"]!,
        modified: clock().toISOString(),
      });
      res.writeHead(200);
      res.end();
      return;
    }
    const object = objects.get(key);
    if (!object) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader("Content-Type", object.contentType);
    res.writeHead(200);
    res.end(req.method === "HEAD" ? undefined : object.body);
  });
  const origin = await listen(server);
  const client = createR2Client({
    endpoint: origin,
    accessKeyId,
    secretAccessKey: secret,
  });
  const r2 = new R2ObjectStorage(client, bucket);
  const storage = {
    async putObject(input: {
      key: string;
      body: Uint8Array;
      contentType: string;
    }) {
      objects.set(input.key, {
        body: Uint8Array.from(input.body),
        contentType: input.contentType,
        modified: clock().toISOString(),
      });
    },
    async getObject(key: string) {
      return objects.get(key)?.body ?? null;
    },
    async readBounded(key: string, maxBytes: number) {
      const body = objects.get(key)?.body;
      if (body && body.length > maxBytes)
        throw new Error("Object exceeds byte limit.");
      return body ? Uint8Array.from(body) : null;
    },
    async deleteObject(key: string) {
      objects.delete(key);
    },
    async head(key: string) {
      const item = objects.get(key);
      return item
        ? { size: item.body.length, contentType: item.contentType }
        : null;
    },
    async list(prefix: string, cursor?: string) {
      const keys = [...objects.keys()]
        .filter(
          (key) => key.startsWith(prefix) && (cursor == null || key > cursor),
        )
        .sort();
      const page = keys.slice(0, 2);
      return {
        objects: page.map((key) => ({
          key,
          size: objects.get(key)!.body.length,
          lastModified: objects.get(key)!.modified,
        })),
        ...(keys.length > 2 ? { cursor: page[page.length - 1]! } : {}),
      };
    },
  };
  return {
    origin,
    storage,
    r2,
    grants: new R2UploadGrantService(r2, clock),
    objects,
    requests,
    async close() {
      client.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
function verify(req: IncomingMessage, url: URL, now: Date): boolean {
  try {
    const params = url.searchParams;
    const credential = params.get("X-Amz-Credential")!;
    const [id, date, region, service, terminator] = credential.split("/");
    const stamp = params.get("X-Amz-Date")!;
    const expires = Number(params.get("X-Amz-Expires"));
    const issued = Date.parse(
      `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}Z`,
    );
    if (
      id !== accessKeyId ||
      service !== "s3" ||
      terminator !== "aws4_request" ||
      params.get("X-Amz-Algorithm") !== "AWS4-HMAC-SHA256" ||
      !Number.isFinite(issued) ||
      expires < 1 ||
      expires > 600 ||
      now.getTime() < issued ||
      now.getTime() >= issued + expires * 1000
    )
      return false;
    const signed = params.get("X-Amz-SignedHeaders")!;
    const headers = signed
      .split(";")
      .map((name) => {
        const value = req.headers[name];
        if (typeof value !== "string")
          throw new Error("Missing signed header.");
        return `${name}:${value.trim().replace(/\s+/g, " ")}\n`;
      })
      .join("");
    const query = [...params.entries()]
      .filter(([name]) => name !== "X-Amz-Signature")
      .map(([name, value]) => [encode(name), encode(value)])
      .sort((a, b) =>
        a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : a[1]!.localeCompare(b[1]!),
      )
      .map((pair) => pair.join("="))
      .join("&");
    const canonical = [
      req.method,
      url.pathname,
      query,
      headers,
      signed,
      params.get("X-Amz-Content-Sha256") ?? "UNSIGNED-PAYLOAD",
    ].join("\n");
    const scope = `${date}/${region}/s3/aws4_request`;
    const toSign = `AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${createHash("sha256").update(canonical).digest("hex")}`;
    const key = hmac(
      hmac(hmac(hmac(`AWS4${secret}`, date!), region!), "s3"),
      "aws4_request",
    );
    const expected = hmac(key, toSign);
    const actual = Buffer.from(params.get("X-Amz-Signature")!, "hex");
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  } catch {
    return false;
  }
}
export function listen(server: Server): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () =>
      resolve(
        `http://127.0.0.1:${(server.address() as { port: number }).port}`,
      ),
    );
  });
}
