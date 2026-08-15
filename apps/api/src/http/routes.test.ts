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

  // A storyboard with no tone yet is the normal starting state of the guided
  // setup flow, not a validation error: step 2 is what fills it in.
  it("creates a storyboard with an undecided tone when none is sent", async () => {
    const created = await req(base, "POST", "/api/projects", { name: "P2" });
    const projectId = (created.body as Record<string, unknown>).id as string;

    const { status, body } = await req(base, "PUT", "/api/storyboards/sb-new", {
      projectId,
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({
      tone: "",
      setupStep: "photos",
      setupCompletedAt: null,
    });
  });

  it("returns 422 when projectId is missing", async () => {
    const { status } = await req(base, "PUT", "/api/storyboards/sb-fail2", {
      tone: "sad",
    });
    expect(status).toBe(422);
  });
});

describe("character reference sheet routes", () => {
  it("queues and returns the current sheet job for a featured storyboard", async () => {
    await req(base, "POST", "/api/projects", {
      projectId: "sheet-project",
      name: "Character Story",
    });
    await req(base, "PUT", "/api/storyboards/sheet-storyboard", {
      projectId: "sheet-project",
      characterPolicy: "featured",
    });

    const queued = await req(
      base,
      "POST",
      "/api/storyboards/sheet-storyboard/character-reference-sheet",
    );
    expect(queued.status).toBe(202);
    expect(queued.body).toMatchObject({
      storyboardId: "sheet-storyboard",
      status: "queued",
    });

    const current = await req(
      base,
      "GET",
      "/api/storyboards/sheet-storyboard/character-reference-sheet",
    );
    expect(current.status).toBe(200);
    expect(current.body).toMatchObject({
      characterReferenceSheet: {
        storyboardId: "sheet-storyboard",
        status: "queued",
      },
    });
  });

  it("rejects generation when the storyboard is not featured", async () => {
    await req(base, "POST", "/api/projects", {
      projectId: "sheet-policy-project",
      name: "Landscape Story",
    });
    await req(base, "PUT", "/api/storyboards/sheet-policy-storyboard", {
      projectId: "sheet-policy-project",
    });

    const result = await req(
      base,
      "POST",
      "/api/storyboards/sheet-policy-storyboard/character-reference-sheet",
    );
    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({
      error: { code: "invalid_state" },
    });
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

describe("POST /api/storyboards/:storyboardId/complement-scenes", () => {
  async function seedTwoScenes() {
    const created = await req(base, "POST", "/api/projects", {
      name: "Complement Test",
    });
    const projectId = (created.body as Record<string, unknown>).id as string;
    await req(base, "PUT", "/api/storyboards/sb-comp", {
      projectId,
      tone: "warm",
    });
    await req(base, "PUT", "/api/storyboards/sb-comp/scenes", {
      scenes: [
        {
          sceneId: "scene-a",
          orderIndex: 0,
          title: "Opening",
          description: "The start",
          imagePrompt: "A bright morning",
          emotion: "happy",
          cameraDirection: "wide",
          lightingDirection: "warm",
          motionDirection: "static",
        },
        {
          sceneId: "scene-b",
          orderIndex: 1,
          title: "Ending",
          description: "The close",
          imagePrompt: "A quiet evening",
          emotion: "calm",
          cameraDirection: "close",
          lightingDirection: "soft",
          motionDirection: "static",
        },
      ],
    });
  }

  it("inserts a complement scene between two adjacent scenes", async () => {
    await seedTwoScenes();

    const result = await req(
      base,
      "POST",
      "/api/storyboards/sb-comp/complement-scenes",
      { fromSceneId: "scene-a", toSceneId: "scene-b" },
    );
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      kind: "complement",
      bridge: { fromSceneId: "scene-a", toSceneId: "scene-b" },
    });

    const getResult = await req(base, "GET", "/api/storyboards/sb-comp/scenes");
    const scenesBody = getResult.body as {
      scenes: Array<Record<string, unknown>>;
    };
    expect(scenesBody.scenes).toHaveLength(3);
  });

  it("returns AI complement-scene proposals", async () => {
    await seedTwoScenes();

    const result = await req(
      base,
      "POST",
      "/api/storyboards/sb-comp/complement-scenes/proposals",
      { fromSceneId: "scene-a", toSceneId: "scene-b" },
    );
    expect(result.status).toBe(202);
    const { jobId } = result.body as { jobId: string };
    expect(jobId).toBeTruthy();

    const job = await deps.aiJobs.findById(jobId);
    expect(job?.kind).toBe("complement_scene_proposals");

    const { runComplementSceneProposalsJob } =
      await import("@gen-story/application");
    const run = await runComplementSceneProposalsJob(deps, job!);
    expect(run.ok).toBe(true);
    if (run.ok) {
      expect((run.value.proposals as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it("deletes a scene via DELETE /api/scenes/:sceneId", async () => {
    await seedTwoScenes();

    // Raw fetch, not `req`: a 204 has no body for `req` to parse.
    const deleted = await fetch(`${base}/api/scenes/scene-a`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(204);

    const listed = await req(base, "GET", "/api/storyboards/sb-comp/scenes");
    const body = listed.body as { scenes: Array<{ id: string }> };
    expect(body.scenes.map((scene) => scene.id)).toEqual(["scene-b"]);

    // The surviving scene closes the order-index gap so a later reorder — which
    // requires a complete list — stays valid.
    const reordered = await req(
      base,
      "PUT",
      "/api/storyboards/sb-comp/scene-order",
      { sceneIds: ["scene-b"] },
    );
    expect(reordered.status).toBe(200);
  });

  it("deletes every scene via DELETE /api/storyboards/:storyboardId/scenes", async () => {
    await seedTwoScenes();

    const deleted = await req(
      base,
      "DELETE",
      "/api/storyboards/sb-comp/scenes",
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ deletedCount: 2 });

    const listed = await req(base, "GET", "/api/storyboards/sb-comp/scenes");
    expect((listed.body as { scenes: unknown[] }).scenes).toEqual([]);
  });

  it("deletes only the scenes with blank fields when scope=unfilled", async () => {
    await seedTwoScenes();
    // A third scene left blank, the way a template scene arrives before AI fill.
    await req(base, "PUT", "/api/storyboards/sb-comp/scenes", {
      scenes: [
        {
          sceneId: "scene-blank",
          orderIndex: 2,
          title: "",
          description: "",
          imagePrompt: "",
          emotion: "",
          cameraDirection: "",
          lightingDirection: "",
          motionDirection: "",
        },
      ],
    });

    const deleted = await req(
      base,
      "DELETE",
      "/api/storyboards/sb-comp/scenes?scope=unfilled",
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body).toEqual({ deletedCount: 1 });

    const listed = await req(base, "GET", "/api/storyboards/sb-comp/scenes");
    const body = listed.body as { scenes: Array<{ id: string }> };
    expect(body.scenes.map((scene) => scene.id)).toEqual([
      "scene-a",
      "scene-b",
    ]);
  });

  it("rejects an unknown bulk-delete scope", async () => {
    await seedTwoScenes();

    const result = await req(
      base,
      "DELETE",
      "/api/storyboards/sb-comp/scenes?scope=everything",
    );
    expect(result.status).toBe(422);
  });

  it("returns 404 when deleting an unknown scene", async () => {
    const result = await req(base, "DELETE", "/api/scenes/no-such-scene");
    expect(result.status).toBe(404);
  });

  it("reorders scenes via PUT /scene-order", async () => {
    await seedTwoScenes();

    const result = await req(
      base,
      "PUT",
      "/api/storyboards/sb-comp/scene-order",
      { sceneIds: ["scene-b", "scene-a"] },
    );
    expect(result.status).toBe(200);
    const body = result.body as { scenes: Array<{ id: string }> };
    expect(body.scenes.map((scene) => scene.id)).toEqual([
      "scene-b",
      "scene-a",
    ]);
  });
});

describe("POST /api/scenes/:sceneId/ai-fill", () => {
  it("fills an authorized scene and returns the updated scene DTO", async () => {
    const {
      createPhotoAsset,
      createProject,
      createStoryboard,
      createTemplateScene,
    } = await import("@gen-story/domain");
    const now = new Date().toISOString();

    await deps.projects.save(
      createProject({
        id: "ai-proj",
        organizationId: LOCAL_ORGANIZATION_ID,
        ownerUserId: LOCAL_USER_ID,
        name: "AI Project",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.storyboards.save(
      createStoryboard({
        id: "ai-sb",
        projectId: "ai-proj",
        tone: "warm",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.photoAssets.save(
      createPhotoAsset({
        id: "ai-photo",
        projectId: "ai-proj",
        name: "family.jpg",
        storageKey: "photos/family.jpg",
        mimeType: "image/jpeg",
        size: 1,
        checksum: "ai-photo-checksum",
        sourceKind: "upload",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.scenes.save(
      createTemplateScene({
        id: "ai-scene",
        projectId: "ai-proj",
        storyboardId: "ai-sb",
        orderIndex: 0,
        photoAssetId: "ai-photo",
        createdAt: now,
        updatedAt: now,
      }),
    );

    const { status, body } = await req(
      base,
      "POST",
      "/api/scenes/ai-scene/ai-fill",
      {},
    );

    // The AI call now runs in the background; the route returns a job handle.
    expect(status).toBe(202);
    const { jobId } = body as { jobId: string; scene: null };
    expect(jobId).toBeTruthy();

    const job = await deps.aiJobs.findById(jobId);
    expect(job?.kind).toBe("scene_ai_fill");
    expect(job?.status).toBe("queued");

    const { runSceneAiFillJob } = await import("@gen-story/application");
    const run = await runSceneAiFillJob(deps, job!);
    expect(run.ok).toBe(true);

    const scene = await deps.scenes.findById("ai-scene");
    expect(scene).toMatchObject({
      id: "ai-scene",
      title: "AI family.jpg",
      description: "AI description for family.jpg",
      imagePrompt: "AI image prompt for family.jpg",
    });
  });

  it("returns 403 for a scene in another organization", async () => {
    const { createProject, createTemplateScene, createStoryboard } =
      await import("@gen-story/domain");
    const now = new Date().toISOString();

    await deps.projects.save(
      createProject({
        id: "foreign-ai-proj",
        organizationId: "other-org",
        ownerUserId: "other-user",
        name: "Foreign AI",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.storyboards.save(
      createStoryboard({
        id: "foreign-ai-sb",
        projectId: "foreign-ai-proj",
        tone: "warm",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.scenes.save(
      createTemplateScene({
        id: "foreign-ai-scene",
        projectId: "foreign-ai-proj",
        storyboardId: "foreign-ai-sb",
        orderIndex: 0,
        createdAt: now,
        updatedAt: now,
      }),
    );

    const { status } = await req(
      base,
      "POST",
      "/api/scenes/foreign-ai-scene/ai-fill",
      {},
    );

    expect(status).toBe(403);
  });

  it("returns 422 when the scene has no primary photo", async () => {
    const { createProject, createTemplateScene, createStoryboard } =
      await import("@gen-story/domain");
    const now = new Date().toISOString();

    await deps.projects.save(
      createProject({
        id: "no-photo-ai-proj",
        organizationId: LOCAL_ORGANIZATION_ID,
        ownerUserId: LOCAL_USER_ID,
        name: "No Photo AI",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.storyboards.save(
      createStoryboard({
        id: "no-photo-ai-sb",
        projectId: "no-photo-ai-proj",
        tone: "warm",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.scenes.save(
      createTemplateScene({
        id: "no-photo-ai-scene",
        projectId: "no-photo-ai-proj",
        storyboardId: "no-photo-ai-sb",
        orderIndex: 0,
        createdAt: now,
        updatedAt: now,
      }),
    );

    const { status, body } = await req(
      base,
      "POST",
      "/api/scenes/no-photo-ai-scene/ai-fill",
      {},
    );

    expect(status).toBe(422);
    expect(body).toMatchObject({ error: { code: "validation_error" } });
  });

  it("returns 404 for an unknown scene", async () => {
    const { status } = await req(
      base,
      "POST",
      "/api/scenes/missing-ai-scene/ai-fill",
      {},
    );

    expect(status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Guided storyboard setup
// ---------------------------------------------------------------------------

describe("guided storyboard setup routes", () => {
  async function seedSetupStoryboard(options?: {
    idPrefix?: string;
    organizationId?: string;
    ownerUserId?: string;
    tone?: string;
    stylePresetId?: string | null;
  }) {
    const {
      createPhotoAsset,
      createProject,
      createStylePreset,
      createStoryboard,
      createTemplateScene,
    } = await import("@gen-story/domain");
    const now = new Date().toISOString();
    const prefix = options?.idPrefix ?? "setup";

    await deps.stylePresets.save(
      createStylePreset({
        id: `${prefix}-style`,
        scope: "system",
        name: "Cinematic",
        prompt: "Filmic contrast.",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.projects.save(
      createProject({
        id: `${prefix}-proj`,
        organizationId: options?.organizationId ?? LOCAL_ORGANIZATION_ID,
        ownerUserId: options?.ownerUserId ?? LOCAL_USER_ID,
        name: "Setup Project",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.storyboards.save(
      createStoryboard({
        id: `${prefix}-sb`,
        projectId: `${prefix}-proj`,
        tone: options?.tone ?? "warm_nostalgia",
        stylePresetId:
          options?.stylePresetId === undefined
            ? `${prefix}-style`
            : options.stylePresetId,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.photoAssets.save(
      createPhotoAsset({
        id: `${prefix}-photo`,
        projectId: `${prefix}-proj`,
        name: "family.jpg",
        storageKey: "photos/family.jpg",
        mimeType: "image/jpeg",
        size: 1,
        checksum: `${prefix}-photo-checksum`,
        sourceKind: "upload",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.scenes.save(
      createTemplateScene({
        id: `${prefix}-scene`,
        projectId: `${prefix}-proj`,
        storyboardId: `${prefix}-sb`,
        orderIndex: 0,
        photoAssetId: `${prefix}-photo`,
        createdAt: now,
        updatedAt: now,
      }),
    );

    return prefix;
  }

  it("returns 202 with a job handle for story setup", async () => {
    const prefix = await seedSetupStoryboard({ idPrefix: "story-ok" });

    const { status, body } = await req(
      base,
      "POST",
      `/api/storyboards/${prefix}-sb/story-setup`,
      {},
    );

    expect(status).toBe(202);
    const { jobId } = body as { jobId: string };
    expect(jobId).toBeTruthy();

    const job = await deps.aiJobs.findById(jobId);
    expect(job?.kind).toBe("story_setup");
    expect(job?.status).toBe("queued");
  });

  it("rejects story setup before a tone is chosen", async () => {
    const prefix = await seedSetupStoryboard({
      idPrefix: "story-no-tone",
      tone: "",
    });

    const { status } = await req(
      base,
      "POST",
      `/api/storyboards/${prefix}-sb/story-setup`,
      {},
    );

    expect(status).toBe(422);
  });

  it("returns 403 for story setup on a storyboard in another organization", async () => {
    const prefix = await seedSetupStoryboard({
      idPrefix: "story-foreign",
      organizationId: "other-org",
      ownerUserId: "other-user",
    });

    const { status } = await req(
      base,
      "POST",
      `/api/storyboards/${prefix}-sb/story-setup`,
      {},
    );

    expect(status).toBe(403);
  });

  it("returns 202 with one bulk fill job per blank scene", async () => {
    const prefix = await seedSetupStoryboard({ idPrefix: "bulk-ok" });

    const { status, body } = await req(
      base,
      "POST",
      `/api/storyboards/${prefix}-sb/scenes/ai-fill`,
      {},
    );

    expect(status).toBe(202);
    const { aiJobIds, skippedSceneCount } = body as {
      aiJobIds: string[];
      skippedSceneCount: number;
    };
    expect(aiJobIds).toHaveLength(1);
    expect(skippedSceneCount).toBe(0);

    const job = await deps.aiJobs.findById(aiJobIds[0]!);
    expect(job?.kind).toBe("scene_ai_fill");
  });

  it("returns 403 for bulk fill on a storyboard in another organization", async () => {
    const prefix = await seedSetupStoryboard({
      idPrefix: "bulk-foreign",
      organizationId: "other-org",
      ownerUserId: "other-user",
    });

    const { status } = await req(
      base,
      "POST",
      `/api/storyboards/${prefix}-sb/scenes/ai-fill`,
      {},
    );

    expect(status).toBe(403);
  });

  it("reports the derived setup step on the storyboard DTO", async () => {
    const prefix = await seedSetupStoryboard({ idPrefix: "step-dto" });

    const { status, body } = await req(
      base,
      "GET",
      `/api/projects/${prefix}-proj/storyboards`,
    );

    expect(status).toBe(200);
    const { storyboards } = body as {
      storyboards: Array<{
        setupStep: string;
        setupCompletedAt: string | null;
      }>;
    };
    // Photos, tone and style are set; the story has not been written yet.
    expect(storyboards[0]).toMatchObject({
      setupStep: "story",
      setupCompletedAt: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Composed-prompt preview
// ---------------------------------------------------------------------------

describe("POST /api/scenes/:sceneId/preview-prompt", () => {
  async function seedPreviewScene(options?: {
    organizationId?: string;
    ownerUserId?: string;
    storyboardNegativePrompt?: string;
    sceneNegativePrompt?: string;
    idPrefix?: string;
  }) {
    const { createProject, createScene, createStoryboard } =
      await import("@gen-story/domain");
    const now = new Date().toISOString();
    const prefix = options?.idPrefix ?? "pv";

    await deps.projects.save(
      createProject({
        id: `${prefix}-proj`,
        organizationId: options?.organizationId ?? LOCAL_ORGANIZATION_ID,
        ownerUserId: options?.ownerUserId ?? LOCAL_USER_ID,
        name: "Preview Project",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.storyboards.save(
      createStoryboard({
        id: `${prefix}-sb`,
        projectId: `${prefix}-proj`,
        tone: "warm",
        negativePrompt: options?.storyboardNegativePrompt ?? "",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.scenes.save(
      createScene({
        id: `${prefix}-scene`,
        projectId: `${prefix}-proj`,
        storyboardId: `${prefix}-sb`,
        orderIndex: 0,
        title: "Beach day",
        description: "A warm afternoon",
        imagePrompt: "a family at the beach",
        emotion: "Joy",
        cameraDirection: "Medium",
        lightingDirection: "Natural",
        motionDirection: "",
        negativePrompt: options?.sceneNegativePrompt ?? "",
        createdAt: now,
        updatedAt: now,
      }),
    );
    return `${prefix}-scene`;
  }

  it("returns the composed prompt and base negative for a persisted scene", async () => {
    const sceneId = await seedPreviewScene();

    const { status, body } = await req(
      base,
      "POST",
      `/api/scenes/${sceneId}/preview-prompt`,
      {},
    );

    expect(status).toBe(200);
    const result = body as { prompt: string; negativePrompt: string };
    expect(result.prompt).toContain("a family at the beach");
    // Base floor is always injected and folded into the prompt as `avoid: …`.
    expect(result.negativePrompt).toContain("watermark");
    expect(result.negativePrompt).toContain("deformed hands");
    expect(result.prompt).toContain("avoid: ");
    expect(result.prompt).toContain("watermark");
  });

  it("reflects an unsaved imagePrompt override", async () => {
    const sceneId = await seedPreviewScene({ idPrefix: "pv-ov" });

    const { status, body } = await req(
      base,
      "POST",
      `/api/scenes/${sceneId}/preview-prompt`,
      { imagePrompt: "a dog running in the park" },
    );

    expect(status).toBe(200);
    const result = body as { prompt: string; negativePrompt: string };
    expect(result.prompt).toContain("a dog running in the park");
    expect(result.prompt).not.toContain("a family at the beach");
  });

  it("merges a projectNegativePrompt override into the avoid clause", async () => {
    const sceneId = await seedPreviewScene({ idPrefix: "pv-neg" });

    const { status, body } = await req(
      base,
      "POST",
      `/api/scenes/${sceneId}/preview-prompt`,
      { projectNegativePrompt: "no balloons" },
    );

    expect(status).toBe(200);
    const result = body as { prompt: string; negativePrompt: string };
    expect(result.negativePrompt).toContain("no balloons");
    expect(result.negativePrompt).toContain("watermark");
    expect(result.prompt).toMatch(/avoid: .*no balloons/);
  });

  it("returns 404 for an unknown scene", async () => {
    const { status } = await req(
      base,
      "POST",
      "/api/scenes/missing-preview-scene/preview-prompt",
      {},
    );

    expect(status).toBe(404);
  });

  it("returns 403 for a scene in another organization", async () => {
    const sceneId = await seedPreviewScene({
      organizationId: "other-org",
      ownerUserId: "other-user",
      idPrefix: "pv-foreign",
    });

    const { status } = await req(
      base,
      "POST",
      `/api/scenes/${sceneId}/preview-prompt`,
      {},
    );

    expect(status).toBe(403);
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

describe("POST /api/style-presets", () => {
  it("creates a custom style preset", async () => {
    const { status, body } = await req(base, "POST", "/api/style-presets", {
      name: "Vintage Film",
      description: "Soft grain and faded color.",
      prompt: "Warm film stock with gentle halation.",
    });

    expect(status).toBe(201);
    expect(body).toMatchObject({
      stylePreset: {
        scope: "user",
        name: "Vintage Film",
        description: "Soft grain and faded color.",
        prompt: "Warm film stock with gentle halation.",
        previewImageUrl: null,
      },
    });

    const presetId = (body as { stylePreset: { id: string } }).stylePreset.id;
    await expect(deps.stylePresets.findById(presetId)).resolves.toMatchObject({
      scope: "user",
      name: "Vintage Film",
    });
  });

  it("validates required custom style fields", async () => {
    const { status, body } = await req(base, "POST", "/api/style-presets", {
      name: "",
      description: "",
      prompt: "",
    });

    expect(status).toBe(422);
    expect(body).toMatchObject({ error: { code: "validation_error" } });
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

describe("project photo analysis routes", () => {
  it("returns null before analysis", async () => {
    const { createProject } = await import("@gen-story/domain");
    const now = new Date().toISOString();
    await deps.projects.save(
      createProject({
        id: "analysis-proj",
        organizationId: LOCAL_ORGANIZATION_ID,
        ownerUserId: LOCAL_USER_ID,
        name: "Analysis Project",
        createdAt: now,
        updatedAt: now,
      }),
    );

    const { status, body } = await req(
      base,
      "GET",
      "/api/projects/analysis-proj/photo-analysis",
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ photoAnalysis: null });
  });

  it("runs and fetches persisted photo analysis", async () => {
    const { createPhotoAsset, createProject } =
      await import("@gen-story/domain");
    const now = new Date().toISOString();
    await deps.projects.save(
      createProject({
        id: "analysis-proj",
        organizationId: LOCAL_ORGANIZATION_ID,
        ownerUserId: LOCAL_USER_ID,
        name: "Analysis Project",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.photoAssets.save(
      createPhotoAsset({
        id: "analysis-photo",
        projectId: "analysis-proj",
        name: "family.jpg",
        storageKey: "family.jpg",
        mimeType: "image/jpeg",
        size: 1,
        checksum: "checksum",
        sourceKind: "upload",
        createdAt: now,
        updatedAt: now,
      }),
    );

    const created = await req(
      base,
      "POST",
      "/api/projects/analysis-proj/photo-analysis",
      {},
    );

    expect(created.status).toBe(202);
    const { jobId, cached } = created.body as {
      jobId: string;
      cached: boolean;
    };
    expect(cached).toBe(false);

    const job = await deps.aiJobs.findById(jobId);
    expect(job?.kind).toBe("photo_analysis");

    const { runPhotoAnalysisJob } = await import("@gen-story/application");
    const run = await runPhotoAnalysisJob(deps, job!);
    expect(run.ok).toBe(true);

    const fetched = await req(
      base,
      "GET",
      "/api/projects/analysis-proj/photo-analysis",
    );
    expect(fetched.status).toBe(200);
    expect(fetched.body).toMatchObject({
      photoAnalysis: {
        projectId: "analysis-proj",
        model: "in-memory",
      },
    });
  });

  it("rejects non-empty analysis request bodies", async () => {
    const { createProject } = await import("@gen-story/domain");
    const now = new Date().toISOString();
    await deps.projects.save(
      createProject({
        id: "analysis-proj",
        organizationId: LOCAL_ORGANIZATION_ID,
        ownerUserId: LOCAL_USER_ID,
        name: "Analysis Project",
        createdAt: now,
        updatedAt: now,
      }),
    );

    const { status } = await req(
      base,
      "POST",
      "/api/projects/analysis-proj/photo-analysis",
      { unexpected: true },
    );

    expect(status).toBe(422);
  });

  it("returns 403 for another organization's analysis project", async () => {
    const { createProject } = await import("@gen-story/domain");
    const now = new Date().toISOString();
    await deps.projects.save(
      createProject({
        id: "foreign-analysis-proj",
        organizationId: "other-org",
        ownerUserId: "other-user",
        name: "Foreign",
        createdAt: now,
        updatedAt: now,
      }),
    );

    const { status } = await req(
      base,
      "GET",
      "/api/projects/foreign-analysis-proj/photo-analysis",
    );

    expect(status).toBe(403);
  });

  it("returns 401 without principal", async () => {
    const { server: s2 } = makeServer();
    const b2 = await listen(s2);
    try {
      const { status } = await req(
        b2,
        "GET",
        "/api/projects/analysis-proj/photo-analysis",
      );
      expect(status).toBe(401);
    } finally {
      await close(s2);
    }
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

describe("POST /api/storyboards/:id/test-generation/variants/:vid/adjustments", () => {
  async function seedVariant() {
    const {
      createProject,
      createStoryboard,
      createScene,
      createGenerationRequest,
      createTestGenerationBatch,
    } = await import("@gen-story/domain");
    const now = new Date().toISOString();

    await deps.projects.save(
      createProject({
        id: "adj-proj",
        organizationId: LOCAL_ORGANIZATION_ID,
        ownerUserId: LOCAL_USER_ID,
        name: "Adjustment Project",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.storyboards.save(
      createStoryboard({
        id: "adj-sb",
        projectId: "adj-proj",
        tone: "cinematic",
        commonPrompt: "Base common prompt.",
        createdAt: now,
        updatedAt: now,
      }),
    );
    await deps.scenes.save(
      createScene({
        id: "adj-scene",
        projectId: "adj-proj",
        storyboardId: "adj-sb",
        orderIndex: 0,
        title: "T",
        description: "D",
        imagePrompt: "P",
        emotion: "calm",
        cameraDirection: "wide",
        lightingDirection: "natural",
        motionDirection: "slow pan",
        createdAt: now,
        updatedAt: now,
      }),
    );
    const batch = createTestGenerationBatch({
      id: "adj-batch",
      storyboardId: "adj-sb",
      status: "pending",
      createdAt: now,
    });
    await deps.testGenerationBatches.save(batch);
    const variant = createGenerationRequest({
      id: "adj-variant",
      projectId: "adj-proj",
      storyboardId: "adj-sb",
      sceneId: "adj-scene",
      inputJson: { testBatchId: batch.id, testVariant: 0 },
      createdAt: now,
      updatedAt: now,
    });
    await deps.generationRequests.save(variant);
  }

  it("happy path: applies one adjustment and returns 200", async () => {
    await seedVariant();
    const { status, body } = await req(
      base,
      "POST",
      "/api/storyboards/adj-sb/test-generation/variants/adj-variant/adjustments",
      { adjustmentIds: ["warmer"] },
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      generationRequest: {
        status: "queued",
        appliedAdjustments: ["warmer"],
        sourceGenerationRequestId: "adj-variant",
      },
    });
  });

  it("returns 422 when more than 3 adjustments are given", async () => {
    await seedVariant();
    const { status } = await req(
      base,
      "POST",
      "/api/storyboards/adj-sb/test-generation/variants/adj-variant/adjustments",
      {
        adjustmentIds: ["warmer", "cooler", "darker", "brighter"],
      },
    );
    expect(status).toBe(422);
  });

  it("returns 422 for unknown adjustment id", async () => {
    await seedVariant();
    const { status } = await req(
      base,
      "POST",
      "/api/storyboards/adj-sb/test-generation/variants/adj-variant/adjustments",
      { adjustmentIds: ["not_real"] },
    );
    expect(status).toBe(422);
  });

  it("returns 404 when variant is missing", async () => {
    await seedVariant();
    const { status } = await req(
      base,
      "POST",
      "/api/storyboards/adj-sb/test-generation/variants/missing/adjustments",
      { adjustmentIds: ["warmer"] },
    );
    expect(status).toBe(404);
  });

  it("accepts an empty array (no-op restoring base commonPrompt)", async () => {
    await seedVariant();
    const { status, body } = await req(
      base,
      "POST",
      "/api/storyboards/adj-sb/test-generation/variants/adj-variant/adjustments",
      { adjustmentIds: [] },
    );
    expect(status).toBe(200);
    expect(body).toMatchObject({
      generationRequest: { appliedAdjustments: [] },
    });
  });
});

describe("GET /api/storyboards/:storyboardId/test-generation/batches", () => {
  async function seedHistory() {
    const {
      createProject,
      createStoryboard,
      createScene,
      createGenerationRequest,
      createGeneratedImage,
      createTestGenerationBatch,
    } = await import("@gen-story/domain");

    await deps.projects.save(
      createProject({
        id: "hist-proj",
        organizationId: LOCAL_ORGANIZATION_ID,
        ownerUserId: LOCAL_USER_ID,
        name: "History Project",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      }),
    );
    await deps.storyboards.save(
      createStoryboard({
        id: "hist-sb",
        projectId: "hist-proj",
        tone: "warm",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      }),
    );
    await deps.scenes.save(
      createScene({
        id: "hist-scene",
        projectId: "hist-proj",
        storyboardId: "hist-sb",
        orderIndex: 0,
        title: "T",
        description: "D",
        imagePrompt: "P",
        emotion: "calm",
        cameraDirection: "wide",
        lightingDirection: "natural",
        motionDirection: "still",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      }),
    );

    for (const [batchId, at] of [
      ["hist-old", "2026-07-01T00:00:00.000Z"],
      ["hist-new", "2026-07-02T00:00:00.000Z"],
    ] as const) {
      await deps.testGenerationBatches.save(
        createTestGenerationBatch({
          id: batchId,
          storyboardId: "hist-sb",
          status: "pending",
          createdAt: at,
        }),
      );
      // Descending variant order on save, so the response ordering is a real
      // assertion rather than an accident of insertion order.
      for (const variantIndex of [2, 1, 0]) {
        const requestId = `${batchId}-v${variantIndex}`;
        await deps.generationRequests.save(
          createGenerationRequest({
            id: requestId,
            projectId: "hist-proj",
            storyboardId: "hist-sb",
            sceneId: "hist-scene",
            status: "succeeded",
            inputJson: { testBatchId: batchId, testVariant: variantIndex },
            testGenerationBatchId: batchId,
            createdAt: at,
            updatedAt: at,
          }),
        );
        await deps.generatedImages.save(
          createGeneratedImage({
            id: `img-${requestId}`,
            projectId: "hist-proj",
            storyboardId: "hist-sb",
            sceneId: "hist-scene",
            generationRequestId: requestId,
            storageKey: `data/uploads/generated/${requestId}.jpg`,
            mimeType: "image/jpeg",
            size: 1,
            checksum: requestId,
            createdAt: at,
            updatedAt: at,
          }),
        );
      }
    }
  }

  it("returns every batch newest first with its samples and images", async () => {
    await seedHistory();

    const { status, body } = await req(
      base,
      "GET",
      "/api/storyboards/hist-sb/test-generation/batches",
    );

    expect(status).toBe(200);
    const batches = (body as { batches: Array<Record<string, never>> }).batches;
    expect(batches).toHaveLength(2);

    const asIds = batches.map(
      (entry) => (entry as unknown as { batch: { id: string } }).batch.id,
    );
    expect(asIds).toEqual(["hist-new", "hist-old"]);

    const newest = batches[0] as unknown as {
      variants: Array<{
        request: { id: string };
        generatedImage: { storageKey: string } | null;
      }>;
    };
    expect(newest.variants.map((variant) => variant.request.id)).toEqual([
      "hist-new-v0",
      "hist-new-v1",
      "hist-new-v2",
    ]);
    expect(newest.variants[0]!.generatedImage?.storageKey).toBe(
      "data/uploads/generated/hist-new-v0.jpg",
    );
  });

  it("returns an empty list for a storyboard that has no batches", async () => {
    const { createProject, createStoryboard } =
      await import("@gen-story/domain");
    await deps.projects.save(
      createProject({
        id: "hist-empty-proj",
        organizationId: LOCAL_ORGANIZATION_ID,
        ownerUserId: LOCAL_USER_ID,
        name: "Empty",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      }),
    );
    await deps.storyboards.save(
      createStoryboard({
        id: "hist-empty-sb",
        projectId: "hist-empty-proj",
        tone: "warm",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      }),
    );

    const { status, body } = await req(
      base,
      "GET",
      "/api/storyboards/hist-empty-sb/test-generation/batches",
    );

    expect(status).toBe(200);
    expect(body).toEqual({ batches: [] });
  });

  it("returns 404 for an unknown storyboard", async () => {
    const { status } = await req(
      base,
      "GET",
      "/api/storyboards/nope/test-generation/batches",
    );
    expect(status).toBe(404);
  });
});

// Samples are generated from the storyboard's first scene, so before this
// filter every rejected sample sat in that scene's history and in its image
// list, burying the scene's real generations.
describe("test-generation samples in scene history", () => {
  async function seedSceneWithSamples() {
    const {
      createProject,
      createStoryboard,
      createScene,
      createGenerationRequest,
      createGeneratedImage,
      createTestGenerationBatch,
    } = await import("@gen-story/domain");

    await deps.projects.save(
      createProject({
        id: "sh-proj",
        organizationId: LOCAL_ORGANIZATION_ID,
        ownerUserId: LOCAL_USER_ID,
        name: "Sample History Project",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      }),
    );
    await deps.storyboards.save(
      createStoryboard({
        id: "sh-sb",
        projectId: "sh-proj",
        tone: "warm",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      }),
    );
    await deps.scenes.save(
      createScene({
        id: "sh-scene",
        projectId: "sh-proj",
        storyboardId: "sh-sb",
        orderIndex: 0,
        title: "T",
        description: "D",
        imagePrompt: "P",
        emotion: "calm",
        cameraDirection: "wide",
        lightingDirection: "natural",
        motionDirection: "still",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      }),
    );

    // One confirmed batch and one the operator never confirmed: the second
    // batch's samples must disappear from the scene entirely.
    await deps.testGenerationBatches.save(
      createTestGenerationBatch({
        id: "sh-batch-done",
        storyboardId: "sh-sb",
        status: "completed",
        confirmedGenerationRequestId: "sh-batch-done-v1",
        createdAt: "2026-07-01T00:00:00.000Z",
        completedAt: "2026-07-01T01:00:00.000Z",
      }),
    );
    await deps.testGenerationBatches.save(
      createTestGenerationBatch({
        id: "sh-batch-open",
        storyboardId: "sh-sb",
        status: "pending",
        createdAt: "2026-07-02T00:00:00.000Z",
      }),
    );

    const seedRequest = async (
      id: string,
      batchId: string | null,
      at: string,
    ) => {
      await deps.generationRequests.save(
        createGenerationRequest({
          id,
          projectId: "sh-proj",
          storyboardId: "sh-sb",
          sceneId: "sh-scene",
          status: "succeeded",
          inputJson: {},
          testGenerationBatchId: batchId,
          createdAt: at,
          updatedAt: at,
        }),
      );
      await deps.generatedImages.save(
        createGeneratedImage({
          id: `img-${id}`,
          projectId: "sh-proj",
          storyboardId: "sh-sb",
          sceneId: "sh-scene",
          generationRequestId: id,
          storageKey: `data/uploads/generated/${id}.jpg`,
          mimeType: "image/jpeg",
          size: 1,
          checksum: id,
          createdAt: at,
          updatedAt: at,
        }),
      );
    };

    for (const variant of [0, 1, 2]) {
      await seedRequest(
        `sh-batch-done-v${variant}`,
        "sh-batch-done",
        "2026-07-01T00:30:00.000Z",
      );
      await seedRequest(
        `sh-batch-open-v${variant}`,
        "sh-batch-open",
        "2026-07-02T00:30:00.000Z",
      );
    }
    await seedRequest("sh-main", null, "2026-07-03T00:00:00.000Z");
  }

  it("lists the scene's real generations and only the confirmed sample", async () => {
    await seedSceneWithSamples();

    const { status, body } = await req(
      base,
      "GET",
      "/api/scenes/sh-scene/generation-requests",
    );

    expect(status).toBe(200);
    const requests = (
      body as {
        generationRequests: Array<{
          id: string;
          testGenerationBatchId: string | null;
        }>;
      }
    ).generationRequests;
    expect(requests.map((r) => r.id).sort()).toEqual([
      "sh-batch-done-v1",
      "sh-main",
    ]);
    // The web tells a sample apart from a real generation by this field.
    expect(
      requests.find((r) => r.id === "sh-batch-done-v1")?.testGenerationBatchId,
    ).toBe("sh-batch-done");
    expect(
      requests.find((r) => r.id === "sh-main")?.testGenerationBatchId,
    ).toBeNull();
  });

  it("drops the images of rejected samples from the scene", async () => {
    await seedSceneWithSamples();

    const { status, body } = await req(
      base,
      "GET",
      "/api/scenes/sh-scene/generated-images",
    );

    expect(status).toBe(200);
    const images = (
      body as { generatedImages: Array<{ generationRequestId: string }> }
    ).generatedImages;
    expect(images.map((i) => i.generationRequestId).sort()).toEqual([
      "sh-batch-done-v1",
      "sh-main",
    ]);
  });

  it("applies the same filter to the storyboard-wide history", async () => {
    await seedSceneWithSamples();

    const { status, body } = await req(
      base,
      "GET",
      "/api/storyboards/sh-sb/generation-requests",
    );

    expect(status).toBe(200);
    const requests = (body as { generationRequests: Array<{ id: string }> })
      .generationRequests;
    expect(requests.map((r) => r.id).sort()).toEqual([
      "sh-batch-done-v1",
      "sh-main",
    ]);
  });
});

describe("AI job routes", () => {
  async function seedJob() {
    const { createProject } = await import("@gen-story/domain");
    const now = new Date().toISOString();
    await deps.projects.save(
      createProject({
        id: "job-proj",
        organizationId: LOCAL_ORGANIZATION_ID,
        ownerUserId: LOCAL_USER_ID,
        name: "Job Project",
        createdAt: now,
        updatedAt: now,
      }),
    );
    const { jobId } = await deps.jobQueue.enqueue({
      kind: "photo_analysis",
      projectId: "job-proj",
      payload: { projectId: "job-proj" },
    });
    return jobId;
  }

  it("returns an AI job by id", async () => {
    const jobId = await seedJob();

    const { status, body } = await req(base, "GET", `/api/ai-jobs/${jobId}`);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      id: jobId,
      projectId: "job-proj",
      kind: "photo_analysis",
      status: "queued",
    });
  });

  it("returns 404 for an unknown AI job", async () => {
    const { status } = await req(base, "GET", "/api/ai-jobs/missing");
    expect(status).toBe(404);
  });

  it("cancels a queued AI job", async () => {
    const jobId = await seedJob();

    const { status, body } = await req(
      base,
      "POST",
      `/api/ai-jobs/${jobId}/cancel`,
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ id: jobId, status: "canceled" });
    expect(await deps.aiJobs.findQueued()).toHaveLength(0);
  });

  it("streams project events as server-sent events", async () => {
    const jobId = await seedJob();

    const controller = new AbortController();
    const res = await fetch(`${base}/api/projects/job-proj/events`, {
      signal: controller.signal,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // The stream opens with a comment frame before any event.
    const first = await reader.read();
    expect(decoder.decode(first.value)).toContain(": connected");

    await req(base, "POST", `/api/ai-jobs/${jobId}/cancel`);

    const next = await reader.read();
    const frame = decoder.decode(next.value);
    expect(frame).toContain("event: ai-job.canceled");
    expect(frame).toContain(jobId);

    controller.abort();
  });
});
