import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";

import {
  seedLocalPrincipal,
  LOCAL_USER_ID,
  LOCAL_ORGANIZATION_ID,
} from "../auth/local-auth";
import { createInMemoryApplicationDependencies } from "../test-support/in-memory-application";
import { buildRouter, handleApiRequest } from "./routes";
import { buildHealthResponse } from "../server";
import { sendJson } from "./json";

function makeServer() {
  const deps = createInMemoryApplicationDependencies();
  const router = buildRouter(deps);

  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, buildHealthResponse());
      return;
    }
    const handled = await handleApiRequest(req, res, router);
    if (!handled) {
      sendJson(res, 404, {
        error: { code: "not_found", message: "Not found." },
      });
    }
  });

  return { server, deps };
}

async function listen(server: Server): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

async function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

async function req(
  base: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

let server: Server;
let base: string;
let deps: ReturnType<typeof createInMemoryApplicationDependencies>;

beforeEach(async () => {
  const setup = makeServer();
  server = setup.server;
  deps = setup.deps;
  await seedLocalPrincipal(deps);
  base = await listen(server);
});

afterEach(async () => {
  await close(server);
});

// ---------------------------------------------------------------------------
// Health (regression guard)
// ---------------------------------------------------------------------------

describe("GET /health", () => {
  it("returns 200 ok", async () => {
    const { status, body } = await req(base, "GET", "/health");
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: "ok" });
  });
});

describe("unknown route", () => {
  it("returns 404 JSON", async () => {
    const { status, body } = await req(base, "GET", "/api/unknown-endpoint");
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: { code: "not_found" } });
  });
});

// ---------------------------------------------------------------------------
// GET /api/me
// ---------------------------------------------------------------------------

describe("GET /api/me", () => {
  it("returns the local principal", async () => {
    const { status, body } = await req(base, "GET", "/api/me");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      userId: LOCAL_USER_ID,
      organizationId: LOCAL_ORGANIZATION_ID,
    });
  });

  it("returns 401 when principal is not seeded", async () => {
    // Create a fresh server without seeding
    const { server: s2 } = makeServer();
    const b2 = await listen(s2);
    try {
      const { status } = await req(b2, "GET", "/api/me");
      expect(status).toBe(401);
    } finally {
      await close(s2);
    }
  });
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

describe("GET /api/projects", () => {
  it("returns empty list when no projects", async () => {
    const { status, body } = await req(base, "GET", "/api/projects");
    expect(status).toBe(200);
    expect(body).toMatchObject({ projects: [] });
  });
});

