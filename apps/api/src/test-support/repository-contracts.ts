import { describe, expect, it } from "vitest";
import type { ApplicationDependencies } from "@gen-story/application";
import {
  createAgentConversation,
  createAgentConversationMessage,
  createAgentConversationTurn,
  createAgentProviderBinding,
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
  createStylePreset,
  createUser,
  createTestGenerationBatch,
  setAgentConversationActiveBinding,
  storyboardSemanticTarget,
  type ScenePhotoAsset,
} from "@gen-story/domain";

export type Repositories = Pick<
  ApplicationDependencies,
  | "users"
  | "organizations"
  | "projects"
  | "photoAssets"
  | "storyboards"
  | "scenes"
  | "stylePresets"
  | "generationRequests"
  | "generatedImages"
  | "aiJobs"
  | "projectPhotoAnalyses"
  | "changeProposals"
  | "agentConversations"
  | "testGenerationBatches"
  | "userPreferences"
>;
export type RepositoryFixture = {
  repositories: Repositories;
  reopen(): Promise<Repositories>;
};
export const now = "2026-05-02T00:00:00.000Z";
export const later = "2026-05-02T00:01:00.000Z";

export function repositoryContracts(
  name: string,
  withDatabase: (
    test: (fixture: RepositoryFixture) => Promise<void>,
  ) => Promise<void>,
) {
  describe(name, () => {
    it("limits deleted photo listings to the seven-day recovery window", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedBase(repositories);
        const photo = buildPhotoAsset("photo_1");
        await repositories.photoAssets.save(photo);
        await repositories.photoAssets.softDelete(photo.id, later);
        await expect(
          repositories.photoAssets.findByProjectId(photo.projectId, true),
        ).resolves.toEqual([]);
        await repositories.photoAssets.softDelete(
          photo.id,
          new Date().toISOString(),
        );
        await expect(
          repositories.photoAssets.findByProjectId(photo.projectId, true),
        ).resolves.toHaveLength(1);
        await expect(
          repositories.photoAssets.findByProjectId(photo.projectId),
        ).resolves.toEqual([]);
        await repositories.photoAssets.restore(photo.id, later);
        await expect(
          repositories.photoAssets.findByProjectId(photo.projectId),
        ).resolves.toEqual([{ ...photo, updatedAt: later }]);
      });
    });
    it("preserves creation timestamps and domain shapes on re-save", async () => {
      await withDatabase(async ({ repositories }) => {
        const { organization, user, project } = await seedBase(repositories);
        await seedGenerationFixture(repositories);
        const photo = buildPhotoAsset("photo_1");
        const style = createStylePreset({
          id: "style_1",
          scope: "user",
          name: "Style",
          description: "Style",
          prompt: "Style",
          createdAt: now,
          updatedAt: now,
        });
        const image = buildGeneratedImage("image_1");
        await repositories.photoAssets.save(photo);
        await repositories.stylePresets.save(style);
        await repositories.generatedImages.save(image);
        await repositories.users.save({
          ...user,
          displayName: "Renamed",
          createdAt: later,
          updatedAt: later,
        });
        await repositories.organizations.save({
          ...organization,
          name: "Renamed",
          createdAt: later,
          updatedAt: later,
        });
        await repositories.projects.save({
          ...project,
          name: "Renamed",
          createdAt: later,
          updatedAt: later,
        });
        await repositories.photoAssets.save({
          ...photo,
          name: "Renamed",
          createdAt: later,
          updatedAt: later,
        });
        await repositories.stylePresets.save({
          ...style,
          prompt: "Updated",
          createdAt: later,
          updatedAt: later,
        });
        await repositories.generatedImages.save({
          ...image,
          createdAt: later,
          updatedAt: later,
        });
        await expect(repositories.users.findById(user.id)).resolves.toEqual({
          ...user,
          displayName: "Renamed",
          updatedAt: later,
        });
        await expect(
          repositories.organizations.findById(organization.id),
        ).resolves.toEqual({
          ...organization,
          name: "Renamed",
          updatedAt: later,
        });
        await expect(
          repositories.projects.findById(project.id),
        ).resolves.toEqual({ ...project, name: "Renamed", updatedAt: later });
        await expect(
          repositories.photoAssets.findById(photo.id),
        ).resolves.toEqual({ ...photo, name: "Renamed", updatedAt: later });
        await expect(
          repositories.stylePresets.findById(style.id),
        ).resolves.toEqual({ ...style, prompt: "Updated", updatedAt: later });
        await expect(
          repositories.generatedImages.findById(image.id),
        ).resolves.toEqual({ ...image, updatedAt: later });
      });
    });

    it("derives active scene IDs after deletion and restores saved scenes", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedGenerationFixture(repositories);
        const scene = buildScene("scene_1", 0);
        await repositories.scenes.softDelete(scene.id, later);
        await expect(
          repositories.scenes.findById(scene.id),
        ).resolves.toBeNull();
        await expect(
          repositories.scenes.findByStoryboardId(scene.storyboardId),
        ).resolves.toEqual([]);
        await expect(
          repositories.storyboards.findByProjectId(scene.projectId),
        ).resolves.toMatchObject([{ sceneIds: [] }]);
        await repositories.scenes.save({ ...scene, updatedAt: later });
        await expect(repositories.scenes.findById(scene.id)).resolves.toEqual({
          ...scene,
          updatedAt: later,
        });
        await expect(
          repositories.storyboards.findByProjectId(scene.projectId),
        ).resolves.toMatchObject([{ sceneIds: [scene.id] }]);
      });
    });

    it("rejects a duplicate conversation turn request ID without replacing the original", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedBase(repositories);
        const conversation = createAgentConversation({
          id: "conversation_1",
          projectId: "project_1",
          title: "Refine",
          createdAt: now,
          updatedAt: now,
        });
        const binding = createAgentProviderBinding({
          id: "binding_1",
          conversationId: conversation.id,
          provider: "codex",
          createdAt: now,
          updatedAt: now,
        });
        const turn = createAgentConversationTurn({
          id: "turn_1",
          conversationId: conversation.id,
          bindingId: binding.id,
          clientRequestId: "request_1",
          provider: "codex",
          startedAt: now,
        });
        await repositories.agentConversations.save(conversation);
        await repositories.agentConversations.saveBinding(binding);
        await repositories.agentConversations.saveTurn(turn);
        await expect(
          repositories.agentConversations.saveTurn({ ...turn, id: "turn_2" }),
        ).rejects.toThrow();
        await expect(
          repositories.agentConversations.findTurnByClientRequestId(
            conversation.id,
            turn.clientRequestId,
          ),
        ).resolves.toEqual(turn);
        await expect(
          repositories.agentConversations.listTurns(conversation.id),
        ).resolves.toEqual([turn]);
      });
    });
    it("persists proposals and preferences after reopening repositories", async () => {
      await withDatabase(async ({ repositories, reopen }) => {
        await seedGenerationFixture(repositories);
        const proposal = buildChangeProposal();
        const preference = {
          userId: "user_1",
          language: "ja" as const,
          agentRuntime: "codex" as const,
          updatedAt: later,
        };
        await repositories.changeProposals.save(proposal);
        await repositories.userPreferences.upsert(preference);
        const restarted = await reopen();
        await expect(
          restarted.changeProposals.findById(proposal.id),
        ).resolves.toEqual(proposal);
        await expect(
          restarted.userPreferences.findByUserId("user_1"),
        ).resolves.toEqual(preference);
        await expect(
          restarted.projects.findById("project_1"),
        ).resolves.toMatchObject({ name: "Anniversary Story" });
      });
    });

    it("round-trips batches and replaces preferences without duplicates", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedGenerationFixture(repositories);
        const first = createTestGenerationBatch({
          id: "batch_1",
          storyboardId: "storyboard_1",
          createdAt: now,
        });
        const second = createTestGenerationBatch({
          id: "batch_2",
          storyboardId: "storyboard_1",
          createdAt: later,
        });
        await repositories.testGenerationBatches.save(second);
        await repositories.testGenerationBatches.save(first);
        await repositories.testGenerationBatches.save(first);
        await expect(
          repositories.testGenerationBatches.listByStoryboardId("storyboard_1"),
        ).resolves.toEqual([second, first]);
        await expect(
          repositories.testGenerationBatches.findLatestByStoryboardId(
            "storyboard_1",
          ),
        ).resolves.toEqual(second);
        await expect(
          repositories.testGenerationBatches.findLatestByStoryboardId("other"),
        ).resolves.toBeNull();
        const preference = {
          userId: "user_1",
          language: "en" as const,
          agentRuntime: "api" as const,
          updatedAt: now,
        };
        await expect(
          repositories.userPreferences.findByUserId("other"),
        ).resolves.toBeNull();
        await repositories.userPreferences.upsert(preference);
        await repositories.userPreferences.upsert({
          ...preference,
          language: "ja",
          updatedAt: later,
        });
        await expect(
          repositories.userPreferences.findByUserId("user_1"),
        ).resolves.toEqual({ ...preference, language: "ja", updatedAt: later });
      });
    });

    it("orders projects, photos, proposals and style presets deterministically", async () => {
      await withDatabase(async ({ repositories }) => {
        const { project } = await seedBase(repositories);
        await repositories.projects.save({
          ...project,
          id: "project_2",
          createdAt: later,
          updatedAt: now,
        });
        await repositories.projects.save({ ...project, updatedAt: later });
        await expect(
          repositories.projects.findByOrganizationId(project.organizationId),
        ).resolves.toMatchObject([{ id: "project_1" }, { id: "project_2" }]);
        await repositories.projects.softDelete(project.id, later);
        await expect(
          repositories.projects.findById(project.id),
        ).resolves.toBeNull();
        await expect(
          repositories.projects.findByOrganizationId(project.organizationId),
        ).resolves.toHaveLength(1);
        await expect(
          repositories.projects.findByOrganizationId(
            project.organizationId,
            true,
          ),
        ).resolves.toHaveLength(1);
        await repositories.projects.softDelete(
          project.id,
          new Date().toISOString(),
        );
        await expect(
          repositories.projects.findByOrganizationId(
            project.organizationId,
            true,
          ),
        ).resolves.toHaveLength(2);
        await repositories.projects.restore(project.id, later);
        await repositories.storyboards.save(buildStoryboard());
        await repositories.photoAssets.save({
          ...buildPhotoAsset("photo_1"),
          position: 2,
        });
        await repositories.photoAssets.save({
          ...buildPhotoAsset("photo_2"),
          position: 1,
          createdAt: later,
        });
        await expect(
          repositories.photoAssets.findByProjectId(project.id),
        ).resolves.toMatchObject([{ id: "photo_2" }, { id: "photo_1" }]);
        const proposal = buildChangeProposal();
        await repositories.changeProposals.save({
          ...proposal,
          id: "proposal_2",
          clientRequestId: "request_2",
          createdAt: later,
          choices: [],
          items: proposal.items.map((i) => ({ ...i, id: `${i.id}_2` })),
        });
        await repositories.changeProposals.save(proposal);
        await expect(
          repositories.changeProposals.findByProjectId(project.id),
        ).resolves.toMatchObject([{ id: "proposal_1" }, { id: "proposal_2" }]);
        for (const [id, name] of [
          ["style_z", "Zebra"],
          ["style_a", "Amber"],
        ] as const) {
          await repositories.stylePresets.save(
            createStylePreset({
              id,
              name,
              scope: "user",
              description: "Style",
              prompt: "Style",
              createdAt: now,
              updatedAt: now,
            }),
          );
        }
        await expect(
          repositories.stylePresets.findAll(),
        ).resolves.toMatchObject([{ id: "style_a" }, { id: "style_z" }]);
      });
    });

    it("rejects competing proposal IDs for one project request ID", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedBase(repositories);
        await repositories.storyboards.save(buildStoryboard());
        const proposal = buildChangeProposal();
        const competing = {
          ...proposal,
          id: "proposal_2",
          choices: [],
          items: proposal.items.map((i) => ({ ...i, id: `${i.id}_2` })),
        };
        const results = await Promise.allSettled([
          repositories.changeProposals.save(proposal),
          repositories.changeProposals.save(competing),
        ]);
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
        await expect(
          repositories.changeProposals.findByProjectId(proposal.projectId),
        ).resolves.toHaveLength(1);
      });
    }, 30_000);

    it("adopts images through save and keeps exactly one scene adoption", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedGenerationFixture(repositories);
        const first = { ...buildGeneratedImage("image_1"), adoptedAt: now };
        const second = {
          ...buildGeneratedImage("image_2"),
          adoptedAt: later,
          updatedAt: later,
        };
        await repositories.generatedImages.save(first);
        await repositories.generatedImages.save(second);
        await expect(
          repositories.scenes.findById("scene_1"),
        ).resolves.toMatchObject({ adoptedGeneratedImageId: second.id });
        await expect(
          repositories.generatedImages.findById(first.id),
        ).resolves.toMatchObject({ adoptedAt: null });
        await expect(
          repositories.generatedImages.findById(second.id),
        ).resolves.toMatchObject({ adoptedAt: later });
        await repositories.generatedImages.save({ ...second, adoptedAt: null });
        await expect(
          repositories.scenes.findById("scene_1"),
        ).resolves.toMatchObject({ adoptedGeneratedImageId: null });
      });
    });

    it("filters generation work and replaces the project's latest analysis", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedGenerationFixture(repositories);
        const request = createGenerationRequest({
          id: "request_2",
          projectId: "project_1",
          storyboardId: "storyboard_1",
          sceneId: "scene_1",
          status: "running",
          inputJson: {},
          testGenerationBatchId: "batch_1",
          createdAt: later,
          updatedAt: later,
        });
        await repositories.testGenerationBatches.save(
          createTestGenerationBatch({
            id: "batch_1",
            storyboardId: "storyboard_1",
            createdAt: now,
          }),
        );
        await repositories.generationRequests.save(request);
        await expect(
          repositories.generationRequests.findRecent(1),
        ).resolves.toMatchObject([{ id: "request_1" }]);
        await expect(
          repositories.generationRequests.findBySceneId("scene_1"),
        ).resolves.toMatchObject([{ id: "request_1" }, { id: "request_2" }]);
        await expect(
          repositories.generationRequests.findByStoryboardId("storyboard_1"),
        ).resolves.toMatchObject([{ id: "request_2" }, { id: "request_1" }]);
        await expect(
          repositories.generationRequests.findByTestBatchId("batch_1"),
        ).resolves.toEqual([request]);
        await expect(
          repositories.generationRequests.findByProjectIdAndStatus(
            "project_1",
            "running",
          ),
        ).resolves.toEqual([request]);
        await expect(
          repositories.generationRequests.findRunningCountByProjectId(
            "project_1",
          ),
        ).resolves.toBe(1);
        await repositories.generationRequests.softDelete(request.id, later);
        await expect(
          repositories.generationRequests.findById(request.id),
        ).resolves.toBeNull();
        await expect(
          repositories.generationRequests.findRunningCountByProjectId(
            "project_1",
          ),
        ).resolves.toBe(0);
        const analysis = createProjectPhotoAnalysis({
          id: "analysis_1",
          projectId: "project_1",
          storySummary: "Story",
          emotionCandidates: [
            {
              value: "warm_nostalgia",
              label: "Warm",
              description: "Warm story",
              reason: "Warm photos",
            },
          ],
          photoInsights: [
            {
              photoAssetId: "photo_1",
              summary: "Moment",
              people: "Family",
              setting: "Home",
              event: "Memory",
              atmosphere: "Warm",
            },
          ],
          model: "test",
          createdAt: now,
          updatedAt: later,
        });
        await repositories.projectPhotoAnalyses.save(analysis);
        const replacement = { ...analysis, id: "analysis_2", updatedAt: now };
        await repositories.projectPhotoAnalyses.save(replacement);
        await expect(
          repositories.projectPhotoAnalyses.findLatestByProjectId("project_1"),
        ).resolves.toEqual(replacement);
      });
    });
    it("round-trips the Phase 2 entities through repositories", async () => {
      await withDatabase(async ({ repositories }) => {
        const base = await seedBase(repositories);
        const photoAsset = buildPhotoAsset("photo_1");
        const stylePreset = createStylePreset({
          id: "style_1",
          scope: "user",
          name: "Soft watercolor",
          description: "Painterly and warm",
          prompt: "Use soft watercolor styling.",
          createdAt: now,
          updatedAt: now,
        });
        const storyboard = createStoryboard({
          id: "storyboard_1",
          projectId: base.project.id,
          status: "ready",
          tone: "warm",
          stylePresetId: stylePreset.id,
          createdAt: now,
          updatedAt: now,
        });
        const scene = buildScene("scene_1", 0, [
          { photoAssetId: photoAsset.id, role: "primary" },
        ]);
        const generationRequest = createGenerationRequest({
          id: "request_1",
          projectId: base.project.id,
          storyboardId: storyboard.id,
          sceneId: scene.id,
          status: "queued",
          inputJson: { prompt: "scene prompt" },
          createdAt: now,
          updatedAt: now,
        });
        const generatedImage = createGeneratedImage({
          id: "image_1",
          projectId: base.project.id,
          storyboardId: storyboard.id,
          sceneId: scene.id,
          generationRequestId: generationRequest.id,
          storageKey:
            "data/uploads/generated/images/projects/project_1/scenes/scene_1/image_1.jpg",
          mimeType: "image/jpeg",
          size: 2048,
          width: 1024,
          height: 768,
          checksum: "generated-checksum-1",
          createdAt: now,
          updatedAt: now,
        });
        const projectPhotoAnalysis = createProjectPhotoAnalysis({
          id: "analysis_1",
          projectId: base.project.id,
          emotionCandidates: [
            {
              value: "warm_nostalgia",
              label: "Warm nostalgia",
              description: "Tender and memory-focused.",
              reason: "The photos feel warm.",
            },
          ],
          photoInsights: [
            {
              photoAssetId: photoAsset.id,
              summary: "A warm moment.",
              people: "Family members.",
              setting: "Indoor setting.",
              event: "Anniversary memory.",
              atmosphere: "Warm.",
            },
          ],
          storySummary: "A warm family story.",
          model: "test-model",
          createdAt: now,
          updatedAt: now,
        });

        await repositories.photoAssets.save(photoAsset);
        await repositories.stylePresets.save(stylePreset);
        await repositories.storyboards.save(storyboard);
        await repositories.scenes.save(scene);
        await repositories.generationRequests.save(generationRequest);
        await repositories.generatedImages.save(generatedImage);
        await repositories.projectPhotoAnalyses.save(projectPhotoAnalysis);

        await expect(
          repositories.organizations.findById(base.organization.id),
        ).resolves.toMatchObject({ id: base.organization.id });
        await expect(
          repositories.users.findById(base.user.id),
        ).resolves.toMatchObject({ id: base.user.id });
        await expect(
          repositories.projects.findById(base.project.id),
        ).resolves.toMatchObject({ id: base.project.id });
        await expect(
          repositories.photoAssets.findById(photoAsset.id),
        ).resolves.toMatchObject({ storageKey: photoAsset.storageKey });
        await expect(
          repositories.stylePresets.findById(stylePreset.id),
        ).resolves.toMatchObject({ prompt: stylePreset.prompt });
        await expect(
          repositories.storyboards.findById(storyboard.id),
        ).resolves.toMatchObject({ id: storyboard.id, sceneIds: [scene.id] });
        await expect(
          repositories.scenes.findById(scene.id),
        ).resolves.toMatchObject({
          id: scene.id,
          photoAssets: scene.photoAssets,
        });
        await expect(
          repositories.generationRequests.findById(generationRequest.id),
        ).resolves.toMatchObject({ inputJson: generationRequest.inputJson });
        await expect(
          repositories.generatedImages.findById(generatedImage.id),
        ).resolves.toMatchObject({ checksum: generatedImage.checksum });
        await expect(
          repositories.projectPhotoAnalyses.findLatestByProjectId(
            base.project.id,
          ),
        ).resolves.toMatchObject({
          id: projectPhotoAnalysis.id,
          emotionCandidates: projectPhotoAnalysis.emotionCandidates,
          photoInsights: projectPhotoAnalysis.photoInsights,
        });
      });
    });

    it("round-trips the storyboard setup completion stamp, including null", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedBase(repositories);
        await repositories.storyboards.save(buildStoryboard());

        // New storyboards start un-stamped: the guided flow is still gating them.
        await expect(
          repositories.storyboards.findById("storyboard_1"),
        ).resolves.toMatchObject({ setupCompletedAt: null });

        const stamped = await repositories.storyboards.findById("storyboard_1");
        await repositories.storyboards.save({
          ...stamped!,
          setupCompletedAt: "2026-07-30T12:00:00.000Z",
        });

        await expect(
          repositories.storyboards.findById("storyboard_1"),
        ).resolves.toMatchObject({
          setupCompletedAt: "2026-07-30T12:00:00.000Z",
        });
      });
    });

    it("stores a blank storyboard tone as undecided", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedBase(repositories);
        await repositories.storyboards.save(
          createStoryboard({
            id: "storyboard_1",
            projectId: "project_1",
            createdAt: now,
            updatedAt: now,
          }),
        );

        await expect(
          repositories.storyboards.findById("storyboard_1"),
        ).resolves.toMatchObject({ tone: "" });
      });
    });

    it("restores scene and scene-photo order from orderIndex", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedBase(repositories);
        await repositories.photoAssets.save(buildPhotoAsset("photo_1"));
        await repositories.photoAssets.save(buildPhotoAsset("photo_2"));
        await repositories.storyboards.save(buildStoryboard());
        await repositories.scenes.save(buildScene("scene_later", 1));
        await repositories.scenes.save(
          buildScene("scene_first", 0, [
            { photoAssetId: "photo_2", role: "reference" },
            { photoAssetId: "photo_1", role: "primary" },
          ]),
        );

        const scenes =
          await repositories.scenes.findByStoryboardId("storyboard_1");

        expect(scenes.map((scene) => scene.id)).toEqual([
          "scene_first",
          "scene_later",
        ]);
        expect(scenes[0]?.photoAssets).toEqual([
          { photoAssetId: "photo_2", role: "reference" },
          { photoAssetId: "photo_1", role: "primary" },
        ]);
      });
    });

    it("round-trips a scene's photoFidelity, defaulting to high", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedBase(repositories);
        await repositories.storyboards.save(buildStoryboard());
        await repositories.scenes.save(buildScene("scene_default", 0));
        await repositories.scenes.save({
          ...buildScene("scene_high", 1),
          photoFidelity: "high",
        });

        const defaultScene =
          await repositories.scenes.findById("scene_default");
        const highScene = await repositories.scenes.findById("scene_high");

        expect(defaultScene?.photoFidelity).toBe("high");
        expect(highScene?.photoFidelity).toBe("high");
      });
    });

    it("round-trips a change proposal with items and a choice card", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedBase(repositories);
        await repositories.storyboards.save(buildStoryboard());
        const proposal = buildChangeProposal();

        await repositories.changeProposals.save(proposal);

        await expect(
          repositories.changeProposals.findById(proposal.id),
        ).resolves.toEqual(proposal);
        await expect(
          repositories.changeProposals.findByClientRequestId(
            "project_1",
            proposal.clientRequestId,
          ),
        ).resolves.toEqual(proposal);
        await expect(
          repositories.changeProposals.findByProjectId("project_1"),
        ).resolves.toEqual([proposal]);
        await expect(
          repositories.changeProposals.findByProjectId("project_1", "pending"),
        ).resolves.toEqual([proposal]);
        await expect(
          repositories.changeProposals.findByProjectId("project_1", "approved"),
        ).resolves.toEqual([]);
      });
    });

    it("replaces a change proposal's items and choices wholesale on re-save", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedBase(repositories);
        await repositories.storyboards.save(buildStoryboard());
        const proposal = buildChangeProposal();
        await repositories.changeProposals.save(proposal);

        const resolved = {
          ...proposal,
          items: proposal.items.map((item) => ({
            ...item,
            approval: "approved" as const,
          })),
          choices: [],
          status: "approved" as const,
          approvedBy: "user_1",
          resolvedAt: later,
          updatedAt: later,
        };
        await repositories.changeProposals.save(resolved);

        await expect(
          repositories.changeProposals.findById(proposal.id),
        ).resolves.toEqual(resolved);
      });
    });

    it("round-trips a conversation, its binding, turns, and transcript", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedBase(repositories);
        const repository = repositories.agentConversations;

        const conversation = createAgentConversation({
          id: "conversation_1",
          projectId: "project_1",
          title: "Creative direction",
          createdAt: now,
          updatedAt: now,
        });
        await repository.save(conversation);

        const binding = createAgentProviderBinding({
          id: "binding_1",
          conversationId: conversation.id,
          provider: "codex",
          model: "gpt-5-codex",
          nativeSessionId: "thread_1",
          compactCount: 2,
          lastCompactedAt: later,
          createdAt: now,
          updatedAt: later,
        });
        await repository.saveBinding(binding);
        await repository.save(
          setAgentConversationActiveBinding(conversation, binding.id, later),
        );

        const turn = createAgentConversationTurn({
          id: "turn_1",
          conversationId: conversation.id,
          bindingId: binding.id,
          clientRequestId: "request_1",
          provider: "codex",
          model: "gpt-5-codex",
          providerTurnId: "provider_turn_1",
          compacted: true,
          startedAt: now,
        });
        await repository.saveTurn(turn);

        const message = createAgentConversationMessage({
          id: "message_1",
          conversationId: conversation.id,
          turnId: turn.id,
          sequence: 1,
          role: "user",
          kind: "user_text",
          text: "Warm up @tone",
          mentions: [
            {
              label: "@tone",
              target: storyboardSemanticTarget("story_1", "tone"),
            },
          ],
          createdAt: now,
        });
        await repository.saveMessage(message);

        await expect(
          repository.findById(conversation.id),
        ).resolves.toMatchObject({ activeBindingId: binding.id });
        await expect(repository.findBindingById(binding.id)).resolves.toEqual(
          binding,
        );
        await expect(repository.listBindings(conversation.id)).resolves.toEqual(
          [binding],
        );
        await expect(repository.findTurnById(turn.id)).resolves.toEqual(turn);
        await expect(
          repository.findTurnByClientRequestId(conversation.id, "request_1"),
        ).resolves.toEqual(turn);
        await expect(repository.listMessages(conversation.id)).resolves.toEqual(
          [message],
        );
        await expect(
          repository.findByProjectId("project_1"),
        ).resolves.toHaveLength(1);
      });
    });

    it("allocates message sequences and replays only what a client has not seen", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedBase(repositories);
        const repository = repositories.agentConversations;

        await repository.save(
          createAgentConversation({
            id: "conversation_1",
            projectId: "project_1",
            title: "Creative direction",
            createdAt: now,
            updatedAt: now,
          }),
        );

        await expect(
          repository.nextMessageSequence("conversation_1"),
        ).resolves.toBe(1);

        for (const sequence of [1, 2, 3]) {
          await repository.saveMessage(
            createAgentConversationMessage({
              id: `message_${sequence}`,
              conversationId: "conversation_1",
              sequence,
              role: "assistant",
              kind: "assistant_text",
              text: `line ${sequence}`,
              createdAt: now,
            }),
          );
        }

        await expect(
          repository.nextMessageSequence("conversation_1"),
        ).resolves.toBe(4);
        const resumed = await repository.listMessages("conversation_1", 1);
        expect(resumed.map((message) => message.sequence)).toEqual([2, 3]);
      });
    });

    it("rejects a second message claiming an existing sequence", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedBase(repositories);
        const repository = repositories.agentConversations;

        await repository.save(
          createAgentConversation({
            id: "conversation_1",
            projectId: "project_1",
            title: "Creative direction",
            createdAt: now,
            updatedAt: now,
          }),
        );
        const message = createAgentConversationMessage({
          id: "message_1",
          conversationId: "conversation_1",
          sequence: 1,
          role: "assistant",
          kind: "assistant_text",
          text: "first",
          createdAt: now,
        });
        await repository.saveMessage(message);

        // Same id: an idempotent re-save of the same message, not an edit.
        await repository.saveMessage({ ...message, text: "rewritten" });
        await expect(
          repository.listMessages("conversation_1"),
        ).resolves.toEqual([message]);

        await expect(
          repository.saveMessage({ ...message, id: "message_2" }),
        ).rejects.toThrow();
      });
    });

    it("rejects duplicate and multi-primary scene photo rows", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedBase(repositories);
        await repositories.photoAssets.save(buildPhotoAsset("photo_1"));
        await repositories.photoAssets.save(buildPhotoAsset("photo_2"));
        await repositories.storyboards.save(buildStoryboard());

        await expect(
          repositories.scenes.save(
            buildScene("scene_duplicate", 0, [
              { photoAssetId: "photo_1", role: "primary" },
              { photoAssetId: "photo_1", role: "reference" },
            ]),
          ),
        ).rejects.toThrow(/unique|constraint/i);

        await expect(
          repositories.scenes.save(
            buildScene("scene_two_primary", 1, [
              { photoAssetId: "photo_1", role: "primary" },
              { photoAssetId: "photo_2", role: "primary" },
            ]),
          ),
        ).rejects.toThrow(/unique|constraint/i);
      });
    });

    it("finds active photo assets by project checksum and ignores soft deletes", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedBase(repositories);
        await repositories.photoAssets.save(buildPhotoAsset("photo_1"));

        await expect(
          repositories.photoAssets.findByProjectIdAndChecksum(
            "project_1",
            "checksum-photo_1",
          ),
        ).resolves.toMatchObject({ id: "photo_1" });

        await repositories.photoAssets.softDelete("photo_1", later);
        await repositories.photoAssets.save({
          ...buildPhotoAsset("photo_2"),
          checksum: "checksum-photo_1",
        });

        await expect(
          repositories.photoAssets.findByProjectIdAndChecksum(
            "project_1",
            "checksum-photo_1",
          ),
        ).resolves.toMatchObject({ id: "photo_2" });
      });
    });

    it("rejects direct edits to existing system style presets", async () => {
      await withDatabase(async ({ repositories }) => {
        const systemPreset = createStylePreset({
          id: "style_system",
          scope: "system",
          name: "System preset",
          description: "Locked preset",
          prompt: "Original prompt",
          createdAt: now,
          updatedAt: now,
        });

        await repositories.stylePresets.save(systemPreset);

        await expect(
          repositories.stylePresets.save({
            ...systemPreset,
            name: "Edited preset",
            updatedAt: later,
          }),
        ).rejects.toThrow("System style presets cannot be edited directly.");

        const userPreset = createStylePreset({
          id: "style_user",
          scope: "user",
          name: "User preset",
          description: "Editable preset",
          prompt: "Original prompt",
          createdAt: now,
          updatedAt: now,
        });

        await repositories.stylePresets.save(userPreset);
        await repositories.stylePresets.save({
          ...userPreset,
          prompt: "Updated prompt",
          updatedAt: later,
        });

        await expect(
          repositories.stylePresets.findById(userPreset.id),
        ).resolves.toMatchObject({ prompt: "Updated prompt" });
      });
    });

    it("keeps failed generation requests separate from storyboard lifecycle", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedGenerationFixture(repositories, "ready");

        await repositories.generationRequests.save(
          createGenerationRequest({
            id: "request_failed",
            projectId: "project_1",
            storyboardId: "storyboard_1",
            sceneId: "scene_1",
            status: "failed",
            inputJson: { prompt: "failed prompt" },
            errorMessage: "Provider rejected the request.",
            createdAt: now,
            updatedAt: later,
          }),
        );

        await expect(
          repositories.generationRequests.findById("request_failed"),
        ).resolves.toMatchObject({ status: "failed" });
        await expect(
          repositories.storyboards.findById("storyboard_1"),
        ).resolves.toMatchObject({ status: "ready" });
      });
    });

    it("round-trips AI jobs and finds them by status and project", async () => {
      await withDatabase(async ({ repositories }) => {
        await seedBase(repositories);

        const queued = createAiJob({
          id: "job_1",
          projectId: "project_1",
          kind: "photo_analysis",
          inputJson: { projectId: "project_1", language: "en" },
          createdAt: now,
          updatedAt: now,
        });
        await repositories.aiJobs.save(queued);

        await expect(
          repositories.aiJobs.findById("job_1"),
        ).resolves.toMatchObject({
          kind: "photo_analysis",
          status: "queued",
          inputJson: { projectId: "project_1", language: "en" },
          resultJson: null,
        });
        await expect(repositories.aiJobs.findQueued()).resolves.toHaveLength(1);
        await expect(
          repositories.aiJobs.findRunningCountByProjectId("project_1"),
        ).resolves.toBe(0);

        await repositories.aiJobs.save({
          ...queued,
          status: "running",
          startedAt: later,
          updatedAt: later,
        });
        await expect(repositories.aiJobs.findQueued()).resolves.toHaveLength(0);
        await expect(repositories.aiJobs.findRunning()).resolves.toHaveLength(
          1,
        );
        await expect(
          repositories.aiJobs.findRunningCountByProjectId("project_1"),
        ).resolves.toBe(1);

        await repositories.aiJobs.save({
          ...queued,
          status: "succeeded",
          resultJson: { photoCount: 3 },
          completedAt: later,
          updatedAt: later,
        });
        await expect(
          repositories.aiJobs.findById("job_1"),
        ).resolves.toMatchObject({
          status: "succeeded",
          resultJson: { photoCount: 3 },
        });
        await expect(
          repositories.aiJobs.findByProjectId("project_1"),
        ).resolves.toHaveLength(1);
      });
    });
  });
}

