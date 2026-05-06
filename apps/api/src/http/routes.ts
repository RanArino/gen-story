import { createReadStream, existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve, sep } from "node:path";

import {
  assignPhotosToScene,
  createGenerationRequestUseCase,
  createProjectUseCase,
  deletePhotoAsset,
  deleteProject,
  markGeneratedImageAdopted,
  restorePhotoAsset,
  restoreProject,
  retryFailedGenerationRequest,
  updatePhotoCuration,
  upsertScenes,
  upsertStoryboard,
  type ApplicationDependencies,
  type AuthPrincipal,
} from "@gen-story/application";

import { PhotoAssetIngestionService } from "../photos/photo-asset-ingestion";
import {
  toGeneratedImageDto,
  toGenerationRequestDto,
  toMeDto,
  toPhotoAssetDto,
  toProjectDto,
  toSceneDto,
  toStoryboardDto,
  toStylePresetDto,
} from "./dto-mappers";
import {
  badRequestBody,
  errorBody,
  forbiddenBody,
  internalErrorBody,
  notFoundBody,
  unauthorizedBody,
  useCaseErrorToStatus,
} from "./errors";
import { readJsonBody, sendJson } from "./json";
import { logRequest } from "./request-logger";
import { getParam, Router } from "./router";
import {
  AssignScenePhotosSchema,
  CreateGenerationRequestSchema,
  CreateProjectSchema,
  PatchPhotoAssetSchema,
  UploadPhotoAssetSchema,
  UpsertScenesSchema,
  UpsertStoryboardSchema,
} from "./schemas";

import type { RouteParams } from "./router";

async function requirePrincipal(
  deps: ApplicationDependencies,
  res: ServerResponse,
): Promise<AuthPrincipal | null> {
  const principal = await deps.authContext.getCurrentPrincipal();

  if (principal == null) {
    sendJson(res, 401, unauthorizedBody());
    return null;
  }

  return principal;
}