describe("POST /api/projects", () => {
  it("creates a project and returns 201", async () => {
    const { status, body } = await req(base, "POST", "/api/projects", {
      name: "Test Project",
    });
    expect(status).toBe(201);
    const b = body as Record<string, unknown>;
    expect(b.name).toBe("Test Project");
    expect(b.organizationId).toBe(LOCAL_ORGANIZATION_ID);
    expect(b.ownerUserId).toBe(LOCAL_USER_ID);
    expect(typeof b.id).toBe("string");
  });

  it("returns 422 when name is missing", async () => {
    const { status, body } = await req(base, "POST", "/api/projects", {});
    expect(status).toBe(422);
    expect(body).toMatchObject({ error: { code: "validation_error" } });
  });

  it("returns 400 on malformed JSON", async () => {
    const res = await fetch(`${base}/api/projects`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect(res.status).toBe(400);
  });

  it("returns 409 on duplicate project ID", async () => {
    await req(base, "POST", "/api/projects", {
      projectId: "proj-1",
      name: "A",
    });
    const { status } = await req(base, "POST", "/api/projects", {
      projectId: "proj-1",
      name: "B",
    });
    expect(status).toBe(409);
  });
});

describe("GET /api/projects/:projectId", () => {
  it("returns the project after creation", async () => {
    const created = await req(base, "POST", "/api/projects", {
      name: "Roundtrip",
    });
    const id = (created.body as Record<string, unknown>).id as string;

    const { status, body } = await req(base, "GET", `/api/projects/${id}`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ id, name: "Roundtrip" });
  });

  it("returns 404 for unknown project", async () => {
    const { status } = await req(base, "GET", "/api/projects/no-such-project");
    expect(status).toBe(404);
  });

  it("returns 403 for project in different org", async () => {
    const { createProject } = await import("@gen-story/domain");
    await deps.projects.save(
      createProject({
        id: "foreign-proj",
        organizationId: "other-org",
        ownerUserId: "other-user",
        name: "Foreign",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    );

    const { status } = await req(base, "GET", "/api/projects/foreign-proj");
    expect(status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Photo assets
// ---------------------------------------------------------------------------

describe("GET /api/projects/:projectId/photo-assets", () => {
  it("returns empty list", async () => {
    const created = await req(base, "POST", "/api/projects", { name: "P" });
    const id = (created.body as Record<string, unknown>).id as string;

    const { status, body } = await req(
      base,
      "GET",
      `/api/projects/${id}/photo-assets`,
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ photoAssets: [] });
  });
});

describe("PATCH /api/photo-assets/:photoAssetId", () => {
  it("returns 422 on invalid usage value", async () => {
    const { createPhotoAsset, createProject } =
      await import("@gen-story/domain");
    const now = new Date().toISOString();

    await deps.projects.save(
      createProject({
        id: "proj-patch",
        organizationId: LOCAL_ORGANIZATION_ID,
        ownerUserId: LOCAL_USER_ID,
        name: "Patch Project",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.photoAssets.save(
      createPhotoAsset({
        id: "photo-patch",
        projectId: "proj-patch",
        name: "test.jpg",
        storageKey: "data/uploads/test/photo-patch.jpg",
        mimeType: "image/jpeg",
        size: 100,
        checksum: "abc",
        sourceKind: "upload",
        createdAt: now,
        updatedAt: now,
      }),
    );

    const { status } = await req(
      base,
      "PATCH",
      "/api/photo-assets/photo-patch",
      {
        usage: "invalid-value",
      },
    );
    expect(status).toBe(422);
  });

  it("returns 403 for photo asset in different org", async () => {
    const { createPhotoAsset, createProject } =
      await import("@gen-story/domain");
    const now = new Date().toISOString();

    await deps.projects.save(
      createProject({
        id: "foreign-proj2",
        organizationId: "other-org",
        ownerUserId: "other-user",
        name: "Foreign",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.photoAssets.save(
      createPhotoAsset({
        id: "foreign-photo",
        projectId: "foreign-proj2",
        name: "test.jpg",
        storageKey: "data/uploads/test/foreign-photo.jpg",
        mimeType: "image/jpeg",
        size: 100,
        checksum: "xyz",
        sourceKind: "upload",
        createdAt: now,
        updatedAt: now,
      }),
    );

    const { status } = await req(
      base,
      "PATCH",
      "/api/photo-assets/foreign-photo",
      {
        usage: "candidate",
      },
    );
    expect(status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Storyboards
// ---------------------------------------------------------------------------

describe("GET /api/projects/:projectId/storyboards", () => {
  it("returns empty list", async () => {
    const created = await req(base, "POST", "/api/projects", { name: "P" });
    const id = (created.body as Record<string, unknown>).id as string;

    const { status, body } = await req(
      base,
      "GET",
      `/api/projects/${id}/storyboards`,
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({ storyboards: [] });
  });
});

describe("PUT /api/storyboards/:storyboardId", () => {
  it("creates and returns a storyboard", async () => {
    const created = await req(base, "POST", "/api/projects", {
      name: "Story Project",
    });
    const projectId = (created.body as Record<string, unknown>).id as string;

    const { status, body } = await req(base, "PUT", "/api/storyboards/sb-1", {
      projectId,
      tone: "heartwarming",
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({ id: "sb-1", projectId, tone: "heartwarming" });
  });

  it("returns 422 when tone is missing", async () => {
    const created = await req(base, "POST", "/api/projects", { name: "P2" });
    const projectId = (created.body as Record<string, unknown>).id as string;

    const { status } = await req(base, "PUT", "/api/storyboards/sb-fail", {
      projectId,
    });
    expect(status).toBe(422);
  });

  it("returns 422 when projectId is missing", async () => {
    const { status } = await req(base, "PUT", "/api/storyboards/sb-fail2", {
      tone: "sad",
    });
    expect(status).toBe(422);
  });
});

describe("GET /api/storyboards/:storyboardId/scenes and PUT scenes", () => {
  it("round-trips: PUT storyboard → PUT scenes → GET scenes", async () => {
    const created = await req(base, "POST", "/api/projects", {
      name: "Scene Test",
    });
    const projectId = (created.body as Record<string, unknown>).id as string;

    await req(base, "PUT", "/api/storyboards/sb-scene", {
      projectId,
      tone: "joyful",
    });

    const scenesPayload = {
      scenes: [
        {
          sceneId: "scene-1",
          orderIndex: 0,
          title: "Opening",
          description: "The start",
          imagePrompt: "A bright morning",
          emotion: "happy",
          cameraDirection: "wide",
          lightingDirection: "warm",
          motionDirection: "static",
        },
      ],
    };

    const putResult = await req(
      base,
      "PUT",
      "/api/storyboards/sb-scene/scenes",
      scenesPayload,
    );
    expect(putResult.status).toBe(200);

    const getResult = await req(
      base,
      "GET",
      "/api/storyboards/sb-scene/scenes",
    );
    expect(getResult.status).toBe(200);
    const scenesBody = getResult.body as {
      scenes: Array<Record<string, unknown>>;
    };
    expect(scenesBody.scenes).toHaveLength(1);
    expect(scenesBody.scenes[0]).toMatchObject({
      id: "scene-1",
      title: "Opening",
    });
  });

  it("returns 422 when scenes array is empty", async () => {
    const created = await req(base, "POST", "/api/projects", { name: "P3" });
    const projectId = (created.body as Record<string, unknown>).id as string;
    await req(base, "PUT", "/api/storyboards/sb-empty", {
      projectId,
      tone: "neutral",
    });

    const { status } = await req(
      base,
      "PUT",
      "/api/storyboards/sb-empty/scenes",
      { scenes: [] },
    );
    expect(status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// Style presets
// ---------------------------------------------------------------------------

describe("GET /api/style-presets", () => {
  it("returns empty list when no presets", async () => {
    const { status, body } = await req(base, "GET", "/api/style-presets");
    expect(status).toBe(200);
    expect(body).toMatchObject({ stylePresets: [] });
  });
});

// ---------------------------------------------------------------------------
// Generation requests (queued only)
// ---------------------------------------------------------------------------

describe("Generation requests", () => {
  it("POST creates a queued generation request", async () => {
    const { createProject, createStoryboard, createScene } =
      await import("@gen-story/domain");
    const now = new Date().toISOString();

    await deps.projects.save(
      createProject({
        id: "gen-proj",
        organizationId: LOCAL_ORGANIZATION_ID,
        ownerUserId: LOCAL_USER_ID,
        name: "Gen Project",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.storyboards.save(
      createStoryboard({
        id: "gen-sb",
        projectId: "gen-proj",
        tone: "epic",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.scenes.save(
      createScene({
        id: "gen-scene",
        projectId: "gen-proj",
        storyboardId: "gen-sb",
        orderIndex: 0,
        title: "Test",
        description: "Desc",
        imagePrompt: "Prompt",
        emotion: "calm",
        cameraDirection: "close",
        lightingDirection: "natural",
        motionDirection: "pan",
        createdAt: now,
        updatedAt: now,
      }),
    );

    const { status, body } = await req(
      base,
      "POST",
      "/api/scenes/gen-scene/generation-requests",
      { inputJson: {} },
    );

    expect(status).toBe(201);
    expect(body).toMatchObject({ sceneId: "gen-scene", status: "queued" });
  });
});

// ---------------------------------------------------------------------------
// Generation request DTO fields and adoption
// ---------------------------------------------------------------------------

describe("Generation request DTO includes startedAt and completedAt", () => {
  it("returns null startedAt and completedAt for a queued request", async () => {
    const { createProject, createStoryboard, createScene } =
      await import("@gen-story/domain");
    const now = new Date().toISOString();

    await deps.projects.save(
      createProject({
        id: "dto-proj",
        organizationId: LOCAL_ORGANIZATION_ID,
        ownerUserId: LOCAL_USER_ID,
        name: "DTO Project",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.storyboards.save(
      createStoryboard({
        id: "dto-sb",
        projectId: "dto-proj",
        tone: "cinematic",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.scenes.save(
      createScene({
        id: "dto-scene",
        projectId: "dto-proj",
        storyboardId: "dto-sb",
        orderIndex: 0,
        title: "DTO Scene",
        description: "A scene.",
        imagePrompt: "Cinematic still.",
        emotion: "calm",
        cameraDirection: "wide",
        lightingDirection: "natural",
        motionDirection: "slow pan",
        createdAt: now,
        updatedAt: now,
      }),
    );

    const { status, body } = await req(
      base,
      "POST",
      "/api/scenes/dto-scene/generation-requests",
      { inputJson: {} },
    );

    expect(status).toBe(201);
    expect(body).toMatchObject({
      status: "queued",
      startedAt: null,
      completedAt: null,
      errorMessage: null,
    });
  });
});

describe("Generated image adoption", () => {
  it("adopts a generated image and returns success", async () => {
    const {
      createProject,
      createStoryboard,
      createScene,
      createGenerationRequest,
      createGeneratedImage,
    } = await import("@gen-story/domain");
    const now = new Date().toISOString();

    await deps.projects.save(
      createProject({
        id: "adopt-proj",
        organizationId: LOCAL_ORGANIZATION_ID,
        ownerUserId: LOCAL_USER_ID,
        name: "Adopt Project",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.storyboards.save(
      createStoryboard({
        id: "adopt-sb",
        projectId: "adopt-proj",
        tone: "warm",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.scenes.save(
      createScene({
        id: "adopt-scene",
        projectId: "adopt-proj",
        storyboardId: "adopt-sb",
        orderIndex: 0,
        title: "Adopt Scene",
        description: "A scene.",
        imagePrompt: "Cinematic still.",
        emotion: "nostalgic",
        cameraDirection: "close-up",
        lightingDirection: "warm",
        motionDirection: "fade",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.generationRequests.save(
      createGenerationRequest({
        id: "adopt-req",
        projectId: "adopt-proj",
        storyboardId: "adopt-sb",
        sceneId: "adopt-scene",
        status: "succeeded",
        inputJson: {},
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.generatedImages.save(
      createGeneratedImage({
        id: "adopt-img",
        projectId: "adopt-proj",
        storyboardId: "adopt-sb",
        sceneId: "adopt-scene",
        generationRequestId: "adopt-req",
        storageKey:
          "data/uploads/generated/images/projects/adopt-proj/scenes/adopt-scene/adopt-img.jpg",
        mimeType: "image/jpeg",
        size: 1,
        width: 1,
        height: 1,
        checksum: "abc",
        createdAt: now,
        updatedAt: now,
      }),
    );

    const { status } = await req(
      base,
      "POST",
      "/api/scenes/adopt-scene/generated-images/adopt-img/adopt",
    );
    expect(status).toBe(200);

    const { body: images } = await req(
      base,
      "GET",
      "/api/scenes/adopt-scene/generated-images",
    );
    const imageList = (
      images as {
        generatedImages: Array<{ id: string; adoptedAt: string | null }>;
      }
    ).generatedImages;
    const adopted = imageList.find((i) => i.id === "adopt-img");
    expect(adopted?.adoptedAt).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Auth scoping
// ---------------------------------------------------------------------------

describe("auth scoping — 401 without principal", () => {
  it("GET /api/projects returns 401 without seeding", async () => {
    const { server: s2 } = makeServer();
    const b2 = await listen(s2);
    try {
      const { status } = await req(b2, "GET", "/api/projects");
      expect(status).toBe(401);
    } finally {
      await close(s2);
    }
  });
});
