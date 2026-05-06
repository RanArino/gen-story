export type ApiHealthDto = {
  status: "ok";
  service: string;
};

export type ApiErrorDto = {
  error: {
    code: string;
    message: string;
  };
};

export type MeDto = {
  userId: string;
  organizationId: string;
  displayName: string;
  email: string | null;
};

export type ProjectDto = {
  id: string;
  organizationId: string;
  ownerUserId: string;
  name: string;
  status: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PhotoAssetDto = {
  id: string;
  projectId: string;
  name: string;
  usage: string;
  storageKey: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  checksum: string;
  sourceKind: string;
  notes: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ScenePhotoAssetDto = {
  photoAssetId: string;
  role: string;
};

export type StoryboardDto = {
  id: string;
  projectId: string;
  status: string;
  tone: string;
  stylePresetId: string | null;
  sceneIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type SceneDto = {
  id: string;
  projectId: string;
  storyboardId: string;
  orderIndex: number;
  status: string;
  title: string;
  description: string;
  imagePrompt: string;
  emotion: string;
  cameraDirection: string;
  lightingDirection: string;
  motionDirection: string;
  notes: string;
  photoAssets: ScenePhotoAssetDto[];
  adoptedGeneratedImageId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StylePresetDto = {
  id: string;
  scope: string;
  name: string;
  description: string;
  prompt: string;
  createdAt: string;
  updatedAt: string;
};

export type GenerationRequestDto = {
  id: string;
  projectId: string;
  storyboardId: string;
  sceneId: string;
  status: string;
  inputJson: Record<string, unknown>;
  errorMessage: string | null;
  sourceGenerationRequestId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GeneratedImageDto = {
  id: string;
  projectId: string;
  storyboardId: string;
  sceneId: string;
  generationRequestId: string;
  storageKey: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  checksum: string;
  adoptedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
