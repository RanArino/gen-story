import { describe, expect, it } from "vitest";

import {
  createGeneratedImage,
  createGenerationRequest,
  createOrganization,
  createPhotoAsset,
  createProject,
  createProjectPhotoAnalysis,
  createScene,
  createStoryboard,
  createTemplateScene,
  createStylePreset,
  createUser,
  type GeneratedImage,
  type GenerationRequest,
  type GenerationRequestStatus,
  type Organization,
  type PhotoAsset,
  type Project,
  type ProjectPhotoAnalysis,
  type Scene,
  type Storyboard,
  type StylePreset,
  type User,
} from "@gen-story/domain";

import type {
  ApplicationDependencies,
  GeneratedImageRepositoryPort,
  GenerationRequestRepositoryPort,
  ImageGenerationPort,
  ImagePreprocessingPort,
  JobQueuePort,
  ObjectStoragePort,
  OrganizationRepositoryPort,
  PhotoAnalysisGenerationInput,
  PhotoAnalysisGenerationPort,
  PhotoAnalysisGenerationResult,
  PhotoAssetRepositoryPort,
  ProgressEventPort,
  ProjectPhotoAnalysisRepositoryPort,
  ProjectRepositoryPort,
  SceneFillGenerationInput,
  SceneFillGenerationPort,
  SceneFillSuggestion,
  SceneRepositoryPort,
  StoryboardRepositoryPort,
  StylePresetRepositoryPort,
  UserRepositoryPort,
} from "./ports";
import {
  analyzeProjectPhotos,
  assignPhotosToScene,
  createGenerationRequestUseCase,
  createProjectUseCase,
  fillSceneWithAi,
  getProjectPhotoAnalysis,
  markGeneratedImageAdopted,
  registerPhotoAsset,
  retryFailedGenerationRequest,
  updatePhotoCuration,
  upsertScenes,
  upsertStoryboard,
} from "./use-cases";

type EntityWithId = { id: string };

class MemoryStore<T extends EntityWithId> {
  private readonly items = new Map<string, T>();

  constructor(initialItems: T[] = []) {
    for (const item of initialItems) {
      this.items.set(item.id, item);
    }
  }

  async findById(id: string): Promise<T | null> {
    return this.items.get(id) ?? null;
  }

  async save(item: T): Promise<void> {
    this.items.set(item.id, item);
  }

  values(): T[] {
    return [...this.items.values()];
  }
}

class InMemoryUserRepository implements UserRepositoryPort {
  constructor(private readonly store: MemoryStore<User>) {}

  async findById(userId: string): Promise<User | null> {
    return this.store.findById(userId);
  }

  async save(user: User): Promise<void> {
    await this.store.save(user);
  }
}

class InMemoryOrganizationRepository implements OrganizationRepositoryPort {
  constructor(private readonly store: MemoryStore<Organization>) {}

  async findById(organizationId: string): Promise<Organization | null> {
    return this.store.findById(organizationId);
  }

  async save(organization: Organization): Promise<void> {
    await this.store.save(organization);
  }
}

class InMemoryProjectRepository implements ProjectRepositoryPort {
  constructor(private readonly store: MemoryStore<Project>) {}

  async findById(projectId: string): Promise<Project | null> {
    return this.store.findById(projectId);
  }

  async findByOrganizationId(
    organizationId: string,
    _includeDeleted?: boolean,
  ): Promise<Project[]> {
    return this.store
      .values()
      .filter((p) => p.organizationId === organizationId);
  }

  async save(project: Project): Promise<void> {
    await this.store.save(project);
  }

  async softDelete(_id: string, _deletedAt: string): Promise<void> {}
  async restore(_id: string, _restoredAt: string): Promise<void> {}
}

class InMemoryPhotoAssetRepository implements PhotoAssetRepositoryPort {
  constructor(private readonly store: MemoryStore<PhotoAsset>) {}

  async findById(photoAssetId: string): Promise<PhotoAsset | null> {
    return this.store.findById(photoAssetId);
  }

  async findByProjectId(
    projectId: string,
    _includeDeleted?: boolean,
  ): Promise<PhotoAsset[]> {
    return this.store
      .values()
      .filter((photoAsset) => photoAsset.projectId === projectId);
  }

  async findByProjectIdAndChecksum(
    projectId: string,
    checksum: string,
  ): Promise<PhotoAsset | null> {
    return (
      this.store
        .values()
        .find(
          (photoAsset) =>
            photoAsset.projectId === projectId &&
            photoAsset.checksum === checksum,
        ) ?? null
    );
  }

  async save(photoAsset: PhotoAsset): Promise<void> {
    await this.store.save(photoAsset);
  }

  async softDelete(_id: string, _deletedAt: string): Promise<void> {}
  async restore(_id: string, _restoredAt: string): Promise<void> {}
}

