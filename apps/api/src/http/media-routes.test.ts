import type {
  UploadGrantDto,
  UploadSessionDto,
  MediaUrlDto,
  SceneDto,
} from "@gen-story/shared";
import { createServer, type Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuthPrincipal } from "@gen-story/application";
import { createOrganization } from "@gen-story/domain";
import {
  createEmulatorClient,
  clearEmulatorData,
} from "../test-support/firestore-emulator";
import { seedMedia, mediaNow } from "../test-support/private-media-fixture";
import {
  createSignedStorageFixture,
  listen,
} from "../test-support/signed-storage-fixture";
import { createInMemoryApplicationDependencies } from "../test-support/in-memory-application";
import { createFirestoreRepositories } from "../firestore/repositories";
import { FirestoreUploadSessionRepository } from "../firestore/upload-session-repository";
import { PrivateMediaService } from "../media/media-service";
import { buildHostedRouter } from "./routes";
import { makeHandleRequest } from "../server";
import { PrincipalAuthContext } from "../auth/principal-auth-context";
import { calculateSha256Hex } from "../storage/checksum";
import { executeUploadCompletion } from "../photos/complete-upload";
import sharp from "sharp";

describe.runIf(process.env.FIRESTORE_EMULATOR_HOST != null)(
  "private hosted media HTTP",
  () => {
    let db: ReturnType<typeof createEmulatorClient>;
    let fixture: Awaited<ReturnType<typeof createSignedStorageFixture>>;
    let server: Server;
    let base: string;
    let sessions: FirestoreUploadSessionRepository;
    beforeEach(async () => {
      await clearEmulatorData();
      db = createEmulatorClient();
      await seedMedia(db);
      fixture = await createSignedStorageFixture(() => new Date(mediaNow));
      sessions = new FirestoreUploadSessionRepository(db);
      const deps = {
        ...createInMemoryApplicationDependencies(),
        ...createFirestoreRepositories(db),
      };
      const media = new PrivateMediaService(
        db,
        sessions,
        fixture.grants,
        () => new Date(mediaNow),
      );
      const router = buildHostedRouter(
        deps,
        async (req, routeIdentity) => {
          const userId =
            req.headers.authorization?.replace("Bearer ", "") ??
            (req.headers.cookie?.includes("session=a") ? "user-a" : null);
          const user = userId ? await deps.users.findById(userId) : null;
          const principal: AuthPrincipal | null = user
            ? {
                user,
                organization: createOrganization({
                  id: user.organizationId,
                  name: user.organizationId,
                  createdAt: mediaNow,
                  updatedAt: mediaNow,
                }),
              }
            : null;
          return {
            requestId: "fixture",
            routeIdentity,
            principal,
            dependencies: {
              ...deps,
              authContext: new PrincipalAuthContext(principal),
            },
          };
        },
        media,
      );
      server = createServer(makeHandleRequest(router));
      base = await listen(server);
    });
    afterEach(async () => {
      if (server)
        await new Promise<void>((resolve) => server.close(() => resolve()));
      await fixture?.close();
      await db?.terminate();
    });
    async function request(
      user: string | null,
      method: string,
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) {
      return fetch(base + path, {
        method,
        headers: {
          ...(user ? { Authorization: `Bearer ${user}` } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    }
    it("authorizes grants/status/access, keeps URLs out of records, and leaves completion durably pending", async () => {
      const body = await sharp({
        create: { width: 32, height: 24, channels: 3, background: "blue" },
      })
        .png()
        .toBuffer();
      const grantRequest = {
        name: "private.png",
        mimeType: "image/png",
        size: body.length,
        sha256: calculateSha256Hex(body),
      };
      expect(
        (
          await request(
            null,
            "POST",
            "/api/projects/project-a/upload-grants",
            grantRequest,
          )
        ).status,
      ).toBe(401);
      expect(
        (
          await request(
            "user-b",
            "POST",
            "/api/projects/project-a/upload-grants",
            grantRequest,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await request(
            "user-a",
            "POST",
            "/api/projects/project-a/upload-grants",
            { ...grantRequest, key: "foreign" },
          )
        ).status,
      ).toBe(422);
      const response = await request(
        "user-a",
        "POST",
        "/api/projects/project-a/upload-grants",
        grantRequest,
      );
      expect(response.status).toBe(201);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      const grant = (await response.json()) as UploadGrantDto;
      const path = `/api/projects/project-a/upload-sessions/${grant.uploadId}`;
      expect(
        (
          await fetch(grant.url, {
            method: "PUT",
            headers: grant.headers,
            body,
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await request("user-a", "POST", path + "/complete", {
            key: "foreign",
          })
        ).status,
      ).toBe(422);
      expect((await request("user-a", "POST", path + "/complete")).status).toBe(
        202,
      );
      expect((await request("user-a", "POST", path + "/complete")).status).toBe(
        409,
      );
      expect((await request("user-b", "GET", path)).status).toBe(404);
      expect((await db.collection("photo_assets").get()).empty).toBe(true);
      expect(JSON.stringify(await sessions.find(grant.uploadId))).not.toContain(
        "X-Amz-",
      );
      await executeUploadCompletion({
        uploadId: grant.uploadId,
        executorId: "test",
        sessions,
        storage: fixture.storage,
        clock: () => new Date(mediaNow),
        decoder: {
          async decode(snapshot) {
            const preview = await sharp(snapshot).jpeg().toBuffer();
            return {
              mimeType: "image/png",
              extension: "png",
              width: 32,
              height: 24,
              preview,
              agentPreview: preview,
            };
          },
        },
      });
      const status = (await (
        await request("user-a", "GET", path)
      ).json()) as UploadSessionDto;
      expect(status.photo).not.toBeNull();
      const mediaPath = `/api/photo-assets/${status.photo!.id}/media-url?variant=preview`;
      expect((await request("user-b", "GET", mediaPath)).status).toBe(404);
      const media = (await (
        await request("user-a", "GET", mediaPath)
      ).json()) as MediaUrlDto;
      expect((await fetch(media.url)).status).toBe(200);
      expect(
        (
          await request(
            "user-a",
            "POST",
            "/api/projects/project-a/photo-assets",
            {},
          )
        ).status,
      ).toBe(404);
      const scenes = (await (
        await request("user-a", "GET", "/api/storyboards/storyboard-a/scenes")
      ).json()) as { scenes: SceneDto[] };
      expect(scenes.scenes).toHaveLength(1);
      expect(
        (await request("user-a", "DELETE", "/api/projects/project-a")).status,
      ).toBe(204);
      expect((await request("user-a", "GET", mediaPath)).status).toBe(404);
      expect(
        (await request("user-a", "POST", "/api/projects/project-a/restore"))
          .status,
      ).toBe(200);
      expect((await request("user-a", "GET", mediaPath)).status).toBe(200);
    }, 30_000);
    it("resolves generated and character-sheet media only through current owned parents", async () => {
      const key = "media/users/user-a/projects/project-a/generated.jpg";
      await db
        .collection("scenes")
        .doc("scene")
        .set({ projectId: "project-a", deletedAt: null });
      await db
        .collection("generated_images")
        .doc("image")
        .set({ sceneId: "scene", storageKey: key });
      await db
        .collection("ai_jobs")
        .doc("sheet")
        .set({
          projectId: "project-a",
          kind: "character_sheet_generation",
          status: "succeeded",
          inputJson: { storyboardId: "storyboard-a" },
          resultJson: { storageKey: key },
        });
      for (const path of ["generated-images/image", "character-sheets/sheet"]) {
        expect(
          (
            await request(
              "user-a",
              "GET",
              `/api/${path}/media-url?variant=preview`,
            )
          ).status,
        ).toBe(200);
        expect(
          (
            await request(
              "user-b",
              "GET",
              `/api/${path}/media-url?variant=preview`,
            )
          ).status,
        ).toBe(404);
      }
      await db
        .collection("scenes")
        .doc("scene")
        .update({ deletedAt: mediaNow });
      expect(
        (
          await request(
            "user-a",
            "GET",
            "/api/generated-images/image/media-url",
          )
        ).status,
      ).toBe(404);
      await db
        .collection("storyboards")
        .doc("storyboard-a")
        .update({ deletedAt: mediaNow });
      expect(
        (
          await request(
            "user-a",
            "GET",
            "/api/character-sheets/sheet/media-url",
          )
        ).status,
      ).toBe(404);
      await db
        .collection("storyboards")
        .doc("storyboard-a")
        .update({ deletedAt: null });
      await db.collection("ai_jobs").doc("sheet").update({ resultJson: null });
      expect(
        (
          await request(
            "user-a",
            "GET",
            "/api/character-sheets/sheet/media-url",
          )
        ).status,
      ).toBe(404);
    });
    it("enforces session cookie CSRF and serves no arbitrary-key signing route", async () => {
      const cookie = "__Host-gen_story_session=a; __Host-gen_story_csrf=token";
      expect(
        (
          await request(
            null,
            "POST",
            "/api/projects/project-a/upload-grants",
            {},
            { Cookie: cookie },
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await request(
            null,
            "POST",
            "/api/projects/project-a/upload-grants",
            {},
            { Cookie: cookie, "X-CSRF-Token": "token" },
          )
        ).status,
      ).toBe(422);
      expect(
        (await request("user-a", "GET", "/api/media-url?key=foreign")).status,
      ).toBe(404);
    });
  },
);
