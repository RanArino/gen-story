import type {
  AgentConversationRepositoryPort,
  AgentRunnerAvailability,
  AgentTurnEvent,
  AgentTurnRequest,
  AgentTurnRunnerPort,
  AiJobRepositoryPort,
  ApplicationDependencies,
  ChangeProposalRepositoryPort,
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
  StorySetupGenerationInput,
  StorySetupGenerationPort,
  StorySetupSuggestion,
  StoryboardRepositoryPort,
  StylePresetRepositoryPort,
  TestGenerationBatchRepositoryPort,
  UserPreference,
  UserPreferenceRepositoryPort,
  UserRepositoryPort,
} from "@gen-story/application";
import type {
  AgentConversation,
  AgentConversationMessage,
  AgentConversationTurn,
  AgentProviderBinding,
  AiJobKind,
  GenerationRequestStatus,
  TestGenerationBatch,
} from "@gen-story/domain";
import { createAiJob } from "@gen-story/domain";
import type { ApiAgentRuntimeInfo } from "../app/create-api-context";
import { LocalAuthContext } from "../auth/local-auth";
import { LocalProgressEvents } from "../jobs/local-progress-events";
import { InMemoryMcpToolCallAudits } from "../mcp/tool-call-audit";
import type {
  AiJob,
  ChangeProposal,
  ChangeProposalStatus,
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

  async delete(id: string): Promise<void> {
    this.items.delete(id);
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

  async softDelete(sceneId: string, _deletedAt: string): Promise<void> {
    await this.store.delete(sceneId);
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

  async findByStoryboardId(storyboardId: string): Promise<GenerationRequest[]> {
    return this.store
      .values()
      .filter((r) => r.storyboardId === storyboardId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async findByTestBatchId(testBatchId: string): Promise<GenerationRequest[]> {
    return this.store
      .values()
      .filter((r) => r.testGenerationBatchId === testBatchId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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

function upsertById<T extends { id: string }>(items: T[], item: T): void {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) {
    items.push(item);
    return;
  }
  items[index] = item;
}

export class InMemoryAgentConversationRepository implements AgentConversationRepositoryPort {
  public readonly conversations: AgentConversation[] = [];
  public readonly bindings: AgentProviderBinding[] = [];
  public readonly turns: AgentConversationTurn[] = [];
  public readonly messages: AgentConversationMessage[] = [];

  async findById(conversationId: string): Promise<AgentConversation | null> {
    return (
      this.conversations.find(
        (conversation) => conversation.id === conversationId,
      ) ?? null
    );
  }

  async findByProjectId(projectId: string): Promise<AgentConversation[]> {
    return this.conversations.filter(
      (conversation) => conversation.projectId === projectId,
    );
  }

  async save(conversation: AgentConversation): Promise<void> {
    upsertById(this.conversations, conversation);
  }

  async findBindingById(
    bindingId: string,
  ): Promise<AgentProviderBinding | null> {
    return this.bindings.find((binding) => binding.id === bindingId) ?? null;
  }

  async listBindings(conversationId: string): Promise<AgentProviderBinding[]> {
    return this.bindings.filter(
      (binding) => binding.conversationId === conversationId,
    );
  }

  async saveBinding(binding: AgentProviderBinding): Promise<void> {
    upsertById(this.bindings, binding);
  }

  async findTurnById(turnId: string): Promise<AgentConversationTurn | null> {
    return this.turns.find((turn) => turn.id === turnId) ?? null;
  }

  async findTurnByClientRequestId(
    conversationId: string,
    clientRequestId: string,
  ): Promise<AgentConversationTurn | null> {
    return (
      this.turns.find(
        (turn) =>
          turn.conversationId === conversationId &&
          turn.clientRequestId === clientRequestId,
      ) ?? null
    );
  }

  async listTurns(conversationId: string): Promise<AgentConversationTurn[]> {
    return this.turns.filter((turn) => turn.conversationId === conversationId);
  }

  async saveTurn(turn: AgentConversationTurn): Promise<void> {
    upsertById(this.turns, turn);
  }

  async listMessages(
    conversationId: string,
    afterSequence?: number,
  ): Promise<AgentConversationMessage[]> {
    return this.messages
      .filter(
        (message) =>
          message.conversationId === conversationId &&
          (afterSequence == null || message.sequence > afterSequence),
      )
      .sort((left, right) => left.sequence - right.sequence);
  }

  async saveMessage(message: AgentConversationMessage): Promise<void> {
    upsertById(this.messages, message);
  }

  async nextMessageSequence(conversationId: string): Promise<number> {
    const sequences = this.messages
      .filter((message) => message.conversationId === conversationId)
      .map((message) => message.sequence);
    return (sequences.length === 0 ? 0 : Math.max(...sequences)) + 1;
  }
}

// Replays a scripted provider turn instead of spawning a CLI, and records
// every request so tests can assert exactly what was sent to the provider.
export class StubAgentTurnRunner implements AgentTurnRunnerPort {
  public readonly requests: AgentTurnRequest[] = [];
  public readonly cancelled: string[] = [];
  public readonly released: string[] = [];
  public script: AgentTurnEvent[] = [
    { type: "session-started", nativeSessionId: "session-1" },
    { type: "assistant-text", text: "Understood." },
    { type: "turn-completed", status: "completed", providerTurnId: "t-1" },
  ];
  public available: AgentRunnerAvailability = {
    available: true,
    provider: "codex",
    model: "gpt-5-codex",
  };
  public compactSupported = true;

  availability(): AgentRunnerAvailability {
    return this.available;
  }

  async startTurn(
    request: AgentTurnRequest,
    onEvent: (event: AgentTurnEvent) => void,
  ): Promise<void> {
    this.requests.push(request);
    for (const event of this.script) {
      onEvent(event);
    }
  }

  async cancelTurn(input: { turnId: string }): Promise<boolean> {
    this.cancelled.push(input.turnId);
    return true;
  }

  async compact(): Promise<boolean> {
    return this.compactSupported;
  }

  async release(input: { conversationId: string }): Promise<void> {
    this.released.push(input.conversationId);
  }
}

class InMemoryChangeProposalRepository implements ChangeProposalRepositoryPort {
  constructor(private readonly store: MemoryStore<ChangeProposal>) {}

  async findById(changeProposalId: string): Promise<ChangeProposal | null> {
    return this.store.findById(changeProposalId);
  }

  async findByClientRequestId(
    projectId: string,
    clientRequestId: string,
  ): Promise<ChangeProposal | null> {
    return (
      this.store
        .values()
        .find(
          (proposal) =>
            proposal.projectId === projectId &&
            proposal.clientRequestId === clientRequestId,
        ) ?? null
    );
  }

  async findByProjectId(
    projectId: string,
    status?: ChangeProposalStatus,
  ): Promise<ChangeProposal[]> {
    return this.store
      .values()
      .filter(
        (proposal) =>
          proposal.projectId === projectId &&
          (status == null || proposal.status === status),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async save(changeProposal: ChangeProposal): Promise<void> {
    await this.store.save(changeProposal);
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

  async listByStoryboardId(
    storyboardId: string,
  ): Promise<TestGenerationBatch[]> {
    return this.store
      .values()
      .filter((b) => b.storyboardId === storyboardId)
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
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

class InMemoryStorySetupGeneration implements StorySetupGenerationPort {
  async generateStorySetup(
    input: StorySetupGenerationInput,
  ): Promise<StorySetupSuggestion> {
    return {
      story: `AI story for ${input.project.name} (${input.storyboard.tone})`,
      commonPrompt: `AI common prompt for ${input.storyboard.tone}`,
      negativePrompt: "text, watermark",
      model: "in-memory",
    };
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

class InMemoryAiJobRepository implements AiJobRepositoryPort {
  constructor(private readonly store: MemoryStore<AiJob>) {}

  async findById(aiJobId: string): Promise<AiJob | null> {
    return this.store.findById(aiJobId);
  }

  async findQueued(): Promise<AiJob[]> {
    return this.store.values().filter((job) => job.status === "queued");
  }

  async findRunning(): Promise<AiJob[]> {
    return this.store.values().filter((job) => job.status === "running");
  }

  async findRunningCountByProjectId(projectId: string): Promise<number> {
    return this.store
      .values()
      .filter((job) => job.projectId === projectId && job.status === "running")
      .length;
  }

  async findByProjectId(projectId: string): Promise<AiJob[]> {
    return this.store.values().filter((job) => job.projectId === projectId);
  }

  async save(aiJob: AiJob): Promise<void> {
    await this.store.save(aiJob);
  }
}

// Writes real rows into the AI job store so tests can assert on what was
// enqueued, and so the worker can be driven end to end in memory.
class InMemoryJobQueue implements JobQueuePort {
  private sequence = 0;

  constructor(
    private readonly store: MemoryStore<AiJob>,
    private readonly progressEvents: ProgressEventPort,
  ) {}

  async enqueue(job: {
    kind: AiJobKind;
    projectId: string;
    payload: Record<string, unknown>;
  }): Promise<{ jobId: string }> {
    this.sequence += 1;
    const timestamp = new Date().toISOString();
    const aiJob = createAiJob({
      id: `job_${this.sequence}`,
      projectId: job.projectId,
      kind: job.kind,
      inputJson: job.payload,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await this.store.save(aiJob);
    await this.progressEvents.publish({
      kind: "ai-job.queued",
      entityType: "aiJob",
      entityId: aiJob.id,
      payload: {
        aiJobId: aiJob.id,
        projectId: aiJob.projectId,
        jobKind: aiJob.kind,
        status: aiJob.status,
      },
    });

    return { jobId: aiJob.id };
  }
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
    changeProposals?: ChangeProposal[];
    testGenerationBatches?: TestGenerationBatch[];
    aiJobs?: AiJob[];
  },
  overrides?: Partial<Omit<ApplicationDependencies, "progressEvents">> & {
    progressEvents?: LocalProgressEvents;
  },
): ApplicationDependencies & {
  progressEvents: LocalProgressEvents;
  agentRuntime: ApiAgentRuntimeInfo;
  mcpToolCallAudits: InMemoryMcpToolCallAudits;
  agentConversations: AgentConversationRepositoryPort;
  agentTurnRunner: AgentTurnRunnerPort;
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
    changeProposals: MemoryStore<ChangeProposal>;
    testGenerationBatches: MemoryStore<TestGenerationBatch>;
    aiJobs: MemoryStore<AiJob>;
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
    changeProposals: new MemoryStore(initial?.changeProposals ?? []),
    testGenerationBatches: new MemoryStore<TestGenerationBatch>(
      initial?.testGenerationBatches ?? [],
    ),
    aiJobs: new MemoryStore<AiJob>(initial?.aiJobs ?? []),
  };
  const progressEvents = new LocalProgressEvents();
  const dependencies: ApplicationDependencies & {
    progressEvents: LocalProgressEvents;
    agentRuntime: ApiAgentRuntimeInfo;
    mcpToolCallAudits: InMemoryMcpToolCallAudits;
  } = {
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
    aiJobs: new InMemoryAiJobRepository(stores.aiJobs),
    projectPhotoAnalyses: new InMemoryProjectPhotoAnalysisRepository(
      stores.projectPhotoAnalyses,
    ),
    changeProposals: new InMemoryChangeProposalRepository(
      stores.changeProposals,
    ),
    testGenerationBatches: new InMemoryTestGenerationBatchRepository(
      stores.testGenerationBatches,
    ),
    agentConversations: new InMemoryAgentConversationRepository(),
    agentTurnRunner: new StubAgentTurnRunner(),
    userPreferences: new InMemoryUserPreferenceRepository(),
    objectStorage: new InMemoryObjectStorage(),
    imagePreprocessing: new InMemoryImagePreprocessing(),
    imageGeneration: new InMemoryImageGeneration(),
    characterSheetGeneration: new InMemoryImageGeneration(),
    sceneFillGeneration: new InMemorySceneFillGeneration(),
    complementSceneProposal: new InMemoryComplementSceneProposal(),
    photoAnalysisGeneration: new InMemoryPhotoAnalysisGeneration(),
    storySetupGeneration: new InMemoryStorySetupGeneration(),
    jobQueue: new InMemoryJobQueue(stores.aiJobs, progressEvents),
    progressEvents,
    authContext: new LocalAuthContext({
      users: new InMemoryUserRepository(stores.users),
      organizations: new InMemoryOrganizationRepository(stores.organizations),
    }),
    mcpToolCallAudits: new InMemoryMcpToolCallAudits(),
    agentRuntime: {
      selection: "api",
      wallet: "api_key",
      capabilities: null,
      availability: { status: "not_applicable" },
    },
    ...overrides,
  };

  return {
    ...dependencies,
    stores,
  };
}
