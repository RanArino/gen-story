import { describe, expect, it } from "vitest";

import {
  createGeneratedImage,
  createGenerationRequest,
  createOrganization,
  createPhotoAsset,
  createProject,
  createScene,
  createStoryboard,
  createStylePreset,
  createUser,
  type GeneratedImage,
  type GenerationRequest,
  type Organization,
  type PhotoAsset,
  type Project,
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
  PhotoAssetRepositoryPort,
  ProgressEventPort,
  ProjectRepositoryPort,
  SceneRepositoryPort,
  StoryboardRepositoryPort,
  StylePresetRepositoryPort,
  UserRepositoryPort,
} from "./ports";
import {
  assignPhotosToScene,
  createGenerationRequestUseCase,
  createProjectUseCase,
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

  async save(project: Project): Promise<void> {
    await this.store.save(project);
  }
}

class InMemoryPhotoAssetRepository implements PhotoAssetRepositoryPort {
  constructor(private readonly store: MemoryStore<PhotoAsset>) {}

  async findById(photoAssetId: string): Promise<PhotoAsset | null> {
    return this.store.findById(photoAssetId);
  }

  async findByProjectId(projectId: string): Promise<PhotoAsset[]> {
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
    return this.store.values().filter((request) => request.sceneId === sceneId);
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
  };
  jobQueue: InMemoryJobQueuePort;
  imagePreprocessing: InMemoryImagePreprocessingPort;
  progressEvents: InMemoryProgressEventPort;
  objectStorage: InMemoryObjectStoragePort;
  imageGeneration: InMemoryImageGenerationPort;
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
  };

  const jobQueue = new InMemoryJobQueuePort();
  const imagePreprocessing = new InMemoryImagePreprocessingPort();
  const progressEvents = new InMemoryProgressEventPort();
  const objectStorage = new InMemoryObjectStoragePort();
  const imageGeneration = new InMemoryImageGenerationPort();

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
    objectStorage,
    imagePreprocessing,
    imageGeneration,
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
});
