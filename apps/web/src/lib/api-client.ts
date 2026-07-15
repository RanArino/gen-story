import type {
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
  const res = await fetch(`${apiBase()}${path}`, {
    method,
    headers: body != null ? { "Content-Type": "application/json" } : undefined,
    body: body != null ? JSON.stringify(body) : undefined,
  });

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

export async function analyzeProjectPhotos(
  projectId: string,
): Promise<{ photoAnalysis: ProjectPhotoAnalysisDto; cached: boolean }> {
  const data = await request<{
    photoAnalysis: ProjectPhotoAnalysisDto;
    cached: boolean;
  }>("POST", `/api/projects/${projectId}/photo-analysis`, {});
  return { photoAnalysis: data.photoAnalysis, cached: data.cached };
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
): Promise<SceneDto[]> {
  const data = await request<{ scenes: SceneDto[] }>(
    "POST",
    `/api/storyboards/${storyboardId}/template-scenes`,
    { photoAssetIds },
  );
  return data.scenes;
}

export async function fillSceneWithAi(sceneId: string): Promise<SceneDto> {
  return request<SceneDto>("POST", `/api/scenes/${sceneId}/ai-fill`, {});
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
): Promise<ComplementSceneProposalDto[]> {
  const data = await request<{ proposals: ComplementSceneProposalDto[] }>(
    "POST",
    `/api/storyboards/${storyboardId}/complement-scenes/proposals`,
    { fromSceneId, toSceneId },
  );
  return data.proposals;
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

export async function resetTestGenerationBatch(
  storyboardId: string,
): Promise<TestGenerationBatchDto> {
  const data = await request<{ batch: TestGenerationBatchDto }>(
    "POST",
    `/api/storyboards/${storyboardId}/test-generation/reset`,
  );
  return data.batch;
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
