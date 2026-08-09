export type Timestamp = string;

export type ProjectId = string;
export type OrganizationId = string;
export type UserId = string;
export type PhotoAssetId = string;
export type StoryboardId = string;
export type SceneId = string;
export type StylePresetId = string;
export type GenerationRequestId = string;
export type GeneratedImageId = string;
export type ProjectPhotoAnalysisId = string;
export type TestGenerationBatchId = string;
export type AiJobId = string;

export type ProjectStatus = "draft" | "active" | "completed" | "archived";
export type TestGenerationBatchStatus = "pending" | "completed";
export type StoryboardStatus = "draft" | "editing" | "ready" | "completed";
export type SceneStatus = "draft" | "ready" | "completed";
export type PhotoUsage = "candidate" | "excluded" | "reference";
export type ScenePhotoRole = "primary" | "reference";
export type StylePresetScope = "system" | "user";
export type GenerationRequestStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

// Background text/vision AI work. Image generation is not an AI job; it keeps
// its own GenerationRequest lifecycle.
export type AiJobKind =
  | "photo_analysis"
  | "story_setup"
  | "scene_ai_fill"
  | "complement_scene_proposals";

export type AiJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export const AI_JOB_KINDS: AiJobKind[] = [
  "photo_analysis",
  "story_setup",
  "scene_ai_fill",
  "complement_scene_proposals",
];

export function isAiJobKind(value: unknown): value is AiJobKind {
  return (
    typeof value === "string" && (AI_JOB_KINDS as string[]).includes(value)
  );
}

export type TestAdjustmentId =
  | "warmer"
  | "cooler"
  | "more_cinematic"
  | "darker"
  | "brighter"
  | "more_candid";

export const TEST_ADJUSTMENT_IDS: TestAdjustmentId[] = [
  "warmer",
  "cooler",
  "more_cinematic",
  "darker",
  "brighter",
  "more_candid",
];

export function isTestAdjustmentId(value: unknown): value is TestAdjustmentId {
  return (
    typeof value === "string" &&
    (TEST_ADJUSTMENT_IDS as string[]).includes(value)
  );
}

