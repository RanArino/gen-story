import type {
  GeneratedImage,
  GenerationRequest,
  GenerationRequestStatus,
  Organization,
  PhotoAsset,
  Project,
  ProjectPhotoAnalysis,
  Scene,
  Storyboard,
  StylePreset,
  TestGenerationBatch,
  User,
} from "@gen-story/domain";

export type AuthPrincipal = {
  user: User;
  organization: Organization;
};

export interface UserRepositoryPort {
  findById(userId: string): Promise<User | null>;
  save(user: User): Promise<void>;
}

export interface OrganizationRepositoryPort {
  findById(organizationId: string): Promise<Organization | null>;
  save(organization: Organization): Promise<void>;
}

export interface ProjectRepositoryPort {
  findById(projectId: string): Promise<Project | null>;
  findByOrganizationId(
    organizationId: string,
    includeDeleted?: boolean,
  ): Promise<Project[]>;
  save(project: Project): Promise<void>;
  softDelete(projectId: string, deletedAt: string): Promise<void>;
  restore(projectId: string, restoredAt: string): Promise<void>;
}

export interface PhotoAssetRepositoryPort {
  findById(photoAssetId: string): Promise<PhotoAsset | null>;
  findByProjectId(
    projectId: string,
    includeDeleted?: boolean,
  ): Promise<PhotoAsset[]>;
  findByProjectIdAndChecksum(
    projectId: string,
    checksum: string,
  ): Promise<PhotoAsset | null>;
  save(photoAsset: PhotoAsset): Promise<void>;
  softDelete(photoAssetId: string, deletedAt: string): Promise<void>;
  restore(photoAssetId: string, restoredAt: string): Promise<void>;
}

export interface StoryboardRepositoryPort {
  findById(storyboardId: string): Promise<Storyboard | null>;
  findByProjectId(projectId: string): Promise<Storyboard[]>;
  save(storyboard: Storyboard): Promise<void>;
}

export interface SceneRepositoryPort {
  findById(sceneId: string): Promise<Scene | null>;
  findByStoryboardId(storyboardId: string): Promise<Scene[]>;
  save(scene: Scene): Promise<void>;
}

export interface StylePresetRepositoryPort {
  findById(stylePresetId: string): Promise<StylePreset | null>;
  findAll(): Promise<StylePreset[]>;
  save(stylePreset: StylePreset): Promise<void>;
}

export interface GenerationRequestRepositoryPort {
  findById(generationRequestId: string): Promise<GenerationRequest | null>;
  findBySceneId(sceneId: string): Promise<GenerationRequest[]>;
  findRunningCountByProjectId(projectId: string): Promise<number>;
  findByProjectIdAndStatus(
    projectId: string,
    status: GenerationRequestStatus,
  ): Promise<GenerationRequest[]>;
  findQueued(): Promise<GenerationRequest[]>;
  findRecent(limit: number): Promise<GenerationRequest[]>;
  save(generationRequest: GenerationRequest): Promise<void>;
}

export interface GeneratedImageRepositoryPort {
  findById(generatedImageId: string): Promise<GeneratedImage | null>;
  findBySceneId(sceneId: string): Promise<GeneratedImage[]>;
  save(generatedImage: GeneratedImage): Promise<void>;
}

export interface ProjectPhotoAnalysisRepositoryPort {
  findLatestByProjectId(
    projectId: string,
  ): Promise<ProjectPhotoAnalysis | null>;
  save(projectPhotoAnalysis: ProjectPhotoAnalysis): Promise<void>;
}

export interface TestGenerationBatchRepositoryPort {
  findLatestByStoryboardId(
    storyboardId: string,
  ): Promise<TestGenerationBatch | null>;
  save(batch: TestGenerationBatch): Promise<void>;
}

