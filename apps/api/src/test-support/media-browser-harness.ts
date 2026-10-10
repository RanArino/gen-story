import { createServer } from "node:http";
import type { AuthPrincipal } from "@gen-story/application";
import { createOrganization, createStylePreset } from "@gen-story/domain";
import { createEmulatorClient, clearEmulatorData } from "./firestore-emulator";
import { seedMedia, mediaNow } from "./private-media-fixture";
import { createSignedStorageFixture, listen } from "./signed-storage-fixture";
import { createFirestoreRepositories } from "../firestore/repositories";
import { FirestoreUploadSessionRepository } from "../firestore/upload-session-repository";
import { PrivateMediaService } from "../media/media-service";
import { createInMemoryApplicationDependencies } from "./in-memory-application";
import { PrincipalAuthContext } from "../auth/principal-auth-context";
import { buildHostedRouter } from "../http/routes";
import { makeHandleRequest } from "../server";
import { executeUploadCompletion } from "../photos/complete-upload";
import { LinuxContainerImageDecoder } from "../photos/bounded-image-decoder";
import { parseCookieHeader } from "../auth/firebase-auth";

export async function createMediaBrowserHarness() {
  await clearEmulatorData();
  const db = createEmulatorClient();
  await seedMedia(db);
  await db
    .collection("style_presets")
    .doc("fixture-style")
    .set(
      createStylePreset({
        id: "fixture-style",
        scope: "system",
        name: "Fixture style",
        description: "Synthetic fixture",
        prompt: "Warm colors",
        createdAt: mediaNow,
        updatedAt: mediaNow,
      }),
    );
  let now = new Date();
  const clock = () => now;
  const fixture = await createSignedStorageFixture(clock);
  const sessions = new FirestoreUploadSessionRepository(db);
  const media = new PrivateMediaService(db, sessions, fixture.grants, clock);
  const deps = {
    ...createInMemoryApplicationDependencies(),
    ...createFirestoreRepositories(db),
  };
  const router = buildHostedRouter(
    deps,
    async (req, routeIdentity) => {
      const userId =
        parseCookieHeader(req.headers.cookie).get("fixture-principal") === "b"
          ? "user-b"
          : parseCookieHeader(req.headers.cookie).get("fixture-principal") ===
              "a"
            ? "user-a"
            : null;
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
  const handle = makeHandleRequest(router);
  let javascript = "";
  let css = "";
  const inflight = new Set<Promise<void>>();
  const oldOrigins = process.env.CORS_ORIGINS;
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    if (req.url === "/fixture.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(javascript);
      return;
    }
    if (req.url === "/fixture.css") {
      res.setHeader("Content-Type", "text/css");
      res.end(css);
      return;
    }
    if (req.url === "/api/auth/csrf") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ csrfToken: "isolated-fixture-token" }));
      return;
    }
    if (!req.url?.startsWith("/api/")) {
      res.setHeader("Content-Type", "text/html");
      res.end(
        '<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
      );
      return;
    }
    const request = handle(req, res);
    inflight.add(request);
    void request.finally(() => inflight.delete(request));
  });
  const origin = await listen(server);
  process.env.CORS_ORIGINS = origin;
  const buildPath = new URL(
    "../../../web/e2e/media-fixture/build.mjs",
    import.meta.url,
  ).href;
  const { bundleMediaFixture } = (await import(buildPath)) as {
    bundleMediaFixture(
      origin: string,
    ): Promise<{ outputFiles: { path: string; text: string }[] }>;
  };
  const bundle = await bundleMediaFixture(origin);
  javascript = bundle.outputFiles.find((file) =>
    file.path.endsWith(".js"),
  )!.text;
  css =
    bundle.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
  return {
    db,
    origin,
    storageOrigin: fixture.origin,
    requests: fixture.requests,
    async pending() {
      return (await db.collection("upload_sessions").get()).docs
        .filter((doc) => doc.data().status === "processing")
        .map((doc) => doc.id);
    },
    async complete(id: string) {
      return executeUploadCompletion({
        uploadId: id,
        executorId: "browser-fixture",
        sessions,
        storage: fixture.storage,
        decoder: new LinuxContainerImageDecoder(),
        clock,
      });
    },
    expireReads() {
      now = new Date(now.getTime() + 301_000);
    },
    async close() {
      server.closeAllConnections();
      if (oldOrigins == null) delete process.env.CORS_ORIGINS;
      else process.env.CORS_ORIGINS = oldOrigins;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await Promise.allSettled([...inflight]);
      await fixture.close();
      await db.terminate();
    },
  };
}