export function buildRouter(deps: ApplicationDependencies): Router {
  const router = new Router();

  // GET /api/me
  router.add("GET", "/api/me", async (_req, res) => {
    const principal = await requirePrincipal(deps, res);
    if (principal == null) return;
    sendJson(res, 200, toMeDto(principal));
  });

  // GET /api/projects
  router.add("GET", "/api/projects", async (req, res) => {
    const principal = await requirePrincipal(deps, res);
    if (principal == null) return;

    const url = new URL(req.url ?? "/", "http://localhost");
    const includeDeleted = url.searchParams.get("includeDeleted") === "true";
    const projects = await deps.projects.findByOrganizationId(
      principal.organization.id,
      includeDeleted,
    );
    sendJson(res, 200, { projects: projects.map(toProjectDto) });
  });

  // POST /api/projects
  router.add("POST", "/api/projects", async (req, res) => {
    const principal = await requirePrincipal(deps, res);
    if (principal == null) return;

    let rawBody: unknown;
    try {
      rawBody = await readJsonBody(req);
    } catch (err) {
      sendJson(
        res,
        400,
        badRequestBody(err instanceof Error ? err.message : "Bad request."),
      );
      return;
    }

    const parsed = CreateProjectSchema.safeParse(rawBody);
    if (!parsed.success) {
      sendJson(res, 422, errorBody("validation_error", parsed.error.message));
      return;
    }

    const projectId = parsed.data.projectId ?? crypto.randomUUID();
    const result = await createProjectUseCase(deps, {
      projectId,
      organizationId: principal.organization.id,
      ownerUserId: principal.user.id,
      name: parsed.data.name,
    });

    if (!result.ok) {
      sendJson(
        res,
        useCaseErrorToStatus(result.error.code),
        errorBody(result.error.code, result.error.message),
      );
      return;
    }

    sendJson(res, 201, toProjectDto(result.value));
  });

  // GET /api/projects/:projectId
  router.add("GET", "/api/projects/:projectId", async (_req, res, params) => {
    const principal = await requirePrincipal(deps, res);
    if (principal == null) return;

    const projectId = getParam(params, "projectId");
    const project = await deps.projects.findById(projectId);
    if (project == null) {
      sendJson(res, 404, notFoundBody("Project not found."));
      return;
    }

    if (project.organizationId !== principal.organization.id) {
      sendJson(res, 403, forbiddenBody());
      return;
    }

    sendJson(res, 200, toProjectDto(project));
  });

  // GET /api/projects/:projectId/photo-assets
  router.add(
    "GET",
    "/api/projects/:projectId/photo-assets",
    async (req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const projectId = getParam(params, "projectId");
      const project = await deps.projects.findById(projectId);
      if (project == null) {
        sendJson(res, 404, notFoundBody("Project not found."));
        return;
      }

      if (project.organizationId !== principal.organization.id) {
        sendJson(res, 403, forbiddenBody());
        return;
      }

      const url = new URL(req.url ?? "/", "http://localhost");
      const includeDeleted = url.searchParams.get("includeDeleted") === "true";
      const photoAssets = await deps.photoAssets.findByProjectId(projectId, includeDeleted);
      sendJson(res, 200, { photoAssets: photoAssets.map(toPhotoAssetDto) });
    },
  );

  // POST /api/projects/:projectId/photo-assets
  router.add(
    "POST",
    "/api/projects/:projectId/photo-assets",
    async (req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const projectId = getParam(params, "projectId");
      const project = await deps.projects.findById(projectId);
      if (project == null) {
        sendJson(res, 404, notFoundBody("Project not found."));
        return;
      }

      if (project.organizationId !== principal.organization.id) {
        sendJson(res, 403, forbiddenBody());
        return;
      }

      let rawBody: unknown;
      try {
        rawBody = await readJsonBody(req);
      } catch (err) {
        sendJson(
          res,
          400,
          badRequestBody(err instanceof Error ? err.message : "Bad request."),
        );
        return;
      }

      const parsed = UploadPhotoAssetSchema.safeParse(rawBody);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const photoAssetId = crypto.randomUUID();
      const body = Buffer.from(parsed.data.contentBase64, "base64");

      const service = new PhotoAssetIngestionService(deps);
      const result = await service.ingest({
        projectId,
        photoAssetId,
        fileName: parsed.data.name,
        body,
        mimeTypeHint: parsed.data.mimeType,
        notes: parsed.data.notes ?? null,
        usage: parsed.data.usage,
      });

      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 201, toPhotoAssetDto(result.value));
    },
  );

  // PATCH /api/photo-assets/:photoAssetId
  router.add(
    "PATCH",
    "/api/photo-assets/:photoAssetId",
    async (req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const photoAssetId = getParam(params, "photoAssetId");
      const photoAsset = await deps.photoAssets.findById(photoAssetId);
      if (photoAsset == null) {
        sendJson(res, 404, notFoundBody("Photo asset not found."));
        return;
      }

      const project = await deps.projects.findById(photoAsset.projectId);
      if (
        project == null ||
        project.organizationId !== principal.organization.id
      ) {
        sendJson(res, 403, forbiddenBody());
        return;
      }

      let rawBody: unknown;
      try {
        rawBody = await readJsonBody(req);
      } catch (err) {
        sendJson(
          res,
          400,
          badRequestBody(err instanceof Error ? err.message : "Bad request."),
        );
        return;
      }

      const parsed = PatchPhotoAssetSchema.safeParse(rawBody);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const result = await updatePhotoCuration(deps, {
        photoAssetId,
        usage: parsed.data.usage,
      });

      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, toPhotoAssetDto(result.value));
    },
  );

  // GET /api/projects/:projectId/storyboards
  router.add(
    "GET",
    "/api/projects/:projectId/storyboards",
    async (_req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const projectId = getParam(params, "projectId");
      const project = await deps.projects.findById(projectId);
      if (project == null) {
        sendJson(res, 404, notFoundBody("Project not found."));
        return;
      }

      if (project.organizationId !== principal.organization.id) {
        sendJson(res, 403, forbiddenBody());
        return;
      }

      const storyboards = await deps.storyboards.findByProjectId(projectId);
      sendJson(res, 200, { storyboards: storyboards.map(toStoryboardDto) });
    },
  );

  // PUT /api/storyboards/:storyboardId
  router.add(
    "PUT",
    "/api/storyboards/:storyboardId",
    async (req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const storyboardId = getParam(params, "storyboardId");

      let rawBody: unknown;
      try {
        rawBody = await readJsonBody(req);
      } catch (err) {
        sendJson(
          res,
          400,
          badRequestBody(err instanceof Error ? err.message : "Bad request."),
        );
        return;
      }

      const parsed = UpsertStoryboardSchema.safeParse(rawBody);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const project = await deps.projects.findById(parsed.data.projectId);
      if (project == null) {
        sendJson(res, 404, notFoundBody("Project not found."));
        return;
      }

      if (project.organizationId !== principal.organization.id) {
        sendJson(res, 403, forbiddenBody());
        return;
      }

      const result = await upsertStoryboard(deps, {
        storyboardId,
        projectId: parsed.data.projectId,
        tone: parsed.data.tone,
        status: parsed.data.status,
        stylePresetId: parsed.data.stylePresetId,
      });

      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, toStoryboardDto(result.value));
    },
  );

  // GET /api/storyboards/:storyboardId/scenes
  router.add(
    "GET",
    "/api/storyboards/:storyboardId/scenes",
    async (_req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const storyboardId = getParam(params, "storyboardId");
      const storyboard = await deps.storyboards.findById(storyboardId);
      if (storyboard == null) {
        sendJson(res, 404, notFoundBody("Storyboard not found."));
        return;
      }

      const project = await deps.projects.findById(storyboard.projectId);
      if (
        project == null ||
        project.organizationId !== principal.organization.id
      ) {
        sendJson(res, 403, forbiddenBody());
        return;
      }

      const scenes = await deps.scenes.findByStoryboardId(storyboardId);
      sendJson(res, 200, { scenes: scenes.map(toSceneDto) });
    },
  );

  // PUT /api/storyboards/:storyboardId/scenes
  router.add(
    "PUT",
    "/api/storyboards/:storyboardId/scenes",
    async (req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const storyboardId = getParam(params, "storyboardId");
      const storyboard = await deps.storyboards.findById(storyboardId);
      if (storyboard == null) {
        sendJson(res, 404, notFoundBody("Storyboard not found."));
        return;
      }

      const project = await deps.projects.findById(storyboard.projectId);
      if (
        project == null ||
        project.organizationId !== principal.organization.id
      ) {
        sendJson(res, 403, forbiddenBody());
        return;
      }

      let rawBody: unknown;
      try {
        rawBody = await readJsonBody(req);
      } catch (err) {
        sendJson(
          res,
          400,
          badRequestBody(err instanceof Error ? err.message : "Bad request."),
        );
        return;
      }

      const parsed = UpsertScenesSchema.safeParse(rawBody);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const projectId = storyboard.projectId;
      const sceneInputs = parsed.data.scenes.map((s) => ({
        sceneId: s.sceneId ?? crypto.randomUUID(),
        projectId,
        storyboardId,
        orderIndex: s.orderIndex,
        status: s.status,
        title: s.title,
        description: s.description,
        imagePrompt: s.imagePrompt,
        emotion: s.emotion,
        cameraDirection: s.cameraDirection,
        lightingDirection: s.lightingDirection,
        motionDirection: s.motionDirection,
        notes: s.notes,
        photoAssets: s.photoAssets,
      }));

      const result = await upsertScenes(deps, {
        storyboardId,
        projectId,
        scenes: sceneInputs,
      });

      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, { scenes: result.value.map(toSceneDto) });
    },
  );

  // PUT /api/scenes/:sceneId/photo-assets
  router.add(
    "PUT",
    "/api/scenes/:sceneId/photo-assets",
    async (req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const sceneId = getParam(params, "sceneId");
      const scene = await deps.scenes.findById(sceneId);
      if (scene == null) {
        sendJson(res, 404, notFoundBody("Scene not found."));
        return;
      }

      const project = await deps.projects.findById(scene.projectId);
      if (
        project == null ||
        project.organizationId !== principal.organization.id
      ) {
        sendJson(res, 403, forbiddenBody());
        return;
      }

      let rawBody: unknown;
      try {
        rawBody = await readJsonBody(req);
      } catch (err) {
        sendJson(
          res,
          400,
          badRequestBody(err instanceof Error ? err.message : "Bad request."),
        );
        return;
      }

      const parsed = AssignScenePhotosSchema.safeParse(rawBody);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const result = await assignPhotosToScene(deps, {
        sceneId,
        photoAssets: parsed.data.photoAssets,
      });

      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, toSceneDto(result.value));
    },
  );

  // GET /api/style-presets
  router.add("GET", "/api/style-presets", async (_req, res) => {
    const principal = await requirePrincipal(deps, res);
    if (principal == null) return;

    const stylePresets = await deps.stylePresets.findAll();
    sendJson(res, 200, { stylePresets: stylePresets.map(toStylePresetDto) });
  });

  // GET /api/scenes/:sceneId/generation-requests
  router.add(
    "GET",
    "/api/scenes/:sceneId/generation-requests",
    async (_req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const sceneId = getParam(params, "sceneId");
      const scene = await deps.scenes.findById(sceneId);
      if (scene == null) {
        sendJson(res, 404, notFoundBody("Scene not found."));
        return;
      }

      const project = await deps.projects.findById(scene.projectId);
      if (
        project == null ||
        project.organizationId !== principal.organization.id
      ) {
        sendJson(res, 403, forbiddenBody());
        return;
      }

      const generationRequests =
        await deps.generationRequests.findBySceneId(sceneId);
      sendJson(res, 200, {
        generationRequests: generationRequests.map(toGenerationRequestDto),
      });
    },
  );

  // POST /api/scenes/:sceneId/generation-requests
  router.add(
    "POST",
    "/api/scenes/:sceneId/generation-requests",
    async (req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const sceneId = getParam(params, "sceneId");
      const scene = await deps.scenes.findById(sceneId);
      if (scene == null) {
        sendJson(res, 404, notFoundBody("Scene not found."));
        return;
      }

      const project = await deps.projects.findById(scene.projectId);
      if (
        project == null ||
        project.organizationId !== principal.organization.id
      ) {
        sendJson(res, 403, forbiddenBody());
        return;
      }

      let rawBody: unknown;
      try {
        rawBody = await readJsonBody(req);
      } catch (err) {
        sendJson(
          res,
          400,
          badRequestBody(err instanceof Error ? err.message : "Bad request."),
        );
        return;
      }

      const parsed = CreateGenerationRequestSchema.safeParse(rawBody);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const generationRequestId =
        parsed.data.generationRequestId ?? crypto.randomUUID();
      const result = await createGenerationRequestUseCase(deps, {
        generationRequestId,
        projectId: scene.projectId,
        storyboardId: scene.storyboardId,
        sceneId,
        inputJson: parsed.data.inputJson,
      });

      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 201, toGenerationRequestDto(result.value));
    },
  );

  // POST /api/generation-requests/:generationRequestId/retry
  router.add(
    "POST",
    "/api/generation-requests/:generationRequestId/retry",
    async (_req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const generationRequestId = getParam(params, "generationRequestId");
      const generationRequest =
        await deps.generationRequests.findById(generationRequestId);
      if (generationRequest == null) {
        sendJson(res, 404, notFoundBody("Generation request not found."));
        return;
      }

      const project = await deps.projects.findById(generationRequest.projectId);
      if (
        project == null ||
        project.organizationId !== principal.organization.id
      ) {
        sendJson(res, 403, forbiddenBody());
        return;
      }

      const newGenerationRequestId = crypto.randomUUID();
      const result = await retryFailedGenerationRequest(deps, {
        generationRequestId,
        newGenerationRequestId,
      });

      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, toGenerationRequestDto(result.value));
    },
  );

  // GET /api/scenes/:sceneId/generated-images
  router.add(
    "GET",
    "/api/scenes/:sceneId/generated-images",
    async (_req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const sceneId = getParam(params, "sceneId");
      const scene = await deps.scenes.findById(sceneId);
      if (scene == null) {
        sendJson(res, 404, notFoundBody("Scene not found."));
        return;
      }

      const project = await deps.projects.findById(scene.projectId);
      if (
        project == null ||
        project.organizationId !== principal.organization.id
      ) {
        sendJson(res, 403, forbiddenBody());
        return;
      }

      const generatedImages = await deps.generatedImages.findBySceneId(sceneId);
      sendJson(res, 200, {
        generatedImages: generatedImages.map(toGeneratedImageDto),
      });
    },
  );

  // POST /api/scenes/:sceneId/generated-images/:generatedImageId/adopt
  router.add(
    "POST",
    "/api/scenes/:sceneId/generated-images/:generatedImageId/adopt",
    async (_req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const sceneId = getParam(params, "sceneId");
      const generatedImageId = getParam(params, "generatedImageId");

      const scene = await deps.scenes.findById(sceneId);
      if (scene == null) {
        sendJson(res, 404, notFoundBody("Scene not found."));
        return;
      }

      const project = await deps.projects.findById(scene.projectId);
      if (
        project == null ||
        project.organizationId !== principal.organization.id
      ) {
        sendJson(res, 403, forbiddenBody());
        return;
      }

      const generatedImage =
        await deps.generatedImages.findById(generatedImageId);
      if (generatedImage == null) {
        sendJson(res, 404, notFoundBody("Generated image not found."));
        return;
      }

      if (generatedImage.sceneId !== sceneId) {
        sendJson(
          res,
          422,
          errorBody(
            "invalid_state",
            "Generated image does not belong to this scene.",
          ),
        );
        return;
      }

      const result = await markGeneratedImageAdopted(deps, {
        sceneId,
        generatedImageId,
      });

      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, toSceneDto(result.value));
    },
  );

  // GET /api/debug/generation-requests
  router.add("GET", "/api/debug/generation-requests", async (_req, res) => {
    const principal = await requirePrincipal(deps, res);
    if (principal == null) return;

    const recent = await deps.generationRequests.findRecent(50);
    sendJson(res, 200, {
      generationRequests: recent.map((r) => ({
        id: r.id,
        sceneId: r.sceneId,
        projectId: r.projectId,
        storyboardId: r.storyboardId,
        status: r.status,
        errorMessage: r.errorMessage ?? null,
        startedAt: r.startedAt ?? null,
        completedAt: r.completedAt ?? null,
        createdAt: r.createdAt,
      })),
    });
  });

  // DELETE /api/photo-assets/:photoAssetId
  router.add("DELETE", "/api/photo-assets/:photoAssetId", async (_req, res, params) => {
    const principal = await requirePrincipal(deps, res);
    if (principal == null) return;

    const photoAssetId = getParam(params, "photoAssetId");
    const photoAsset = await deps.photoAssets.findById(photoAssetId);
    if (photoAsset == null) {
      sendJson(res, 404, notFoundBody("Photo asset not found."));
      return;
    }
    const project = await deps.projects.findById(photoAsset.projectId);
    if (project == null || project.organizationId !== principal.organization.id) {
      sendJson(res, 403, forbiddenBody());
      return;
    }
    const result = await deletePhotoAsset(deps, photoAssetId);
    if (!result.ok) {
      sendJson(res, useCaseErrorToStatus(result.error.code), errorBody(result.error.code, result.error.message));
      return;
    }
    res.writeHead(204);
    res.end();
  });

  // POST /api/photo-assets/:photoAssetId/restore
  router.add("POST", "/api/photo-assets/:photoAssetId/restore", async (_req, res, params) => {
    const principal = await requirePrincipal(deps, res);
    if (principal == null) return;

    const photoAssetId = getParam(params, "photoAssetId");
    const result = await restorePhotoAsset(deps, photoAssetId);
    if (!result.ok) {
      sendJson(res, useCaseErrorToStatus(result.error.code), errorBody(result.error.code, result.error.message));
      return;
    }
    // Re-fetch via includeDeleted=true path — the record is now active
    const allAssets = await deps.photoAssets.findByProjectId(
      (await deps.photoAssets.findById(photoAssetId))!.projectId,
    );
    const restored = allAssets.find((a) => a.id === photoAssetId);
    if (restored == null) {
      sendJson(res, 404, notFoundBody("Photo asset not found after restore."));
      return;
    }
    sendJson(res, 200, toPhotoAssetDto(restored));
  });

  // DELETE /api/projects/:projectId
  router.add("DELETE", "/api/projects/:projectId", async (_req, res, params) => {
    const principal = await requirePrincipal(deps, res);
    if (principal == null) return;

    const projectId = getParam(params, "projectId");
    const project = await deps.projects.findById(projectId);
    if (project == null) {
      sendJson(res, 404, notFoundBody("Project not found."));
      return;
    }
    if (project.organizationId !== principal.organization.id) {
      sendJson(res, 403, forbiddenBody());
      return;
    }
    const result = await deleteProject(deps, projectId);
    if (!result.ok) {
      sendJson(res, useCaseErrorToStatus(result.error.code), errorBody(result.error.code, result.error.message));
      return;
    }
    res.writeHead(204);
    res.end();
  });

  // POST /api/projects/:projectId/restore
  router.add("POST", "/api/projects/:projectId/restore", async (_req, res, params) => {
    const principal = await requirePrincipal(deps, res);
    if (principal == null) return;

    const projectId = getParam(params, "projectId");
    const result = await restoreProject(deps, projectId);
    if (!result.ok) {
      sendJson(res, useCaseErrorToStatus(result.error.code), errorBody(result.error.code, result.error.message));
      return;
    }
    const restored = await deps.projects.findById(projectId);
    if (restored == null) {
      sendJson(res, 404, notFoundBody("Project not found after restore."));
      return;
    }
    sendJson(res, 200, toProjectDto(restored));
  });

  const uploadsRoot = resolve(process.cwd(), "data", "uploads");

  const MIME_MAP: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };

  router.add("GET", "/files/*", async (_req, res, params) => {
    const tail = getParam(params, "*");
    const safePath = resolve(uploadsRoot, ...tail.split("/").filter(Boolean));

    if (
      safePath !== uploadsRoot &&
      !safePath.startsWith(`${uploadsRoot}${sep}`)
    ) {
      sendJson(res, 403, errorBody("FORBIDDEN", "Access denied"));
      return;
    }

    if (!existsSync(safePath)) {
      sendJson(res, 404, notFoundBody("File not found"));
      return;
    }

    const ext = safePath.slice(safePath.lastIndexOf(".")).toLowerCase();
    const contentType = MIME_MAP[ext] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    createReadStream(safePath).pipe(res);
  });

  return router;
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  router: Router,
): Promise<boolean> {
  const startMs = Date.now();
  try {
    const handled = await router.handle(req, res);
    if (handled) {
      logRequest(
        req.method ?? "GET",
        req.url ?? "/",
        res.statusCode,
        Date.now() - startMs,
      );
    }
    return handled;
  } catch (err) {
    console.error("Unhandled route error:", err);
    sendJson(res, 500, internalErrorBody());
    logRequest(req.method ?? "GET", req.url ?? "/", 500, Date.now() - startMs);
    return true;
  }
}

// Suppress unused import warning — RouteParams is re-exported for test use
export type { RouteParams };
