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

export type ProjectStatus = "draft" | "active" | "completed" | "archived";
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
  deletedAt: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type ScenePhotoAsset = {
  photoAssetId: PhotoAssetId;
  role: ScenePhotoRole;
};

export type Scene = {
  id: SceneId;
  projectId: ProjectId;
  storyboardId: StoryboardId;
  orderIndex: number;
  status: SceneStatus;
  title: string;
  description: string;
  imagePrompt: string;
  emotion: string;
  cameraDirection: string;
  lightingDirection: string;
  motionDirection: string;
  notes: string;
  photoAssets: ScenePhotoAsset[];
  adoptedGeneratedImageId: GeneratedImageId | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type Storyboard = {
  id: StoryboardId;
  projectId: ProjectId;
  status: StoryboardStatus;
  tone: string;
  stylePresetId: StylePresetId | null;
  sceneIds: SceneId[];
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
  deletedAt?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CreateStoryboardInput = {
  id: StoryboardId;
  projectId: ProjectId;
  status?: StoryboardStatus;
  tone: string;
  stylePresetId?: StylePresetId | null;
  sceneIds?: SceneId[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
};

export type CreateSceneInput = {
  id: SceneId;
  projectId: ProjectId;
  storyboardId: StoryboardId;
  orderIndex: number;
  status?: SceneStatus;
  title: string;
  description: string;
  imagePrompt: string;
  emotion: string;
  cameraDirection: string;
  lightingDirection: string;
  motionDirection: string;
  notes?: string;
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
    tone: trimRequiredText(input.tone, "Storyboard tone"),
    stylePresetId: input.stylePresetId ?? null,
    sceneIds: [...(input.sceneIds ?? [])],
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
    title: trimRequiredText(input.title, "Scene title"),
    description: trimRequiredText(input.description, "Scene description"),
    imagePrompt: trimRequiredText(input.imagePrompt, "Scene image prompt"),
    emotion: trimRequiredText(input.emotion, "Scene emotion"),
    cameraDirection: trimRequiredText(
      input.cameraDirection,
      "Scene camera direction",
    ),
    lightingDirection: trimRequiredText(
      input.lightingDirection,
      "Scene lighting direction",
    ),
    motionDirection: trimRequiredText(
      input.motionDirection,
      "Scene motion direction",
    ),
    notes: trimOptionalText(input.notes),
    photoAssets: [...(input.photoAssets ?? [])],
    adoptedGeneratedImageId: input.adoptedGeneratedImageId ?? null,
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