export async function seedBase(repositories: Repositories) {
  const organization = createOrganization({
    id: "organization_1",
    name: "Gen Story Studio",
    createdAt: now,
    updatedAt: now,
  });
  const user = createUser({
    id: "user_1",
    organizationId: organization.id,
    displayName: "Test User",
    email: "test@example.com",
    createdAt: now,
    updatedAt: now,
  });
  const project = createProject({
    id: "project_1",
    organizationId: organization.id,
    ownerUserId: user.id,
    name: "Anniversary Story",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  await repositories.organizations.save(organization);
  await repositories.users.save(user);
  await repositories.projects.save(project);

  return { organization, user, project };
}

export function buildPhotoAsset(photoAssetId: string) {
  return createPhotoAsset({
    id: photoAssetId,
    projectId: "project_1",
    name: `${photoAssetId}.jpg`,
    usage: "candidate",
    storageKey: `data/uploads/originals/projects/project_1/${photoAssetId}.jpg`,
    mimeType: "image/jpeg",
    size: 1024,
    width: 800,
    height: 600,
    checksum: `checksum-${photoAssetId}`,
    sourceKind: "upload",
    createdAt: now,
    updatedAt: now,
  });
}

export function buildStoryboard(
  status: "draft" | "editing" | "ready" | "completed" = "draft",
) {
  return createStoryboard({
    id: "storyboard_1",
    projectId: "project_1",
    status,
    tone: "warm",
    createdAt: now,
    updatedAt: now,
  });
}

export function buildScene(
  sceneId: string,
  orderIndex: number,
  photoAssets: ScenePhotoAsset[] = [],
) {
  return createScene({
    id: sceneId,
    projectId: "project_1",
    storyboardId: "storyboard_1",
    orderIndex,
    status: "ready",
    title: `Scene ${sceneId}`,
    description: "A quiet story beat.",
    imagePrompt: "Create a warm family scene.",
    emotion: "nostalgic",
    cameraDirection: "medium shot",
    lightingDirection: "soft window light",
    motionDirection: "still",
    photoAssets,
    createdAt: now,
    updatedAt: now,
  });
}

export function buildChangeProposal() {
  return createChangeProposal({
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
        before: "warm",
        after: "melancholic",
        rationale: "The photos lean more reflective than warm.",
        baseRevision: now,
      },
      {
        id: "item_2",
        target: storyboardSemanticTarget("storyboard_1", "stylePresetId"),
        before: null,
        after: "style_1",
        rationale: "A watercolor preset matches the reflective tone.",
        baseRevision: now,
      },
    ],
    rationale: "Shifting tone and style to match the photos' mood.",
    choices: [
      {
        targetItemId: "item_1",
        options: [
          {
            id: "option_warm",
            label: "Keep warm",
            value: "warm",
            reason: "Preserves the original nostalgic framing.",
            impact: "No change to downstream scene prompts.",
          },
          {
            id: "option_melancholic",
            label: "Shift to melancholic",
            value: "melancholic",
            reason: "Matches the reflective mood detected in the photos.",
            impact: "Scene prompts will lean more subdued.",
          },
        ],
      },
    ],
    clientRequestId: "client_request_1",
    createdAt: now,
    updatedAt: now,
  });
}

export async function seedGenerationFixture(
  repositories: Repositories,
  storyboardStatus: "draft" | "editing" | "ready" | "completed" = "draft",
) {
  await seedBase(repositories);
  await repositories.storyboards.save(buildStoryboard(storyboardStatus));
  await repositories.scenes.save(buildScene("scene_1", 0));
  await repositories.generationRequests.save(
    createGenerationRequest({
      id: "request_1",
      projectId: "project_1",
      storyboardId: "storyboard_1",
      sceneId: "scene_1",
      status: "succeeded",
      inputJson: { prompt: "generation prompt" },
      createdAt: now,
      updatedAt: now,
    }),
  );
}

export function buildGeneratedImage(generatedImageId: string) {
  return createGeneratedImage({
    id: generatedImageId,
    projectId: "project_1",
    storyboardId: "storyboard_1",
    sceneId: "scene_1",
    generationRequestId: "request_1",
    storageKey: `data/uploads/generated/images/projects/project_1/scenes/scene_1/${generatedImageId}.jpg`,
    mimeType: "image/jpeg",
    size: 2048,
    width: 1024,
    height: 768,
    checksum: `checksum-${generatedImageId}`,
    createdAt: now,
    updatedAt: now,
  });
}
