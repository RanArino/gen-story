import {
  Firestore,
  type CollectionReference,
  type Query,
} from "@google-cloud/firestore";

import type {
  AgentConversationRepositoryPort,
  AiJobRepositoryPort,
  ChangeProposalRepositoryPort,
  GeneratedImageRepositoryPort,
  GenerationRequestRepositoryPort,
  OrganizationRepositoryPort,
  PhotoAssetRepositoryPort,
  ProjectPhotoAnalysisRepositoryPort,
  ProjectRepositoryPort,
  SceneRepositoryPort,
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
  AiJob,
  ChangeProposal,
  ChangeProposalStatus,
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

type Entity = { id: string };
type SoftDeletable = Entity & { deletedAt: string | null };

export function createFirestoreClient(input: {
  projectId: string;
  databaseId: string;
}): Firestore {
  return new Firestore({
    projectId: input.projectId,
    databaseId: input.databaseId,
    ignoreUndefinedProperties: true,
  });
}

class CollectionStore<T extends Entity> {
  constructor(private readonly collection: CollectionReference) {}

  async findById(id: string): Promise<T | null> {
    const snapshot = await this.collection.doc(id).get();
    return snapshot.exists ? (snapshot.data() as T) : null;
  }

  async save(value: T): Promise<void> {
    await this.collection.doc(value.id).set(value);
  }

  async where(field: string, value: unknown): Promise<T[]> {
    return readQuery<T>(this.collection.where(field, "==", value));
  }

  async all(): Promise<T[]> {
    return readQuery<T>(this.collection);
  }

  async patch(id: string, value: Record<string, unknown>): Promise<void> {
    await this.collection.doc(id).update(value);
  }
}

class FirestoreUserRepository implements UserRepositoryPort {
  private readonly store: CollectionStore<User>;
  constructor(db: Firestore) {
    this.store = store(db, "users");
  }
  findById(id: string) {
    return this.store.findById(id);
  }
  save(value: User) {
    return this.store.save(value);
  }
}

class FirestoreOrganizationRepository implements OrganizationRepositoryPort {
  private readonly store: CollectionStore<Organization>;
  constructor(db: Firestore) {
    this.store = store(db, "organizations");
  }
  findById(id: string) {
    return this.store.findById(id);
  }
  save(value: Organization) {
    return this.store.save(value);
  }
}

class FirestoreProjectRepository implements ProjectRepositoryPort {
  private readonly store: CollectionStore<Project>;
  constructor(db: Firestore) {
    this.store = store(db, "projects");
  }
  async findById(id: string) {
    return active(await this.store.findById(id));
  }
  async findByOrganizationId(organizationId: string, includeDeleted = false) {
    return sortDesc(
      filterDeleted(
        await this.store.where("organizationId", organizationId),
        includeDeleted,
      ),
      "updatedAt",
    );
  }
  save(value: Project) {
    return this.store.save(value);
  }
  softDelete(id: string, deletedAt: string) {
    return this.store.patch(id, { deletedAt, updatedAt: deletedAt });
  }
  restore(id: string, restoredAt: string) {
    return this.store.patch(id, { deletedAt: null, updatedAt: restoredAt });
  }
}

class FirestorePhotoAssetRepository implements PhotoAssetRepositoryPort {
  private readonly store: CollectionStore<PhotoAsset>;
  constructor(db: Firestore) {
    this.store = store(db, "photo_assets");
  }
  async findById(id: string) {
    return active(await this.store.findById(id));
  }
  async findByProjectId(projectId: string, includeDeleted = false) {
    return sortAsc(
      filterDeleted(
        await this.store.where("projectId", projectId),
        includeDeleted,
      ),
      "createdAt",
    );
  }
  async findByProjectIdAndChecksum(projectId: string, checksum: string) {
    return (
      (await this.findByProjectId(projectId)).find(
        (item) => item.checksum === checksum,
      ) ?? null
    );
  }
  save(value: PhotoAsset) {
    return this.store.save(value);
  }
  softDelete(id: string, deletedAt: string) {
    return this.store.patch(id, { deletedAt, updatedAt: deletedAt });
  }
  restore(id: string, restoredAt: string) {
    return this.store.patch(id, { deletedAt: null, updatedAt: restoredAt });
  }
}

class FirestoreStoryboardRepository implements StoryboardRepositoryPort {
  private readonly store: CollectionStore<Storyboard>;
  constructor(db: Firestore) {
    this.store = store(db, "storyboards");
  }
  async findById(id: string) {
    return active(await this.store.findById(id));
  }
  async findByProjectId(projectId: string) {
    return sortAsc(
      filterDeleted(await this.store.where("projectId", projectId)),
      "createdAt",
    );
  }
  save(value: Storyboard) {
    return this.store.save(value);
  }
}

class FirestoreSceneRepository implements SceneRepositoryPort {
  private readonly store: CollectionStore<Scene>;
  constructor(db: Firestore) {
    this.store = store(db, "scenes");
  }
  async findById(id: string) {
    return active(await this.store.findById(id));
  }
  async findByStoryboardId(storyboardId: string) {
    return sortNumber(
      filterDeleted(await this.store.where("storyboardId", storyboardId)),
      "orderIndex",
    );
  }
  save(value: Scene) {
    return this.store.save(value);
  }
  softDelete(id: string, deletedAt: string) {
    return this.store.patch(id, { deletedAt, updatedAt: deletedAt });
  }
}

class FirestoreStylePresetRepository implements StylePresetRepositoryPort {
  private readonly store: CollectionStore<StylePreset>;
  constructor(db: Firestore) {
    this.store = store(db, "style_presets");
  }
  async findById(id: string) {
    return active(await this.store.findById(id));
  }
  async findAll() {
    return sortAsc(filterDeleted(await this.store.all()), "createdAt");
  }
  save(value: StylePreset) {
    return this.store.save(value);
  }
}

class FirestoreGenerationRequestRepository implements GenerationRequestRepositoryPort {
  private readonly store: CollectionStore<GenerationRequest>;
  constructor(db: Firestore) {
    this.store = store(db, "generation_requests");
  }
  async findById(id: string) {
    return stripDeletedAt(active(await this.store.findById(id)));
  }
  async findBySceneId(sceneId: string) {
    return stripDeletedAtList(
      sortAsc(
        filterDeleted(await this.store.where("sceneId", sceneId)),
        "createdAt",
      ),
    );
  }
  async findRunningCountByProjectId(projectId: string) {
    return filterDeleted(await this.store.where("projectId", projectId)).filter(
      (item) => item.status === "running",
    ).length;
  }
  async findByProjectIdAndStatus(
    projectId: string,
    status: GenerationRequestStatus,
  ) {
    return stripDeletedAtList(
      sortAsc(
        filterDeleted(await this.store.where("projectId", projectId)).filter(
          (item) => item.status === status,
        ),
        "createdAt",
      ),
    );
  }
  async findQueued() {
    return stripDeletedAtList(
      sortAsc(
        filterDeleted(await this.store.where("status", "queued")),
        "createdAt",
      ),
    );
  }
  async findRecent(limit: number) {
    return stripDeletedAtList(
      sortAsc(filterDeleted(await this.store.all()), "createdAt").slice(
        0,
        limit,
      ),
    );
  }
  async findByStoryboardId(storyboardId: string) {
    return stripDeletedAtList(
      sortAsc(
        filterDeleted(await this.store.where("storyboardId", storyboardId)),
        "createdAt",
      ),
    );
  }
  async findByTestBatchId(testBatchId: string) {
    return stripDeletedAtList(
      sortAsc(
        filterDeleted(
          await this.store.where("testGenerationBatchId", testBatchId),
        ),
        "createdAt",
      ),
    );
  }
  save(value: GenerationRequest) {
    return this.store.save({ ...value, deletedAt: null } as GenerationRequest);
  }
  softDelete(id: string, deletedAt: string) {
    return this.store.patch(id, { deletedAt, updatedAt: deletedAt });
  }
}

class FirestoreAiJobRepository implements AiJobRepositoryPort {
  private readonly store: CollectionStore<AiJob>;
  constructor(db: Firestore) {
    this.store = store(db, "ai_jobs");
  }
  findById(id: string) {
    return this.store.findById(id);
  }
  async findQueued() {
    return sortAsc(await this.store.where("status", "queued"), "createdAt");
  }
  async findRunning() {
    return sortAsc(await this.store.where("status", "running"), "createdAt");
  }
  async findRunningCountByProjectId(projectId: string) {
    return (await this.store.where("projectId", projectId)).filter(
      (item) => item.status === "running",
    ).length;
  }
  async findByProjectId(projectId: string) {
    return sortDesc(
      await this.store.where("projectId", projectId),
      "createdAt",
    );
  }
  save(value: AiJob) {
    return this.store.save(value);
  }
}

class FirestoreGeneratedImageRepository implements GeneratedImageRepositoryPort {
  private readonly store: CollectionStore<GeneratedImage>;
  constructor(db: Firestore) {
    this.store = store(db, "generated_images");
  }
  async findById(id: string) {
    return active(await this.store.findById(id));
  }
  async findBySceneId(sceneId: string) {
    return sortAsc(
      filterDeleted(await this.store.where("sceneId", sceneId)),
      "createdAt",
    );
  }
  save(value: GeneratedImage) {
    return this.store.save(value);
  }
}

class FirestoreProjectPhotoAnalysisRepository implements ProjectPhotoAnalysisRepositoryPort {
  private readonly store: CollectionStore<ProjectPhotoAnalysis>;
  constructor(db: Firestore) {
    this.store = store(db, "project_photo_analyses");
  }
  async findLatestByProjectId(projectId: string) {
    return (
      sortDesc(
        await this.store.where("projectId", projectId),
        "createdAt",
      )[0] ?? null
    );
  }
  save(value: ProjectPhotoAnalysis) {
    return this.store.save(value);
  }
}

class FirestoreChangeProposalRepository implements ChangeProposalRepositoryPort {
  private readonly store: CollectionStore<ChangeProposal>;
  constructor(db: Firestore) {
    this.store = store(db, "change_proposals");
  }
  findById(id: string) {
    return this.store.findById(id);
  }
  async findByClientRequestId(projectId: string, clientRequestId: string) {
    return (
      (await this.store.where("projectId", projectId)).find(
        (item) => item.clientRequestId === clientRequestId,
      ) ?? null
    );
  }
  async findByProjectId(projectId: string, status?: ChangeProposalStatus) {
    const values = await this.store.where("projectId", projectId);
    return sortDesc(
      status == null ? values : values.filter((item) => item.status === status),
      "createdAt",
    );
  }
  save(value: ChangeProposal) {
    return this.store.save(value);
  }
}

class FirestoreTestGenerationBatchRepository implements TestGenerationBatchRepositoryPort {
  private readonly store: CollectionStore<TestGenerationBatch>;
  constructor(db: Firestore) {
    this.store = store(db, "test_generation_batches");
  }
  async findLatestByStoryboardId(storyboardId: string) {
    return (await this.listByStoryboardId(storyboardId))[0] ?? null;
  }
  async listByStoryboardId(storyboardId: string) {
    return sortDesc(
      await this.store.where("storyboardId", storyboardId),
      "createdAt",
    );
  }
  save(value: TestGenerationBatch) {
    return this.store.save(value);
  }
}

class FirestoreUserPreferenceRepository implements UserPreferenceRepositoryPort {
  constructor(private readonly db: Firestore) {}
  async findByUserId(userId: string): Promise<UserPreference | null> {
    const snapshot = await this.db
      .collection("user_preferences")
      .doc(userId)
      .get();
    return snapshot.exists ? (snapshot.data() as UserPreference) : null;
  }
  async upsert(value: UserPreference): Promise<void> {
    await this.db.collection("user_preferences").doc(value.userId).set(value);
  }
}

class FirestoreAgentConversationRepository implements AgentConversationRepositoryPort {
  private readonly conversations: CollectionStore<AgentConversation>;
  private readonly bindings: CollectionStore<AgentProviderBinding>;
  private readonly turns: CollectionStore<AgentConversationTurn>;
  private readonly messages: CollectionStore<AgentConversationMessage>;
  constructor(private readonly db: Firestore) {
    this.conversations = store(db, "agent_conversations");
    this.bindings = store(db, "agent_provider_bindings");
    this.turns = store(db, "agent_conversation_turns");
    this.messages = store(db, "agent_conversation_messages");
  }
  findById(id: string) {
    return this.conversations.findById(id);
  }
  async findByProjectId(projectId: string) {
    return sortDesc(
      await this.conversations.where("projectId", projectId),
      "updatedAt",
    );
  }
  save(value: AgentConversation) {
    return this.conversations.save(value);
  }
  findBindingById(id: string) {
    return this.bindings.findById(id);
  }
  async listBindings(conversationId: string) {
    return sortAsc(
      await this.bindings.where("conversationId", conversationId),
      "createdAt",
    );
  }
  saveBinding(value: AgentProviderBinding) {
    return this.bindings.save(value);
  }
  findTurnById(id: string) {
    return this.turns.findById(id);
  }
  async findTurnByClientRequestId(
    conversationId: string,
    clientRequestId: string,
  ) {
    return (
      (await this.turns.where("conversationId", conversationId)).find(
        (item) => item.clientRequestId === clientRequestId,
      ) ?? null
    );
  }
  async listTurns(conversationId: string) {
    return sortAsc(
      await this.turns.where("conversationId", conversationId),
      "startedAt",
    );
  }
  saveTurn(value: AgentConversationTurn) {
    return this.turns.save(value);
  }
  async listMessages(conversationId: string, afterSequence = 0) {
    return sortNumber(
      (await this.messages.where("conversationId", conversationId)).filter(
        (item) => item.sequence > afterSequence,
      ),
      "sequence",
    );
  }
  async saveMessage(value: AgentConversationMessage) {
    const reference = this.db
      .collection("agent_conversation_messages")
      .doc(value.id);
    await this.db.runTransaction(async (transaction) => {
      if (!(await transaction.get(reference)).exists)
        transaction.create(reference, value);
    });
  }
  async nextMessageSequence(conversationId: string): Promise<number> {
    const reference = this.db
      .collection("agent_conversation_counters")
      .doc(conversationId);
    return this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const next =
        ((snapshot.data()?.lastSequence as number | undefined) ?? 0) + 1;
      transaction.set(reference, { lastSequence: next });
      return next;
    });
  }
}

