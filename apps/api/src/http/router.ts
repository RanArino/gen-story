import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import type { AuthPrincipal } from "@gen-story/application";

import type { ApiDependencies } from "../app/create-api-context";
import { PrincipalAuthContext } from "../auth/principal-auth-context";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RouteParams = { readonly _params: Map<string, string> };

export type HttpRequestContext = {
  requestId: string;
  routeIdentity: string;
  principal: AuthPrincipal | null;
  dependencies: ApiDependencies;
};

export type HttpRequestContextFactory = (
  req: IncomingMessage,
  routeIdentity: string,
) => Promise<HttpRequestContext>;

export function createHttpRequestContextFactory(
  baseDependencies: ApiDependencies,
): HttpRequestContextFactory {
  return async (_req, routeIdentity) => {
    const principal = await baseDependencies.authContext.getCurrentPrincipal();
    return {
      requestId: randomUUID(),
      routeIdentity,
      principal,
      dependencies: {
        ...baseDependencies,
        authContext: new PrincipalAuthContext(principal),
      },
    };
  };
}

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
  context: HttpRequestContext,
) => Promise<void>;

type RouteSegment =
  | { type: "static"; value: string }
  | { type: "param"; name: string }
  | { type: "wildcard" };

type Route = {
  method: HttpMethod;
  pattern: string;
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

  constructor(private readonly contextFactory?: HttpRequestContextFactory) {}

  add(method: HttpMethod, pattern: string, handler: RouteHandler): this {
    this.routes.push({
      method,
      pattern,
      segments: parsePattern(pattern),
      handler,
    });
    return this;
  }

  private match(
    method: string,
    url: string,
  ): {
    handler: RouteHandler;
    params: RouteParams;
    routeIdentity: string;
  } | null {
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
        return {
          handler: route.handler,
          params: { _params: map },
          routeIdentity: route.pattern,
        };
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

    if (this.contextFactory === undefined) {
      throw new Error("Matched route has no HTTP request context factory.");
    }
    const context = await this.contextFactory(req, result.routeIdentity);
    await result.handler(req, res, result.params, context);
    return true;
  }
}
