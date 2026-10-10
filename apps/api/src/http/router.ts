import type { IncomingMessage, ServerResponse } from "node:http";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RouteParams = { readonly _params: Map<string, string> };

export function getParam(params: RouteParams, key: string): string {
  const value = params._params.get(key);
  if (value === undefined) {
    throw new Error(`Route param "${key}" is missing.`);
  }
  return value;
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: RouteParams,
) => Promise<void>;

type RouteSegment =
  | { type: "static"; value: string }
  | { type: "param"; name: string }
  | { type: "wildcard" };

type Route = {
  method: HttpMethod;
  segments: RouteSegment[];
  handler: RouteHandler;
};

function parsePattern(pattern: string): RouteSegment[] {
  return pattern
    .split("/")
    .filter(Boolean)
    .map((seg) => {
      if (seg === "*") {
        return { type: "wildcard" as const };
      }
      if (seg.startsWith(":")) {
        return { type: "param" as const, name: seg.slice(1) };
      }
      return { type: "static" as const, value: seg };
    });
}

function parsePath(url: string): string[] {
  const questionMark = url.indexOf("?");
  const path = questionMark === -1 ? url : url.slice(0, questionMark);
  return path.split("/").filter(Boolean);
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: HttpMethod, pattern: string, handler: RouteHandler): this {
    this.routes.push({ method, segments: parsePattern(pattern), handler });
    return this;
  }

  private match(
    method: string,
    url: string,
  ): { handler: RouteHandler; params: RouteParams } | null {
    const pathSegments = parsePath(url);

    for (const route of this.routes) {
      if (route.method !== method) {
        continue;
      }

      const lastSeg = route.segments[route.segments.length - 1];
      const hasWildcard = lastSeg?.type === "wildcard";
      const fixedSegments = hasWildcard
        ? route.segments.slice(0, -1)
        : route.segments;

      if (hasWildcard) {
        if (pathSegments.length < fixedSegments.length) continue;
      } else {
        if (route.segments.length !== pathSegments.length) continue;
      }

      const map = new Map<string, string>();
      let matched = true;

      for (let i = 0; i < fixedSegments.length; i++) {
        const seg = fixedSegments[i]!;
        const pathSeg = pathSegments[i]!;

        if (seg.type === "static") {
          if (seg.value !== pathSeg) {
            matched = false;
            break;
          }
        } else if (seg.type === "param") {
          map.set(seg.name, decodeURIComponent(pathSeg));
        }
      }

      if (matched) {
        if (hasWildcard) {
          const tail = pathSegments.slice(fixedSegments.length).join("/");
          map.set("*", tail);
        }
        return { handler: route.handler, params: { _params: map } };
      }
    }

    return null;
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";
    const result = this.match(method, url);

    if (result == null) {
      return false;
    }

    await result.handler(req, res, result.params);
    return true;
  }
}
