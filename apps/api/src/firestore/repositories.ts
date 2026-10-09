import { createHash } from "node:crypto";
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

export type FirestoreRepositories = {
  users: UserRepositoryPort;
  organizations: OrganizationRepositoryPort;
  projects: ProjectRepositoryPort;
  photoAssets: PhotoAssetRepositoryPort;
  storyboards: StoryboardRepositoryPort;
  scenes: SceneRepositoryPort;
  stylePresets: StylePresetRepositoryPort;
  generationRequests: GenerationRequestRepositoryPort;
  generatedImages: GeneratedImageRepositoryPort;
  aiJobs: AiJobRepositoryPort;
  projectPhotoAnalyses: ProjectPhotoAnalysisRepositoryPort;
  changeProposals: ChangeProposalRepositoryPort;
  agentConversations: AgentConversationRepositoryPort;
  testGenerationBatches: TestGenerationBatchRepositoryPort;
  userPreferences: UserPreferenceRepositoryPort;
};

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
    const reference = this.collection.doc(value.id);
    await this.collection.firestore.runTransaction(async (transaction) => {
      const previous = await transaction.get(reference);
      transaction.set(reference, {
        ...value,
        ...(previous.exists && "createdAt" in value
          ? { createdAt: previous.data()?.createdAt }
          : {}),
      });
    });
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
    const values = await this.store.where("organizationId", organizationId);
    return sortAsc(filterDeleted(values, includeDeleted), "createdAt");
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
    return filterDeleted(
      await this.store.where("projectId", projectId),
      includeDeleted,
    ).sort(
      (left, right) =>
        left.position - right.position ||
        compare(left.createdAt, right.createdAt) ||
        compare(left.id, right.id),
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
  constructor(private readonly db: Firestore) {
    this.store = store(db, "storyboards");
  }
  async findById(id: string) {
    const value = active(await this.store.findById(id));
    return value == null ? null : this.withSceneIds(value);
  }
  async findByProjectId(projectId: string) {
    return Promise.all(
      sortAsc(
        filterDeleted(await this.store.where("projectId", projectId)),
        "createdAt",
      ).map((value) => this.withSceneIds(value)),
    );
  }
  private async withSceneIds(value: Storyboard): Promise<Storyboard> {
    const scenes = await readQuery<Scene>(
      this.db.collection("scenes").where("storyboardId", "==", value.id),
    );
    return {
      ...value,
      sceneIds: sortNumber(filterDeleted(scenes), "orderIndex").map(
        (scene) => scene.id,
      ),
    };
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
  async save(value: Scene) {
    if (
      new Set(value.photoAssets.map((photo) => photo.photoAssetId)).size !==
        value.photoAssets.length ||
      value.photoAssets.filter((photo) => photo.role === "primary").length > 1
    ) {
      throw new Error("Scene photo unique constraint violated.");
    }
    return this.store.save(value);
  }
  softDelete(id: string, deletedAt: string) {
    return this.store.patch(id, { deletedAt, updatedAt: deletedAt });
  }
}

class FirestoreStylePresetRepository implements StylePresetRepositoryPort {
  private readonly store: CollectionStore<StylePreset>;
  constructor(private readonly db: Firestore) {
    this.store = store(db, "style_presets");
  }
  async findById(id: string) {
    return stripDeletedAt(active(await this.store.findById(id)));
  }
  async findAll() {
    return stripDeletedAtList(filterDeleted(await this.store.all())).sort(
      (left, right) =>
        compare(left.scope, right.scope) ||
        compare(left.name, right.name) ||
        compare(left.id, right.id),
    );
  }
  async save(value: StylePreset) {
    const reference = this.db.collection("style_presets").doc(value.id);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const existing = snapshot.data() as StylePreset | undefined;
      if (
        existing?.scope === "system" &&
        (value.scope !== existing.scope ||
          value.name !== existing.name ||
          value.description !== existing.description ||
          value.prompt !== existing.prompt)
      ) {
        throw new Error("System style presets cannot be edited directly.");
      }
      transaction.set(reference, {
        ...value,
        createdAt: existing?.createdAt ?? value.createdAt,
        deletedAt: null,
      });
    });
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
      sortAsc(await this.store.all(), "createdAt").slice(0, limit),
    );
  }
  async findByStoryboardId(storyboardId: string) {
    return stripDeletedAtList(
      sortDesc(
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
  constructor(private readonly db: Firestore) {
    this.store = store(db, "generated_images");
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
  async save(value: GeneratedImage) {
    const reference = this.db.collection("generated_images").doc(value.id);
    const sceneReference = this.db.collection("scenes").doc(value.sceneId);
    await this.db.runTransaction(async (transaction) => {
      const sceneSnapshot = await transaction.get(sceneReference);
      const scene = sceneSnapshot.data() as (Scene & SoftDeletable) | undefined;
      if (scene == null || scene.deletedAt != null)
        throw new Error("Scene not found.");
      const existing = await transaction.get(reference);
      const images =
        value.adoptedAt == null
          ? null
          : await transaction.get(
              this.db
                .collection("generated_images")
                .where("sceneId", "==", value.sceneId),
            );
      if (images != null) {
        for (const image of images.docs) {
          if (image.id !== value.id && image.data().deletedAt == null)
            transaction.update(image.ref, {
              adoptedAt: null,
              updatedAt: value.adoptedAt,
            });
        }
      }
      transaction.set(reference, {
        ...value,
        createdAt: existing.data()?.createdAt ?? value.createdAt,
        deletedAt: null,
      });
      if (
        value.adoptedAt != null ||
        scene.adoptedGeneratedImageId === value.id
      ) {
        transaction.update(sceneReference, {
          adoptedGeneratedImageId: value.adoptedAt == null ? null : value.id,
          updatedAt: value.adoptedAt ?? value.updatedAt,
        });
      }
    });
  }
}

class FirestoreProjectPhotoAnalysisRepository implements ProjectPhotoAnalysisRepositoryPort {
  private readonly store: CollectionStore<ProjectPhotoAnalysis>;
  constructor(private readonly db: Firestore) {
    this.store = store(db, "project_photo_analyses");
  }
  async findLatestByProjectId(projectId: string) {
    return (
      sortDesc(
        filterDeleted(await this.store.where("projectId", projectId)),
        "updatedAt",
      )[0] ?? null
    );
  }
  async save(value: ProjectPhotoAnalysis) {
    const reference = this.db
      .collection("project_photo_analyses")
      .doc(value.projectId);
    await this.db.runTransaction(async (transaction) => {
      const previous = await transaction.get(reference);
      transaction.set(reference, {
        ...value,
        createdAt: previous.data()?.createdAt ?? value.createdAt,
      });
    });
  }
}

class FirestoreChangeProposalRepository implements ChangeProposalRepositoryPort {
  private readonly store: CollectionStore<ChangeProposal>;
  constructor(private readonly db: Firestore) {
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
    return sortAsc(
      status == null ? values : values.filter((item) => item.status === status),
      "createdAt",
    );
  }
  async save(value: ChangeProposal) {
    const reference = this.db.collection("change_proposals").doc(value.id);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const existing = snapshot.data() as ChangeProposal | undefined;
      const record =
        existing == null
          ? value
          : {
              ...value,
              projectId: existing.projectId,
              provenance: existing.provenance,
              clientRequestId: existing.clientRequestId,
              createdAt: existing.createdAt,
            };
      const key = this.db
        .collection("change_proposal_request_keys")
        .doc(compoundKey(record.projectId, record.clientRequestId));
      const reservation = await transaction.get(key);
      if (reservation.exists && reservation.data()?.proposalId !== value.id)
        throw new Error("Proposal request ID unique constraint violated.");
      transaction.set(key, { proposalId: value.id });
      transaction.set(reference, record);
    });
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
    return (await this.conversations.where("projectId", projectId)).sort(
      (left, right) =>
        compare(right.createdAt, left.createdAt) || compare(left.id, right.id),
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
  async saveTurn(value: AgentConversationTurn) {
    const reference = this.db
      .collection("agent_conversation_turns")
      .doc(value.id);
    await this.db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const existing = snapshot.data() as AgentConversationTurn | undefined;
      const record =
        existing == null
          ? value
          : {
              ...existing,
              status: value.status,
              model: value.model,
              providerTurnId: value.providerTurnId,
              compacted: value.compacted,
              errorMessage: value.errorMessage,
              completedAt: value.completedAt,
            };
      const key = this.db
        .collection("agent_turn_request_keys")
        .doc(compoundKey(record.conversationId, record.clientRequestId));
      const reservation = await transaction.get(key);
      if (reservation.exists && reservation.data()?.turnId !== value.id)
        throw new Error("Turn request ID unique constraint violated.");
      transaction.set(key, { turnId: value.id });
      transaction.set(reference, record);
    });
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
      if ((await transaction.get(reference)).exists) return;
      const sequenceKey = this.db
        .collection("agent_message_sequence_keys")
        .doc(compoundKey(value.conversationId, String(value.sequence)));
      const collision = await transaction.get(sequenceKey);
      if (collision.exists)
        throw new Error("Message sequence unique constraint violated.");
      const counter = this.db
        .collection("agent_conversation_counters")
        .doc(value.conversationId);
      const snapshot = await transaction.get(counter);
      transaction.create(reference, value);
      transaction.set(sequenceKey, { messageId: value.id });
      transaction.set(counter, {
        lastSequence: Math.max(
          (snapshot.data()?.lastSequence as number | undefined) ?? 0,
          value.sequence,
        ),
      });
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

export function createFirestoreRepositories(
  db: Firestore,
): FirestoreRepositories {
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
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  return values.filter((value) => {
    const deletedAt = (value as Partial<SoftDeletable>).deletedAt;
    return deletedAt == null || (includeDeleted && deletedAt >= cutoff);
  });
}

function sortAsc<T extends Entity>(values: T[], field: keyof T): T[] {
  return [...values].sort(
    (left, right) =>
      compare(left[field], right[field]) || compare(left.id, right.id),
  );
}

function sortDesc<T extends Entity>(values: T[], field: keyof T): T[] {
  return sortAsc(values, field).reverse();
}

function sortNumber<T extends Entity>(values: T[], field: keyof T): T[] {
  return [...values].sort(
    (left, right) =>
      Number(left[field]) - Number(right[field]) || compare(left.id, right.id),
  );
}

function compare(left: unknown, right: unknown): number {
  return String(left) < String(right)
    ? -1
    : String(left) > String(right)
      ? 1
      : 0;
}

function compoundKey(...parts: string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
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