class InMemoryStoryboardRepository implements StoryboardRepositoryPort {
  constructor(private readonly store: MemoryStore<Storyboard>) {}

  async findById(storyboardId: string): Promise<Storyboard | null> {
    return this.store.findById(storyboardId);
  }

  async findByProjectId(projectId: string): Promise<Storyboard[]> {
    return this.store
      .values()
      .filter((storyboard) => storyboard.projectId === projectId);
  }

  async save(storyboard: Storyboard): Promise<void> {
    await this.store.save(storyboard);
  }
}

class InMemorySceneRepository implements SceneRepositoryPort {
  public saveCalls = 0;

  constructor(private readonly store: MemoryStore<Scene>) {}

  async findById(sceneId: string): Promise<Scene | null> {
    return this.store.findById(sceneId);
  }

  async findByStoryboardId(storyboardId: string): Promise<Scene[]> {
    return this.store
      .values()
      .filter((scene) => scene.storyboardId === storyboardId);
  }

  async save(scene: Scene): Promise<void> {
    this.saveCalls += 1;
    await this.store.save(scene);
  }
}

class InMemoryStylePresetRepository implements StylePresetRepositoryPort {
  constructor(private readonly store: MemoryStore<StylePreset>) {}

  async findById(stylePresetId: string): Promise<StylePreset | null> {
    return this.store.findById(stylePresetId);
  }

  async findAll(): Promise<StylePreset[]> {
    return this.store.values();
  }

  async save(stylePreset: StylePreset): Promise<void> {
    await this.store.save(stylePreset);
  }
}

class InMemoryGenerationRequestRepository implements GenerationRequestRepositoryPort {
  constructor(private readonly store: MemoryStore<GenerationRequest>) {}

  async findById(id: string): Promise<GenerationRequest | null> {
    return this.store.findById(id);
  }

  async findBySceneId(sceneId: string): Promise<GenerationRequest[]> {
    return this.store.values().filter((r) => r.sceneId === sceneId);
  }

  async findRunningCountByProjectId(projectId: string): Promise<number> {
    return this.store
      .values()
      .filter((r) => r.projectId === projectId && r.status === "running")
      .length;
  }

  async findByProjectIdAndStatus(
    projectId: string,
    status: GenerationRequestStatus,
  ): Promise<GenerationRequest[]> {
    return this.store
      .values()
      .filter((r) => r.projectId === projectId && r.status === status);
  }

