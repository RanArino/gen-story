import { describe, expect, it } from "vitest";

import {
  createAiJob,
  createChangeProposal,
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
  storyboardSemanticTarget,
  type AgentConversation,
  type AgentConversationMessage,
  type AgentConversationTurn,
  type AgentProviderBinding,
  type ChangeProposal,
  type ChangeProposalStatus,
  type TestAdjustmentId,
  type AiJob,
  type AiJobKind,
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
  StorySetupGenerationInput,
  StorySetupGenerationPort,
  StorySetupSuggestion,
  StoryboardRepositoryPort,
  StylePresetRepositoryPort,
  TestGenerationBatchRepositoryPort,
  UserPreference,
  UserPreferenceRepositoryPort,
  UserRepositoryPort,
} from "./ports";
import {
  cancelAgentChatTurn,
  compactAgentChatConversation,
  createAgentChatConversation,
  forkAgentChatProviderSession,
  getAgentChatConversation,
  postAgentChatTurn,
  runAgentChatTurn,
} from "./agent-chat-use-cases";
import {
  analyzeProjectPhotos,
  applyAdjustmentToTestVariant,
  applyChangeProposal,
  assignPhotosToScene,
  confirmTestGeneration,
  createGenerationRequestUseCase,
  createCustomStyle,
  createTemplateScenesFromPhotos,
  createProjectUseCase,
  decideChangeProposalItem,
  fillSceneWithAi,
  fillStoryboardScenesWithAi,
  generateStorySetup,
  generateCharacterReferenceSheet,
  getCharacterReferenceSheet,
  getProjectPhotoAnalysis,
  getUserPreference,
  insertComplementScene,
  listTestGenerationBatches,
  markGeneratedImageAdopted,
  proposeComplementScenes,
  registerPhotoAsset,
  reorderPhotos,
  reorderScenes,
  retryFailedGenerationRequest,
  reviseChangeProposalItemUseCase,
  runComplementSceneProposalsJob,
  runPhotoAnalysisJob,
  runSceneAiFillJob,
  runStorySetupJob,
  runCharacterSheetGenerationJob,
  selectChangeProposalChoice,
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
    await this.store.save(projectPhotoAnalysis);
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

class InMemoryStorySetupGenerationPort implements StorySetupGenerationPort {
  public readonly calls: StorySetupGenerationInput[] = [];
  public result: StorySetupSuggestion = {
    story: "A warm story about this family, told over one long summer.",
    commonPrompt: "Warm grain, soft highlights, muted color, consistent cast.",
    negativePrompt: "text, watermark, extra limbs",
    model: "test-model",
  };

  async generateStorySetup(
    input: StorySetupGenerationInput,
  ): Promise<StorySetupSuggestion> {
    this.calls.push(input);
    return this.result;
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

class InMemoryJobQueuePort implements JobQueuePort {
  public readonly jobs: Array<{
    kind: AiJobKind;
    projectId: string;
    payload: Record<string, unknown>;
  }> = [];

  constructor(private readonly store: MemoryStore<AiJob>) {}

  async enqueue(job: {
    kind: AiJobKind;
    projectId: string;
    payload: Record<string, unknown>;
  }): Promise<{ jobId: string }> {
    this.jobs.push(job);
    const timestamp = new Date().toISOString();
    const aiJob = createAiJob({
      id: `job_${this.jobs.length}`,
      projectId: job.projectId,
      kind: job.kind,
      inputJson: job.payload,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await this.store.save(aiJob);
    return { jobId: aiJob.id };
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

class InMemoryAgentConversationRepository implements AgentConversationRepositoryPort {
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

// Replays a scripted event sequence instead of spawning a CLI. `script` is
// what a provider turn "did"; `requests` records exactly what was sent, which
// is how the transcript-is-not-resent rule is asserted.
class StubAgentTurnRunner implements AgentTurnRunnerPort {
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

function upsertById<T extends { id: string }>(items: T[], item: T): void {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) {
    items.push(item);
    return;
  }
  items[index] = item;
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
  changeProposals?: ChangeProposal[];
  testGenerationBatches?: TestGenerationBatch[];
  aiJobs?: AiJob[];
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
    changeProposals: MemoryStore<ChangeProposal>;
    testGenerationBatches: MemoryStore<TestGenerationBatch>;
    aiJobs: MemoryStore<AiJob>;
  };
  jobQueue: InMemoryJobQueuePort;
  imagePreprocessing: InMemoryImagePreprocessingPort;
  progressEvents: InMemoryProgressEventPort;
  objectStorage: InMemoryObjectStoragePort;
  imageGeneration: InMemoryImageGenerationPort;
  characterSheetGeneration: InMemoryImageGenerationPort;
  sceneFillGeneration: InMemorySceneFillGenerationPort;
  complementSceneProposal: InMemoryComplementSceneProposalPort;
  photoAnalysisGeneration: InMemoryPhotoAnalysisGenerationPort;
  storySetupGeneration: InMemoryStorySetupGenerationPort;
  scenes: InMemorySceneRepository;
  agentConversations: InMemoryAgentConversationRepository;
  agentTurnRunner: StubAgentTurnRunner;
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
    changeProposals: new MemoryStore<ChangeProposal>(
      initial?.changeProposals ?? [],
    ),
    testGenerationBatches: new MemoryStore<TestGenerationBatch>(
      initial?.testGenerationBatches ?? [],
    ),
    aiJobs: new MemoryStore<AiJob>(initial?.aiJobs ?? []),
  };

  const jobQueue = new InMemoryJobQueuePort(stores.aiJobs);
  const imagePreprocessing = new InMemoryImagePreprocessingPort();
  const progressEvents = new InMemoryProgressEventPort();
  const objectStorage = new InMemoryObjectStoragePort();
  const imageGeneration = new InMemoryImageGenerationPort();
  const sceneFillGeneration = new InMemorySceneFillGenerationPort();
  const complementSceneProposal = new InMemoryComplementSceneProposalPort();
  const photoAnalysisGeneration = new InMemoryPhotoAnalysisGenerationPort();
  const storySetupGeneration = new InMemoryStorySetupGenerationPort();

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
    objectStorage,
    imagePreprocessing,
    imageGeneration,
    characterSheetGeneration: imageGeneration,
    sceneFillGeneration,
    complementSceneProposal,
    photoAnalysisGeneration,
    storySetupGeneration,
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

  it("persists an explicit photoFidelity and preserves it when omitted on a later save", async () => {
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

    await upsertStoryboard(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      tone: "Reflective",
      status: "editing",
    });

    const created = await upsertScenes(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      scenes: [
        {
          sceneId: "scene_1",
          projectId: "project_1",
          storyboardId: "storyboard_1",
          orderIndex: 0,
          title: "First",
          description: "desc",
          imagePrompt: "prompt",
          emotion: "warm",
          cameraDirection: "wide",
          lightingDirection: "soft",
          motionDirection: "still",
          photoFidelity: "high",
        },
      ],
    });

    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(created.value[0]?.photoFidelity).toBe("high");
    }

    // Omitting photoFidelity on a later save must not silently reset it to
    // "off" — that would undo the user's choice every time an unrelated
    // field, like the title, is edited and saved.
    const resaved = await upsertScenes(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      scenes: [
        {
          sceneId: "scene_1",
          projectId: "project_1",
          storyboardId: "storyboard_1",
          orderIndex: 0,
          title: "First, retitled",
          description: "desc",
          imagePrompt: "prompt",
          emotion: "warm",
          cameraDirection: "wide",
          lightingDirection: "soft",
          motionDirection: "still",
        },
      ],
    });

    expect(resaved.ok).toBe(true);
    if (resaved.ok) {
      expect(resaved.value[0]?.photoFidelity).toBe("high");
    }
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

  // Setup step 4 gates on the common prompt being written, so a save that does
  // not mention it must leave it blank. Composing one here would mark step 4
  // done the moment the user picked a tone.
  it("leaves the common prompt blank when the caller does not ask for one", async () => {
    const deps = createCommonPromptDeps();

    const result = await upsertStoryboard(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      tone: "Reflective",
      stylePresetId: "style_1",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.commonPrompt).toBe("");
    }
  });

  it("composes a common prompt from tone and style on an explicit regenerate", async () => {
    const deps = createCommonPromptDeps();

    // An explicit empty string is the "regenerate from tone & style" action.
    const result = await upsertStoryboard(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      tone: "Reflective",
      stylePresetId: "style_1",
      commonPrompt: "",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
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

  // Same rule as the common prompt: seeding only on an explicit request keeps
  // setup step 4 gateable.
  it("leaves the story blank when the caller does not ask for one", async () => {
    const deps = createStoryDeps();

    const result = await upsertStoryboard(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      tone: "Reflective",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.story).toBe("");
    }
  });

  it("seeds a storyboard story from the latest photo analysis on an explicit regenerate", async () => {
    const deps = createStoryDeps();

    const result = await upsertStoryboard(deps, {
      storyboardId: "storyboard_1",
      projectId: "project_1",
      tone: "Reflective",
      story: "",
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
    // Image work is queued by the generation_requests row itself, not the AI
    // job queue.
    expect(await deps.generationRequests.findQueued()).toHaveLength(1);
    expect(deps.jobQueue.jobs).toHaveLength(0);
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
    expect(await deps.generationRequests.findQueued()).toHaveLength(1);
    expect(deps.jobQueue.jobs).toHaveLength(0);
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

    const enqueued = await fillSceneWithAi(deps, { sceneId: "scene_ai" });

    expect(enqueued.ok).toBe(true);
    // The enqueue half must not touch the AI port or the scene.
    expect(deps.sceneFillGeneration.calls).toHaveLength(0);
    expect(deps.scenes.saveCalls).toBe(0);
    if (!enqueued.ok || enqueued.value.jobId == null) {
      throw new Error("expected a job to be enqueued");
    }

    const job = await deps.aiJobs.findById(enqueued.value.jobId);
    expect(job?.kind).toBe("scene_ai_fill");
    expect(job?.status).toBe("queued");

    const result = await runSceneAiFillJob(deps, job!);

    expect(result.ok).toBe(true);
    expect(deps.sceneFillGeneration.calls).toHaveLength(1);
    expect(deps.scenes.saveCalls).toBe(1);

    const scene = await deps.scenes.findById("scene_ai");
    expect(scene).toMatchObject({
      title: "Edited title",
      description: "AI description",
      imagePrompt: "AI image prompt",
      emotion: "Wonder",
      cameraDirection: "Medium",
      lightingDirection: "Natural",
      motionDirection: "Slow pan",
    });
    expect(scene?.updatedAt).not.toBe("2026-05-02T00:00:00.000Z");
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

  // ── Guided setup: step 4 (story) ───────────────────────────────────────────

  function createStorySetupDeps(
    storyboardOverrides: Partial<{
      tone: string;
      stylePresetId: string | null;
    }> = {},
  ) {
    return createDependencies({
      projects: [
        createProject({
          id: "project_setup",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Anniversary",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      stylePresets: [
        createStylePreset({
          id: "style_setup",
          scope: "system",
          name: "Cinematic",
          prompt: "Filmic contrast, shallow depth of field.",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      storyboards: [
        createStoryboard({
          id: "storyboard_setup",
          projectId: "project_setup",
          tone: "warm_nostalgia",
          stylePresetId: "style_setup",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
          ...storyboardOverrides,
        }),
      ],
    });
  }

  it("writes the story, common prompt, and negative prompt from the story setup job", async () => {
    const deps = createStorySetupDeps();

    const enqueued = await generateStorySetup(deps, {
      storyboardId: "storyboard_setup",
    });

    expect(enqueued.ok).toBe(true);
    // The enqueue half must not touch the AI port.
    expect(deps.storySetupGeneration.calls).toHaveLength(0);
    if (!enqueued.ok) throw new Error("expected a job to be enqueued");

    const job = await deps.aiJobs.findById(enqueued.value.jobId);
    expect(job?.kind).toBe("story_setup");

    const result = await runStorySetupJob(deps, job!);

    expect(result.ok).toBe(true);
    expect(deps.storySetupGeneration.calls).toHaveLength(1);
    // The chosen tone and style are what the model is given to write against.
    expect(deps.storySetupGeneration.calls[0]?.storyboard.tone).toBe(
      "warm_nostalgia",
    );
    expect(deps.storySetupGeneration.calls[0]?.stylePreset?.name).toBe(
      "Cinematic",
    );

    const storyboard = await deps.storyboards.findById("storyboard_setup");
    expect(storyboard).toMatchObject({
      story: "A warm story about this family, told over one long summer.",
      commonPrompt:
        "Warm grain, soft highlights, muted color, consistent cast.",
      negativePrompt: "text, watermark, extra limbs",
    });
  });

  it("refuses to generate the story setup before tone and style are decided", async () => {
    const noTone = await generateStorySetup(
      createStorySetupDeps({ tone: "" }),
      {
        storyboardId: "storyboard_setup",
      },
    );
    expect(noTone.ok).toBe(false);
    if (!noTone.ok) expect(noTone.error.code).toBe("invalid_state");

    const noStyle = await generateStorySetup(
      createStorySetupDeps({ stylePresetId: null }),
      { storyboardId: "storyboard_setup" },
    );
    expect(noStyle.ok).toBe(false);
    if (!noStyle.ok) expect(noStyle.error.code).toBe("invalid_state");
  });

  it("generates and exposes one optional reference sheet for a featured storyboard", async () => {
    const deps = createStorySetupDeps();
    await deps.storyboards.save({
      ...(await deps.storyboards.findById("storyboard_setup"))!,
      characterPolicy: "featured",
    });

    const enqueued = await generateCharacterReferenceSheet(deps, {
      storyboardId: "storyboard_setup",
    });
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok) throw new Error("expected character sheet job");
    const job = await deps.aiJobs.findById(enqueued.value.jobId);
    expect(job?.kind).toBe("character_sheet_generation");

    const generated = await runCharacterSheetGenerationJob(deps, job!);
    expect(generated.ok).toBe(true);
    if (!generated.ok) throw new Error("expected generated character sheet");
    await deps.aiJobs.save({
      ...job!,
      status: "succeeded",
      resultJson: generated.value,
      completedAt: "2026-08-13T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
    });

    const sheet = await getCharacterReferenceSheet(deps, "storyboard_setup");
    expect(sheet).toMatchObject({
      ok: true,
      value: { status: "succeeded", storageKey: "generated/image.jpg" },
    });
  });

  it("rejects a reference sheet unless the storyboard policy is featured", async () => {
    const result = await generateCharacterReferenceSheet(
      createStorySetupDeps(),
      { storyboardId: "storyboard_setup" },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "invalid_state" },
    });
  });

  // ── Guided setup: step 5 (scenes) ──────────────────────────────────────────

  function createBulkFillDeps() {
    const photo = (id: string) =>
      createPhotoAsset({
        id,
        projectId: "project_bulk",
        name: `${id}.jpg`,
        storageKey: `photos/${id}.jpg`,
        mimeType: "image/jpeg",
        size: 1,
        checksum: `${id}_checksum`,
        sourceKind: "upload",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      });

    return createDependencies({
      projects: [
        createProject({
          id: "project_bulk",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Anniversary",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      stylePresets: [
        createStylePreset({
          id: "style_bulk",
          scope: "system",
          name: "Cinematic",
          prompt: "Filmic contrast.",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      storyboards: [
        createStoryboard({
          id: "storyboard_bulk",
          projectId: "project_bulk",
          tone: "warm_nostalgia",
          stylePresetId: "style_bulk",
          commonPrompt: "Warm grain.",
          story: "A warm family story.",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      photoAssets: [photo("photo_blank"), photo("photo_written")],
      scenes: [
        createTemplateScene({
          id: "scene_blank",
          projectId: "project_bulk",
          storyboardId: "storyboard_bulk",
          orderIndex: 0,
          photoAssetId: "photo_blank",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
        createScene({
          id: "scene_written",
          projectId: "project_bulk",
          storyboardId: "storyboard_bulk",
          orderIndex: 1,
          title: "Departure",
          description: "They drive away at dusk.",
          imagePrompt: "A car pulling away at dusk.",
          emotion: "Nostalgia",
          cameraDirection: "Medium",
          lightingDirection: "Golden hour",
          motionDirection: "Tracking",
          photoAssets: [{ photoAssetId: "photo_written", role: "primary" }],
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
    });
  }

  it("enqueues one bulk fill job per blank scene and skips written ones", async () => {
    const deps = createBulkFillDeps();

    const result = await fillStoryboardScenesWithAi(deps, {
      storyboardId: "storyboard_bulk",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.aiJobIds).toHaveLength(1);
    expect(result.value.skippedSceneCount).toBe(1);
    expect(deps.jobQueue.jobs).toHaveLength(1);
    expect(deps.jobQueue.jobs[0]).toMatchObject({
      kind: "scene_ai_fill",
      payload: { sceneId: "scene_blank" },
    });
    // Enqueueing must not spend an AI call.
    expect(deps.sceneFillGeneration.calls).toHaveLength(0);
  });

  it("stamps setup completion once the last blank scene is filled", async () => {
    const deps = createBulkFillDeps();
    // The photos have to be analyzable for step 1 to count as done.
    expect(
      (await deps.photoAssets.findByProjectId("project_bulk")).every(
        (candidate) => candidate.usage === "candidate",
      ),
    ).toBe(true);

    expect(
      (await deps.storyboards.findById("storyboard_bulk"))?.setupCompletedAt,
    ).toBeNull();

    const enqueued = await fillStoryboardScenesWithAi(deps, {
      storyboardId: "storyboard_bulk",
    });
    if (!enqueued.ok) throw new Error("expected jobs to be enqueued");

    for (const jobId of enqueued.value.aiJobIds) {
      const job = await deps.aiJobs.findById(jobId);
      await runSceneAiFillJob(deps, job!);
    }

    const storyboard = await deps.storyboards.findById("storyboard_bulk");
    expect(storyboard?.setupCompletedAt).not.toBeNull();
    expect(
      deps.progressEvents.events.some(
        (event) => event.kind === "storyboard.setup_completed",
      ),
    ).toBe(true);
  });

  it("leaves setup incomplete while any step is still unsatisfied", async () => {
    const deps = createBulkFillDeps();
    // Blank the story so step 4 is open even after every scene is written.
    const storyboard = await deps.storyboards.findById("storyboard_bulk");
    await deps.storyboards.save({ ...storyboard!, story: "" });

    const enqueued = await fillStoryboardScenesWithAi(deps, {
      storyboardId: "storyboard_bulk",
    });
    if (!enqueued.ok) throw new Error("expected jobs to be enqueued");

    for (const jobId of enqueued.value.aiJobIds) {
      const job = await deps.aiJobs.findById(jobId);
      await runSceneAiFillJob(deps, job!);
    }

    expect(
      (await deps.storyboards.findById("storyboard_bulk"))?.setupCompletedAt,
    ).toBeNull();
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

    const enqueued = await analyzeProjectPhotos(deps, {
      projectId: "project_1",
    });

    expect(enqueued.ok).toBe(true);
    // The enqueue half must not spend anything.
    expect(deps.photoAnalysisGeneration.calls).toHaveLength(0);
    if (!enqueued.ok || enqueued.value.jobId == null) {
      throw new Error("expected a job to be enqueued");
    }
    expect(enqueued.value.cached).toBe(false);
    expect(enqueued.value.analysis).toBeNull();

    const job = await deps.aiJobs.findById(enqueued.value.jobId);
    expect(job?.kind).toBe("photo_analysis");

    const result = await runPhotoAnalysisJob(deps, job!);

    expect(result.ok).toBe(true);
    expect(deps.photoAnalysisGeneration.calls).toHaveLength(1);
    expect(
      deps.photoAnalysisGeneration.calls[0]!.photos.map((photo) => photo.id),
    ).toEqual(["photo_1", "photo_2"]);
    expect(deps.photoAnalysisGeneration.calls[0]!.storyboard?.id).toBe(
      "storyboard_1",
    );
    expect(deps.stores.projectPhotoAnalyses.values()).toHaveLength(1);
    expect(deps.stores.projectPhotoAnalyses.values()[0]!.model).toBe(
      "test-model",
    );
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
    if (!first.ok || first.value.jobId == null) {
      throw new Error("expected a job to be enqueued");
    }
    const firstJob = await deps.aiJobs.findById(first.value.jobId);
    const ran = await runPhotoAnalysisJob(deps, firstJob!);
    expect(ran.ok).toBe(true);
    expect(deps.photoAnalysisGeneration.calls).toHaveLength(1);

    const second = await analyzeProjectPhotos(deps, { projectId: "project_1" });
    expect(second.ok).toBe(true);
    // No second AI call and no second job: the cached analysis is reused.
    expect(deps.photoAnalysisGeneration.calls).toHaveLength(1);
    expect(deps.stores.aiJobs.values()).toHaveLength(1);
    expect(deps.stores.projectPhotoAnalyses.values()).toHaveLength(1);
    if (second.ok) {
      expect(second.value.cached).toBe(true);
      expect(second.value.jobId).toBeNull();
      expect(second.value.analysis?.id).toBe(
        deps.stores.projectPhotoAnalyses.values()[0]!.id,
      );
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
    if (!first.ok || first.value.jobId == null) {
      throw new Error("expected a job to be enqueued");
    }
    await runPhotoAnalysisJob(
      deps,
      (await deps.aiJobs.findById(first.value.jobId))!,
    );
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
    if (!second.ok || second.value.jobId == null) {
      throw new Error("expected a second job to be enqueued");
    }
    expect(second.value.cached).toBe(false);

    await runPhotoAnalysisJob(
      deps,
      (await deps.aiJobs.findById(second.value.jobId))!,
    );
    expect(deps.photoAnalysisGeneration.calls).toHaveLength(2);
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

    const enqueued = await proposeComplementScenes(deps, {
      storyboardId: "storyboard_1",
      fromSceneId: "scene_1",
      toSceneId: "scene_2",
    });

    expect(enqueued.ok).toBe(true);
    expect(deps.complementSceneProposal.calls).toHaveLength(0);
    if (!enqueued.ok) throw new Error("expected a job to be enqueued");

    const job = await deps.aiJobs.findById(enqueued.value.jobId);
    expect(job?.kind).toBe("complement_scene_proposals");

    const result = await runComplementSceneProposalsJob(deps, job!);

    expect(result.ok).toBe(true);
    if (result.ok) {
      const proposals = result.value.proposals as unknown[];
      expect(proposals.length).toBeGreaterThan(0);
      expect(proposals.length).toBeLessThanOrEqual(3);
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
          // A sample is only confirmable once its image exists, and the batch
          // link is now a field rather than something read back out of inputJson.
          status: "succeeded",
          testGenerationBatchId: "batch_1",
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

      // Re-confirming the same sample is allowed now that a confirmation can be
      // moved between batches, and it must be idempotent: the suffixes are
      // already in the common prompt and must not be appended a second time.
      const reconfirm = await confirmTestGeneration(deps, {
        storyboardId: "sb1",
        confirmedGenerationRequestId: "variant_1",
        adjustmentSuffixes: SUFFIXES,
      });
      expect(reconfirm.ok).toBe(true);

      const afterReconfirm = await deps.storyboards.findById("sb1");
      expect(afterReconfirm?.commonPrompt).toBe(
        "Base prompt. warmer color temperature stronger cinematic grade",
      );
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

  describe("test-generation sample history", () => {
    // Two batches, older first, each with one succeeded sample carrying an image.
    async function seedTwoBatches() {
      const deps = createDependencies();
      await deps.projects.save(
        createProject({
          id: "p1",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Trip",
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
        }),
      );
      await deps.storyboards.save(
        createStoryboard({
          id: "sb1",
          projectId: "p1",
          tone: "warm",
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
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
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
        }),
      );

      const batches = [
        { id: "batch_old", at: "2026-07-01T00:00:00.000Z" },
        { id: "batch_new", at: "2026-07-02T00:00:00.000Z" },
      ];
      for (const { id, at } of batches) {
        await deps.testGenerationBatches.save(
          createTestGenerationBatch({
            id,
            storyboardId: "sb1",
            status: "pending",
            createdAt: at,
          }),
        );
        // Saved out of variant order so the ordering assertion is meaningful.
        for (const variantIndex of [1, 0]) {
          const requestId = `${id}_v${variantIndex}`;
          await deps.generationRequests.save(
            createGenerationRequest({
              id: requestId,
              projectId: "p1",
              storyboardId: "sb1",
              sceneId: "s1",
              status: "succeeded",
              inputJson: { testBatchId: id, testVariant: variantIndex },
              testGenerationBatchId: id,
              createdAt: at,
              updatedAt: at,
            }),
          );
          await deps.generatedImages.save(
            createGeneratedImage({
              id: `img_${requestId}`,
              projectId: "p1",
              storyboardId: "sb1",
              sceneId: "s1",
              generationRequestId: requestId,
              storageKey: `data/uploads/generated/${requestId}.jpg`,
              mimeType: "image/jpeg",
              size: 1,
              checksum: requestId,
              createdAt: at,
              updatedAt: at,
            }),
          );
        }
      }

      return deps;
    }

    it("lists every batch newest first with its samples in variant order", async () => {
      const deps = await seedTwoBatches();

      const result = await listTestGenerationBatches(deps, {
        storyboardId: "sb1",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.map((entry) => entry.batch.id)).toEqual([
        "batch_new",
        "batch_old",
      ]);
      expect(
        result.value[0]!.variants.map((variant) => variant.request.id),
      ).toEqual(["batch_new_v0", "batch_new_v1"]);
      expect(result.value[1]!.variants[0]!.generatedImage?.id).toBe(
        "img_batch_old_v0",
      );
    });

    it("keeps each batch's samples to itself", async () => {
      const deps = await seedTwoBatches();

      const oldVariants =
        await deps.generationRequests.findByTestBatchId("batch_old");

      expect(oldVariants.map((variant) => variant.id).sort()).toEqual([
        "batch_old_v0",
        "batch_old_v1",
      ]);
    });

    // The point of the feature: run the real generation from a different sample
    // without losing the batch it came from.
    it("moves the single confirmation when a sample from an older batch is confirmed", async () => {
      const deps = await seedTwoBatches();

      const first = await confirmTestGeneration(deps, {
        storyboardId: "sb1",
        confirmedGenerationRequestId: "batch_new_v0",
      });
      expect(first.ok).toBe(true);

      const second = await confirmTestGeneration(deps, {
        storyboardId: "sb1",
        confirmedGenerationRequestId: "batch_old_v1",
      });
      expect(second.ok).toBe(true);

      const listed = await listTestGenerationBatches(deps, {
        storyboardId: "sb1",
      });
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;

      const completed = listed.value.filter(
        (entry) => entry.batch.status === "completed",
      );
      expect(completed).toHaveLength(1);
      expect(completed[0]!.batch.id).toBe("batch_old");
      expect(completed[0]!.batch.confirmedGenerationRequestId).toBe(
        "batch_old_v1",
      );

      // The batch that lost the confirmation stays in place in the history.
      const newBatch = listed.value.find(
        (entry) => entry.batch.id === "batch_new",
      );
      expect(newBatch?.batch.status).toBe("pending");
      expect(newBatch?.batch.createdAt).toBe("2026-07-02T00:00:00.000Z");
      expect(listed.value.map((entry) => entry.batch.id)).toEqual([
        "batch_new",
        "batch_old",
      ]);
    });

    it("refuses to confirm a sample that has not succeeded", async () => {
      const deps = await seedTwoBatches();
      const queued = await deps.generationRequests.findById("batch_new_v0");
      await deps.generationRequests.save({ ...queued!, status: "queued" });

      const result = await confirmTestGeneration(deps, {
        storyboardId: "sb1",
        confirmedGenerationRequestId: "batch_new_v0",
      });

      expect(result.ok).toBe(false);
    });
  });

  it("treats legacy placeholder scene fields as blank so AI fill still applies", async () => {
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
          // Exactly what the web layer used to persist for a blank scene.
          title: "Untitled",
          description: "-",
          imagePrompt: "-",
          emotion: "Joy",
          cameraDirection: "Wide",
          lightingDirection: "Natural",
          motionDirection: "Slow pan",
        },
      ],
    });

    const enqueued = await fillSceneWithAi(deps, { sceneId: "scene_ai" });
    expect(enqueued.ok).toBe(true);
    if (!enqueued.ok || enqueued.value.jobId == null) {
      throw new Error("placeholder-filled scene should still enqueue a job");
    }

    const job = await deps.aiJobs.findById(enqueued.value.jobId);
    await runSceneAiFillJob(deps, job!);

    const scene = await deps.scenes.findById("scene_ai");
    expect(scene).toMatchObject({
      title: "AI title",
      description: "AI description",
      imagePrompt: "AI image prompt",
    });
  });

  it("passes the stored photo analysis to the scene fill port", async () => {
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
        createTemplateScene({
          id: "scene_ai",
          projectId: "project_ai",
          storyboardId: "storyboard_ai",
          orderIndex: 0,
          photoAssetId: "photo_ai",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      projectPhotoAnalyses: [
        createProjectPhotoAnalysis({
          id: "analysis_1",
          projectId: "project_ai",
          emotionCandidates: [
            {
              value: "warm_nostalgia",
              label: "Warm nostalgia",
              description: "Tender.",
              reason: "Because.",
            },
          ],
          photoInsights: [
            {
              photoAssetId: "photo_ai",
              summary: "A birthday table.",
              people: "Two adults.",
              setting: "Indoors.",
              event: "Birthday.",
              atmosphere: "Warm.",
            },
          ],
          storySummary: "A warm family birthday.",
          model: "test-model",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
    });

    const enqueued = await fillSceneWithAi(deps, { sceneId: "scene_ai" });
    if (!enqueued.ok || enqueued.value.jobId == null) {
      throw new Error("expected a job to be enqueued");
    }
    const job = await deps.aiJobs.findById(enqueued.value.jobId);
    await runSceneAiFillJob(deps, job!);

    expect(deps.sceneFillGeneration.calls).toHaveLength(1);
    expect(deps.sceneFillGeneration.calls[0]!.photoAnalysis).toMatchObject({
      id: "analysis_1",
      storySummary: "A warm family birthday.",
    });
  });

  // The scene fill used to receive every project photo, so each scene's call
  // billed one image per photo in the project. Only what the scene actually
  // references is sent now; the rest of the project arrives as analysis text.
  it("passes only the scene's reference photos to the scene fill port", async () => {
    const photo = (id: string) =>
      createPhotoAsset({
        id,
        projectId: "project_ref",
        name: `${id}.jpg`,
        storageKey: `photos/${id}.jpg`,
        mimeType: "image/jpeg",
        size: 1,
        checksum: `${id}_checksum`,
        sourceKind: "upload",
        createdAt: "2026-05-02T00:00:00.000Z",
        updatedAt: "2026-05-02T00:00:00.000Z",
      });

    const deps = createDependencies({
      projects: [
        createProject({
          id: "project_ref",
          organizationId: "org_1",
          ownerUserId: "user_1",
          name: "Family Story",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      storyboards: [
        createStoryboard({
          id: "storyboard_ref",
          projectId: "project_ref",
          tone: "Warm",
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      // Four photos in the project, but the scene only names two of them.
      photoAssets: [
        photo("photo_primary"),
        photo("photo_reference"),
        photo("photo_other_1"),
        photo("photo_other_2"),
      ],
      scenes: [
        createScene({
          id: "scene_ref",
          projectId: "project_ref",
          storyboardId: "storyboard_ref",
          orderIndex: 0,
          title: "",
          description: "",
          imagePrompt: "",
          emotion: "",
          cameraDirection: "",
          lightingDirection: "",
          motionDirection: "",
          photoAssets: [
            { photoAssetId: "photo_primary", role: "primary" },
            { photoAssetId: "photo_reference", role: "reference" },
          ],
          createdAt: "2026-05-02T00:00:00.000Z",
          updatedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
    });

    const enqueued = await fillSceneWithAi(deps, { sceneId: "scene_ref" });
    if (!enqueued.ok || enqueued.value.jobId == null) {
      throw new Error("expected a job to be enqueued");
    }
    const job = await deps.aiJobs.findById(enqueued.value.jobId);
    await runSceneAiFillJob(deps, job!);

    const call = deps.sceneFillGeneration.calls[0]!;
    expect(call.primaryPhoto.id).toBe("photo_primary");
    expect(call.referencePhotos.map((candidate) => candidate.id)).toEqual([
      "photo_reference",
    ]);
  });

  it("enqueues one AI fill job per created scene only when autoFill is requested", async () => {
    function seed() {
      return createDependencies({
        projects: [
          createProject({
            id: "project_t",
            organizationId: "org_1",
            ownerUserId: "user_1",
            name: "Trip",
            createdAt: "2026-05-02T00:00:00.000Z",
            updatedAt: "2026-05-02T00:00:00.000Z",
          }),
        ],
        storyboards: [
          createStoryboard({
            id: "storyboard_t",
            projectId: "project_t",
            tone: "Warm",
            createdAt: "2026-05-02T00:00:00.000Z",
            updatedAt: "2026-05-02T00:00:00.000Z",
          }),
        ],
        photoAssets: ["photo_a", "photo_b"].map((id) =>
          createPhotoAsset({
            id,
            projectId: "project_t",
            name: `${id}.jpg`,
            usage: "candidate",
            storageKey: `photos/${id}.jpg`,
            mimeType: "image/jpeg",
            size: 1,
            checksum: id,
            sourceKind: "upload",
            createdAt: "2026-05-02T00:00:00.000Z",
            updatedAt: "2026-05-02T00:00:00.000Z",
          }),
        ),
      });
    }

    const withoutFill = seed();
    const plain = await createTemplateScenesFromPhotos(withoutFill, {
      storyboardId: "storyboard_t",
      projectId: "project_t",
      photoAssetIds: ["photo_a", "photo_b"],
    });
    expect(plain.ok).toBe(true);
    if (plain.ok) {
      expect(plain.value.scenes).toHaveLength(2);
      expect(plain.value.aiJobIds).toEqual([]);
    }
    expect(withoutFill.stores.aiJobs.values()).toHaveLength(0);

    const withFill = seed();
    const auto = await createTemplateScenesFromPhotos(withFill, {
      storyboardId: "storyboard_t",
      projectId: "project_t",
      photoAssetIds: ["photo_a", "photo_b"],
      autoFill: true,
    });
    expect(auto.ok).toBe(true);
    if (auto.ok) {
      expect(auto.value.aiJobIds).toHaveLength(2);
    }
    const jobs = withFill.stores.aiJobs.values();
    expect(jobs).toHaveLength(2);
    expect(jobs.every((job) => job.kind === "scene_ai_fill")).toBe(true);
    expect(jobs.map((job) => job.inputJson.sceneId).sort()).toEqual(
      auto.ok ? auto.value.scenes.map((s) => s.id).sort() : [],
    );
    // Enqueue must not call the model.
    expect(withFill.sceneFillGeneration.calls).toHaveLength(0);
  });

  describe("change proposal approval and apply", () => {
    const storyboardUpdatedAt = "2026-08-10T00:00:00.000Z";

    function seedChangeProposalFixture() {
      return createDependencies({
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
            updatedAt: storyboardUpdatedAt,
          }),
        ],
        changeProposals: [
          createChangeProposal({
            id: "proposal_1",
            projectId: "project_1",
            provenance: {
              provider: "codex",
              conversationId: "conversation_1",
              turnId: "turn_1",
            },
            items: [
              {
                id: "item_1",
                target: storyboardSemanticTarget("storyboard_1", "tone"),
                before: "Reflective",
                after: "Warm nostalgia",
                rationale: "Photos lean warmer than the current tone.",
                baseRevision: storyboardUpdatedAt,
              },
            ],
            rationale: "Shift the tone to match the photos' mood.",
            clientRequestId: "client_req_1",
            createdAt: "2026-08-15T00:00:00.000Z",
            updatedAt: "2026-08-15T00:00:00.000Z",
          }),
        ],
      });
    }

    function withPrincipal<T extends ApplicationDependencies>(deps: T): T {
      return {
        ...deps,
        authContext: {
          async getCurrentPrincipal() {
            return {
              user: {
                id: "user_1",
                organizationId: "org_1",
                displayName: "Ran",
                createdAt: "2026-05-02T00:00:00.000Z",
                updatedAt: "2026-05-02T00:00:00.000Z",
              },
              organization: {
                id: "org_1",
                name: "Family Studio",
                createdAt: "2026-05-02T00:00:00.000Z",
                updatedAt: "2026-05-02T00:00:00.000Z",
              },
            };
          },
        },
      };
    }

    it("rejects a decision without an authenticated principal", async () => {
      const deps = seedChangeProposalFixture();

      const result = await decideChangeProposalItem(deps, {
        changeProposalId: "proposal_1",
        itemId: "item_1",
        approval: "approved",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("invalid_state");
      }
    });

    it("approves an item and derives a partially_approved status for a mixed proposal", async () => {
      const deps = seedChangeProposalFixture();
      await deps.stores.changeProposals.save(
        createChangeProposal({
          id: "proposal_2",
          projectId: "project_1",
          provenance: {
            provider: "codex",
            conversationId: "conversation_1",
            turnId: "turn_1",
          },
          items: [
            {
              id: "item_a",
              target: storyboardSemanticTarget("storyboard_1", "tone"),
              before: "Reflective",
              after: "Warm nostalgia",
              rationale: "r",
              baseRevision: storyboardUpdatedAt,
            },
            {
              id: "item_b",
              target: storyboardSemanticTarget("storyboard_1", "stylePresetId"),
              before: null,
              after: "style_1",
              rationale: "r",
              baseRevision: storyboardUpdatedAt,
            },
          ],
          rationale: "r",
          clientRequestId: "client_req_2",
          createdAt: "2026-08-15T00:00:00.000Z",
          updatedAt: "2026-08-15T00:00:00.000Z",
        }),
      );

      const result = await decideChangeProposalItem(withPrincipal(deps), {
        changeProposalId: "proposal_2",
        itemId: "item_a",
        approval: "approved",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("partially_approved");
      }

      const rejected = await decideChangeProposalItem(withPrincipal(deps), {
        changeProposalId: "proposal_2",
        itemId: "item_b",
        approval: "rejected",
      });

      expect(rejected.ok).toBe(true);
      if (rejected.ok) {
        expect(rejected.value.status).toBe("partially_approved");
        expect(rejected.value.approvedBy).toBe("user_1");
      }
    });

    it("selects a choice option and updates the item's after value", async () => {
      const deps = seedChangeProposalFixture();
      await deps.stores.changeProposals.save(
        createChangeProposal({
          id: "proposal_choice",
          projectId: "project_1",
          provenance: {
            provider: "codex",
            conversationId: "conversation_1",
            turnId: "turn_1",
          },
          items: [
            {
              id: "item_1",
              target: storyboardSemanticTarget("storyboard_1", "tone"),
              before: "Reflective",
              after: "Warm nostalgia",
              rationale: "r",
              baseRevision: storyboardUpdatedAt,
            },
          ],
          rationale: "r",
          choices: [
            {
              targetItemId: "item_1",
              options: [
                {
                  id: "opt_warm",
                  label: "Warm",
                  value: "Warm nostalgia",
                  reason: "r",
                  impact: "i",
                },
                {
                  id: "opt_bright",
                  label: "Bright",
                  value: "Bright joy",
                  reason: "r",
                  impact: "i",
                },
              ],
            },
          ],
          clientRequestId: "client_req_choice",
          createdAt: "2026-08-15T00:00:00.000Z",
          updatedAt: "2026-08-15T00:00:00.000Z",
        }),
      );

      const result = await selectChangeProposalChoice(withPrincipal(deps), {
        changeProposalId: "proposal_choice",
        targetItemId: "item_1",
        optionId: "opt_bright",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.choices[0]?.selectedOptionId).toBe("opt_bright");
        expect(result.value.items[0]?.after).toBe("Bright joy");
      }
    });

    it("rebases a revised item onto the storyboard's current revision", async () => {
      const deps = seedChangeProposalFixture();

      const result = await reviseChangeProposalItemUseCase(deps, {
        changeProposalId: "proposal_1",
        itemId: "item_1",
        after: "Bittersweet",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.items[0]).toMatchObject({
          after: "Bittersweet",
          baseRevision: storyboardUpdatedAt,
          approval: "pending",
        });
      }
    });

    it("applies an approved item through upsertStoryboard and marks the proposal applied", async () => {
      const deps = seedChangeProposalFixture();

      const decided = await decideChangeProposalItem(withPrincipal(deps), {
        changeProposalId: "proposal_1",
        itemId: "item_1",
        approval: "approved",
      });
      expect(decided.ok).toBe(true);

      const applied = await applyChangeProposal(withPrincipal(deps), {
        changeProposalId: "proposal_1",
      });

      expect(applied.ok).toBe(true);
      if (applied.ok) {
        expect(applied.value.status).toBe("applied");
        expect(applied.value.applyOutcome?.appliedItemIds).toEqual(["item_1"]);
      }

      const storyboard = await deps.storyboards.findById("storyboard_1");
      expect(storyboard?.tone).toBe("Warm nostalgia");

      // Repeating a successful apply is a no-op that returns the stored result.
      const reapplied = await applyChangeProposal(withPrincipal(deps), {
        changeProposalId: "proposal_1",
      });
      expect(reapplied).toEqual(applied);
    });

    it("marks the proposal conflicted when the target changed after the proposal was created", async () => {
      const deps = seedChangeProposalFixture();

      const decided = await decideChangeProposalItem(withPrincipal(deps), {
        changeProposalId: "proposal_1",
        itemId: "item_1",
        approval: "approved",
      });
      expect(decided.ok).toBe(true);

      const storyboard = await deps.storyboards.findById("storyboard_1");
      await deps.storyboards.save({
        ...storyboard!,
        story: "Edited after the proposal was created.",
        updatedAt: "2026-08-16T00:00:00.000Z",
      });

      const applied = await applyChangeProposal(withPrincipal(deps), {
        changeProposalId: "proposal_1",
      });

      expect(applied.ok).toBe(false);
      if (!applied.ok) {
        expect(applied.error.code).toBe("conflict");
      }

      const proposal = await deps.changeProposals.findById("proposal_1");
      expect(proposal?.status).toBe("conflicted");

      const untouchedStoryboard =
        await deps.storyboards.findById("storyboard_1");
      expect(untouchedStoryboard?.tone).toBe("Reflective");
    });

    it("rejects applying a proposal with no approved items", async () => {
      const deps = seedChangeProposalFixture();

      const result = await applyChangeProposal(withPrincipal(deps), {
        changeProposalId: "proposal_1",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("invalid_state");
      }
    });
  });
  describe("embedded agent chat", () => {
    function seedChatDeps() {
      return createDependencies({
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
            name: "Other Story",
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
            updatedAt: "2026-05-02T00:00:10.000Z",
          }),
          createStoryboard({
            id: "storyboard_2",
            projectId: "project_2",
            tone: "Playful",
            createdAt: "2026-05-02T00:00:00.000Z",
            updatedAt: "2026-05-02T00:00:10.000Z",
          }),
        ],
      });
    }

    async function startConversation(
      deps: ReturnType<typeof createDependencies>,
    ) {
      const created = await createAgentChatConversation(deps, {
        projectId: "project_1",
      });
      if (!created.ok) throw new Error("conversation was not created");
      return created.value;
    }

    it("persists the operator's message and opens exactly one running turn", async () => {
      const deps = seedChatDeps();
      const conversation = await startConversation(deps);

      const posted = await postAgentChatTurn(deps, {
        conversationId: conversation.id,
        clientRequestId: "request_1",
        text: "Should the tone be warmer?",
      });

      expect(posted.ok).toBe(true);
      if (!posted.ok) return;
      expect(posted.value.turn.status).toBe("running");
      expect(posted.value.message.kind).toBe("user_text");
      // Nothing was sent to the provider yet: posting only makes it durable.
      expect(deps.agentTurnRunner.requests).toHaveLength(0);

      const second = await postAgentChatTurn(deps, {
        conversationId: conversation.id,
        clientRequestId: "request_2",
        text: "And the style?",
      });
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.error.code).toBe("conflict");
    });

    it("returns the same turn when a submission is retried with its client request ID", async () => {
      const deps = seedChatDeps();
      const conversation = await startConversation(deps);

      const first = await postAgentChatTurn(deps, {
        conversationId: conversation.id,
        clientRequestId: "request_1",
        text: "Should the tone be warmer?",
      });
      const retried = await postAgentChatTurn(deps, {
        conversationId: conversation.id,
        clientRequestId: "request_1",
        text: "Should the tone be warmer?",
      });

      expect(retried).toEqual(first);
      expect(deps.agentConversations.turns).toHaveLength(1);
      expect(
        deps.agentConversations.messages.filter(
          (message) => message.kind === "user_text",
        ),
      ).toHaveLength(1);
    });

    it("sends only the new turn and its referenced fields, never the stored transcript", async () => {
      const deps = seedChatDeps();
      const conversation = await startConversation(deps);

      const first = await postAgentChatTurn(deps, {
        conversationId: conversation.id,
        clientRequestId: "request_1",
        text: "First question about the story.",
      });
      if (!first.ok) throw new Error("first turn was not posted");
      await runAgentChatTurn(deps, { turnId: first.value.turn.id });

      const second = await postAgentChatTurn(deps, {
        conversationId: conversation.id,
        clientRequestId: "request_2",
        text: "Now warm up the tone.",
        mentions: [
          {
            label: "@tone",
            target: storyboardSemanticTarget("storyboard_1", "tone"),
          },
        ],
      });
      if (!second.ok) throw new Error("second turn was not posted");
      await runAgentChatTurn(deps, { turnId: second.value.turn.id });

      expect(deps.agentTurnRunner.requests).toHaveLength(2);
      const [firstRequest, secondRequest] = deps.agentTurnRunner.requests;
      if (firstRequest == null || secondRequest == null) {
        throw new Error("both turns should have reached the provider");
      }
      expect(firstRequest.nativeSessionId).toBeNull();
      // The second turn resumes the session the first one created, and its
      // payload contains no trace of the first turn or the assistant's reply.
      expect(secondRequest.nativeSessionId).toBe("session-1");
      expect(secondRequest.text).toBe("Now warm up the tone.");
      expect(secondRequest.text).not.toContain("First question");
      expect(secondRequest.references).toEqual([
        {
          label: "@tone",
          targetKey: "storyboard:storyboard_1#tone",
          value: "Reflective",
          revision: "2026-05-02T00:00:10.000Z",
        },
      ]);
    });

    it("records the assistant reply, tool activity, and compaction in the transcript", async () => {
      const deps = seedChatDeps();
      const conversation = await startConversation(deps);
      deps.agentTurnRunner.script = [
        { type: "session-started", nativeSessionId: "session-1" },
        { type: "tool-activity", toolName: "get_creative_direction" },
        { type: "compacted" },
        { type: "assistant-text", text: "Warmer suits these photos." },
        { type: "turn-completed", status: "completed", providerTurnId: "t-1" },
      ];

      const posted = await postAgentChatTurn(deps, {
        conversationId: conversation.id,
        clientRequestId: "request_1",
        text: "Warmer?",
      });
      if (!posted.ok) throw new Error("turn was not posted");
      const finished = await runAgentChatTurn(deps, {
        turnId: posted.value.turn.id,
      });

      expect(finished.ok).toBe(true);
      if (finished.ok) {
        expect(finished.value.status).toBe("completed");
        expect(finished.value.compacted).toBe(true);
        expect(finished.value.providerTurnId).toBe("t-1");
      }

      const kinds = deps.agentConversations.messages.map(
        (message) => message.kind,
      );
      expect(kinds).toEqual([
        "user_text",
        "tool_activity",
        "notice",
        "assistant_text",
      ]);

      expect(deps.agentConversations.bindings[0]).toMatchObject({
        nativeSessionId: "session-1",
        compactCount: 1,
      });
    });

    it("shows a proposal card for a proposal the agent recorded during the turn", async () => {
      const deps = seedChatDeps();
      const conversation = await startConversation(deps);

      deps.agentTurnRunner.script = [
        { type: "session-started", nativeSessionId: "session-1" },
        { type: "turn-completed", status: "completed" },
      ];
      await deps.changeProposals.save(
        createChangeProposal({
          id: "proposal_1",
          projectId: "project_1",
          provenance: {
            provider: "codex",
            conversationId: conversation.id,
            turnId: "turn_1",
          },
          items: [
            {
              id: "item_1",
              target: storyboardSemanticTarget("storyboard_1", "tone"),
              before: "Reflective",
              after: "Warm nostalgia",
              rationale: "Photos lean warmer.",
              baseRevision: "2026-05-02T00:00:10.000Z",
            },
          ],
          rationale: "Shift the tone to match the photos.",
          clientRequestId: "client_req_1",
          createdAt: "2026-08-16T00:00:00.000Z",
          updatedAt: "2026-08-16T00:00:00.000Z",
        }),
      );

      const posted = await postAgentChatTurn(deps, {
        conversationId: conversation.id,
        clientRequestId: "request_1",
        text: "Warmer?",
      });
      if (!posted.ok) throw new Error("turn was not posted");
      await runAgentChatTurn(deps, { turnId: posted.value.turn.id });

      const proposalMessages = deps.agentConversations.messages.filter(
        (message) => message.kind === "proposal",
      );
      expect(proposalMessages).toHaveLength(1);
      expect(proposalMessages[0]?.data).toEqual({
        changeProposalId: "proposal_1",
      });

      // No project value changed: the card is a review unit, not a write.
      const storyboard = await deps.storyboards.findById("storyboard_1");
      expect(storyboard?.tone).toBe("Reflective");
    });

    it("marks the binding recoverable when the provider session cannot be opened", async () => {
      const deps = seedChatDeps();
      const conversation = await startConversation(deps);
      deps.agentTurnRunner.script = [
        {
          type: "turn-completed",
          status: "failed",
          errorMessage: "codex exited before starting.",
        },
      ];

      const posted = await postAgentChatTurn(deps, {
        conversationId: conversation.id,
        clientRequestId: "request_1",
        text: "Warmer?",
      });
      if (!posted.ok) throw new Error("turn was not posted");
      const finished = await runAgentChatTurn(deps, {
        turnId: posted.value.turn.id,
      });

      expect(finished.ok).toBe(true);
      if (finished.ok) expect(finished.value.status).toBe("failed");
      expect(deps.agentConversations.bindings[0]?.status).toBe("recoverable");
      expect(deps.agentConversations.messages.at(-1)).toMatchObject({
        kind: "notice",
        text: "codex exited before starting.",
      });

      // A recoverable binding refuses the next turn instead of quietly
      // starting a session that lost the visible context.
      const next = await postAgentChatTurn(deps, {
        conversationId: conversation.id,
        clientRequestId: "request_2",
        text: "Try again",
      });
      expect(next.ok).toBe(false);
      if (!next.ok) expect(next.error.code).toBe("conflict");
    });

    it("cancels a running turn while keeping what was already said", async () => {
      const deps = seedChatDeps();
      const conversation = await startConversation(deps);

      const posted = await postAgentChatTurn(deps, {
        conversationId: conversation.id,
        clientRequestId: "request_1",
        text: "Warmer?",
      });
      if (!posted.ok) throw new Error("turn was not posted");

      const cancelled = await cancelAgentChatTurn(deps, {
        turnId: posted.value.turn.id,
      });

      expect(cancelled.ok).toBe(true);
      if (cancelled.ok) expect(cancelled.value.status).toBe("cancelled");
      expect(deps.agentTurnRunner.cancelled).toEqual([posted.value.turn.id]);
      expect(
        deps.agentConversations.messages.some(
          (message) => message.kind === "user_text",
        ),
      ).toBe(true);
    });

    it("forks a new provider session without forking the transcript", async () => {
      const deps = seedChatDeps();
      const conversation = await startConversation(deps);

      const posted = await postAgentChatTurn(deps, {
        conversationId: conversation.id,
        clientRequestId: "request_1",
        text: "Warmer?",
      });
      if (!posted.ok) throw new Error("turn was not posted");
      await runAgentChatTurn(deps, { turnId: posted.value.turn.id });

      const forked = await forkAgentChatProviderSession(deps, {
        conversationId: conversation.id,
      });

      expect(forked.ok).toBe(true);
      if (!forked.ok) return;
      expect(deps.agentConversations.bindings).toHaveLength(2);
      expect(deps.agentConversations.bindings[0]?.status).toBe("closed");
      expect(forked.value.nativeSessionId).toBeNull();
      expect(deps.agentTurnRunner.released).toEqual([conversation.id]);

      const detail = await getAgentChatConversation(deps, {
        conversationId: conversation.id,
      });
      expect(detail.ok).toBe(true);
      if (detail.ok) {
        expect(detail.value.binding?.id).toBe(forked.value.id);
        // The transcript is untouched by the fork.
        expect(
          detail.value.messages.some((message) => message.kind === "user_text"),
        ).toBe(true);
      }
    });

    it("counts an explicit compaction on the active binding", async () => {
      const deps = seedChatDeps();
      const conversation = await startConversation(deps);
      const posted = await postAgentChatTurn(deps, {
        conversationId: conversation.id,
        clientRequestId: "request_1",
        text: "Warmer?",
      });
      if (!posted.ok) throw new Error("turn was not posted");
      await runAgentChatTurn(deps, { turnId: posted.value.turn.id });

      const compacted = await compactAgentChatConversation(deps, {
        conversationId: conversation.id,
      });

      expect(compacted.ok).toBe(true);
      if (compacted.ok) expect(compacted.value.compactCount).toBe(1);
    });

    it("refuses a mention that points at another project's field", async () => {
      const deps = seedChatDeps();
      const conversation = await startConversation(deps);

      const posted = await postAgentChatTurn(deps, {
        conversationId: conversation.id,
        clientRequestId: "request_1",
        text: "Warm up @tone",
        mentions: [
          {
            label: "@tone",
            target: storyboardSemanticTarget("storyboard_2", "tone"),
          },
        ],
      });

      expect(posted.ok).toBe(false);
      if (!posted.ok) expect(posted.error.code).toBe("not_found");
      expect(deps.agentConversations.turns).toHaveLength(0);
    });

    it("refuses to chat when no CLI runtime is available", async () => {
      const deps = seedChatDeps();
      const conversation = await startConversation(deps);
      deps.agentTurnRunner.available = {
        available: false,
        reason: "The codex CLI is not logged in.",
      };

      const posted = await postAgentChatTurn(deps, {
        conversationId: conversation.id,
        clientRequestId: "request_1",
        text: "Warmer?",
      });

      expect(posted.ok).toBe(false);
      if (!posted.ok) {
        expect(posted.error.code).toBe("invalid_state");
        expect(posted.error.message).toBe("The codex CLI is not logged in.");
      }
    });

    it("replays only the messages a reconnecting client has not seen", async () => {
      const deps = seedChatDeps();
      const conversation = await startConversation(deps);
      const posted = await postAgentChatTurn(deps, {
        conversationId: conversation.id,
        clientRequestId: "request_1",
        text: "Warmer?",
      });
      if (!posted.ok) throw new Error("turn was not posted");
      await runAgentChatTurn(deps, { turnId: posted.value.turn.id });

      const resumed = await getAgentChatConversation(deps, {
        conversationId: conversation.id,
        afterSequence: 1,
      });

      expect(resumed.ok).toBe(true);
      if (resumed.ok) {
        expect(
          resumed.value.messages.map((message) => message.sequence),
        ).toEqual([2]);
      }
    });
  });
});