export interface ObjectStoragePort {
  putObject(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<void>;
  getObject(key: string): Promise<Uint8Array | null>;
  deleteObject(key: string): Promise<void>;
}

export interface ImagePreprocessingPort {
  preprocess(input: {
    projectId: string;
    storyboardId: string;
    sceneId: string;
    inputJson: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}

export interface ImageGenerationPort {
  generate(input: {
    requestId: string;
    inputJson: Record<string, unknown>;
  }): Promise<{
    storageKey: string;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
    checksum: string;
  }>;
}

export type SceneFillSuggestion = {
  title: string;
  description: string;
  imagePrompt: string;
  emotion: string;
  cameraDirection: string;
  lightingDirection: string;
  motionDirection: string;
};

export type SceneFillGenerationInput = {
  project: Project;
  storyboard: Storyboard;
  scene: Scene;
  primaryPhoto: PhotoAsset;
  stylePreset: StylePreset | null;
  projectPhotos: PhotoAsset[];
  siblingScenes: Scene[];
};

export interface SceneFillGenerationPort {
  generateSceneFill(
    input: SceneFillGenerationInput,
  ): Promise<SceneFillSuggestion>;
}

export type ComplementSceneProposal = {
  title: string;
  description: string;
  imagePrompt: string;
  emotion: string;
  cameraDirection: string;
  lightingDirection: string;
  motionDirection: string;
};

export type ComplementSceneProposalInput = {
  project: Project;
  storyboard: Storyboard;
  fromScene: Scene;
  toScene: Scene;
  stylePreset: StylePreset | null;
  projectPhotos: PhotoAsset[];
  siblingScenes: Scene[];
};

export interface ComplementSceneProposalPort {
  proposeComplementScenes(
    input: ComplementSceneProposalInput,
  ): Promise<ComplementSceneProposal[]>;
}

export type PhotoAnalysisGenerationInput = {
  project: Project;
  storyboard: Storyboard | null;
  photos: PhotoAsset[];
};

export type PhotoAnalysisGenerationResult = {
  emotionCandidates: ProjectPhotoAnalysis["emotionCandidates"];
  photoInsights: ProjectPhotoAnalysis["photoInsights"];
  storySummary: string;
  model: string;
};

export interface PhotoAnalysisGenerationPort {
  analyzeProjectPhotos(
    input: PhotoAnalysisGenerationInput,
  ): Promise<PhotoAnalysisGenerationResult>;
}

export interface JobQueuePort {
  enqueue(job: {
    kind: string;
    payload: Record<string, unknown>;
  }): Promise<{ jobId: string }>;
}

export interface ProgressEventPort {
  publish(event: {
    kind: string;
    entityType: string;
    entityId: string;
    payload?: Record<string, unknown>;
  }): Promise<void>;
}

export interface AuthContextPort {
  getCurrentPrincipal(): Promise<AuthPrincipal | null>;
}

export interface ApplicationDependencies {
  users: UserRepositoryPort;
  organizations: OrganizationRepositoryPort;
  projects: ProjectRepositoryPort;
  photoAssets: PhotoAssetRepositoryPort;
  storyboards: StoryboardRepositoryPort;
  scenes: SceneRepositoryPort;
  stylePresets: StylePresetRepositoryPort;
  generationRequests: GenerationRequestRepositoryPort;
  generatedImages: GeneratedImageRepositoryPort;
  projectPhotoAnalyses: ProjectPhotoAnalysisRepositoryPort;
  testGenerationBatches: TestGenerationBatchRepositoryPort;
  objectStorage: ObjectStoragePort;
  imagePreprocessing: ImagePreprocessingPort;
  imageGeneration: ImageGenerationPort;
  sceneFillGeneration: SceneFillGenerationPort;
  complementSceneProposal: ComplementSceneProposalPort;
  photoAnalysisGeneration: PhotoAnalysisGenerationPort;
  jobQueue: JobQueuePort;
  progressEvents: ProgressEventPort;
  authContext: AuthContextPort;
}

export type UseCaseErrorCode =
  | "validation_error"
  | "not_found"
  | "conflict"
  | "invalid_state";

export type UseCaseError = {
  code: UseCaseErrorCode;
  message: string;
};

export type UseCaseResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      error: UseCaseError;
    };