  async findQueued(): Promise<GenerationRequest[]> {
    return this.store
      .values()
      .filter((r) => r.status === "queued")
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async findRecent(limit: number): Promise<GenerationRequest[]> {
    return this.store
      .values()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async save(generationRequest: GenerationRequest): Promise<void> {
    await this.store.save(generationRequest);
  }
}

class InMemoryGeneratedImageRepository implements GeneratedImageRepositoryPort {
  constructor(private readonly store: MemoryStore<GeneratedImage>) {}

  async findById(generatedImageId: string): Promise<GeneratedImage | null> {
    return this.store.findById(generatedImageId);
  }

  async findBySceneId(sceneId: string): Promise<GeneratedImage[]> {
    return this.store.values().filter((image) => image.sceneId === sceneId);
  }

  async save(generatedImage: GeneratedImage): Promise<void> {
    await this.store.save(generatedImage);
  }
}

class InMemoryProjectPhotoAnalysisRepository implements ProjectPhotoAnalysisRepositoryPort {
  constructor(private readonly store: MemoryStore<ProjectPhotoAnalysis>) {}

  async findLatestByProjectId(
    projectId: string,
  ): Promise<ProjectPhotoAnalysis | null> {
    return (
      this.store
        .values()
        .filter((analysis) => analysis.projectId === projectId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
    );
  }

  async save(projectPhotoAnalysis: ProjectPhotoAnalysis): Promise<void> {
    await this.store.save(projectPhotoAnalysis);
  }
}

class InMemoryObjectStoragePort implements ObjectStoragePort {
  public readonly storedObjects: Array<{
    key: string;
    body: Uint8Array;
    contentType: string;
  }> = [];

  async putObject(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<void> {
    this.storedObjects.push(input);
  }

  async getObject(): Promise<Uint8Array | null> {
    return null;
  }

  async deleteObject(): Promise<void> {}
}

class InMemoryImagePreprocessingPort implements ImagePreprocessingPort {
  public readonly calls: Array<{
    projectId: string;
    storyboardId: string;
    sceneId: string;
    inputJson: Record<string, unknown>;
  }> = [];

  async preprocess(input: {
    projectId: string;
    storyboardId: string;
    sceneId: string;
    inputJson: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    this.calls.push(input);
    return {
      ...input.inputJson,
      preprocessed: true,
    };
  }
}

class InMemoryImageGenerationPort implements ImageGenerationPort {
  async generate(): Promise<{
    storageKey: string;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
    checksum: string;
  }> {
    return {
      storageKey: "generated/image.jpg",
      mimeType: "image/jpeg",
      size: 1,
      width: 1,
      height: 1,
      checksum: "checksum",
    };
  }
}

class InMemorySceneFillGenerationPort implements SceneFillGenerationPort {
  public readonly calls: SceneFillGenerationInput[] = [];
  public suggestion: SceneFillSuggestion = {
    title: "AI title",
    description: "AI description",
    imagePrompt: "AI image prompt",
    emotion: "Wonder",
    cameraDirection: "Medium",
    lightingDirection: "Natural",
    motionDirection: "Slow pan",
  };

  async generateSceneFill(
    input: SceneFillGenerationInput,
  ): Promise<SceneFillSuggestion> {
    this.calls.push(input);
    return this.suggestion;
  }
}

class InMemoryPhotoAnalysisGenerationPort implements PhotoAnalysisGenerationPort {
  public readonly calls: PhotoAnalysisGenerationInput[] = [];
  public result: PhotoAnalysisGenerationResult = {
    emotionCandidates: [
      {
        value: "warm_nostalgia",
        label: "Warm nostalgia",
        description: "Tender and memory-focused.",
        reason: "The photos feel warm.",
      },
      {
        value: "quiet_gratitude",
        label: "Quiet gratitude",
        description: "Calm and appreciative.",
        reason: "The photos feel reflective.",
      },
      {
        value: "joyful_connection",
        label: "Joyful connection",
        description: "Bright and people-centered.",
        reason: "The photos feel connected.",
      },
    ],
    photoInsights: [
      {
        photoAssetId: "photo_1",
        summary: "A warm family moment.",
        people: "Family members are central.",
        setting: "Indoor setting.",
        event: "Anniversary memory.",
        atmosphere: "Warm and intimate.",
      },
    ],
    storySummary: "A warm family story.",
    model: "test-model",
  };

  async analyzeProjectPhotos(
    input: PhotoAnalysisGenerationInput,
  ): Promise<PhotoAnalysisGenerationResult> {
    this.calls.push(input);
    return this.result;
  }
}

class InMemoryJobQueuePort implements JobQueuePort {
  public readonly jobs: Array<{
    kind: string;
    payload: Record<string, unknown>;
  }> = [];

  async enqueue(job: {
    kind: string;
    payload: Record<string, unknown>;
  }): Promise<{ jobId: string }> {
    this.jobs.push(job);
    return { jobId: `job_${this.jobs.length}` };
  }
}

class InMemoryProgressEventPort implements ProgressEventPort {
  public readonly events: Array<{
    kind: string;
    entityType: string;
    entityId: string;
    payload?: Record<string, unknown>;
  }> = [];

  async publish(event: {
    kind: string;
    entityType: string;
    entityId: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    this.events.push(event);
  }
}

function createDependencies(initial?: {
  users?: User[];
  organizations?: Organization[];
  projects?: Project[];
  photoAssets?: PhotoAsset[];
  storyboards?: Storyboard[];
  scenes?: Scene[];
  stylePresets?: StylePreset[];
  generationRequests?: GenerationRequest[];
  generatedImages?: GeneratedImage[];
  projectPhotoAnalyses?: ProjectPhotoAnalysis[];
}): ApplicationDependencies & {
  stores: {
    users: MemoryStore<User>;
    organizations: MemoryStore<Organization>;
    projects: MemoryStore<Project>;
    photoAssets: MemoryStore<PhotoAsset>;
    storyboards: MemoryStore<Storyboard>;
    scenes: MemoryStore<Scene>;
    stylePresets: MemoryStore<StylePreset>;
    generationRequests: MemoryStore<GenerationRequest>;
    generatedImages: MemoryStore<GeneratedImage>;
    projectPhotoAnalyses: MemoryStore<ProjectPhotoAnalysis>;
  };
  jobQueue: InMemoryJobQueuePort;
  imagePreprocessing: InMemoryImagePreprocessingPort;
  progressEvents: InMemoryProgressEventPort;
  objectStorage: InMemoryObjectStoragePort;
  imageGeneration: InMemoryImageGenerationPort;
  sceneFillGeneration: InMemorySceneFillGenerationPort;
  photoAnalysisGeneration: InMemoryPhotoAnalysisGenerationPort;
  scenes: InMemorySceneRepository;
} {
  const stores = {
    users: new MemoryStore<User>(initial?.users ?? []),
    organizations: new MemoryStore<Organization>(initial?.organizations ?? []),
    projects: new MemoryStore<Project>(initial?.projects ?? []),
    photoAssets: new MemoryStore<PhotoAsset>(initial?.photoAssets ?? []),
    storyboards: new MemoryStore<Storyboard>(initial?.storyboards ?? []),
    scenes: new MemoryStore<Scene>(initial?.scenes ?? []),
    stylePresets: new MemoryStore<StylePreset>(initial?.stylePresets ?? []),
    generationRequests: new MemoryStore<GenerationRequest>(
      initial?.generationRequests ?? [],
    ),
    generatedImages: new MemoryStore<GeneratedImage>(
      initial?.generatedImages ?? [],
    ),
    projectPhotoAnalyses: new MemoryStore<ProjectPhotoAnalysis>(
      initial?.projectPhotoAnalyses ?? [],
    ),
  };

  const jobQueue = new InMemoryJobQueuePort();
  const imagePreprocessing = new InMemoryImagePreprocessingPort();
  const progressEvents = new InMemoryProgressEventPort();
  const objectStorage = new InMemoryObjectStoragePort();
  const imageGeneration = new InMemoryImageGenerationPort();
  const sceneFillGeneration = new InMemorySceneFillGenerationPort();
  const photoAnalysisGeneration = new InMemoryPhotoAnalysisGenerationPort();

  return {
    users: new InMemoryUserRepository(stores.users),
    organizations: new InMemoryOrganizationRepository(stores.organizations),
    projects: new InMemoryProjectRepository(stores.projects),
    photoAssets: new InMemoryPhotoAssetRepository(stores.photoAssets),
    storyboards: new InMemoryStoryboardRepository(stores.storyboards),
    scenes: new InMemorySceneRepository(stores.scenes),
    stylePresets: new InMemoryStylePresetRepository(stores.stylePresets),
    generationRequests: new InMemoryGenerationRequestRepository(
      stores.generationRequests,
    ),
    generatedImages: new InMemoryGeneratedImageRepository(
      stores.generatedImages,
    ),
    projectPhotoAnalyses: new InMemoryProjectPhotoAnalysisRepository(
      stores.projectPhotoAnalyses,
    ),
    objectStorage,
    imagePreprocessing,
    imageGeneration,
    sceneFillGeneration,
    photoAnalysisGeneration,
    jobQueue,
    progressEvents,
    authContext: {
      async getCurrentPrincipal() {
        return null;
      },
    },
    stores,
  };
}

describe("application use cases", () => {
  it("creates a project through repository ports", async () => {
    const deps = createDependencies({
      users: [
        createUser({
          id: "user_1",
          organizationId: "org_1",
          displayName: "Ran",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      organizations: [
        createOrganization({
          id: "org_1",
          name: "Family Studio",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
    });

    const result = await createProjectUseCase(deps, {
      projectId: "project_1",
      organizationId: "org_1",
      ownerUserId: "user_1",
      name: " Family Story ",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        id: "project_1",
        organizationId: "org_1",
        ownerUserId: "user_1",
        name: "Family Story",
        status: "draft",
      });
    }
    expect(deps.progressEvents.events).toHaveLength(1);
  });

  it("registers and re-curates a photo asset", async () => {
    const deps = createDependencies({
      users: [
        createUser({
          id: "user_1",
          organizationId: "org_1",
          displayName: "Ran",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      organizations: [
        createOrganization({
          id: "org_1",
          name: "Family Studio",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      projects: [
        createProject({
          id: "project_1",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Family Story",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
    });

    const registerResult = await registerPhotoAsset(deps, {
      photoAssetId: "photo_1",
      projectId: "project_1",
      name: " Snapshot ",
      storageKey: "data/uploads/originals/projects/project_1/photo_1.jpg",
      mimeType: "image/jpeg",
      size: 2048,
      width: 1000,
      height: 800,
      checksum: "checksum_1",
      sourceKind: "upload",
    });

    expect(registerResult.ok).toBe(true);
    if (registerResult.ok) {
      expect(registerResult.value.usage).toBe("candidate");
    }

    const curationResult = await registerPhotoAsset(deps, {
      photoAssetId: "photo_2",
      projectId: "project_1",
      name: " Reference ",
      storageKey: "data/uploads/originals/projects/project_1/photo_2.jpg",
      mimeType: "image/jpeg",
      size: 2048,
      width: 1000,
      height: 800,
      checksum: "checksum_2",
      sourceKind: "upload",
      usage: "reference",
    });

    expect(curationResult.ok).toBe(true);
    if (curationResult.ok) {
      expect(curationResult.value.usage).toBe("reference");
    }

    const updateResult = await updatePhotoCuration(deps, {
      photoAssetId: "photo_2",
      usage: "excluded",
    });

    expect(updateResult.ok).toBe(true);
    if (updateResult.ok) {
      expect(updateResult.value.usage).toBe("excluded");
    }
  });

  it("rejects duplicate photo checksums within the same project", async () => {
    const deps = createDependencies({
      users: [
        createUser({
          id: "user_1",
          organizationId: "org_1",
          displayName: "Ran",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      organizations: [
        createOrganization({
          id: "org_1",
          name: "Family Studio",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      projects: [
        createProject({
          id: "project_1",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Family Story",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      photoAssets: [
        createPhotoAsset({
          id: "photo_1",
          projectId: "project_1",
          name: "Snapshot",
          storageKey: "data/uploads/originals/projects/project_1/photo_1.jpg",
          mimeType: "image/jpeg",
          size: 2048,
          width: 1000,
          height: 800,
          checksum: "same-checksum",
          sourceKind: "upload",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
    });

    const result = await registerPhotoAsset(deps, {
      photoAssetId: "photo_2",
      projectId: "project_1",
      name: "Snapshot copy",
      storageKey: "data/uploads/originals/projects/project_1/photo_2.jpg",
      mimeType: "image/jpeg",
      size: 2048,
      width: 1000,
      height: 800,
      checksum: "same-checksum",
      sourceKind: "upload",
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "conflict" },
    });
  });

  it("allows the same photo checksum in a different project", async () => {
    const deps = createDependencies({
      users: [
        createUser({
          id: "user_1",
          organizationId: "org_1",
          displayName: "Ran",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      organizations: [
        createOrganization({
          id: "org_1",
          name: "Family Studio",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      projects: [
        createProject({
          id: "project_1",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Family Story",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
        createProject({
          id: "project_2",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Second Story",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      photoAssets: [
        createPhotoAsset({
          id: "photo_1",
          projectId: "project_1",
          name: "Snapshot",
          storageKey: "data/uploads/originals/projects/project_1/photo_1.jpg",
          mimeType: "image/jpeg",
          size: 2048,
          width: 1000,
          height: 800,
          checksum: "same-checksum",
          sourceKind: "upload",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
    });

    const result = await registerPhotoAsset(deps, {
      photoAssetId: "photo_2",
      projectId: "project_2",
      name: "Snapshot",
      storageKey: "data/uploads/originals/projects/project_2/photo_2.jpg",
      mimeType: "image/jpeg",
      size: 2048,
      width: 1000,
      height: 800,
      checksum: "same-checksum",
      sourceKind: "upload",
    });

    expect(result.ok).toBe(true);
  });

  it("creates a storyboard and ordered scenes", async () => {
    const deps = createDependencies({
      users: [
        createUser({
          id: "user_1",
          organizationId: "org_1",
          displayName: "Ran",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      organizations: [
        createOrganization({
          id: "org_1",
          name: "Family Studio",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      projects: [
        createProject({
          id: "project_1",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Family Story",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      stylePresets: [
        createStylePreset({
          id: "style_1",
          scope: "system",
          name: "Cinematic",
          prompt: "filmic",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
    });

    const storyboardResult = await upsertStoryboard(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      tone: "Reflective",
      stylePresetId: "style_1",
      status: "editing",
    });

    expect(storyboardResult.ok).toBe(true);

    const scenesResult = await upsertScenes(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      scenes: [
        {
          sceneId: "scene_2",
          projectId: "project_1",
          storyboardId: "storyboard_1",
          orderIndex: 2,
          title: "Second",
          description: "desc",
          imagePrompt: "prompt",
          emotion: "warm",
          cameraDirection: "wide",
          lightingDirection: "soft",
          motionDirection: "still",
        },
        {
          sceneId: "scene_1",
          projectId: "project_1",
          storyboardId: "storyboard_1",
          orderIndex: 1,
          title: "First",
          description: "desc",
          imagePrompt: "prompt",
          emotion: "warm",
          cameraDirection: "wide",
          lightingDirection: "soft",
          motionDirection: "still",
        },
      ],
    });

    expect(scenesResult.ok).toBe(true);
    if (scenesResult.ok) {
      expect(scenesResult.value.map((scene) => scene.id)).toEqual([
        "scene_1",
        "scene_2",
      ]);
    }

    const storedStoryboard = await deps.storyboards.findById("storyboard_1");
    expect(storedStoryboard?.sceneIds).toEqual(["scene_1", "scene_2"]);
  });

  it("assigns photos to a scene and keeps primary counts valid", async () => {
    const deps = createDependencies({
      users: [
        createUser({
          id: "user_1",
          organizationId: "org_1",
          displayName: "Ran",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      organizations: [
        createOrganization({
          id: "org_1",
          name: "Family Studio",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      projects: [
        createProject({
          id: "project_1",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Family Story",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      storyboards: [
        createStoryboard({
          id: "storyboard_1",
          projectId: "project_1",
          tone: "Reflective",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      scenes: [
        createScene({
          id: "scene_1",
          projectId: "project_1",
          storyboardId: "storyboard_1",
          orderIndex: 0,
          title: "Scene",
          description: "desc",
          imagePrompt: "prompt",
          emotion: "warm",
          cameraDirection: "wide",
          lightingDirection: "soft",
          motionDirection: "still",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      photoAssets: [
        createPhotoAsset({
          id: "photo_1",
          projectId: "project_1",
          name: "Photo",
          storageKey: "storage/photo_1.jpg",
          mimeType: "image/jpeg",
          size: 1,
          checksum: "checksum_1",
          sourceKind: "upload",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
        createPhotoAsset({
          id: "photo_2",
          projectId: "project_1",
          name: "Photo 2",
          storageKey: "storage/photo_2.jpg",
          mimeType: "image/jpeg",
          size: 1,
          checksum: "checksum_2",
          sourceKind: "upload",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
    });

    const result = await assignPhotosToScene(deps, {
      sceneId: "scene_1",
      photoAssets: [
        { photoAssetId: "photo_1", role: "primary" },
        { photoAssetId: "photo_2", role: "reference" },
      ],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.photoAssets).toEqual([
        { photoAssetId: "photo_1", role: "primary" },
        { photoAssetId: "photo_2", role: "reference" },
      ]);
    }
  });

  it("creates a generation request using preprocessing and queue ports", async () => {
    const deps = createDependencies({
      users: [
        createUser({
          id: "user_1",
          organizationId: "org_1",
          displayName: "Ran",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      organizations: [
        createOrganization({
          id: "org_1",
          name: "Family Studio",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      projects: [
        createProject({
          id: "project_1",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Family Story",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      storyboards: [
        createStoryboard({
          id: "storyboard_1",
          projectId: "project_1",
          tone: "Reflective",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      scenes: [
        createScene({
          id: "scene_1",
          projectId: "project_1",
          storyboardId: "storyboard_1",
          orderIndex: 0,
          title: "Scene",
          description: "desc",
          imagePrompt: "prompt",
          emotion: "warm",
          cameraDirection: "wide",
          lightingDirection: "soft",
          motionDirection: "still",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
    });

    const result = await createGenerationRequestUseCase(deps, {
      generationRequestId: "request_1",
      projectId: "project_1",
      storyboardId: "storyboard_1",
      sceneId: "scene_1",
      inputJson: { prompt: "prompt" },
    });

    expect(result.ok).toBe(true);
    expect(deps.imagePreprocessing.calls).toHaveLength(1);
    expect(deps.jobQueue.jobs).toHaveLength(1);
    expect(deps.progressEvents.events[0]?.kind).toBe(
      "generation-request.created",
    );
  });

  it("adopts generated images and unadopts the previous one", async () => {
    const deps = createDependencies({
      users: [
        createUser({
          id: "user_1",
          organizationId: "org_1",
          displayName: "Ran",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      organizations: [
        createOrganization({
          id: "org_1",
          name: "Family Studio",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      projects: [
        createProject({
          id: "project_1",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Family Story",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      storyboards: [
        createStoryboard({
          id: "storyboard_1",
          projectId: "project_1",
          tone: "Reflective",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      scenes: [
        createScene({
          id: "scene_1",
          projectId: "project_1",
          storyboardId: "storyboard_1",
          orderIndex: 0,
          title: "Scene",
          description: "desc",
          imagePrompt: "prompt",
          emotion: "warm",
          cameraDirection: "wide",
          lightingDirection: "soft",
          motionDirection: "still",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      generationRequests: [
        createGenerationRequest({
          id: "request_1",
          projectId: "project_1",
          storyboardId: "storyboard_1",
          sceneId: "scene_1",
          inputJson: { prompt: "prompt" },
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      generatedImages: [
        createGeneratedImage({
          id: "image_1",
          projectId: "project_1",
          storyboardId: "storyboard_1",
          sceneId: "scene_1",
          generationRequestId: "request_1",
          storageKey: "storage/image_1.jpg",
          mimeType: "image/jpeg",
          size: 1,
          checksum: "checksum_1",
          adoptedAt: "2026-05-02T00:00:00.000Z",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
        createGeneratedImage({
          id: "image_2",
          projectId: "project_1",
          storyboardId: "storyboard_1",
          sceneId: "scene_1",
          generationRequestId: "request_1",
          storageKey: "storage/image_2.jpg",
          mimeType: "image/jpeg",
          size: 1,
          checksum: "checksum_2",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
    });

    const result = await markGeneratedImageAdopted(deps, {
      sceneId: "scene_1",
      generatedImageId: "image_2",
    });

    expect(result.ok).toBe(true);
    const images = await deps.generatedImages.findBySceneId("scene_1");
    expect(
      images.map((image) => ({ id: image.id, adoptedAt: image.adoptedAt })),
    ).toEqual([
      { id: "image_1", adoptedAt: null },
      { id: "image_2", adoptedAt: expect.any(String) },
    ]);
  });

  it("retries a failed generation request as a fresh queued request", async () => {
    const deps = createDependencies({
      users: [
        createUser({
          id: "user_1",
          organizationId: "org_1",
          displayName: "Ran",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      organizations: [
        createOrganization({
          id: "org_1",
          name: "Family Studio",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      projects: [
        createProject({
          id: "project_1",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Family Story",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      storyboards: [
        createStoryboard({
          id: "storyboard_1",
          projectId: "project_1",
          tone: "Reflective",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      scenes: [
        createScene({
          id: "scene_1",
          projectId: "project_1",
          storyboardId: "storyboard_1",
          orderIndex: 0,
          title: "Scene",
          description: "desc",
          imagePrompt: "prompt",
          emotion: "warm",
          cameraDirection: "wide",
          lightingDirection: "soft",
          motionDirection: "still",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      generationRequests: [
        createGenerationRequest({
          id: "request_1",
          projectId: "project_1",
          storyboardId: "storyboard_1",
          sceneId: "scene_1",
          inputJson: { prompt: "prompt" },
          status: "failed",
          errorMessage: "timed out",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:30:00.000Z",
        }),
      ],
    });

    const result = await retryFailedGenerationRequest(deps, {
      generationRequestId: "request_1",
      newGenerationRequestId: "request_2",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.status).toBe("queued");
      expect(result.value.sourceGenerationRequestId).toBe("request_1");
    }
    expect(deps.jobQueue.jobs).toHaveLength(1);
  });

  it("fills blank scene fields with AI suggestions and preserves edited fields", async () => {
    const deps = createDependencies({
      projects: [
        createProject({
          id: "project_ai",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Family Story",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      storyboards: [
        createStoryboard({
          id: "storyboard_ai",
          projectId: "project_ai",
          tone: "Warm",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      photoAssets: [
        createPhotoAsset({
          id: "photo_ai",
          projectId: "project_ai",
          name: "birthday.jpg",
          storageKey: "photos/birthday.jpg",
          mimeType: "image/jpeg",
          size: 1,
          checksum: "photo_ai_checksum",
          sourceKind: "upload",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      scenes: [
        {
          ...createTemplateScene({
            id: "scene_ai",
            projectId: "project_ai",
            storyboardId: "storyboard_ai",
            orderIndex: 0,
            photoAssetId: "photo_ai",
            createdAt: "2026-05-02T00:00:00.000Z",
            updatedAt: "2026-05-02T00:00:00.000Z",
          }),
          title: "Edited title",
          imagePrompt: "   ",
        },
      ],
    });

    const result = await fillSceneWithAi(deps, { sceneId: "scene_ai" });

    expect(result.ok).toBe(true);
    expect(deps.sceneFillGeneration.calls).toHaveLength(1);
    expect(deps.scenes.saveCalls).toBe(1);
    if (result.ok) {
      expect(result.value).toMatchObject({
        title: "Edited title",
        description: "AI description",
        imagePrompt: "AI image prompt",
        emotion: "Wonder",
        cameraDirection: "Medium",
        lightingDirection: "Natural",
        motionDirection: "Slow pan",
      });
      expect(result.value.updatedAt).not.toBe("2026-05-02T00:00:00.000Z");
    }
  });

  it("rejects AI fill when the scene has no primary photo", async () => {
    const deps = createDependencies({
      projects: [
        createProject({
          id: "project_no_photo",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Family Story",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      storyboards: [
        createStoryboard({
          id: "storyboard_no_photo",
          projectId: "project_no_photo",
          tone: "Warm",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      scenes: [
        createTemplateScene({
          id: "scene_no_photo",
          projectId: "project_no_photo",
          storyboardId: "storyboard_no_photo",
          orderIndex: 0,
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
    });

    const result = await fillSceneWithAi(deps, { sceneId: "scene_no_photo" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error");
    }
    expect(deps.sceneFillGeneration.calls).toHaveLength(0);
  });

  it("does not call AI fill generation when all fill fields are already present", async () => {
    const deps = createDependencies({
      projects: [
        createProject({
          id: "project_full",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Family Story",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      storyboards: [
        createStoryboard({
          id: "storyboard_full",
          projectId: "project_full",
          tone: "Warm",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      photoAssets: [
        createPhotoAsset({
          id: "photo_full",
          projectId: "project_full",
          name: "family.jpg",
          storageKey: "photos/family.jpg",
          mimeType: "image/jpeg",
          size: 1,
          checksum: "photo_full_checksum",
          sourceKind: "upload",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      scenes: [
        createScene({
          id: "scene_full",
          projectId: "project_full",
          storyboardId: "storyboard_full",
          orderIndex: 0,
          title: "Title",
          description: "Description",
          imagePrompt: "Prompt",
          emotion: "Joy",
          cameraDirection: "Wide",
          lightingDirection: "Natural",
          motionDirection: "Static",
          photoAssets: [{ photoAssetId: "photo_full", role: "primary" }],
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
    });

    const result = await fillSceneWithAi(deps, { sceneId: "scene_full" });

    expect(result.ok).toBe(true);
    expect(deps.sceneFillGeneration.calls).toHaveLength(0);
    expect(deps.scenes.saveCalls).toBe(0);
  });

  it("analyzes only candidate and reference photos", async () => {
    const deps = createDependencies({
      projects: [
        createProject({
          id: "project_1",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Anniversary",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      storyboards: [
        createStoryboard({
          id: "storyboard_1",
          projectId: "project_1",
          tone: "warm",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      photoAssets: [
        createPhotoAsset({
          id: "photo_1",
          projectId: "project_1",
          name: "candidate.jpg",
          usage: "candidate",
          storageKey: "candidate.jpg",
          mimeType: "image/jpeg",
          size: 1,
          checksum: "candidate",
          sourceKind: "upload",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
        createPhotoAsset({
          id: "photo_2",
          projectId: "project_1",
          name: "reference.jpg",
          usage: "reference",
          storageKey: "reference.jpg",
          mimeType: "image/jpeg",
          size: 1,
          checksum: "reference",
          sourceKind: "upload",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
        createPhotoAsset({
          id: "photo_3",
          projectId: "project_1",
          name: "excluded.jpg",
          usage: "excluded",
          storageKey: "excluded.jpg",
          mimeType: "image/jpeg",
          size: 1,
          checksum: "excluded",
          sourceKind: "upload",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
        createPhotoAsset({
          id: "photo_4",
          projectId: "project_1",
          name: "deleted.jpg",
          usage: "candidate",
          storageKey: "deleted.jpg",
          mimeType: "image/jpeg",
          size: 1,
          checksum: "deleted",
          sourceKind: "upload",
          deletedAt: "2026-05-03T00:00:00.000Z",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-03T00:00:00.000Z",
        }),
      ],
    });
    deps.photoAnalysisGeneration.result = {
      ...deps.photoAnalysisGeneration.result,
      photoInsights: [
        {
          photoAssetId: "photo_1",
          summary: "Candidate insight.",
          people: "People",
          setting: "Setting",
          event: "Event",
          atmosphere: "Atmosphere",
        },
        {
          photoAssetId: "photo_2",
          summary: "Reference insight.",
          people: "People",
          setting: "Setting",
          event: "Event",
          atmosphere: "Atmosphere",
        },
      ],
    };

    const result = await analyzeProjectPhotos(deps, { projectId: "project_1" });

    expect(result.ok).toBe(true);
    expect(deps.photoAnalysisGeneration.calls).toHaveLength(1);
    expect(
      deps.photoAnalysisGeneration.calls[0]!.photos.map((photo) => photo.id),
    ).toEqual(["photo_1", "photo_2"]);
    expect(deps.photoAnalysisGeneration.calls[0]!.storyboard?.id).toBe(
      "storyboard_1",
    );
    expect(deps.stores.projectPhotoAnalyses.values()).toHaveLength(1);
    if (result.ok) {
      expect(result.value.model).toBe("test-model");
    }
  });

  it("rejects project photo analysis without included photos", async () => {
    const deps = createDependencies({
      projects: [
        createProject({
          id: "project_1",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Anniversary",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      photoAssets: [
        createPhotoAsset({
          id: "photo_1",
          projectId: "project_1",
          name: "excluded.jpg",
          usage: "excluded",
          storageKey: "excluded.jpg",
          mimeType: "image/jpeg",
          size: 1,
          checksum: "excluded",
          sourceKind: "upload",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
    });

    const result = await analyzeProjectPhotos(deps, { projectId: "project_1" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error");
    }
    expect(deps.photoAnalysisGeneration.calls).toHaveLength(0);
    expect(deps.stores.projectPhotoAnalyses.values()).toHaveLength(0);
  });

  it("returns the latest saved project photo analysis", async () => {
    const analysis = createProjectPhotoAnalysis({
      id: "analysis_1",
      projectId: "project_1",
      emotionCandidates: [
        {
          value: "warm_nostalgia",
          label: "Warm nostalgia",
          description: "Tender.",
          reason: "The photos are warm.",
        },
      ],
      photoInsights: [
        {
          photoAssetId: "photo_1",
          summary: "Insight.",
          people: "People.",
          setting: "Setting.",
          event: "Event.",
          atmosphere: "Atmosphere.",
        },
      ],
      storySummary: "Saved summary.",
      model: "test-model",
      createdAt: "2026-05-02T00:00:00.000Z",
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    const deps = createDependencies({
      projects: [
        createProject({
          id: "project_1",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Anniversary",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      projectPhotoAnalyses: [analysis],
    });

    const result = await getProjectPhotoAnalysis(deps, {
      projectId: "project_1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value?.id).toBe("analysis_1");
    }
  });
});
