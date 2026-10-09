import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostedPersistenceContext } from "../app/hosted-persistence";
import { buildHostedRouter } from "../http/routes";
import { makeHandleRequest } from "../server";
import { createInMemoryApplicationDependencies } from "../test-support/in-memory-application";
import {
  clearEmulatorData,
  requireFirestoreEmulator,
} from "../test-support/firestore-emulator";

const verification = vi.hoisted(() => {
  const identity = async (token: string) => {
    if (token !== "user-a" && token !== "user-b")
      throw new Error("Invalid or revoked identity.");
    return {
      uid: token,
      tenantId: "test-tenant",
      email: `${token}@example.test`,
      displayName: token,
    };
  };
  return {
    verifyIdToken: vi.fn(identity),
    verifySessionCookie: vi.fn(identity),
    createSessionCookie: vi.fn(),
    revokeSessionCookie: vi.fn(),
  };
});

vi.mock("../auth/firebase-auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/firebase-auth")>();
  return {
    ...actual,
    FirebaseTenantTokenVerifier: vi.fn(function () {
      return verification;
    }),
  };
});
vi.mock("./repositories", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./repositories")>();
  return {
    ...actual,
    createFirestoreClient: vi.fn(() => {
      requireFirestoreEmulator();
      return actual.createFirestoreClient({
        projectId: "demo-gen-story",
        databaseId: "(default)",
      });
    }),
  };
});

describe.runIf(process.env.FIRESTORE_EMULATOR_HOST != null)(
  "hosted metadata HTTP with Firestore",
  () => {
    let persistence: ReturnType<typeof createHostedPersistenceContext>;
    let server: Server;
    let base: string;
    beforeEach(async () => {
      await clearEmulatorData();
      persistence = createHostedPersistenceContext({
        FIREBASE_PROJECT_ID: "gen-story-496911",
        FIREBASE_TENANT_ID: "test-tenant",
        FIRESTORE_DATABASE_ID: "gen-story-staging",
      });
      const dependencies = {
        ...createInMemoryApplicationDependencies(),
        ...persistence.repositories,
      };
      const router = buildHostedRouter(
        dependencies,
        persistence.createRequestContextFactory(dependencies),
      );
      server = createServer(makeHandleRequest(router));
      base = await new Promise<string>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () =>
          resolve(
            `http://127.0.0.1:${(server.address() as { port: number }).port}`,
          ),
        );
      });
    });
    afterEach(async () => {
      if (server)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      await persistence?.close();
    });
    async function request(
      user: string | null,
      method: string,
      path: string,
      body?: unknown,
    ) {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          ...(user == null ? {} : { authorization: `Bearer ${user}` }),
          ...(body == null ? {} : { "content-type": "application/json" }),
        },
        body: body == null ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        body:
          response.status === 204
            ? null
            : ((await response.json()) as Record<string, unknown>),
      };
    }

    it("persists principals and isolates concurrent users through metadata CRUD", async () => {
      const created = await Promise.all([
        request("user-a", "POST", "/api/projects", {
          projectId: "project-a",
          name: "A",
        }),
        request("user-b", "POST", "/api/projects", {
          projectId: "project-b",
          name: "B",
        }),
      ]);
      expect(created.map((result) => result.status)).toEqual([201, 201]);
      const lists = await Promise.all([
        request("user-a", "GET", "/api/projects"),
        request("user-b", "GET", "/api/projects"),
      ]);
      expect(lists[0]?.body).toMatchObject({ projects: [{ id: "project-a" }] });
      expect(lists[1]?.body).toMatchObject({ projects: [{ id: "project-b" }] });
      expect(
        (await request("user-b", "GET", "/api/projects/project-a")).status,
      ).toBe(404);
      expect(
        (await request("user-b", "DELETE", "/api/projects/project-a")).status,
      ).toBe(404);
      expect(
        (
          await request("user-a", "PUT", "/api/storyboards/storyboard-a", {
            projectId: "project-a",
            tone: "warm",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await request("user-b", "PUT", "/api/storyboards/storyboard-a", {
            projectId: "project-a",
            tone: "cold",
          })
        ).status,
      ).toBe(404);
      expect(
        (await request("user-a", "GET", "/api/projects/project-a/storyboards"))
          .body,
      ).toMatchObject({ storyboards: [{ tone: "warm" }] });
      const me = await request("user-a", "GET", "/api/me");
      const userId = me.body?.userId as string;
      await persistence.repositories.userPreferences.upsert({
        userId,
        language: "ja",
        agentRuntime: "codex",
        updatedAt: new Date().toISOString(),
      });
      await request("user-a", "GET", "/api/me");
      await expect(
        persistence.repositories.userPreferences.findByUserId(userId),
      ).resolves.toMatchObject({ language: "ja", agentRuntime: "codex" });
      expect(
        (await request("user-a", "DELETE", "/api/projects/project-a")).status,
      ).toBe(204);
      expect(
        (await request("user-a", "GET", "/api/projects/project-a")).status,
      ).toBe(404);
      expect(
        (await request("user-b", "POST", "/api/projects/project-a/restore"))
          .status,
      ).toBe(404);
      expect(
        (await request("user-a", "POST", "/api/projects/project-a/restore"))
          .status,
      ).toBe(200);
    });

    it("cannot overwrite another user's storyboard by supplying an owned project", async () => {
      await request("user-a", "POST", "/api/projects", {
        projectId: "project-a",
        name: "A",
      });
      await request("user-b", "POST", "/api/projects", {
        projectId: "project-b",
        name: "B",
      });
      await request("user-a", "PUT", "/api/storyboards/storyboard-a", {
        projectId: "project-a",
        tone: "warm",
      });
      expect(
        (
          await request("user-b", "PUT", "/api/storyboards/storyboard-a", {
            projectId: "project-b",
            tone: "cold",
          })
        ).status,
      ).toBe(404);
      await expect(
        persistence.repositories.storyboards.findById("storyboard-a"),
      ).resolves.toMatchObject({ projectId: "project-a", tone: "warm" });
    });

    it.each([null, "foreign-tenant", "deleted-user", "stale-claim"])(
      "rejects the unauthenticated or rejected identity %s",
      async (token) => {
        expect((await request(token, "GET", "/api/projects")).status).toBe(401);
        expect(
          (
            await request(token, "POST", "/api/projects", {
              name: "Unauthorized",
            })
          ).status,
        ).toBe(401);
      },
    );

    it("keeps local runtime and chat routes absent", async () => {
      for (const path of [
        "/api/ai-runtime",
        "/api/debug/generation-requests",
        "/files/private.jpg",
        "/api/projects/project-a/agent-conversations",
      ]) {
        expect((await request("user-a", "GET", path)).status).toBe(404);
      }
    });
  },
);
