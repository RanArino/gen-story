import { createReadStream, existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve, sep } from "node:path";

import {
  assignPhotosToScene,
  analyzeProjectPhotos,
  cancelAgentChatTurn,
  compactAgentChatConversation,
  createAgentChatConversation,
  forkAgentChatProviderSession,
  getAgentChatConversation,
  listAgentChatConversations,
  postAgentChatTurn,
  runAgentChatTurn,
  applyAdjustmentToTestVariant,
  applyChangeProposal,
  cancelAiJob,
  cancelGenerationRequest,
  confirmTestGeneration,
  createGenerationRequestUseCase,
  createCustomStyle,
  createProjectUseCase,
  createTemplateScenesFromPhotos,
  decideChangeProposalItem,
  deletePhotoAsset,
  deleteProject,
  deleteScene,
  deleteScenes,
  exportStoryboardAsJson,
  fillSceneWithAi,
  fillStoryboardScenesWithAi,
  generateStorySetup,
  generateCharacterReferenceSheet,
  getCharacterReferenceSheet,
  getChangeProposal,
  getCreativeDirection,
  getProjectPhotoAnalysis,
  getStoryboardSetup,
  getUserPreference,
  insertComplementScene,
  listChangeProposals,
  listTestGenerationBatches,
  markGeneratedImageAdopted,
  proposeComplementScenes,
  reorderPhotos,
  reorderScenes,
  requestTestGeneration,
  restorePhotoAsset,
  restoreProject,
  retryFailedGenerationRequest,
  reviseChangeProposalItemUseCase,
  selectChangeProposalChoice,
  setUserPreference,
  updatePhotoCuration,
  upsertScenes,
  upsertStoryboard,
  type ApplicationDependencies,
  type AuthPrincipal,
} from "@gen-story/application";
import { isLanguage as isLanguageValue } from "@gen-story/application";
import type {
  AgentConversation,
  AiJob,
  ChangeProposal,
  Project,
} from "@gen-story/domain";
import {
  isChangeProposalStatus,
  isVisibleInSceneHistory,
} from "@gen-story/domain";
import {
  getLocalizedLabels,
  isTestAdjustmentId,
  TEST_ADJUSTMENTS,
  type TestAdjustmentId,
} from "@gen-story/shared";

