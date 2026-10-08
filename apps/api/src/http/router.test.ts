import { createServer, type Server } from "node:http";

import { createOrganization, createUser } from "@gen-story/domain";
import { afterEach, describe, expect, it } from "vitest";

import { PrincipalAuthContext } from "../auth/principal-auth-context";
import { createInMemoryApplicationDependencies } from "../test-support/in-memory-application";
import { sendJson } from "./json";
import { Router, type HttpRequestContextFactory } from "./router";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});

describe("Router request context", () => {
  it("keeps concurrent principals isolated and exposes a sanitized route identity", async () => {
    const createdAt = "2026-01-01T00:00:00.000Z";
    const organizations = ["a", "b"].map((suffix) =>
      createOrganization({
        id: `org-${suffix}`,
        name: `Organization ${suffix}`,
        createdAt,
        updatedAt: createdAt,
      }),
    );
    const users = organizations.map((organization, index) =>
      createUser({
        id: `user-${index === 0 ? "a" : "b"}`,
        organizationId: organization.id,
        displayName: `User ${index}`,
        email: null,
        createdAt,
        updatedAt: createdAt,
      }),
    );
    const baseDependencies = createInMemoryApplicationDependencies({
      organizations,
      users,
    });
    const principals = new Map(
      users.map((user, index) => [
        user.id,
        { user, organization: organizations[index]! },
      ]),
    );
    let nextRequestId = 0;
    const contextFactory: HttpRequestContextFactory = async (
      request,
      routeIdentity,
    ) => {
      const principal =
        principals.get(String(request.headers["x-test-user"])) ?? null;
      return {
        requestId: `request-${++nextRequestId}`,
        routeIdentity,
        principal,
        dependencies: {
          ...baseDependencies,
          authContext: new PrincipalAuthContext(principal),
        },
      };
    };
    const router = new Router(contextFactory);
    router.add(
      "GET",
      "/projects/:projectId",
      async (_request, response, _params, context) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        const principal =
          await context.dependencies.authContext.getCurrentPrincipal();
        sendJson(response, 200, {
          requestId: context.requestId,
          routeIdentity: context.routeIdentity,
          userId: principal?.user.id ?? null,
        });
      },
    );

    const server = createServer(async (request, response) => {
      if (!(await router.handle(request, response))) {
        sendJson(response, 404, { error: "not found" });
      }
    });
    servers.push(server);
    const baseUrl = await new Promise<string>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as { port: number };
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });

    const [responseA, responseB] = (await Promise.all([
      fetch(`${baseUrl}/projects/project-a?secret=value`, {
        headers: { "x-test-user": "user-a" },
      }).then((response) => response.json()),
      fetch(`${baseUrl}/projects/project-b?secret=value`, {
        headers: { "x-test-user": "user-b" },
      }).then((response) => response.json()),
    ])) as [Record<string, unknown>, Record<string, unknown>];

    expect(responseA).toMatchObject({
      routeIdentity: "/projects/:projectId",
      userId: "user-a",
    });
    expect(responseB).toMatchObject({
      routeIdentity: "/projects/:projectId",
      userId: "user-b",
    });
    expect(responseA.requestId).not.toBe(responseB.requestId);
  });
});
