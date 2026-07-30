import type {
  AiJobDto,
  ComplementSceneProposalDto,
  GeneratedImageDto,
  GenerationRequestDto,
  GenerationRequestWithSceneTitleDto,
  Language,
  MeDto,
  PhotoAssetDto,
  ProjectDto,
  ProjectPhotoAnalysisDto,
  SceneDto,
  StylePresetDto,
  StoryboardDto,
  TestAdjustmentId,
  TestGenerationBatchDto,
  TestGenerationBatchWithVariantsDto,
  UserPreferenceDto,
} from "@gen-story/shared";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, {
      method,
      headers:
        body != null ? { "Content-Type": "application/json" } : undefined,
      body: body != null ? JSON.stringify(body) : undefined,
    });
  } catch {
    // fetch only rejects before a response exists, so the API was unreachable.
    // Its own "Failed to fetch" says nothing about which server is down.
    throw new ApiError(
      0,
      "API_UNREACHABLE",
      `Cannot reach the API server at ${apiBase()}. Make sure it is running (pnpm dev).`,
    );
  }

  if (!res.ok) {
    let code = "UNKNOWN";
    let message = res.statusText;
    try {
      const json = (await res.json()) as {
        error?: { code?: string; message?: string };
      };
      code = json.error?.code ?? code;
      message = json.error?.message ?? message;
    } catch {
      // ignore parse failure
    }
    throw new ApiError(res.status, code, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function getMe(): Promise<MeDto> {
  return request<MeDto>("GET", "/api/me");
}

// ── AI jobs ───────────────────────────────────────────────────────────────────

export type ProjectEvent = {
  kind: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
};

const AI_JOB_TERMINAL_STATUSES = ["succeeded", "failed", "canceled"];

export function isAiJobTerminal(job: AiJobDto): boolean {
  return AI_JOB_TERMINAL_STATUSES.includes(job.status);
}

export async function getAiJob(jobId: string): Promise<AiJobDto> {
  return request<AiJobDto>("GET", `/api/ai-jobs/${jobId}`);
}

export async function cancelAiJob(jobId: string): Promise<AiJobDto> {
  return request<AiJobDto>("POST", `/api/ai-jobs/${jobId}/cancel`);
}

// Live project event stream. Returns an unsubscribe function.
export function subscribeToProjectEvents(
  projectId: string,
  handler: (event: ProjectEvent) => void,
): () => void {
  const source = new EventSource(
    `${apiBase()}/api/projects/${projectId}/events`,
  );

  const onMessage = (message: MessageEvent<string>) => {
    try {
      handler(JSON.parse(message.data) as ProjectEvent);
    } catch {
      // A malformed frame is not worth breaking the stream over.
    }
  };

  // Named SSE events do not fire the default `message` handler, so listen for
  // each kind the server emits.
  const kinds = [
    "ai-job.queued",
    "ai-job.running",
    "ai-job.succeeded",
    "ai-job.failed",
    "ai-job.canceled",
    "project_photo_analysis.completed",
    "scene.ai_filled",
    "generation-request.created",
    "generation-request.retried",
    "generation-request.running",
    "generation-request.succeeded",
    "generation-request.failed",
  ];
  for (const kind of kinds) source.addEventListener(kind, onMessage);
  source.addEventListener("message", onMessage);

  return () => {
    for (const kind of kinds) source.removeEventListener(kind, onMessage);
    source.removeEventListener("message", onMessage);
    source.close();
  };
}

export type AiJobWatchOptions = {
  projectId: string;
  onJobId?: (jobId: string) => void;
  onStatus?: (status: string) => void;
};

// Resolve once the job reaches a terminal state. The event stream makes this
// prompt; the poll makes it correct even if the stream never connects.
export async function awaitAiJob(
  jobId: string,
  options: AiJobWatchOptions,
): Promise<AiJobDto> {
  return new Promise<AiJobDto>((resolve, reject) => {
    let settled = false;
    let lastStatus: string | null = null;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      unsubscribe();
      fn();
    };

    const check = async () => {
      if (settled) return;
      try {
        const job = await getAiJob(jobId);
        if (job.status !== lastStatus) {
          lastStatus = job.status;
          options.onStatus?.(job.status);
        }
        if (!isAiJobTerminal(job)) return;
        finish(() => resolve(job));
      } catch (err) {
        finish(() => reject(err));
      }
    };

    const unsubscribe = subscribeToProjectEvents(options.projectId, (event) => {
      if (event.payload?.aiJobId === jobId) void check();
    });
    const timer = setInterval(() => void check(), 2000);
    void check();
  });
}

// Cancellation is a user action, not a failure; callers distinguish it so the
// UI can return to idle instead of showing an error.
export class AiJobCanceledError extends Error {
  constructor() {
    super("AI job was canceled.");
    this.name = "AiJobCanceledError";
  }
}

function aiJobResultOrThrow(job: AiJobDto, fallbackMessage: string): void {
  if (job.status === "succeeded") return;
  if (job.status === "canceled") throw new AiJobCanceledError();
  throw new Error(job.errorMessage ?? fallbackMessage);
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function listProjects(
  includeDeleted = false,
): Promise<ProjectDto[]> {
  const qs = includeDeleted ? "?includeDeleted=true" : "";
  const data = await request<{ projects: ProjectDto[] }>(
    "GET",
    `/api/projects${qs}`,
  );
  return data.projects;
}

export async function deleteProject(projectId: string): Promise<void> {
  return request<void>("DELETE", `/api/projects/${projectId}`);
}

export async function restoreProject(projectId: string): Promise<ProjectDto> {
  return request<ProjectDto>("POST", `/api/projects/${projectId}/restore`);
}

export async function createProject(
  name: string,
  occasion?: string,
): Promise<ProjectDto> {
  return request<ProjectDto>("POST", "/api/projects", { name, occasion });
}

// ── Photo Assets ──────────────────────────────────────────────────────────────

export async function listPhotoAssets(
  projectId: string,
  includeDeleted = false,
): Promise<PhotoAssetDto[]> {
  const qs = includeDeleted ? "?includeDeleted=true" : "";
  const data = await request<{ photoAssets: PhotoAssetDto[] }>(
    "GET",
    `/api/projects/${projectId}/photo-assets${qs}`,
  );
  return data.photoAssets;
}

export async function deletePhotoAsset(photoAssetId: string): Promise<void> {
  return request<void>("DELETE", `/api/photo-assets/${photoAssetId}`);
}

export async function restorePhotoAsset(
  photoAssetId: string,
): Promise<PhotoAssetDto> {
  return request<PhotoAssetDto>(
    "POST",
    `/api/photo-assets/${photoAssetId}/restore`,
  );
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // strip the data URL prefix (e.g. "data:image/jpeg;base64,")
      resolve(result.split(",")[1] ?? result);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export async function uploadPhotoAsset(
  projectId: string,
  file: File,
  notes?: string,
): Promise<PhotoAssetDto> {
  const contentBase64 = await fileToBase64(file);
  return request<PhotoAssetDto>(
    "POST",
    `/api/projects/${projectId}/photo-assets`,
    {
      name: file.name,
      mimeType: file.type || "image/jpeg",
      contentBase64,
      notes: notes ?? null,
    },
  );
}

export type PhotoUsage = "candidate" | "excluded" | "reference";

export async function patchPhotoAsset(
  photoAssetId: string,
  usage: PhotoUsage,
): Promise<PhotoAssetDto> {
  return request<PhotoAssetDto>("PATCH", `/api/photo-assets/${photoAssetId}`, {
    usage,
  });
}

export async function reorderPhotos(
  projectId: string,
  photoAssetIds: string[],
): Promise<PhotoAssetDto[]> {
  const data = await request<{ photoAssets: PhotoAssetDto[] }>(
    "PATCH",
    `/api/projects/${projectId}/photos/order`,
    { photoAssetIds },
  );
  return data.photoAssets;
}

// ── Photo Analysis ───────────────────────────────────────────────────────────

export async function getProjectPhotoAnalysis(
  projectId: string,
): Promise<ProjectPhotoAnalysisDto | null> {
  const data = await request<{ photoAnalysis: ProjectPhotoAnalysisDto | null }>(
    "GET",
    `/api/projects/${projectId}/photo-analysis`,
  );
  return data.photoAnalysis;
}

// Enqueues a background job unless the stored analysis is still valid, then
// waits for it and returns the persisted result.
export async function analyzeProjectPhotos(
  projectId: string,
  watch?: Omit<AiJobWatchOptions, "projectId">,
): Promise<{ photoAnalysis: ProjectPhotoAnalysisDto; cached: boolean }> {
  const data = await request<{
    photoAnalysis: ProjectPhotoAnalysisDto | null;
    cached: boolean;
    jobId: string | null;
  }>("POST", `/api/projects/${projectId}/photo-analysis`, {});

  if (data.cached && data.photoAnalysis != null) {
    return { photoAnalysis: data.photoAnalysis, cached: true };
  }

  if (data.jobId == null) {
    throw new Error("Photo analysis did not start.");
  }
  watch?.onJobId?.(data.jobId);

  const job = await awaitAiJob(data.jobId, { projectId, ...watch });
  aiJobResultOrThrow(job, "Photo analysis failed.");

  const analysis = await getProjectPhotoAnalysis(projectId);
  if (analysis == null) {
    throw new Error("Photo analysis produced no result.");
  }
  return { photoAnalysis: analysis, cached: false };
}

// ── Storyboards ───────────────────────────────────────────────────────────────

export async function listStoryboards(
  projectId: string,
): Promise<StoryboardDto[]> {
  const data = await request<{ storyboards: StoryboardDto[] }>(
    "GET",
    `/api/projects/${projectId}/storyboards`,
  );
  return data.storyboards;
}

export async function upsertStoryboard(
  storyboardId: string,
  input: {
    projectId: string;
    tone: string;
    stylePresetId?: string | null;
    status?: string;
    commonPrompt?: string;
    story?: string;
    negativePrompt?: string;
  },
): Promise<StoryboardDto> {
  return request<StoryboardDto>(
    "PUT",
    `/api/storyboards/${storyboardId}`,
    input,
  );
}

// ── Scenes ────────────────────────────────────────────────────────────────────

export async function listScenes(storyboardId: string): Promise<SceneDto[]> {
  const data = await request<{ scenes: SceneDto[] }>(
    "GET",
    `/api/storyboards/${storyboardId}/scenes`,
  );
  return data.scenes;
}

export type UpsertSceneInput = {
  sceneId?: string;
  orderIndex: number;
  title: string;
  description: string;
  imagePrompt: string;
  emotion: string;
  cameraDirection: string;
  lightingDirection: string;
  motionDirection: string;
  notes?: string;
  negativePrompt?: string;
};

export type PreviewScenePromptOverrides = {
  imagePrompt?: string;
  emotion?: string;
  cameraDirection?: string;
  lightingDirection?: string;
  motionDirection?: string;
  sceneNegativePrompt?: string;
  projectNegativePrompt?: string;
  commonPrompt?: string;
  story?: string;
};

export type ComposedPromptPreview = {
  prompt: string;
  negativePrompt: string;
};

// Read-only, side-effect-free, no image call. Returns the exact positive and
// negative prompt the next generation would use given the current (possibly
// unsaved) form values.
export async function previewScenePrompt(
  sceneId: string,
  overrides: PreviewScenePromptOverrides = {},
): Promise<ComposedPromptPreview> {
  return request<ComposedPromptPreview>(
    "POST",
    `/api/scenes/${sceneId}/preview-prompt`,
    overrides,
  );
}

export async function upsertScenes(
  storyboardId: string,
  scenes: UpsertSceneInput[],
): Promise<SceneDto[]> {
  const data = await request<{ scenes: SceneDto[] }>(
    "PUT",
    `/api/storyboards/${storyboardId}/scenes`,
    { scenes },
  );
  return data.scenes;
}

export async function reorderScenes(
  storyboardId: string,
  sceneIds: string[],
): Promise<SceneDto[]> {
  const data = await request<{ scenes: SceneDto[] }>(
    "PUT",
    `/api/storyboards/${storyboardId}/scene-order`,
    { sceneIds },
  );
  return data.scenes;
}

export async function assignPhotosToScene(
  sceneId: string,
  photoAssets: { photoAssetId: string; role: "primary" | "reference" }[],
): Promise<SceneDto> {
  return request<SceneDto>("PUT", `/api/scenes/${sceneId}/photo-assets`, {
    photoAssets,
  });
}

export async function createTemplateScenesFromPhotos(
  storyboardId: string,
  photoAssetIds: string[],
  autoFill = false,
): Promise<{ scenes: SceneDto[]; aiJobIds: string[] }> {
  const data = await request<{ scenes: SceneDto[]; aiJobIds: string[] }>(
    "POST",
    `/api/storyboards/${storyboardId}/template-scenes`,
    { photoAssetIds, autoFill },
  );
  return { scenes: data.scenes, aiJobIds: data.aiJobIds ?? [] };
}

export async function fillSceneWithAi(
  sceneId: string,
  context: {
    projectId: string;
    storyboardId: string;
  } & Omit<AiJobWatchOptions, "projectId">,
): Promise<SceneDto> {
  const { projectId, storyboardId, ...watch } = context;
  const data = await request<{ scene: SceneDto | null; jobId: string | null }>(
    "POST",
    `/api/scenes/${sceneId}/ai-fill`,
    {},
  );

  // Nothing was blank, so there was no AI call and no job.
  if (data.jobId == null) {
    if (data.scene == null) throw new Error("AI fill returned no scene.");
    return data.scene;
  }
  watch.onJobId?.(data.jobId);

  const job = await awaitAiJob(data.jobId, { projectId, ...watch });
  aiJobResultOrThrow(job, "AI fill failed.");

  const scene = (await listScenes(storyboardId)).find(
    (candidate) => candidate.id === sceneId,
  );
  if (scene == null) throw new Error("AI fill returned no scene.");
  return scene;
}

// ── Complement Scenes ─────────────────────────────────────────────────────────

export async function insertComplementScene(
  storyboardId: string,
  fromSceneId: string,
  toSceneId: string,
): Promise<SceneDto> {
  return request<SceneDto>(
    "POST",
    `/api/storyboards/${storyboardId}/complement-scenes`,
    { fromSceneId, toSceneId },
  );
}

export async function proposeComplementScenes(
  storyboardId: string,
  fromSceneId: string,
  toSceneId: string,
  watch: AiJobWatchOptions,
): Promise<ComplementSceneProposalDto[]> {
  const data = await request<{ jobId: string }>(
    "POST",
    `/api/storyboards/${storyboardId}/complement-scenes/proposals`,
    { fromSceneId, toSceneId },
  );
  watch.onJobId?.(data.jobId);

  const job = await awaitAiJob(data.jobId, watch);
  aiJobResultOrThrow(job, "Complement scene proposals failed.");

  const proposals = job.resultJson?.proposals;
  return Array.isArray(proposals)
    ? (proposals as ComplementSceneProposalDto[])
    : [];
}

// ── Style Presets ─────────────────────────────────────────────────────────────

export async function listStylePresets(): Promise<StylePresetDto[]> {
  const data = await request<{ stylePresets: StylePresetDto[] }>(
    "GET",
    "/api/style-presets",
  );
  return data.stylePresets;
}

export async function createCustomStyle(input: {
  name: string;
  description: string;
  prompt: string;
  referenceImageStorageKey?: string;
}): Promise<StylePresetDto> {
  const data = await request<{ stylePreset: StylePresetDto }>(
    "POST",
    "/api/style-presets",
    input,
  );
  return data.stylePreset;
}

// ── Generation Requests ───────────────────────────────────────────────────────

export async function createGenerationRequest(
  sceneId: string,
  inputJson: Record<string, unknown>,
): Promise<GenerationRequestDto> {
  return request<GenerationRequestDto>(
    "POST",
    `/api/scenes/${sceneId}/generation-requests`,
    { inputJson },
  );
}

export async function listGenerationRequests(
  sceneId: string,
): Promise<GenerationRequestDto[]> {
  const data = await request<{ generationRequests: GenerationRequestDto[] }>(
    "GET",
    `/api/scenes/${sceneId}/generation-requests`,
  );
  return data.generationRequests;
}

export async function listStoryboardGenerationRequests(
  storyboardId: string,
): Promise<GenerationRequestWithSceneTitleDto[]> {
  const data = await request<{
    generationRequests: GenerationRequestWithSceneTitleDto[];
  }>("GET", `/api/storyboards/${storyboardId}/generation-requests`);
  return data.generationRequests;
}

export async function retryGenerationRequest(
  generationRequestId: string,
): Promise<GenerationRequestDto> {
  return request<GenerationRequestDto>(
    "POST",
    `/api/generation-requests/${generationRequestId}/retry`,
  );
}

export async function cancelGenerationRequest(
  generationRequestId: string,
): Promise<GenerationRequestDto> {
  return request<GenerationRequestDto>(
    "POST",
    `/api/generation-requests/${generationRequestId}/cancel`,
  );
}

// ── Generated Images ──────────────────────────────────────────────────────────

export async function listGeneratedImages(
  sceneId: string,
): Promise<GeneratedImageDto[]> {
  const data = await request<{ generatedImages: GeneratedImageDto[] }>(
    "GET",
    `/api/scenes/${sceneId}/generated-images`,
  );
  return data.generatedImages;
}

export async function adoptGeneratedImage(
  sceneId: string,
  generatedImageId: string,
): Promise<void> {
  return request<void>(
    "POST",
    `/api/scenes/${sceneId}/generated-images/${generatedImageId}/adopt`,
  );
}

export async function getTestGenerationBatch(
  storyboardId: string,
): Promise<TestGenerationBatchDto | null> {
  const data = await request<{ batch: TestGenerationBatchDto | null }>(
    "GET",
    `/api/storyboards/${storyboardId}/test-generation/current`,
  );
  return data.batch;
}

export async function requestTestGenerationBatch(
  storyboardId: string,
  sceneId: string,
): Promise<{
  batch: TestGenerationBatchDto;
  generationRequests: GenerationRequestDto[];
}> {
  return request<{
    batch: TestGenerationBatchDto;
    generationRequests: GenerationRequestDto[];
  }>("POST", `/api/storyboards/${storyboardId}/test-generation`, { sceneId });
}

export async function confirmTestGenerationBatch(
  storyboardId: string,
  confirmedGenerationRequestId: string,
): Promise<TestGenerationBatchDto> {
  const data = await request<{ batch: TestGenerationBatchDto }>(
    "POST",
    `/api/storyboards/${storyboardId}/test-generation/confirm`,
    { confirmedGenerationRequestId },
  );
  return data.batch;
}

// The storyboard's whole sample history, newest batch first, with each sample's
// image already attached.
export async function listTestGenerationBatches(
  storyboardId: string,
): Promise<TestGenerationBatchWithVariantsDto[]> {
  const data = await request<{
    batches: TestGenerationBatchWithVariantsDto[];
  }>("GET", `/api/storyboards/${storyboardId}/test-generation/batches`);
  return data.batches;
}

export async function applyTestVariantAdjustments(
  storyboardId: string,
  variantId: string,
  adjustmentIds: TestAdjustmentId[],
): Promise<GenerationRequestDto> {
  const data = await request<{ generationRequest: GenerationRequestDto }>(
    "POST",
    `/api/storyboards/${storyboardId}/test-generation/variants/${variantId}/adjustments`,
    { adjustmentIds },
  );
  return data.generationRequest;
}

export function exportStoryboardUrl(
  storyboardId: string,
  language?: Language,
): string {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
  const qs = language ? `?lang=${language}` : "";
  return `${base}/api/storyboards/${storyboardId}/export.json${qs}`;
}

// ── User preferences ──────────────────────────────────────────────────────────

export async function getUserLanguagePreference(): Promise<UserPreferenceDto> {
  const data = await request<{ preference: UserPreferenceDto }>(
    "GET",
    "/api/user/preferences",
  );
  return data.preference;
}

export async function setUserLanguagePreference(
  language: Language,
): Promise<UserPreferenceDto> {
  const data = await request<{ preference: UserPreferenceDto }>(
    "PUT",
    "/api/user/preferences",
    { language },
  );
  return data.preference;
}
