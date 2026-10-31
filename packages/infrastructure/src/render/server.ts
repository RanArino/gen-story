import {
  CINEMATIC_BROWSER_FILES,
  cinematicRoot,
} from "../cinematic/sources.js";
// Local render server. Serves only the runtime pages, the painter transpiled from its locked
// source, Plans under out/, locked fixture media, and registry font blobs, on 127.0.0.1.
import { existsSync, readFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, resolve, sep } from "node:path";
import ts from "typescript";
import { planDigest } from "../compiler/fingerprint.js";
import { FilmFailure } from "../contracts/errors.js";
import { readLockedBytes, readMediaLock } from "../media/lock.js";
import { PAINTER_SOURCE } from "../env/fingerprint.js";
import type { FilmRuntimePaths } from "../paths.js";
import { Registry } from "../registry/registry.js";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

export interface ServerLog {
  /** Font blob digests served, in request order. */
  fonts: string[];
  plans: { path: string; digest: string }[];
}

export interface RenderServer {
  origin: string;
  log: ServerLog;
  close(): Promise<void>;
}

/** The painter as the browser runs it: a type-stripped transpile of the exact locked source. */
export function painterScript(): string {
  return ts.transpileModule(readFileSync(PAINTER_SOURCE, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
}

function inside(root: string, path: string): boolean {
  const full = resolve(root, path);
  return full.startsWith(resolve(root) + sep);
}

export async function startServer(
  paths: FilmRuntimePaths,
): Promise<RenderServer> {
  const registry = new Registry(paths.state);
  const lock = readMediaLock(paths.media);
  const painter = painterScript();
  const cinematicScripts = new Map(
    CINEMATIC_BROWSER_FILES.map((name) => [
      `/cinematic/${name}`,
      readFileSync(`${cinematicRoot}${name}`),
    ]),
  );
  const pages = {
    "render.html": readFileSync(`${paths.root}runtime/render.html`),
    "preview.html": readFileSync(`${paths.root}runtime/preview.html`),
  };
  const log: ServerLog = { fonts: [], plans: [] };

  const send = (
    res: ServerResponse,
    status: number,
    body: string | Buffer,
    type = "text/plain; charset=utf-8",
    headers: Record<string, string> = {},
  ) => {
    res.writeHead(status, {
      "content-type": type,
      "cache-control": "no-store",
      ...headers,
    });
    res.end(body);
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      const cinematicScript = cinematicScripts.get(url.pathname);
      if (cinematicScript) return send(res, 200, cinematicScript, TYPES[".js"]);
      if (url.pathname === "/runtime/painter.js")
        return send(res, 200, painter, TYPES[".js"]);
      const page = url.pathname
        .match(/^\/runtime\/(render|preview)\.html$/)?.[0]
        ?.slice("/runtime/".length) as keyof typeof pages | undefined;
      if (page) return send(res, 200, pages[page], TYPES[".html"]);
      if (url.pathname === "/plan") {
        const path = url.searchParams.get("path") ?? "";
        if (!inside(paths.out, path) || !existsSync(resolve(paths.out, path)))
          return send(res, 404, "not found");
        const text = readFileSync(resolve(paths.out, path), "utf8");
        const digest = planDigest(JSON.parse(text));
        log.plans.push({ path, digest });
        return send(res, 200, text, TYPES[".json"], {
          "x-plan-digest": digest,
        });
      }
      const media = url.pathname.match(/^\/media\/(.+)$/)?.[1];
      if (media) {
        const asset = decodeURIComponent(media);
        return send(
          res,
          200,
          readLockedBytes(paths.media, lock, asset),
          TYPES[extname(asset)] ?? "application/octet-stream",
        );
      }
      const font = url.pathname.match(/^\/fonts\/([0-9a-f]{64})$/)?.[1];
      if (font) {
        const digest = `sha256:${font}`;
        const bytes = registry.readBlob(digest);
        log.fonts.push(digest);
        return send(res, 200, bytes, "font/ttf");
      }
      return send(res, 404, "not found");
    } catch (error) {
      if (error instanceof FilmFailure) return send(res, 404, error.message);
      return send(res, 500, String(error));
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    log,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}
