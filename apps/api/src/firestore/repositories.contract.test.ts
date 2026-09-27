import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createAgentConversation,
  createAgentConversationMessage,
  createAgentConversationTurn,
  createAgentProviderBinding,
  createAiJob,
  createGenerationRequest,
  createOrganization,
  createPhotoAsset,
  createProject,
  createScene,
  createStoryboard,
  createTestGenerationBatch,
  createUser,
} from "@gen-story/domain";

import {
  createFirestoreClient,
  createFirestoreRepositories,
} from "./repositories";

const now = "2026-09-27T00:00:00.000Z";
const later = "2026-09-27T00:01:00.000Z";
const projectId = process.env.GCLOUD_PROJECT ?? "demo-gen-story";
const databaseId = "gen-story-staging";
const db = createFirestoreClient({ projectId, databaseId });
const repositories = createFirestoreRepositories(db);

describe.runIf(process.env.FIRESTORE_EMULATOR_HOST != null)(
  "Firestore repository contracts",
  () => {
    beforeAll(async () => {
      await clearCollections();
    });

    afterAll(async () => {
      await db.terminate();
    });

    it("round-trips tenant-owned core entities and logical deletion", async () => {
      const organization = createOrganization({
        id: "org-1",
        name: "Personal Organization",
        createdAt: now,
        updatedAt: now,
      });
      const user = createUser({
        id: "user-1",
        organizationId: organization.id,
        displayName: "Reviewer",
        email: "reviewer@example.com",
        createdAt: now,
        updatedAt: now,
      });
      const project = createProject({
        id: "project-1",
        organizationId: organization.id,
        ownerUserId: user.id,
        name: "Review project",
        createdAt: now,
        updatedAt: now,
      });
      const photo = createPhotoAsset({
        id: "photo-1",
        projectId: project.id,
        name: "photo.jpg",
        storageKey: "media/project-1/photo-1/original.jpg",
        mimeType: "image/jpeg",
        size: 1024,
        checksum: "checksum-1",
        sourceKind: "upload",
        createdAt: now,
        updatedAt: now,
      });
      const storyboard = createStoryboard({
        id: "storyboard-1",
        projectId: project.id,
        tone: "warm",
        createdAt: now,
        updatedAt: now,
      });
      const scene = createScene({
        id: "scene-1",
        projectId: project.id,
        storyboardId: storyboard.id,
        orderIndex: 0,
        title: "Opening",
        description: "A quiet opening.",
        imagePrompt: "Warm family scene",
        emotion: "nostalgic",
        cameraDirection: "medium shot",
        lightingDirection: "soft light",
        motionDirection: "still",
        photoAssets: [{ photoAssetId: photo.id, role: "primary" }],
        createdAt: now,
        updatedAt: now,
      });

      await repositories.organizations.save(organization);
      await repositories.users.save(user);
      await repositories.projects.save(project);
      await repositories.photoAssets.save(photo);
      await repositories.storyboards.save(storyboard);
      await repositories.scenes.save(scene);

      await expect(repositories.users.findById(user.id)).resolves.toEqual(user);
      await expect(
        repositories.projects.findByOrganizationId(organization.id),
      ).resolves.toEqual([project]);
      await expect(
        repositories.photoAssets.findByProjectIdAndChecksum(
          project.id,
          photo.checksum,
        ),
      ).resolves.toEqual(photo);
      await expect(
        repositories.scenes.findByStoryboardId(storyboard.id),
      ).resolves.toEqual([scene]);

      await repositories.projects.softDelete(project.id, later);
      await expect(
        repositories.projects.findById(project.id),
      ).resolves.toBeNull();
      await expect(
        repositories.projects.findByOrganizationId(organization.id, true),
      ).resolves.toHaveLength(1);
      await repositories.projects.restore(project.id, later);
      await expect(
        repositories.projects.findById(project.id),
      ).resolves.toMatchObject({
        id: project.id,
        deletedAt: null,
      });
    });

    it("queries queued work, idempotent batches, and preferences", async () => {
      const request = createGenerationRequest({
        id: "request-1",
        projectId: "project-1",
        storyboardId: "storyboard-1",
        sceneId: "scene-1",
        status: "queued",
        inputJson: { prompt: "hello" },
        testGenerationBatchId: "batch-1",
        createdAt: now,
        updatedAt: now,
      });
      const job = createAiJob({
        id: "job-1",
        projectId: "project-1",
        kind: "photo_analysis",
        inputJson: {},
        createdAt: now,
        updatedAt: now,
      });
      const batch = createTestGenerationBatch({
        id: "batch-1",
        storyboardId: "storyboard-1",
        createdAt: now,
      });
      const preference = {
        userId: "user-1",
        language: "ja" as const,
        agentRuntime: "api" as const,
        updatedAt: now,
      };

      await repositories.generationRequests.save(request);
      await repositories.aiJobs.save(job);
      await repositories.testGenerationBatches.save(batch);
      await repositories.userPreferences.upsert(preference);

      await expect(
        repositories.generationRequests.findQueued(),
      ).resolves.toEqual([request]);
      await expect(
        repositories.generationRequests.findByTestBatchId(batch.id),
      ).resolves.toEqual([request]);
      await expect(repositories.aiJobs.findQueued()).resolves.toEqual([job]);
      await expect(
        repositories.testGenerationBatches.findLatestByStoryboardId(
          batch.storyboardId,
        ),
      ).resolves.toEqual(batch);
      await expect(
        repositories.userPreferences.findByUserId(preference.userId),
      ).resolves.toEqual(preference);
    });

    it("allocates conversation message sequences transactionally", async () => {
      const conversation = createAgentConversation({
        id: "conversation-1",
        projectId: "project-1",
        title: "Refine story",
        createdAt: now,
        updatedAt: now,
      });
      const binding = createAgentProviderBinding({
        id: "binding-1",
        conversationId: conversation.id,
        provider: "codex",
        createdAt: now,
        updatedAt: now,
      });
      const turn = createAgentConversationTurn({
        id: "turn-1",
        conversationId: conversation.id,
        bindingId: binding.id,
        clientRequestId: "client-request-1",
        provider: "codex",
        startedAt: now,
      });

      await repositories.agentConversations.save(conversation);
      await repositories.agentConversations.saveBinding(binding);
      await repositories.agentConversations.saveTurn(turn);
      const sequences = await Promise.all(
        Array.from({ length: 8 }, () =>
          repositories.agentConversations.nextMessageSequence(conversation.id),
        ),
      );
      expect([...sequences].sort((a, b) => a - b)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8,
      ]);

      const message = createAgentConversationMessage({
        id: "message-1",
        conversationId: conversation.id,
        turnId: turn.id,
        sequence: 1,
        role: "user",
        kind: "user_text",
        text: "Make it warmer",
        createdAt: now,
      });
      await repositories.agentConversations.saveMessage(message);
      await repositories.agentConversations.saveMessage(message);

      await expect(
        repositories.agentConversations.listMessages(conversation.id),
      ).resolves.toEqual([message]);
      await expect(
        repositories.agentConversations.findTurnByClientRequestId(
          conversation.id,
          turn.clientRequestId,
        ),
      ).resolves.toEqual(turn);
    });
  },
);

async function clearCollections(): Promise<void> {
  const collections = await db.listCollections();
  await Promise.all(
    collections.map((collection) => db.recursiveDelete(collection)),
  );
}