import type { ApiDependencies } from "../app/create-api-context";
import { exportStoryboardAssetBundle } from "../exports/local-storyboard-asset-export";
import { composeScenePrompt } from "../generation/compose-scene-prompt";
import {
  handleProjectMcpHttpRequest,
  resolveMcpProvider,
} from "../mcp/http-transport";
import { PhotoAssetIngestionService } from "../photos/photo-asset-ingestion";
import {
  toAiJobDto,
  toAiRuntimeInfoDto,
  toChangeProposalDto,
  toCreativeDirectionDto,
  toGeneratedImageDto,
  toGenerationRequestDto,
  toGenerationRequestWithSceneTitleDto,
  toMeDto,
  toPhotoAssetDto,
  toProjectDto,
  toProjectPhotoAnalysisDto,
  toSceneDto,
  toAgentConversationDetailDto,
  toAgentConversationDto,
  toAgentConversationMessageDto,
  toAgentConversationTurnDto,
  toAgentProviderBindingDto,
  toStoryboardDto,
  toStylePresetDto,
  toTestGenerationBatchDto,
  toTestGenerationBatchWithVariantsDto,
  toUserPreferenceDto,
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
  AnalyzeProjectPhotosSchema,
  CreateAgentConversationSchema,
  PostAgentChatTurnSchema,
  ComplementSceneBridgeSchema,
  CreateGenerationRequestSchema,
  CreateCustomStyleSchema,
  ExportStoryboardAssetsSchema,
  ReorderPhotosSchema,
  ReorderScenesSchema,
  CreateProjectSchema,
  CreateTemplateScenesSchema,
  DecideChangeProposalItemSchema,
  FillSceneWithAiSchema,
  FillStoryboardScenesWithAiSchema,
  GenerateStorySetupSchema,
  PatchPhotoAssetSchema,
  PreviewScenePromptSchema,
  ReviseChangeProposalItemSchema,
  SelectChangeProposalChoiceSchema,
  SetUserPreferenceSchema,
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

// Resolve an AI job and confirm it belongs to the caller's organization,
// responding on the failure paths exactly as the other handlers do.
async function requireOwnedAiJob(
  deps: ApiDependencies,
  res: ServerResponse,
  aiJobId: string,
): Promise<AiJob | null> {
  const principal = await requirePrincipal(deps, res);
  if (principal == null) return null;

  const job = await deps.aiJobs.findById(aiJobId);
  if (job == null) {
    sendJson(res, 404, notFoundBody("AI job not found."));
    return null;
  }

  const project = await deps.projects.findById(job.projectId);
  if (project == null || project.organizationId !== principal.organization.id) {
    sendJson(res, 403, forbiddenBody());
    return null;
  }

  return job;
}

// Resolve a project and confirm it belongs to the caller's organization.
// Every project-scoped change-proposal and MCP route funnels through this, so
// one organization can never reach another's proposals or MCP session.
async function requireOwnedProject(
  deps: ApiDependencies,
  res: ServerResponse,
  projectId: string,
): Promise<Project | null> {
  const principal = await requirePrincipal(deps, res);
  if (principal == null) return null;

  const project = await deps.projects.findById(projectId);
  if (project == null) {
    sendJson(res, 404, notFoundBody("Project not found."));
    return null;
  }

  if (project.organizationId !== principal.organization.id) {
    sendJson(res, 403, forbiddenBody());
    return null;
  }

  return project;
}

async function requireOwnedChangeProposal(
  deps: ApiDependencies,
  res: ServerResponse,
  changeProposalId: string,
): Promise<ChangeProposal | null> {
  const result = await getChangeProposal(deps, { changeProposalId });
  if (!result.ok) {
    sendJson(
      res,
      useCaseErrorToStatus(result.error.code),
      errorBody(result.error.code, result.error.message),
    );
    return null;
  }

  const project = await requireOwnedProject(deps, res, result.value.projectId);
  if (project == null) return null;

  return result.value;
}

async function requireOwnedConversation(
  deps: ApiDependencies,
  res: ServerResponse,
  conversationId: string,
): Promise<AgentConversation | null> {
  const conversation = await deps.agentConversations.findById(conversationId);
  if (conversation == null) {
    sendJson(res, 404, notFoundBody("Conversation not found."));
    return null;
  }

  const project = await requireOwnedProject(deps, res, conversation.projectId);
  if (project == null) return null;

  return conversation;
}

// Body reading shared by the change-proposal decision endpoints; responds with
// the same 400 the other POST handlers use when the body is not JSON.
async function readBodyOrRespond(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<{ body: unknown } | null> {
  try {
    return { body: await readJsonBody(req) };
  } catch (err) {
    sendJson(
      res,
      400,
      badRequestBody(err instanceof Error ? err.message : "Bad request."),
    );
    return null;
  }
}

// The ids of the samples a storyboard's operator picked, one per completed
// batch. Feeds `isVisibleInSceneHistory` so scene-scoped history keeps the
// chosen sample and drops the rejected ones.
async function confirmedTestRequestIds(
  deps: ApiDependencies,
  storyboardId: string,
): Promise<Set<string>> {
  const batches =
    await deps.testGenerationBatches.listByStoryboardId(storyboardId);
  const ids = new Set<string>();

  for (const batch of batches) {
    if (batch.confirmedGenerationRequestId !== null) {
      ids.add(batch.confirmedGenerationRequestId);
    }
  }

  return ids;
}

export function buildRouter(deps: ApiDependencies): Router {
  const router = new Router();

  // GET /api/me
  router.add("GET", "/api/me", async (_req, res) => {
    const principal = await requirePrincipal(deps, res);
    if (principal == null) return;
    sendJson(res, 200, toMeDto(principal));
  });

  // GET /api/ai-runtime
  router.add("GET", "/api/ai-runtime", async (_req, res) => {
    const principal = await requirePrincipal(deps, res);
    if (principal == null) return;
    sendJson(
      res,
      200,
      toAiRuntimeInfoDto(
        deps.agentRuntime,
        deps.agentTurnRunner.availability(),
      ),
    );
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
      const photoAssets = await deps.photoAssets.findByProjectId(
        projectId,
        includeDeleted,
      );
      sendJson(res, 200, { photoAssets: photoAssets.map(toPhotoAssetDto) });
    },
  );

  // POST /api/storyboards/:storyboardId/export-assets
  router.add(
    "POST",
    "/api/storyboards/:storyboardId/export-assets",
    async (req, res, params) => {
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
      const parsed = ExportStoryboardAssetsSchema.safeParse(rawBody);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

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

      const result = await exportStoryboardAsJson(deps, { storyboardId });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      const exported = await exportStoryboardAssetBundle({
        storyboard: result.value,
        objectStorage: deps.objectStorage,
        assetSelection: parsed.data.assetSelection,
      });
      sendJson(res, 201, exported);
    },
  );

  // GET /api/projects/:projectId/photo-analysis
  router.add(
    "GET",
    "/api/projects/:projectId/photo-analysis",
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

      const result = await getProjectPhotoAnalysis(deps, { projectId });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, {
        photoAnalysis:
          result.value == null ? null : toProjectPhotoAnalysisDto(result.value),
      });
    },
  );

  // POST /api/projects/:projectId/photo-analysis
  router.add(
    "POST",
    "/api/projects/:projectId/photo-analysis",
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

      const parsed = AnalyzeProjectPhotosSchema.safeParse(rawBody);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const result = await analyzeProjectPhotos(deps, { projectId });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      // A cache hit answers immediately; otherwise the caller follows the job.
      sendJson(res, result.value.cached ? 200 : 202, {
        photoAnalysis:
          result.value.analysis == null
            ? null
            : toProjectPhotoAnalysisDto(result.value.analysis),
        cached: result.value.cached,
        jobId: result.value.jobId,
      });
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
      sendJson(res, 200, {
        storyboards: await Promise.all(
          storyboards.map(async (storyboard) =>
            toStoryboardDto(
              storyboard,
              await getStoryboardSetup(deps, storyboard),
            ),
          ),
        ),
      });
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
        commonPrompt: parsed.data.commonPrompt,
        story: parsed.data.story,
        negativePrompt: parsed.data.negativePrompt,
        characterPolicy: parsed.data.characterPolicy,
      });

      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(
        res,
        200,
        toStoryboardDto(
          result.value,
          await getStoryboardSetup(deps, result.value),
        ),
      );
    },
  );

  // POST /api/storyboards/:storyboardId/story-setup
  router.add(
    "GET",
    "/api/storyboards/:storyboardId/character-reference-sheet",
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
      if (project?.organizationId !== principal.organization.id) {
        sendJson(res, 403, forbiddenBody());
        return;
      }
      const result = await getCharacterReferenceSheet(deps, storyboardId);
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }
      sendJson(res, 200, { characterReferenceSheet: result.value });
    },
  );

  router.add(
    "POST",
    "/api/storyboards/:storyboardId/character-reference-sheet",
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
      if (project?.organizationId !== principal.organization.id) {
        sendJson(res, 403, forbiddenBody());
        return;
      }
      const result = await generateCharacterReferenceSheet(deps, {
        storyboardId,
      });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }
      sendJson(res, 202, result.value);
    },
  );

  // POST /api/storyboards/:storyboardId/story-setup
  router.add(
    "POST",
    "/api/storyboards/:storyboardId/story-setup",
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

      const parsed = GenerateStorySetupSchema.safeParse(rawBody);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const result = await generateStorySetup(deps, {
        storyboardId,
        storyPurpose: parsed.data.storyPurpose,
      });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 202, { jobId: result.value.jobId });
    },
  );

  // POST /api/storyboards/:storyboardId/scenes/ai-fill
  router.add(
    "POST",
    "/api/storyboards/:storyboardId/scenes/ai-fill",
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

      const parsed = FillStoryboardScenesWithAiSchema.safeParse(rawBody);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const result = await fillStoryboardScenesWithAi(deps, { storyboardId });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      // Nothing left to fill answers immediately; otherwise follow the jobs.
      sendJson(res, result.value.aiJobIds.length === 0 ? 200 : 202, {
        aiJobIds: result.value.aiJobIds,
        skippedSceneCount: result.value.skippedSceneCount,
      });
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
        negativePrompt: s.negativePrompt,
        photoFidelity: s.photoFidelity,
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

  // DELETE /api/storyboards/:storyboardId/scenes
  router.add(
    "DELETE",
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

      const url = new URL(req.url ?? "/", "http://localhost");
      const scopeParam = url.searchParams.get("scope") ?? "all";
      if (scopeParam !== "all" && scopeParam !== "unfilled") {
        sendJson(
          res,
          422,
          errorBody("validation_error", "scope must be 'all' or 'unfilled'."),
        );
        return;
      }

      const result = await deleteScenes(deps, {
        storyboardId,
        scope: scopeParam,
      });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, result.value);
    },
  );

  // POST /api/storyboards/:storyboardId/template-scenes
  router.add(
    "POST",
    "/api/storyboards/:storyboardId/template-scenes",
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

      const parsed = CreateTemplateScenesSchema.safeParse(rawBody);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const result = await createTemplateScenesFromPhotos(deps, {
        storyboardId,
        projectId: storyboard.projectId,
        photoAssetIds: parsed.data.photoAssetIds,
        autoFill: parsed.data.autoFill,
      });

      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 201, {
        scenes: result.value.scenes.map(toSceneDto),
        aiJobIds: result.value.aiJobIds,
      });
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

  // DELETE /api/scenes/:sceneId
  router.add("DELETE", "/api/scenes/:sceneId", async (_req, res, params) => {
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

    const result = await deleteScene(deps, sceneId);
    if (!result.ok) {
      sendJson(
        res,
        useCaseErrorToStatus(result.error.code),
        errorBody(result.error.code, result.error.message),
      );
      return;
    }

    res.writeHead(204);
    res.end();
  });

  // POST /api/scenes/:sceneId/ai-fill
  router.add(
    "POST",
    "/api/scenes/:sceneId/ai-fill",
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

      const parsed = FillSceneWithAiSchema.safeParse(rawBody);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const result = await fillSceneWithAi(deps, { sceneId });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      // Nothing to fill answers immediately; otherwise follow the job.
      sendJson(res, result.value.jobId == null ? 200 : 202, {
        scene:
          result.value.scene == null ? null : toSceneDto(result.value.scene),
        jobId: result.value.jobId,
      });
    },
  );

  // POST /api/scenes/:sceneId/preview-prompt
  // Read-only, side-effect-free, no image call. Returns the exact positive and
  // negative prompt the next generation would use, computed from the persisted
  // scene/storyboard with optional unsaved-edit overrides applied.
  router.add(
    "POST",
    "/api/scenes/:sceneId/preview-prompt",
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

      const parsed = PreviewScenePromptSchema.safeParse(rawBody);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const { prompt, negativePrompt } = await composeScenePrompt(deps, {
        sceneId,
        overrides: parsed.data,
      });

      sendJson(res, 200, { prompt, negativePrompt });
    },
  );

  // POST /api/storyboards/:storyboardId/complement-scenes
  router.add(
    "POST",
    "/api/storyboards/:storyboardId/complement-scenes",
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

      const parsed = ComplementSceneBridgeSchema.safeParse(rawBody);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const result = await insertComplementScene(deps, {
        storyboardId,
        fromSceneId: parsed.data.fromSceneId,
        toSceneId: parsed.data.toSceneId,
      });

      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 201, toSceneDto(result.value));
    },
  );

  // POST /api/storyboards/:storyboardId/complement-scenes/proposals
  router.add(
    "POST",
    "/api/storyboards/:storyboardId/complement-scenes/proposals",
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

      const parsed = ComplementSceneBridgeSchema.safeParse(rawBody);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const result = await proposeComplementScenes(deps, {
        storyboardId,
        fromSceneId: parsed.data.fromSceneId,
        toSceneId: parsed.data.toSceneId,
      });

      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 202, { jobId: result.value.jobId });
    },
  );

  // PATCH /api/projects/:projectId/photos/order
  router.add(
    "PATCH",
    "/api/projects/:projectId/photos/order",
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

      const parsed = ReorderPhotosSchema.safeParse(rawBody);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const result = await reorderPhotos(deps, {
        projectId,
        photoAssetIds: parsed.data.photoAssetIds,
      });

      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, { photoAssets: result.value.map(toPhotoAssetDto) });
    },
  );

  // PUT /api/storyboards/:storyboardId/scene-order
  router.add(
    "PUT",
    "/api/storyboards/:storyboardId/scene-order",
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

      const parsed = ReorderScenesSchema.safeParse(rawBody);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const result = await reorderScenes(deps, {
        storyboardId,
        sceneIds: parsed.data.sceneIds,
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

  // GET /api/style-presets
  router.add("GET", "/api/style-presets", async (_req, res) => {
    const principal = await requirePrincipal(deps, res);
    if (principal == null) return;

    const stylePresets = await deps.stylePresets.findAll();
    sendJson(res, 200, { stylePresets: stylePresets.map(toStylePresetDto) });
  });

  // POST /api/style-presets
  router.add("POST", "/api/style-presets", async (req, res) => {
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

    const parsed = CreateCustomStyleSchema.safeParse(rawBody);
    if (!parsed.success) {
      sendJson(res, 422, errorBody("validation_error", parsed.error.message));
      return;
    }

    const result = await createCustomStyle(deps, parsed.data);
    if (!result.ok) {
      sendJson(
        res,
        useCaseErrorToStatus(result.error.code),
        errorBody(result.error.code, result.error.message),
      );
      return;
    }

    sendJson(res, 201, { stylePreset: toStylePresetDto(result.value) });
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

      const [generationRequests, confirmedIds] = await Promise.all([
        deps.generationRequests.findBySceneId(sceneId),
        confirmedTestRequestIds(deps, scene.storyboardId),
      ]);

      sendJson(res, 200, {
        generationRequests: generationRequests
          .filter((req) => isVisibleInSceneHistory(req, confirmedIds))
          .map(toGenerationRequestDto),
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

  // POST /api/generation-requests/:generationRequestId/cancel
  router.add(
    "POST",
    "/api/generation-requests/:generationRequestId/cancel",
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

      const result = await cancelGenerationRequest(deps, {
        generationRequestId,
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

  // GET /api/ai-jobs/:aiJobId
  router.add("GET", "/api/ai-jobs/:aiJobId", async (_req, res, params) => {
    const job = await requireOwnedAiJob(deps, res, getParam(params, "aiJobId"));
    if (job == null) return;

    sendJson(res, 200, toAiJobDto(job));
  });

  // POST /api/ai-jobs/:aiJobId/cancel
  router.add(
    "POST",
    "/api/ai-jobs/:aiJobId/cancel",
    async (_req, res, params) => {
      const aiJobId = getParam(params, "aiJobId");
      const job = await requireOwnedAiJob(deps, res, aiJobId);
      if (job == null) return;

      const result = await cancelAiJob(deps, { aiJobId });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, toAiJobDto(result.value));
    },
  );

  // GET /api/projects/:projectId/events
  // Server-sent events: job lifecycle and mutations for one project. The
  // stream is an optimization — every event it carries is also reachable by
  // polling GET /api/ai-jobs/:aiJobId.
  router.add(
    "GET",
    "/api/projects/:projectId/events",
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

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(": connected\n\n");

      const unsubscribe = deps.progressEvents.subscribe(projectId, (event) => {
        res.write(`event: ${event.kind}\n`);
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      });

      // Keep intermediaries from closing an idle connection.
      const heartbeat = setInterval(() => {
        res.write(": heartbeat\n\n");
      }, 25_000);

      const close = () => {
        clearInterval(heartbeat);
        unsubscribe();
        res.end();
      };
      req.on("close", close);
      req.on("error", close);
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

      // The images of rejected samples must go too, or the scene's "generated
      // image" panel and its review thumbnails can show a sample that was
      // turned down.
      const [generatedImages, sceneRequests, confirmedIds] = await Promise.all([
        deps.generatedImages.findBySceneId(sceneId),
        deps.generationRequests.findBySceneId(sceneId),
        confirmedTestRequestIds(deps, scene.storyboardId),
      ]);

      const hiddenRequestIds = new Set(
        sceneRequests
          .filter((req) => !isVisibleInSceneHistory(req, confirmedIds))
          .map((req) => req.id),
      );

      sendJson(res, 200, {
        generatedImages: generatedImages
          .filter((image) => !hiddenRequestIds.has(image.generationRequestId))
          .map(toGeneratedImageDto),
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
  router.add(
    "DELETE",
    "/api/photo-assets/:photoAssetId",
    async (_req, res, params) => {
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
      const result = await deletePhotoAsset(deps, photoAssetId);
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }
      res.writeHead(204);
      res.end();
    },
  );

  // POST /api/photo-assets/:photoAssetId/restore
  router.add(
    "POST",
    "/api/photo-assets/:photoAssetId/restore",
    async (_req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const photoAssetId = getParam(params, "photoAssetId");
      const result = await restorePhotoAsset(deps, photoAssetId);
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }
      // Re-fetch via includeDeleted=true path — the record is now active
      const allAssets = await deps.photoAssets.findByProjectId(
        (await deps.photoAssets.findById(photoAssetId))!.projectId,
      );
      const restored = allAssets.find((a) => a.id === photoAssetId);
      if (restored == null) {
        sendJson(
          res,
          404,
          notFoundBody("Photo asset not found after restore."),
        );
        return;
      }
      sendJson(res, 200, toPhotoAssetDto(restored));
    },
  );

  // DELETE /api/projects/:projectId
  router.add(
    "DELETE",
    "/api/projects/:projectId",
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
      const result = await deleteProject(deps, projectId);
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }
      res.writeHead(204);
      res.end();
    },
  );

  // POST /api/projects/:projectId/restore
  router.add(
    "POST",
    "/api/projects/:projectId/restore",
    async (_req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const projectId = getParam(params, "projectId");
      const result = await restoreProject(deps, projectId);
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }
      const restored = await deps.projects.findById(projectId);
      if (restored == null) {
        sendJson(res, 404, notFoundBody("Project not found after restore."));
        return;
      }
      sendJson(res, 200, toProjectDto(restored));
    },
  );

  const uploadsRoot = resolve(process.cwd(), "data", "uploads");
  const repoRoot = resolve(process.cwd());

  const MIME_MAP: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
  };

  // POST /api/storyboards/:storyboardId/test-generation
  router.add(
    "POST",
    "/api/storyboards/:storyboardId/test-generation",
    async (req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const storyboardId = getParam(params, "storyboardId");
      const body = await readJsonBody(req);
      if (
        !body ||
        typeof body !== "object" ||
        !("sceneId" in body) ||
        typeof body.sceneId !== "string"
      ) {
        sendJson(res, 422, badRequestBody("sceneId is required"));
        return;
      }

      const result = await requestTestGeneration(deps, {
        storyboardId,
        sceneId: body.sceneId,
      });

      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 201, {
        batch: toTestGenerationBatchDto(result.value.batch),
        generationRequests: result.value.generationRequests.map(
          toGenerationRequestDto,
        ),
      });
    },
  );

  // GET /api/storyboards/:storyboardId/test-generation/current
  router.add(
    "GET",
    "/api/storyboards/:storyboardId/test-generation/current",
    async (_req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const storyboardId = getParam(params, "storyboardId");
      const batch =
        await deps.testGenerationBatches.findLatestByStoryboardId(storyboardId);

      sendJson(res, 200, {
        batch: batch ? toTestGenerationBatchDto(batch) : null,
      });
    },
  );

  // POST /api/storyboards/:storyboardId/test-generation/confirm
  router.add(
    "POST",
    "/api/storyboards/:storyboardId/test-generation/confirm",
    async (req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const storyboardId = getParam(params, "storyboardId");
      const body = await readJsonBody(req);
      if (
        !body ||
        typeof body !== "object" ||
        !("confirmedGenerationRequestId" in body) ||
        typeof body.confirmedGenerationRequestId !== "string"
      ) {
        sendJson(
          res,
          422,
          badRequestBody("confirmedGenerationRequestId is required"),
        );
        return;
      }

      const adjustmentSuffixes = Object.fromEntries(
        Object.entries(TEST_ADJUSTMENTS).map(([id, def]) => [
          id,
          def.promptSuffix,
        ]),
      ) as Record<TestAdjustmentId, string>;

      const result = await confirmTestGeneration(deps, {
        storyboardId,
        confirmedGenerationRequestId: body.confirmedGenerationRequestId,
        adjustmentSuffixes,
      });

      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, { batch: toTestGenerationBatchDto(result.value) });
    },
  );

  // GET /api/storyboards/:storyboardId/test-generation/batches
  router.add(
    "GET",
    "/api/storyboards/:storyboardId/test-generation/batches",
    async (_req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const storyboardId = getParam(params, "storyboardId");
      const result = await listTestGenerationBatches(deps, { storyboardId });

      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, {
        batches: result.value.map(toTestGenerationBatchWithVariantsDto),
      });
    },
  );

  // POST /api/storyboards/:storyboardId/test-generation/variants/:variantId/adjustments
  router.add(
    "POST",
    "/api/storyboards/:storyboardId/test-generation/variants/:variantId/adjustments",
    async (req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const storyboardId = getParam(params, "storyboardId");
      const variantId = getParam(params, "variantId");
      const body = await readJsonBody(req);

      if (
        !body ||
        typeof body !== "object" ||
        !("adjustmentIds" in body) ||
        !Array.isArray(body.adjustmentIds)
      ) {
        sendJson(res, 422, badRequestBody("adjustmentIds (array) is required"));
        return;
      }

      const rawIds = body.adjustmentIds as unknown[];
      for (const id of rawIds) {
        if (!isTestAdjustmentId(id)) {
          sendJson(
            res,
            422,
            badRequestBody(`Unknown adjustment id: ${String(id)}`),
          );
          return;
        }
      }
      const adjustmentIds = rawIds as TestAdjustmentId[];

      const adjustmentSuffixes = Object.fromEntries(
        Object.entries(TEST_ADJUSTMENTS).map(([id, def]) => [
          id,
          def.promptSuffix,
        ]),
      ) as Record<TestAdjustmentId, string>;

      const result = await applyAdjustmentToTestVariant(deps, {
        storyboardId,
        variantId,
        adjustmentIds,
        adjustmentSuffixes,
      });

      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, {
        generationRequest: toGenerationRequestDto(result.value),
      });
    },
  );

  // GET /api/storyboards/:storyboardId/generation-requests
  router.add(
    "GET",
    "/api/storyboards/:storyboardId/generation-requests",
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

      const [requests, scenes, confirmedIds] = await Promise.all([
        deps.generationRequests.findByStoryboardId(storyboardId),
        deps.scenes.findByStoryboardId(storyboardId),
        confirmedTestRequestIds(deps, storyboardId),
      ]);

      const sceneTitleById = new Map(
        scenes.map((s) => [s.id, s.title ?? null]),
      );

      // The rejected samples are listed by the test-generation section of this
      // same screen; repeating them under the first scene would double-count
      // them.
      sendJson(res, 200, {
        generationRequests: requests
          .filter((r) => isVisibleInSceneHistory(r, confirmedIds))
          .map((r) =>
            toGenerationRequestWithSceneTitleDto(
              r,
              sceneTitleById.get(r.sceneId) ?? null,
            ),
          ),
      });
    },
  );

  // GET /api/storyboards/:storyboardId/export.json
  router.add(
    "GET",
    "/api/storyboards/:storyboardId/export.json",
    async (req, res, params) => {
      const principal = await requirePrincipal(deps, res);
      if (principal == null) return;

      const storyboardId = getParam(params, "storyboardId");
      const url = new URL(req.url ?? "/", "http://localhost");
      const langParam = url.searchParams.get("lang");
      const language = isLanguageValue(langParam) ? langParam : undefined;

      const result = await exportStoryboardAsJson(deps, {
        storyboardId,
        language,
      });

      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      const envelope = {
        language: result.value.language,
        localizedLabels: getLocalizedLabels(result.value.language),
        storyboard: result.value,
      };

      const filename = `storyboard-${storyboardId}-${Date.now()}.json`;
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      });
      res.end(JSON.stringify(envelope, null, 2));
    },
  );

  // GET /api/user/preferences
  router.add("GET", "/api/user/preferences", async (_req, res) => {
    const principal = await requirePrincipal(deps, res);
    if (principal == null) return;

    const result = await getUserPreference(deps, principal.user.id);
    if (!result.ok) {
      sendJson(
        res,
        useCaseErrorToStatus(result.error.code),
        errorBody(result.error.code, result.error.message),
      );
      return;
    }

    sendJson(res, 200, { preference: toUserPreferenceDto(result.value) });
  });

  // PUT /api/user/preferences
  router.add("PUT", "/api/user/preferences", async (req, res) => {
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

    const parsed = SetUserPreferenceSchema.safeParse(rawBody);
    if (!parsed.success) {
      sendJson(res, 422, errorBody("validation_error", parsed.error.message));
      return;
    }

    const result = await setUserPreference(deps, {
      userId: principal.user.id,
      language: parsed.data.language,
      agentRuntime: parsed.data.agentRuntime,
    });

    if (!result.ok) {
      sendJson(
        res,
        useCaseErrorToStatus(result.error.code),
        errorBody(result.error.code, result.error.message),
      );
      return;
    }

    sendJson(res, 200, { preference: toUserPreferenceDto(result.value) });
  });

  // ── Creative direction and change proposals ───────────────────────────────

  // GET /api/projects/:projectId/creative-direction
  router.add(
    "GET",
    "/api/projects/:projectId/creative-direction",
    async (_req, res, params) => {
      const projectId = getParam(params, "projectId");
      const project = await requireOwnedProject(deps, res, projectId);
      if (project == null) return;

      const result = await getCreativeDirection(deps, { projectId });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, toCreativeDirectionDto(result.value));
    },
  );

  // GET /api/projects/:projectId/change-proposals?status=pending
  router.add(
    "GET",
    "/api/projects/:projectId/change-proposals",
    async (req, res, params) => {
      const projectId = getParam(params, "projectId");
      const project = await requireOwnedProject(deps, res, projectId);
      if (project == null) return;

      const url = new URL(req.url ?? "/", "http://localhost");
      const status = url.searchParams.get("status");
      if (status != null && !isChangeProposalStatus(status)) {
        sendJson(res, 422, errorBody("validation_error", "Unknown status."));
        return;
      }

      const result = await listChangeProposals(deps, {
        projectId,
        status: status ?? undefined,
      });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, {
        changeProposals: result.value.map(toChangeProposalDto),
      });
    },
  );

  // GET /api/change-proposals/:changeProposalId
  router.add(
    "GET",
    "/api/change-proposals/:changeProposalId",
    async (_req, res, params) => {
      const proposal = await requireOwnedChangeProposal(
        deps,
        res,
        getParam(params, "changeProposalId"),
      );
      if (proposal == null) return;

      sendJson(res, 200, toChangeProposalDto(proposal));
    },
  );

  // POST /api/change-proposals/:changeProposalId/items/:itemId/decision
  router.add(
    "POST",
    "/api/change-proposals/:changeProposalId/items/:itemId/decision",
    async (req, res, params) => {
      const changeProposalId = getParam(params, "changeProposalId");
      const proposal = await requireOwnedChangeProposal(
        deps,
        res,
        changeProposalId,
      );
      if (proposal == null) return;

      const body = await readBodyOrRespond(req, res);
      if (body == null) return;

      const parsed = DecideChangeProposalItemSchema.safeParse(body.body);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const result = await decideChangeProposalItem(deps, {
        changeProposalId,
        itemId: getParam(params, "itemId"),
        approval: parsed.data.approval,
      });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, toChangeProposalDto(result.value));
    },
  );

  // POST /api/change-proposals/:changeProposalId/items/:itemId/choice
  router.add(
    "POST",
    "/api/change-proposals/:changeProposalId/items/:itemId/choice",
    async (req, res, params) => {
      const changeProposalId = getParam(params, "changeProposalId");
      const proposal = await requireOwnedChangeProposal(
        deps,
        res,
        changeProposalId,
      );
      if (proposal == null) return;

      const body = await readBodyOrRespond(req, res);
      if (body == null) return;

      const parsed = SelectChangeProposalChoiceSchema.safeParse(body.body);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const result = await selectChangeProposalChoice(deps, {
        changeProposalId,
        targetItemId: getParam(params, "itemId"),
        optionId: parsed.data.optionId,
      });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, toChangeProposalDto(result.value));
    },
  );

  // POST /api/change-proposals/:changeProposalId/items/:itemId/revision
  router.add(
    "POST",
    "/api/change-proposals/:changeProposalId/items/:itemId/revision",
    async (req, res, params) => {
      const changeProposalId = getParam(params, "changeProposalId");
      const proposal = await requireOwnedChangeProposal(
        deps,
        res,
        changeProposalId,
      );
      if (proposal == null) return;

      const body = await readBodyOrRespond(req, res);
      if (body == null) return;

      const parsed = ReviseChangeProposalItemSchema.safeParse(body.body);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const result = await reviseChangeProposalItemUseCase(deps, {
        changeProposalId,
        itemId: getParam(params, "itemId"),
        after: parsed.data.after,
        rationale: parsed.data.rationale,
      });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, toChangeProposalDto(result.value));
    },
  );

  // POST /api/change-proposals/:changeProposalId/apply
  router.add(
    "POST",
    "/api/change-proposals/:changeProposalId/apply",
    async (_req, res, params) => {
      const changeProposalId = getParam(params, "changeProposalId");
      const proposal = await requireOwnedChangeProposal(
        deps,
        res,
        changeProposalId,
      );
      if (proposal == null) return;

      const result = await applyChangeProposal(deps, { changeProposalId });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, toChangeProposalDto(result.value));
    },
  );

  // ── Embedded agent chat (M3) ─────────────────────────────────────────────

  // POST /api/projects/:projectId/agent-conversations
  router.add(
    "POST",
    "/api/projects/:projectId/agent-conversations",
    async (req, res, params) => {
      const projectId = getParam(params, "projectId");
      const project = await requireOwnedProject(deps, res, projectId);
      if (project == null) return;

      const body = await readBodyOrRespond(req, res);
      if (body == null) return;

      const parsed = CreateAgentConversationSchema.safeParse(body.body);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const result = await createAgentChatConversation(deps, {
        projectId,
        title: parsed.data.title,
      });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 201, toAgentConversationDto(result.value));
    },
  );

  // GET /api/projects/:projectId/agent-conversations
  router.add(
    "GET",
    "/api/projects/:projectId/agent-conversations",
    async (_req, res, params) => {
      const projectId = getParam(params, "projectId");
      const project = await requireOwnedProject(deps, res, projectId);
      if (project == null) return;

      const result = await listAgentChatConversations(deps, { projectId });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, {
        conversations: result.value.map(toAgentConversationDto),
      });
    },
  );

  // GET /api/agent-conversations/:conversationId?afterSequence=N
  // A reconnecting client passes the last sequence it rendered and gets only
  // what it missed; omitting it returns the complete transcript.
  router.add(
    "GET",
    "/api/agent-conversations/:conversationId",
    async (req, res, params) => {
      const conversation = await requireOwnedConversation(
        deps,
        res,
        getParam(params, "conversationId"),
      );
      if (conversation == null) return;

      const url = new URL(req.url ?? "/", "http://localhost");
      const rawAfter = url.searchParams.get("afterSequence");
      const afterSequence = rawAfter == null ? undefined : Number(rawAfter);
      if (
        afterSequence != null &&
        (!Number.isInteger(afterSequence) || afterSequence < 0)
      ) {
        sendJson(
          res,
          422,
          errorBody(
            "validation_error",
            "afterSequence must be a non-negative integer.",
          ),
        );
        return;
      }

      const result = await getAgentChatConversation(deps, {
        conversationId: conversation.id,
        afterSequence,
      });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, toAgentConversationDetailDto(result.value));
    },
  );

  // POST /api/agent-conversations/:conversationId/turns
  router.add(
    "POST",
    "/api/agent-conversations/:conversationId/turns",
    async (req, res, params) => {
      const conversation = await requireOwnedConversation(
        deps,
        res,
        getParam(params, "conversationId"),
      );
      if (conversation == null) return;

      const body = await readBodyOrRespond(req, res);
      if (body == null) return;

      const parsed = PostAgentChatTurnSchema.safeParse(body.body);
      if (!parsed.success) {
        sendJson(res, 422, errorBody("validation_error", parsed.error.message));
        return;
      }

      const result = await postAgentChatTurn(deps, {
        conversationId: conversation.id,
        clientRequestId: parsed.data.clientRequestId,
        text: parsed.data.text,
        mentions: parsed.data.mentions,
      });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      // The provider turn runs after the response: it can take minutes, and
      // everything it produces reaches the client over the project's event
      // stream and is durable in the transcript either way.
      if (result.value.turn.status === "running") {
        void runAgentChatTurn(deps, { turnId: result.value.turn.id }).catch(
          (error: unknown) => {
            console.error("[agent-chat] turn failed:", error);
          },
        );
      }

      sendJson(res, 202, {
        turn: toAgentConversationTurnDto(result.value.turn),
        message: toAgentConversationMessageDto(result.value.message),
      });
    },
  );

  // POST /api/agent-conversation-turns/:turnId/cancel
  router.add(
    "POST",
    "/api/agent-conversation-turns/:turnId/cancel",
    async (_req, res, params) => {
      const turnId = getParam(params, "turnId");
      const turn = await deps.agentConversations.findTurnById(turnId);
      if (turn == null) {
        sendJson(res, 404, notFoundBody("Conversation turn not found."));
        return;
      }
      const conversation = await requireOwnedConversation(
        deps,
        res,
        turn.conversationId,
      );
      if (conversation == null) return;

      const result = await cancelAgentChatTurn(deps, { turnId });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, toAgentConversationTurnDto(result.value));
    },
  );

  // POST /api/agent-conversations/:conversationId/fork
  router.add(
    "POST",
    "/api/agent-conversations/:conversationId/fork",
    async (_req, res, params) => {
      const conversation = await requireOwnedConversation(
        deps,
        res,
        getParam(params, "conversationId"),
      );
      if (conversation == null) return;

      const result = await forkAgentChatProviderSession(deps, {
        conversationId: conversation.id,
      });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 201, toAgentProviderBindingDto(result.value));
    },
  );

  // POST /api/agent-conversations/:conversationId/compact
  router.add(
    "POST",
    "/api/agent-conversations/:conversationId/compact",
    async (_req, res, params) => {
      const conversation = await requireOwnedConversation(
        deps,
        res,
        getParam(params, "conversationId"),
      );
      if (conversation == null) return;

      const result = await compactAgentChatConversation(deps, {
        conversationId: conversation.id,
      });
      if (!result.ok) {
        sendJson(
          res,
          useCaseErrorToStatus(result.error.code),
          errorBody(result.error.code, result.error.message),
        );
        return;
      }

      sendJson(res, 200, toAgentProviderBindingDto(result.value));
    },
  );

  // POST /api/mcp/projects/:projectId — the embedded client's MCP transport.
  // The external CLI transport (`pnpm --filter @gen-story/api mcp:stdio`)
  // serves the identical tool registry over stdio.
  router.add(
    "POST",
    "/api/mcp/projects/:projectId",
    async (req, res, params) => {
      const projectId = getParam(params, "projectId");
      const project = await requireOwnedProject(deps, res, projectId);
      if (project == null) return;

      const body = await readBodyOrRespond(req, res);
      if (body == null) return;

      const url = new URL(req.url ?? "/", "http://localhost");
      await handleProjectMcpHttpRequest({
        deps,
        projectId,
        provider: resolveMcpProvider(url.searchParams.get("provider"), deps),
        req,
        res,
        body: body.body,
      });
    },
  );

  // The transport is stateless, so there is no session to resume or delete.
  for (const method of ["GET", "DELETE"] as const) {
    router.add(method, "/api/mcp/projects/:projectId", async (_req, res) => {
      sendJson(
        res,
        405,
        errorBody(
          "method_not_allowed",
          "The Gen Story MCP endpoint accepts POST only.",
        ),
      );
    });
  }

  router.add("GET", "/files/*", async (_req, res, params) => {
    const tail = getParam(params, "*");
    const safePath = resolve(repoRoot, ...tail.split("/").filter(Boolean));

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