export type User = {
  id: UserId;
  organizationId: OrganizationId;
  displayName: string;
  email: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type Organization = {
  id: OrganizationId;
  name: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type Project = {
  id: ProjectId;
  organizationId: OrganizationId;
  ownerUserId: UserId;
  name: string;
  status: ProjectStatus;
  deletedAt: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type PhotoAsset = {
  id: PhotoAssetId;
  projectId: ProjectId;
  name: string;
  usage: PhotoUsage;
  storageKey: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  checksum: string;
  sourceKind: string;
  notes: string | null;
  position: number;
  deletedAt: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type ScenePhotoAsset = {
  photoAssetId: PhotoAssetId;
  role: ScenePhotoRole;
};

export type SceneKind = "photo" | "complement";

export type SceneBridge = {
  fromSceneId: SceneId;
  toSceneId: SceneId;
};

export type Scene = {
  id: SceneId;
  projectId: ProjectId;
  storyboardId: StoryboardId;
  orderIndex: number;
  status: SceneStatus;
  kind: SceneKind;
  bridge: SceneBridge | null;
  title: string;
  description: string;
  imagePrompt: string;
  emotion: string;
  cameraDirection: string;
  lightingDirection: string;
  motionDirection: string;
  notes: string;
  negativePrompt: string;
  photoAssets: ScenePhotoAsset[];
  adoptedGeneratedImageId: GeneratedImageId | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type Storyboard = {
  id: StoryboardId;
  projectId: ProjectId;
  status: StoryboardStatus;
  // Empty means "not decided yet". The guided setup flow needs to tell an
  // undecided storyboard from one where the user deliberately chose a tone,
  // which a default value would make impossible.
  tone: string;
  stylePresetId: StylePresetId | null;
  commonPrompt: string;
  story: string;
  negativePrompt: string;
  sceneIds: SceneId[];
  // When set, the storyboard has been through all five setup steps and is
  // freely editable. Null means the guided flow is still gating it.
  setupCompletedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type StylePreset = {
  id: StylePresetId;
  scope: StylePresetScope;
  name: string;
  description: string;
  prompt: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type GenerationRequest = {
  id: GenerationRequestId;
  projectId: ProjectId;
  storyboardId: StoryboardId;
  sceneId: SceneId;
  status: GenerationRequestStatus;
  inputJson: Record<string, unknown>;
  errorMessage: string | null;
  sourceGenerationRequestId: GenerationRequestId | null;
  appliedAdjustments: TestAdjustmentId[];
  // Set only on the variants of a test-generation batch. It is what makes "the
  // samples of batch X" a query rather than a scan of inputJson.
  testGenerationBatchId: TestGenerationBatchId | null;
  startedAt: Timestamp | null;
  completedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type AiJob = {
  id: AiJobId;
  projectId: ProjectId;
  kind: AiJobKind;
  status: AiJobStatus;
  inputJson: Record<string, unknown>;
  resultJson: Record<string, unknown> | null;
  errorMessage: string | null;
  startedAt: Timestamp | null;
  completedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type GeneratedImage = {
  id: GeneratedImageId;
  projectId: ProjectId;
  storyboardId: StoryboardId;
  sceneId: SceneId;
  generationRequestId: GenerationRequestId;
  storageKey: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  checksum: string;
  adoptedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type EmotionCandidate = {
  value: string;
  label: string;
  description: string;
  reason: string;
};

export type PhotoInsight = {
  photoAssetId: PhotoAssetId;
  summary: string;
  people: string;
  setting: string;
  event: string;
  atmosphere: string;
};

export type ProjectPhotoAnalysis = {
  id: ProjectPhotoAnalysisId;
  projectId: ProjectId;
  emotionCandidates: EmotionCandidate[];
  photoInsights: PhotoInsight[];
  storySummary: string;
  model: string;
  // Fingerprint of the analysis inputs (analyzable photo set + language).
  // Used to skip redundant AI calls when nothing relevant has changed.
  inputsHash: string;
  deletedAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type TestGenerationBatch = {
  id: TestGenerationBatchId;
  storyboardId: StoryboardId;
  status: TestGenerationBatchStatus;
  confirmedGenerationRequestId: GenerationRequestId | null;
  createdAt: Timestamp;
  completedAt: Timestamp | null;
};

export type CreateUserInput = {
  id: UserId;
  organizationId: OrganizationId;
  displayName: string;
  email?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CreateOrganizationInput = {
  id: OrganizationId;
  name: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CreateProjectInput = {
  id: ProjectId;
  organizationId: OrganizationId;
  ownerUserId: UserId;
  name: string;
  status?: ProjectStatus;
  deletedAt?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CreatePhotoAssetInput = {
  id: PhotoAssetId;
  projectId: ProjectId;
  name: string;
  storageKey: string;
  mimeType: string;
  size: number;
  width?: number | null;
  height?: number | null;
  checksum: string;
  sourceKind: string;
  notes?: string | null;
  usage?: PhotoUsage;
  position?: number;
  deletedAt?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CreateStoryboardInput = {
  id: StoryboardId;
  projectId: ProjectId;
  status?: StoryboardStatus;
  tone?: string;
  stylePresetId?: StylePresetId | null;
  commonPrompt?: string;
  story?: string;
  negativePrompt?: string;
  sceneIds?: SceneId[];
  setupCompletedAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CreateSceneInput = {
  id: SceneId;
  projectId: ProjectId;
  storyboardId: StoryboardId;
  orderIndex: number;
  status?: SceneStatus;
  kind?: SceneKind;
  bridge?: SceneBridge | null;
  title: string;
  description: string;
  imagePrompt: string;
  emotion: string;
  cameraDirection: string;
  lightingDirection: string;
  motionDirection: string;
  notes?: string;
  negativePrompt?: string;
  photoAssets?: ScenePhotoAsset[];
  adoptedGeneratedImageId?: GeneratedImageId | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CreateStylePresetInput = {
  id: StylePresetId;
  scope: StylePresetScope;
  name: string;
  description?: string;
  prompt: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CreateGenerationRequestInput = {
  id: GenerationRequestId;
  projectId: ProjectId;
  storyboardId: StoryboardId;
  sceneId: SceneId;
  inputJson: Record<string, unknown>;
  status?: GenerationRequestStatus;
  errorMessage?: string | null;
  sourceGenerationRequestId?: GenerationRequestId | null;
  appliedAdjustments?: TestAdjustmentId[];
  testGenerationBatchId?: TestGenerationBatchId | null;
  startedAt?: Timestamp | null;
  completedAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CreateAiJobInput = {
  id: AiJobId;
  projectId: ProjectId;
  kind: AiJobKind;
  inputJson: Record<string, unknown>;
  status?: AiJobStatus;
  resultJson?: Record<string, unknown> | null;
  errorMessage?: string | null;
  startedAt?: Timestamp | null;
  completedAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CreateGeneratedImageInput = {
  id: GeneratedImageId;
  projectId: ProjectId;
  storyboardId: StoryboardId;
  sceneId: SceneId;
  generationRequestId: GenerationRequestId;
  storageKey: string;
  mimeType: string;
  size: number;
  width?: number | null;
  height?: number | null;
  checksum: string;
  adoptedAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CreateProjectPhotoAnalysisInput = {
  id: ProjectPhotoAnalysisId;
  projectId: ProjectId;
  emotionCandidates: EmotionCandidate[];
  photoInsights: PhotoInsight[];
  storySummary: string;
  model: string;
  inputsHash?: string;
  deletedAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CreateTestGenerationBatchInput = {
  id: TestGenerationBatchId;
  storyboardId: StoryboardId;
  status?: TestGenerationBatchStatus;
  confirmedGenerationRequestId?: GenerationRequestId | null;
  createdAt: Timestamp;
  completedAt?: Timestamp | null;
};

function trimRequiredText(value: string, fieldName: string): string {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    throw new Error(`${fieldName} is required.`);
  }

  return trimmedValue;
}

function trimOptionalText(value: string | null | undefined): string {
  return value == null ? "" : value.trim();
}

function trimRequiredAnalysisText(value: string, fieldName: string): string {
  return trimRequiredText(value, fieldName);
}

export function createUser(input: CreateUserInput): User {
  return {
    id: input.id,
    organizationId: input.organizationId,
    displayName: trimRequiredText(input.displayName, "User display name"),
    email: trimOptionalText(input.email) || null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export function createOrganization(
  input: CreateOrganizationInput,
): Organization {
  return {
    id: input.id,
    name: trimRequiredText(input.name, "Organization name"),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export function createProject(input: CreateProjectInput): Project {
  return {
    id: input.id,
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
    name: trimRequiredText(input.name, "Project name"),
    status: input.status ?? "draft",
    deletedAt: input.deletedAt ?? null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export function createPhotoAsset(input: CreatePhotoAssetInput): PhotoAsset {
  return {
    id: input.id,
    projectId: input.projectId,
    name: trimRequiredText(input.name, "Photo asset name"),
    usage: input.usage ?? "candidate",
    storageKey: trimRequiredText(input.storageKey, "Photo asset storage key"),
    mimeType: trimRequiredText(input.mimeType, "Photo asset MIME type"),
    size: input.size,
    width: input.width ?? null,
    height: input.height ?? null,
    checksum: trimRequiredText(input.checksum, "Photo asset checksum"),
    sourceKind: trimRequiredText(input.sourceKind, "Photo asset source kind"),
    notes: trimOptionalText(input.notes) || null,
    position: input.position ?? 0,
    deletedAt: input.deletedAt ?? null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export function createStoryboard(input: CreateStoryboardInput): Storyboard {
  return {
    id: input.id,
    projectId: input.projectId,
    status: input.status ?? "draft",
    // Optional on purpose: a blank tone is the "undecided" state the guided
    // setup flow gates on, not a validation error.
    tone: trimOptionalText(input.tone),
    stylePresetId: input.stylePresetId ?? null,
    commonPrompt: (input.commonPrompt ?? "").trim(),
    story: (input.story ?? "").trim(),
    negativePrompt: (input.negativePrompt ?? "").trim(),
    sceneIds: [...(input.sceneIds ?? [])],
    setupCompletedAt: input.setupCompletedAt ?? null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export function createScene(input: CreateSceneInput): Scene {
  return {
    id: input.id,
    projectId: input.projectId,
    storyboardId: input.storyboardId,
    orderIndex: input.orderIndex,
    status: input.status ?? "draft",
    kind: input.kind ?? "photo",
    bridge: input.bridge ?? null,
    title: trimOptionalText(input.title),
    description: trimOptionalText(input.description),
    imagePrompt: trimOptionalText(input.imagePrompt),
    emotion: trimOptionalText(input.emotion),
    cameraDirection: trimOptionalText(input.cameraDirection),
    lightingDirection: trimOptionalText(input.lightingDirection),
    motionDirection: trimOptionalText(input.motionDirection),
    notes: trimOptionalText(input.notes),
    negativePrompt: trimOptionalText(input.negativePrompt),
    photoAssets: [...(input.photoAssets ?? [])],
    adoptedGeneratedImageId: input.adoptedGeneratedImageId ?? null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export type CreateTemplateSceneInput = {
  id: SceneId;
  projectId: ProjectId;
  storyboardId: StoryboardId;
  orderIndex: number;
  photoAssetId?: PhotoAssetId;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export function createTemplateScene(input: CreateTemplateSceneInput): Scene {
  return {
    id: input.id,
    projectId: input.projectId,
    storyboardId: input.storyboardId,
    orderIndex: input.orderIndex,
    status: "draft",
    kind: "photo",
    bridge: null,
    title: "",
    description: "",
    imagePrompt: "",
    emotion: "",
    cameraDirection: "",
    lightingDirection: "",
    motionDirection: "",
    notes: "",
    negativePrompt: "",
    photoAssets: input.photoAssetId
      ? [{ photoAssetId: input.photoAssetId, role: "primary" }]
      : [],
    adoptedGeneratedImageId: null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export type CreateComplementSceneInput = {
  id: SceneId;
  projectId: ProjectId;
  storyboardId: StoryboardId;
  orderIndex: number;
  bridge: SceneBridge;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export function createComplementScene(
  input: CreateComplementSceneInput,
): Scene {
  if (input.bridge.fromSceneId === input.bridge.toSceneId) {
    throw new Error(
      "A complement scene bridge must reference two distinct scenes.",
    );
  }

  return {
    id: input.id,
    projectId: input.projectId,
    storyboardId: input.storyboardId,
    orderIndex: input.orderIndex,
    status: "draft",
    kind: "complement",
    bridge: {
      fromSceneId: input.bridge.fromSceneId,
      toSceneId: input.bridge.toSceneId,
    },
    title: "",
    description: "",
    imagePrompt: "",
    emotion: "",
    cameraDirection: "",
    lightingDirection: "",
    motionDirection: "",
    notes: "",
    negativePrompt: "",
    photoAssets: [],
    adoptedGeneratedImageId: null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export function createStylePreset(input: CreateStylePresetInput): StylePreset {
  return {
    id: input.id,
    scope: input.scope,
    name: trimRequiredText(input.name, "Style preset name"),
    description: trimOptionalText(input.description),
    prompt: trimRequiredText(input.prompt, "Style preset prompt"),
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export function createGenerationRequest(
  input: CreateGenerationRequestInput,
): GenerationRequest {
  return {
    id: input.id,
    projectId: input.projectId,
    storyboardId: input.storyboardId,
    sceneId: input.sceneId,
    status: input.status ?? "queued",
    inputJson: { ...input.inputJson },
    errorMessage: trimOptionalText(input.errorMessage) || null,
    sourceGenerationRequestId: input.sourceGenerationRequestId ?? null,
    appliedAdjustments: [...(input.appliedAdjustments ?? [])],
    testGenerationBatchId: input.testGenerationBatchId ?? null,
    startedAt: input.startedAt ?? null,
    completedAt: input.completedAt ?? null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export function createAiJob(input: CreateAiJobInput): AiJob {
  return {
    id: input.id,
    projectId: input.projectId,
    kind: input.kind,
    status: input.status ?? "queued",
    inputJson: { ...input.inputJson },
    resultJson: input.resultJson ?? null,
    errorMessage: trimOptionalText(input.errorMessage) || null,
    startedAt: input.startedAt ?? null,
    completedAt: input.completedAt ?? null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export function createGeneratedImage(
  input: CreateGeneratedImageInput,
): GeneratedImage {
  return {
    id: input.id,
    projectId: input.projectId,
    storyboardId: input.storyboardId,
    sceneId: input.sceneId,
    generationRequestId: input.generationRequestId,
    storageKey: trimRequiredText(
      input.storageKey,
      "Generated image storage key",
    ),
    mimeType: trimRequiredText(input.mimeType, "Generated image MIME type"),
    size: input.size,
    width: input.width ?? null,
    height: input.height ?? null,
    checksum: trimRequiredText(input.checksum, "Generated image checksum"),
    adoptedAt: input.adoptedAt ?? null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export function createProjectPhotoAnalysis(
  input: CreateProjectPhotoAnalysisInput,
): ProjectPhotoAnalysis {
  const emotionCandidates = input.emotionCandidates.map((candidate) => ({
    value: trimRequiredAnalysisText(candidate.value, "Emotion candidate value"),
    label: trimRequiredAnalysisText(candidate.label, "Emotion candidate label"),
    description: trimRequiredAnalysisText(
      candidate.description,
      "Emotion candidate description",
    ),
    reason: trimRequiredAnalysisText(
      candidate.reason,
      "Emotion candidate reason",
    ),
  }));

  if (emotionCandidates.length === 0) {
    throw new Error("Project photo analysis emotion candidates are required.");
  }

  const photoInsights = input.photoInsights.map((insight) => ({
    photoAssetId: trimRequiredAnalysisText(
      insight.photoAssetId,
      "Photo insight photo asset ID",
    ),
    summary: trimRequiredAnalysisText(insight.summary, "Photo insight summary"),
    people: trimRequiredAnalysisText(insight.people, "Photo insight people"),
    setting: trimRequiredAnalysisText(insight.setting, "Photo insight setting"),
    event: trimRequiredAnalysisText(insight.event, "Photo insight event"),
    atmosphere: trimRequiredAnalysisText(
      insight.atmosphere,
      "Photo insight atmosphere",
    ),
  }));

  if (photoInsights.length === 0) {
    throw new Error("Project photo analysis photo insights are required.");
  }

  return {
    id: input.id,
    projectId: input.projectId,
    emotionCandidates,
    photoInsights,
    storySummary: trimRequiredAnalysisText(
      input.storySummary,
      "Project photo analysis story summary",
    ),
    model: trimRequiredAnalysisText(
      input.model,
      "Project photo analysis model",
    ),
    inputsHash: input.inputsHash ?? "",
    deletedAt: input.deletedAt ?? null,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
  };
}

export function createTestGenerationBatch(
  input: CreateTestGenerationBatchInput,
): TestGenerationBatch {
  return {
    id: input.id,
    storyboardId: input.storyboardId,
    status: input.status ?? "pending",
    confirmedGenerationRequestId: input.confirmedGenerationRequestId ?? null,
    createdAt: input.createdAt,
    completedAt: input.completedAt ?? null,
  };
}
