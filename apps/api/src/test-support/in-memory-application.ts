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
  PhotoAssetRepositoryPort,
  PhotoAnalysisGenerationInput,
  PhotoAnalysisGenerationPort,
  PhotoAnalysisGenerationResult,
  ProgressEventPort,
  ProjectRepositoryPort,
  ProjectPhotoAnalysisRepositoryPort,
  SceneFillGenerationInput,
  SceneFillGenerationPort,
  SceneFillSuggestion,
  SceneRepositoryPort,
  StoryboardRepositoryPort,
  StylePresetRepositoryPort,
  TestGenerationBatchRepositoryPort,
  UserRepositoryPort,
} from "@gen-story/application";
import type {
  GenerationRequestStatus,
  TestGenerationBatch,
} from "@gen-story/domain";
import { LocalAuthContext } from "../auth/local-auth";
import type {
  GeneratedImage,
  GenerationRequest,
  Organization,
  PhotoAsset,
  Project,
  ProjectPhotoAnalysis,
  Scene,
  Storyboard,
  StylePreset,
  User,
} from "@gen-story/domain";

type EntityWithId = { id: string };

export class MemoryStore<T extends EntityWithId> {
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

  async findById(
    generationRequestId: string,
  ): Promise<GenerationRequest | null> {
    return this.store.findById(generationRequestId);
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

  async findByStoryboardId(
    storyboardId: string,
  ): Promise<GenerationRequest[]> {
    return this.store
      .values()
      .filter((r) => r.storyboardId === storyboardId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
    const existing = await this.findLatestByProjectId(
      projectPhotoAnalysis.projectId,
    );
    if (existing != null && existing.id !== projectPhotoAnalysis.id) {
      await this.store.save({ ...projectPhotoAnalysis, id: existing.id });
      return;
    }
    await this.store.save(projectPhotoAnalysis);
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

class InMemoryObjectStorage implements ObjectStoragePort {
  private readonly objects = new Map<string, Uint8Array>();

  async putObject(input: {
    key: string;
    body: Uint8Array;
    contentType: string;
  }): Promise<void> {
    this.objects.set(input.key, input.body);
  }

  async getObject(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

class InMemoryImagePreprocessing implements ImagePreprocessingPort {
  async preprocess(input: {
    inputJson: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    return input.inputJson;
  }
}

class InMemoryImageGeneration implements ImageGenerationPort {
  async generate(): Promise<{
    storageKey: string;
    mimeType: string;
    size: number;
    width: number | null;
    height: number | null;
    checksum: string;
  }> {
    return {
      storageKey:
        "data/uploads/generated/images/projects/project_1/scenes/scene_1/image_1.jpg",
      mimeType: "image/jpeg",
      size: 1,
      width: 1,
      height: 1,
      checksum: "checksum",
    };
  }
}

class InMemorySceneFillGeneration implements SceneFillGenerationPort {
  async generateSceneFill(
    input: SceneFillGenerationInput,
  ): Promise<SceneFillSuggestion> {
    return {
      title: `AI ${input.primaryPhoto.name}`,
      description: `AI description for ${input.primaryPhoto.name}`,
      imagePrompt: `AI image prompt for ${input.primaryPhoto.name}`,
      emotion: "Joy",
      cameraDirection: "Medium",
      lightingDirection: "Natural",
      motionDirection: "Slow pan",
    };
  }
}

class InMemoryComplementSceneProposal implements ComplementSceneProposalPort {
  async proposeComplementScenes(
    input: ComplementSceneProposalInput,
  ): Promise<ComplementSceneProposal[]> {
    return [
      {
        title: `Bridge ${input.fromScene.id} → ${input.toScene.id}`,
        description: `AI bridging scene for ${input.project.name}`,
        imagePrompt: `AI bridging image prompt for ${input.storyboard.tone}`,
        emotion: "Calm",
        cameraDirection: "Wide",
        lightingDirection: "Natural",
        motionDirection: "Slow pan",
      },
    ];
  }
}

class InMemoryPhotoAnalysisGeneration implements PhotoAnalysisGenerationPort {
  async analyzeProjectPhotos(
    input: PhotoAnalysisGenerationInput,
  ): Promise<PhotoAnalysisGenerationResult> {
    return {
      emotionCandidates: [
        {
          value: "warm_nostalgia",
          label: "Warm nostalgia",
          description: "Tender and memory-focused.",
          reason: `Generated from ${input.photos.length} photos.`,
        },
        {
          value: "quiet_gratitude",
          label: "Quiet gratitude",
          description: "Calm and appreciative.",
          reason: "A reflective option for the storyboard.",
        },
        {
          value: "joyful_connection",
          label: "Joyful connection",
          description: "Bright and people-centered.",
          reason: "A lively option for the storyboard.",
        },
      ],
      photoInsights: input.photos.map((photo) => ({
        photoAssetId: photo.id,
        summary: `Insight for ${photo.name}`,
        people: "People insight",
        setting: "Setting insight",
        event: "Event insight",
        atmosphere: "Atmosphere insight",
      })),
      storySummary: `Summary for ${input.project.name}`,
      model: "in-memory",
    };
  }
}

class InMemoryJobQueue implements JobQueuePort {
  async enqueue(): Promise<{ jobId: string }> {
    return { jobId: "job_1" };
  }
}

class InMemoryProgressEvents implements ProgressEventPort {
  async publish(): Promise<void> {}
}

export function createInMemoryApplicationDependencies(
  initial?: {
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
  },
  overrides?: Partial<ApplicationDependencies>,
): ApplicationDependencies & {
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
} {
  const stores = {
    users: new MemoryStore(initial?.users ?? []),
    organizations: new MemoryStore(initial?.organizations ?? []),
    projects: new MemoryStore(initial?.projects ?? []),
    photoAssets: new MemoryStore(initial?.photoAssets ?? []),
    storyboards: new MemoryStore(initial?.storyboards ?? []),
    scenes: new MemoryStore(initial?.scenes ?? []),
    stylePresets: new MemoryStore(initial?.stylePresets ?? []),
    generationRequests: new MemoryStore(initial?.generationRequests ?? []),
    generatedImages: new MemoryStore(initial?.generatedImages ?? []),
    projectPhotoAnalyses: new MemoryStore(initial?.projectPhotoAnalyses ?? []),
    testGenerationBatches: new MemoryStore<TestGenerationBatch>(
      initial?.testGenerationBatches ?? [],
    ),
  };
  const dependencies: ApplicationDependencies = {
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
    objectStorage: new InMemoryObjectStorage(),
    imagePreprocessing: new InMemoryImagePreprocessing(),
    imageGeneration: new InMemoryImageGeneration(),
    sceneFillGeneration: new InMemorySceneFillGeneration(),
    complementSceneProposal: new InMemoryComplementSceneProposal(),
    photoAnalysisGeneration: new InMemoryPhotoAnalysisGeneration(),
    jobQueue: new InMemoryJobQueue(),
    progressEvents: new InMemoryProgressEvents(),
    authContext: new LocalAuthContext({
      users: new InMemoryUserRepository(stores.users),
      organizations: new InMemoryOrganizationRepository(stores.organizations),
    }),
    ...overrides,
  };

  return {
    ...dependencies,
    stores,
  };
}