export function createFirestoreRepositories(db: Firestore) {
  return {
    users: new FirestoreUserRepository(db),
    organizations: new FirestoreOrganizationRepository(db),
    projects: new FirestoreProjectRepository(db),
    photoAssets: new FirestorePhotoAssetRepository(db),
    storyboards: new FirestoreStoryboardRepository(db),
    scenes: new FirestoreSceneRepository(db),
    stylePresets: new FirestoreStylePresetRepository(db),
    generationRequests: new FirestoreGenerationRequestRepository(db),
    generatedImages: new FirestoreGeneratedImageRepository(db),
    aiJobs: new FirestoreAiJobRepository(db),
    projectPhotoAnalyses: new FirestoreProjectPhotoAnalysisRepository(db),
    changeProposals: new FirestoreChangeProposalRepository(db),
    agentConversations: new FirestoreAgentConversationRepository(db),
    testGenerationBatches: new FirestoreTestGenerationBatchRepository(db),
    userPreferences: new FirestoreUserPreferenceRepository(db),
  };
}

function store<T extends Entity>(
  db: Firestore,
  name: string,
): CollectionStore<T> {
  return new CollectionStore<T>(db.collection(name));
}

async function readQuery<T>(query: Query): Promise<T[]> {
  const snapshot = await query.get();
  return snapshot.docs.map((document) => document.data() as T);
}

function active<T extends Entity>(value: T | null): T | null {
  return value != null && (value as Partial<SoftDeletable>).deletedAt == null
    ? value
    : null;
}

function filterDeleted<T extends Entity>(
  values: T[],
  includeDeleted = false,
): T[] {
  return includeDeleted
    ? values
    : values.filter(
        (value) => (value as Partial<SoftDeletable>).deletedAt == null,
      );
}

function sortAsc<T>(values: T[], field: keyof T): T[] {
  return [...values].sort((left, right) =>
    String(left[field]).localeCompare(String(right[field])),
  );
}

function sortDesc<T>(values: T[], field: keyof T): T[] {
  return sortAsc(values, field).reverse();
}

function sortNumber<T>(values: T[], field: keyof T): T[] {
  return [...values].sort(
    (left, right) => Number(left[field]) - Number(right[field]),
  );
}

function stripDeletedAt<T extends Entity>(value: T | null): T | null {
  if (value == null) return null;
  const domainValue = { ...value } as T & { deletedAt?: string | null };
  delete domainValue.deletedAt;
  return domainValue;
}

function stripDeletedAtList<T extends Entity>(values: T[]): T[] {
  return values.map((value) => stripDeletedAt(value)!);
}
