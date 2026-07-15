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
  createTestGenerationBatch,
  createUser,
  type TestAdjustmentId,
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
  type TestGenerationBatch,
  type User,
} from "@gen-story/domain";

import type {
  ApplicationDependencies,
  ComplementSceneProposal,
  ComplementSceneProposalInput,
  ComplementSceneProposalPort,
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
  TestGenerationBatchRepositoryPort,
  UserPreference,
  UserPreferenceRepositoryPort,
  UserRepositoryPort,
} from "./ports";
import {
  analyzeProjectPhotos,
  applyAdjustmentToTestVariant,
  assignPhotosToScene,
  confirmTestGeneration,
  createGenerationRequestUseCase,
  createCustomStyle,
  createProjectUseCase,
  fillSceneWithAi,
  getProjectPhotoAnalysis,
  getUserPreference,
  insertComplementScene,
  markGeneratedImageAdopted,
  proposeComplementScenes,
  registerPhotoAsset,
  reorderPhotos,
  reorderScenes,
  retryFailedGenerationRequest,
  setUserPreference,
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

  async findByStoryboardId(storyboardId: string): Promise<GenerationRequest[]> {
    return this.store
      .values()
      .filter((r) => r.storyboardId === storyboardId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async save(generationRequest: GenerationRequest): Promise<void> {
    await this.store.save(generationRequest);
  }

  async softDelete(_id: string, _deletedAt: string): Promise<void> {}
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

class InMemoryUserPreferenceRepository implements UserPreferenceRepositoryPort {
  private readonly items = new Map<string, UserPreference>();

  async findByUserId(userId: string): Promise<UserPreference | null> {
    return this.items.get(userId) ?? null;
  }

  async upsert(preference: UserPreference): Promise<void> {
    this.items.set(preference.userId, preference);
  }
}

class InMemoryTestGenerationBatchRepository implements TestGenerationBatchRepositoryPort {
  constructor(private readonly store: MemoryStore<TestGenerationBatch>) {}

  async findLatestByStoryboardId(
    storyboardId: string,
  ): Promise<TestGenerationBatch | null> {
    return (
      this.store
        .values()
        .filter((b) => b.storyboardId === storyboardId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    );
  }

  async save(batch: TestGenerationBatch): Promise<void> {
    await this.store.save(batch);
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

class InMemoryComplementSceneProposalPort implements ComplementSceneProposalPort {
  public readonly calls: ComplementSceneProposalInput[] = [];
  public proposals: ComplementSceneProposal[] = [
    {
      title: "Bridge proposal",
      description: "AI bridging description",
      imagePrompt: "AI bridging image prompt",
      emotion: "Calm",
      cameraDirection: "Wide",
      lightingDirection: "Natural",
      motionDirection: "Slow pan",
    },
  ];

  async proposeComplementScenes(
    input: ComplementSceneProposalInput,
  ): Promise<ComplementSceneProposal[]> {
    this.calls.push(input);
    return this.proposals;
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
  testGenerationBatches?: TestGenerationBatch[];
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
    testGenerationBatches: MemoryStore<TestGenerationBatch>;
  };
  jobQueue: InMemoryJobQueuePort;
  imagePreprocessing: InMemoryImagePreprocessingPort;
  progressEvents: InMemoryProgressEventPort;
  objectStorage: InMemoryObjectStoragePort;
  imageGeneration: InMemoryImageGenerationPort;
  sceneFillGeneration: InMemorySceneFillGenerationPort;
  complementSceneProposal: InMemoryComplementSceneProposalPort;
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
    testGenerationBatches: new MemoryStore<TestGenerationBatch>(
      initial?.testGenerationBatches ?? [],
    ),
  };

  const jobQueue = new InMemoryJobQueuePort();
  const imagePreprocessing = new InMemoryImagePreprocessingPort();
  const progressEvents = new InMemoryProgressEventPort();
  const objectStorage = new InMemoryObjectStoragePort();
  const imageGeneration = new InMemoryImageGenerationPort();
  const sceneFillGeneration = new InMemorySceneFillGenerationPort();
  const complementSceneProposal = new InMemoryComplementSceneProposalPort();
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
    testGenerationBatches: new InMemoryTestGenerationBatchRepository(
      stores.testGenerationBatches,
    ),
    userPreferences: new InMemoryUserPreferenceRepository(),
    objectStorage,
    imagePreprocessing,
    imageGeneration,
    sceneFillGeneration,
    complementSceneProposal,
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
  it("returns the default language for a brand-new user", async () => {
    const deps = createDependencies();

    const result = await getUserPreference(deps, "user_new");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.userId).toBe("user_new");
      expect(result.value.language).toBe("en");
    }
  });

  it("round-trips a user language preference", async () => {
    const deps = createDependencies();

    const setResult = await setUserPreference(deps, {
      userId: "user_1",
      language: "ja",
    });
    expect(setResult.ok).toBe(true);

    const getResult = await getUserPreference(deps, "user_1");
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      expect(getResult.value.language).toBe("ja");
    }
  });

  it("rejects an invalid language", async () => {
    const deps = createDependencies();

    const result = await setUserPreference(deps, {
      userId: "user_1",
      // @ts-expect-error intentional bad value
      language: "fr",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("validation_error");
    }
  });

  it("creates a user-scoped custom style preset", async () => {
    const deps = createDependencies();

    const result = await createCustomStyle(deps, {
      name: " Vintage Film ",
      description: " Soft grain and faded color. ",
      prompt: " Warm film stock with gentle halation. ",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({
        scope: "user",
        name: "Vintage Film",
        description: "Soft grain and faded color.",
        prompt: "Warm film stock with gentle halation.",
      });

      await expect(
        deps.stylePresets.findById(result.value.id),
      ).resolves.toEqual(result.value);
    }
  });

  it("rejects a custom style without a name or prompt", async () => {
    const deps = createDependencies();

    const missingName = await createCustomStyle(deps, {
      name: "",
      description: "",
      prompt: "painterly",
    });
    const missingPrompt = await createCustomStyle(deps, {
      name: "Painterly",
      description: "",
      prompt: "",
    });

    expect(missingName).toMatchObject({
      ok: false,
      error: { code: "validation_error" },
    });
    expect(missingPrompt).toMatchObject({
      ok: false,
      error: { code: "validation_error" },
    });
  });

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

  function createCommonPromptDeps() {
    return createDependencies({
      users: [
        createUser({
          id: "user_1",
          organizationId: "org_1",
          email: "ran@example.com",
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
          prompt: "filmic photorealistic still",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
    });
  }

  function createStoryDeps() {
    return createDependencies({
      users: [
        createUser({
          id: "user_1",
          organizationId: "org_1",
          email: "ran@example.com",
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
      projectPhotoAnalyses: [
        createProjectPhotoAnalysis({
          id: "analysis_1",
          projectId: "project_1",
          emotionCandidates: [
            {
              value: "Reflective",
              label: "Reflective",
              description: "Quiet and thoughtful",
              reason: "The photos suggest a calm family arc.",
            },
          ],
          photoInsights: [
            {
              photoAssetId: "photo_1",
              summary: "A family by the sea.",
              people: "Family members",
              setting: "Seaside town",
              event: "Family gathering",
              atmosphere: "Warm and reflective",
            },
          ],
          storySummary:
            "A family grows across seasons around the same seaside town.",
          model: "local-deterministic",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
    });
  }

  it("auto-generates a common prompt for a new storyboard when none is provided", async () => {
    const deps = createCommonPromptDeps();

    const result = await upsertStoryboard(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      tone: "Reflective",
      stylePresetId: "style_1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.commonPrompt).not.toBe("");
      expect(result.value.commonPrompt).toContain("Reflective");
      expect(result.value.commonPrompt).toContain("Cinematic");
    }
  });

  it("keeps an existing non-empty common prompt when none is provided", async () => {
    const deps = createCommonPromptDeps();

    await upsertStoryboard(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      tone: "Reflective",
      stylePresetId: "style_1",
      commonPrompt: "Hand-written common prompt.",
    });

    const result = await upsertStoryboard(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      tone: "Joyful",
      stylePresetId: "style_1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.commonPrompt).toBe("Hand-written common prompt.");
    }
  });

  it("regenerates the common prompt when an explicit empty value is provided", async () => {
    const deps = createCommonPromptDeps();

    await upsertStoryboard(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      tone: "Reflective",
      stylePresetId: "style_1",
      commonPrompt: "Hand-written common prompt.",
    });

    const result = await upsertStoryboard(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      tone: "Joyful",
      stylePresetId: "style_1",
      commonPrompt: "",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.commonPrompt).not.toBe("Hand-written common prompt.");
      expect(result.value.commonPrompt).toContain("Joyful");
    }
  });

  it("stores an explicit non-empty common prompt verbatim", async () => {
    const deps = createCommonPromptDeps();

    const result = await upsertStoryboard(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      tone: "Reflective",
      stylePresetId: "style_1",
      commonPrompt: "  Warm nostalgic family film.  ",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.commonPrompt).toBe("Warm nostalgic family film.");
    }
  });

  it("seeds a storyboard story from the latest photo analysis", async () => {
    const deps = createStoryDeps();

    const result = await upsertStoryboard(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      tone: "Reflective",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.story).toBe(
        "A family grows across seasons around the same seaside town.",
      );
    }
  });

  it("keeps an existing non-empty story when none is provided", async () => {
    const deps = createStoryDeps();

    await upsertStoryboard(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      tone: "Reflective",
      story: "Hand-written worldview.",
    });

    const result = await upsertStoryboard(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      tone: "Joyful",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.story).toBe("Hand-written worldview.");
    }
  });

  it("regenerates the story when an explicit empty value is provided", async () => {
    const deps = createStoryDeps();

    await upsertStoryboard(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      tone: "Reflective",
      story: "Hand-written worldview.",
    });

    const result = await upsertStoryboard(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      tone: "Joyful",
      story: "",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.story).toBe(
        "A family grows across seasons around the same seaside town.",
      );
    }
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
      expect(result.value.cached).toBe(false);
      expect(result.value.analysis.model).toBe("test-model");
    }
  });

  it("reuses the stored analysis when inputs are unchanged", async () => {
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
      ],
    });

    const first = await analyzeProjectPhotos(deps, { projectId: "project_1" });
    expect(first.ok).toBe(true);
    expect(deps.photoAnalysisGeneration.calls).toHaveLength(1);

    const second = await analyzeProjectPhotos(deps, { projectId: "project_1" });
    expect(second.ok).toBe(true);
    // No second AI call: the cached analysis is reused.
    expect(deps.photoAnalysisGeneration.calls).toHaveLength(1);
    expect(deps.stores.projectPhotoAnalyses.values()).toHaveLength(1);
    if (first.ok && second.ok) {
      expect(second.value.cached).toBe(true);
      expect(second.value.analysis.id).toBe(first.value.analysis.id);
    }
  });

  it("re-runs analysis after a photo changes", async () => {
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
      ],
    });

    const first = await analyzeProjectPhotos(deps, { projectId: "project_1" });
    expect(first.ok).toBe(true);
    expect(deps.photoAnalysisGeneration.calls).toHaveLength(1);

    // A new candidate photo changes the analyzable set.
    await deps.photoAssets.save(
      createPhotoAsset({
        id: "photo_2",
        projectId: "project_1",
        name: "added.jpg",
        usage: "candidate",
        storageKey: "added.jpg",
        mimeType: "image/jpeg",
        size: 1,
        checksum: "added",
        sourceKind: "upload",
        createdAt: "2026-05-04T00:00:00.000Z",
        updatedAt: "2026-05-04T00:00:00.000Z",
      }),
    );

    const second = await analyzeProjectPhotos(deps, { projectId: "project_1" });
    expect(second.ok).toBe(true);
    expect(deps.photoAnalysisGeneration.calls).toHaveLength(2);
    if (second.ok) {
      expect(second.value.cached).toBe(false);
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

  function seedComplementSceneDeps() {
    const ts = "2026-05-02T00:00:00.000Z";
    const baseScene = (id: string, orderIndex: number) =>
      createScene({
        id,
        projectId: "project_1",
        storyboardId: "storyboard_1",
        orderIndex,
        title: `Scene ${orderIndex + 1}`,
        description: "desc",
        imagePrompt: "prompt",
        emotion: "warm",
        cameraDirection: "wide",
        lightingDirection: "soft",
        motionDirection: "still",
        createdAt: ts,
        updatedAt: ts,
      });
    return createDependencies({
      users: [
        createUser({
          id: "user_1",
          organizationId: "org_1",
          displayName: "Ran",
          createdAt: ts,
          updatedAt: ts,
        }),
      ],
      organizations: [
        createOrganization({
          id: "org_1",
          name: "Family Studio",
          createdAt: ts,
          updatedAt: ts,
        }),
      ],
      projects: [
        createProject({
          id: "project_1",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Family Story",
          createdAt: ts,
          updatedAt: ts,
        }),
      ],
      storyboards: [
        createStoryboard({
          id: "storyboard_1",
          projectId: "project_1",
          tone: "Reflective",
          createdAt: ts,
          updatedAt: ts,
        }),
      ],
      scenes: [baseScene("scene_1", 0), baseScene("scene_2", 1)],
    });
  }

  it("inserts a blank complement scene between two adjacent scenes", async () => {
    const deps = seedComplementSceneDeps();

    const result = await insertComplementScene(deps, {
      storyboardId: "storyboard_1",
      fromSceneId: "scene_1",
      toSceneId: "scene_2",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("complement");
      expect(result.value.orderIndex).toBe(1);
      expect(result.value.photoAssets).toHaveLength(0);
      expect(result.value.bridge).toEqual({
        fromSceneId: "scene_1",
        toSceneId: "scene_2",
      });
    }

    const scenes = await deps.scenes.findByStoryboardId("storyboard_1");
    expect(scenes).toHaveLength(3);
    const trailing = scenes.find((scene) => scene.id === "scene_2");
    expect(trailing?.orderIndex).toBe(2);
  });

  it("rejects a complement scene between non-adjacent scenes", async () => {
    const deps = seedComplementSceneDeps();

    const result = await insertComplementScene(deps, {
      storyboardId: "storyboard_1",
      fromSceneId: "scene_2",
      toSceneId: "scene_1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_state");
    }
  });

  it("returns AI complement-scene proposals for a bridge", async () => {
    const deps = seedComplementSceneDeps();

    const result = await proposeComplementScenes(deps, {
      storyboardId: "storyboard_1",
      fromSceneId: "scene_1",
      toSceneId: "scene_2",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.length).toBeGreaterThan(0);
      expect(result.value.length).toBeLessThanOrEqual(3);
    }
    expect(deps.complementSceneProposal.calls).toHaveLength(1);
  });

  it("reorders scenes and rejects an incomplete order list", async () => {
    const deps = seedComplementSceneDeps();

    const result = await reorderScenes(deps, {
      storyboardId: "storyboard_1",
      sceneIds: ["scene_2", "scene_1"],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.map((scene) => scene.id)).toEqual([
        "scene_2",
        "scene_1",
      ]);
      expect(result.value[0]?.orderIndex).toBe(0);
    }

    const incomplete = await reorderScenes(deps, {
      storyboardId: "storyboard_1",
      sceneIds: ["scene_1"],
    });
    expect(incomplete.ok).toBe(false);
  });

  it("reorders photos by the provided id list", async () => {
    const ts = "2026-05-02T00:00:00.000Z";
    const photo = (id: string, position: number) =>
      createPhotoAsset({
        id,
        projectId: "project_1",
        name: `${id}.jpg`,
        storageKey: `data/uploads/originals/projects/project_1/${id}.jpg`,
        mimeType: "image/jpeg",
        size: 1024,
        checksum: `checksum_${id}`,
        sourceKind: "upload",
        position,
        createdAt: ts,
        updatedAt: ts,
      });
    const deps = createDependencies({
      users: [
        createUser({
          id: "user_1",
          organizationId: "org_1",
          displayName: "Ran",
          createdAt: ts,
          updatedAt: ts,
        }),
      ],
      organizations: [
        createOrganization({
          id: "org_1",
          name: "Family Studio",
          createdAt: ts,
          updatedAt: ts,
        }),
      ],
      projects: [
        createProject({
          id: "project_1",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Family Story",
          createdAt: ts,
          updatedAt: ts,
        }),
      ],
      photoAssets: [photo("photo_1", 0), photo("photo_2", 1)],
    });

    const result = await reorderPhotos(deps, {
      projectId: "project_1",
      photoAssetIds: ["photo_2", "photo_1"],
    });

    expect(result.ok).toBe(true);
    const photo2 = await deps.photoAssets.findById("photo_2");
    const photo1 = await deps.photoAssets.findById("photo_1");
    expect(photo2?.position).toBe(0);
    expect(photo1?.position).toBe(1);
  });

  describe("test-generation adjustments", () => {
    const SUFFIXES: Record<TestAdjustmentId, string> = {
      warmer: "warmer color temperature",
      cooler: "cooler color temperature",
      more_cinematic: "stronger cinematic grade",
      darker: "lower-key lighting",
      brighter: "higher-key lighting",
      more_candid: "candid documentary feel",
    };

    async function seedBatch(opts?: { adjustments?: TestAdjustmentId[] }) {
      const deps = createDependencies();
      const ts = new Date().toISOString();
      await deps.projects.save(
        createProject({
          id: "p1",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Proj",
          createdAt: ts,
          updatedAt: ts,
        }),
      );
      await deps.storyboards.save(
        createStoryboard({
          id: "sb1",
          projectId: "p1",
          tone: "cinematic",
          commonPrompt: "Base prompt.",
          createdAt: ts,
          updatedAt: ts,
        }),
      );
      await deps.scenes.save(
        createScene({
          id: "s1",
          projectId: "p1",
          storyboardId: "sb1",
          orderIndex: 0,
          title: "T",
          description: "D",
          imagePrompt: "P",
          emotion: "",
          cameraDirection: "",
          lightingDirection: "",
          motionDirection: "",
          createdAt: ts,
          updatedAt: ts,
        }),
      );
      await deps.testGenerationBatches.save(
        createTestGenerationBatch({
          id: "batch_1",
          storyboardId: "sb1",
          status: "pending",
          createdAt: ts,
        }),
      );
      await deps.generationRequests.save(
        createGenerationRequest({
          id: "variant_1",
          projectId: "p1",
          storyboardId: "sb1",
          sceneId: "s1",
          inputJson: { testBatchId: "batch_1", testVariant: 0 },
          appliedAdjustments: opts?.adjustments ?? [],
          createdAt: ts,
          updatedAt: ts,
        }),
      );
      return deps;
    }

    it("applyAdjustmentToTestVariant queues a new request with adjustments", async () => {
      const deps = await seedBatch();

      const result = await applyAdjustmentToTestVariant(deps, {
        storyboardId: "sb1",
        variantId: "variant_1",
        adjustmentIds: ["warmer", "more_cinematic"],
        adjustmentSuffixes: SUFFIXES,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.appliedAdjustments).toEqual([
          "warmer",
          "more_cinematic",
        ]);
        expect(result.value.sourceGenerationRequestId).toBe("variant_1");
        expect(result.value.status).toBe("queued");
      }
    });

    it("applyAdjustmentToTestVariant rejects more than 3 adjustments", async () => {
      const deps = await seedBatch();
      const result = await applyAdjustmentToTestVariant(deps, {
        storyboardId: "sb1",
        variantId: "variant_1",
        adjustmentIds: ["warmer", "cooler", "darker", "brighter"],
        adjustmentSuffixes: SUFFIXES,
      });
      expect(result.ok).toBe(false);
    });

    it("confirmTestGeneration appends adjustments to commonPrompt once", async () => {
      const deps = await seedBatch({
        adjustments: ["warmer", "more_cinematic"],
      });

      const result = await confirmTestGeneration(deps, {
        storyboardId: "sb1",
        confirmedGenerationRequestId: "variant_1",
        adjustmentSuffixes: SUFFIXES,
      });
      expect(result.ok).toBe(true);

      const sb1 = await deps.storyboards.findById("sb1");
      expect(sb1?.commonPrompt).toBe(
        "Base prompt. warmer color temperature stronger cinematic grade",
      );

      const reconfirm = await confirmTestGeneration(deps, {
        storyboardId: "sb1",
        confirmedGenerationRequestId: "variant_1",
        adjustmentSuffixes: SUFFIXES,
      });
      expect(reconfirm.ok).toBe(false);
    });

    it("confirmTestGeneration with no adjustments leaves commonPrompt unchanged", async () => {
      const deps = await seedBatch({ adjustments: [] });
      const before = (await deps.storyboards.findById("sb1"))?.commonPrompt;

      const result = await confirmTestGeneration(deps, {
        storyboardId: "sb1",
        confirmedGenerationRequestId: "variant_1",
        adjustmentSuffixes: SUFFIXES,
      });
      expect(result.ok).toBe(true);

      const after = (await deps.storyboards.findById("sb1"))?.commonPrompt;
      expect(after).toBe(before);
    });
  });
});
