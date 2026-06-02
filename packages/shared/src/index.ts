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
  position: number;
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
  commonPrompt: string;
  sceneIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type SceneBridgeDto = {
  fromSceneId: string;
  toSceneId: string;
};

export type SceneDto = {
  id: string;
  projectId: string;
  storyboardId: string;
  orderIndex: number;
  status: string;
  kind: string;
  bridge: SceneBridgeDto | null;
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

export type ComplementSceneProposalDto = {
  title: string;
  description: string;
  imagePrompt: string;
  emotion: string;
  cameraDirection: string;
  lightingDirection: string;
  motionDirection: string;
};

export type StylePresetDto = {
  id: string;
  scope: string;
  name: string;
  description: string;
  prompt: string;
  previewImageUrl: string | null;
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

export type GenerationRequestWithSceneTitleDto = GenerationRequestDto & {
  sceneTitle: string | null;
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

export type TestGenerationBatchDto = {
  id: string;
  storyboardId: string;
  status: string;
  confirmedGenerationRequestId: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type EmotionCandidateDto = {
  value: string;
  label: string;
  description: string;
  reason: string;
};

export type PhotoInsightDto = {
  photoAssetId: string;
  summary: string;
  people: string;
  setting: string;
  event: string;
  atmosphere: string;
};

export type ProjectPhotoAnalysisDto = {
  id: string;
  projectId: string;
  emotionCandidates: EmotionCandidateDto[];
  photoInsights: PhotoInsightDto[];
  storySummary: string;
  model: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
