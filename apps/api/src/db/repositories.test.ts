import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq, isNotNull } from "drizzle-orm";
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
  createStylePreset,
  createUser,
  storyboardSemanticTarget,
  type ScenePhotoAsset,
} from "@gen-story/domain";

import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  type GenStoryDatabase,
  type GenStorySqliteClient,
} from "./index";
import { generatedImages } from "./schema";

const now = "2026-05-02T00:00:00.000Z";
const later = "2026-05-02T00:01:00.000Z";

type TestDatabase = {
  client: GenStorySqliteClient;
  db: GenStoryDatabase;
  repositories: ReturnType<typeof createSqliteRepositories>;
};

describe("SQLite persistence", () => {
  it("applies migrations to a blank SQLite database", async () => {
    await withDatabase(async ({ client }) => {
      const table = client.sqlite
        .prepare(
          "select name from sqlite_master where type = 'table' and name = ?",
        )
        .get("projects");

      expect(table).toEqual({ name: "projects" });
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

  it("round-trips a scene's photoFidelity through SQLite, defaulting to off", async () => {
    await withDatabase(async ({ repositories }) => {
      await seedBase(repositories);
      await repositories.storyboards.save(buildStoryboard());
      await repositories.scenes.save(buildScene("scene_default", 0));
      await repositories.scenes.save({
        ...buildScene("scene_high", 1),
        photoFidelity: "high",
      });

      const defaultScene = await repositories.scenes.findById("scene_default");
      const highScene = await repositories.scenes.findById("scene_high");

      expect(defaultScene?.photoFidelity).toBe("off");
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

  it("keeps a pending change proposal durable across an API restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "gen-story-sqlite-"));
    const databasePath = join(directory, "test.sqlite");

    try {
      const proposal = buildChangeProposal();

      const firstClient = openDatabase(databasePath);
      migrateDatabase(firstClient.db);
      await seedBase(createSqliteRepositories(firstClient.db));
      await createSqliteRepositories(firstClient.db).storyboards.save(
        buildStoryboard(),
      );
      await createSqliteRepositories(firstClient.db).changeProposals.save(
        proposal,
      );
      firstClient.close();

      const restartedClient = openDatabase(databasePath);
      const restartedRepositories = createSqliteRepositories(
        restartedClient.db,
      );
      await expect(
        restartedRepositories.changeProposals.findById(proposal.id),
      ).resolves.toEqual(proposal);
      restartedClient.close();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
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

  it("classifies photo assets from active scene links", async () => {
    await withDatabase(async ({ repositories }) => {
      await seedBase(repositories);
      await repositories.photoAssets.save(buildPhotoAsset("photo_used"));
      await repositories.photoAssets.save(buildPhotoAsset("photo_reference"));
      await repositories.photoAssets.save(buildPhotoAsset("photo_unused"));
      await repositories.storyboards.save(buildStoryboard());
      await repositories.scenes.save(
        buildScene("scene_1", 0, [
          { photoAssetId: "photo_used", role: "primary" },
          { photoAssetId: "photo_reference", role: "reference" },
        ]),
      );

      await expect(
        repositories.photoAssets.classifyPhotoAssetsForProject("project_1"),
      ).resolves.toEqual({
        used: ["photo_used"],
        referenceOnly: ["photo_reference"],
        unused: ["photo_unused"],
      });
    });
  });

  it("hides and restores soft-deleted rows", async () => {
    await withDatabase(async ({ repositories }) => {
      await seedBase(repositories);
      await repositories.photoAssets.save(buildPhotoAsset("photo_1"));
      await repositories.storyboards.save(buildStoryboard());
      await repositories.scenes.save(buildScene("scene_1", 0));

      await repositories.photoAssets.softDelete("photo_1", later);
      await expect(
        repositories.photoAssets.findById("photo_1"),
      ).resolves.toBeNull();

      await repositories.photoAssets.restore("photo_1", later);
      await expect(
        repositories.photoAssets.findById("photo_1"),
      ).resolves.toMatchObject({ id: "photo_1" });

      await repositories.storyboards.softDelete("storyboard_1", later);
      await expect(
        repositories.scenes.findByStoryboardId("storyboard_1"),
      ).resolves.toEqual([]);
      await expect(repositories.scenes.findById("scene_1")).resolves.toBeNull();

      await repositories.storyboards.restore("storyboard_1", later);
      await expect(
        repositories.scenes.findById("scene_1"),
      ).resolves.toMatchObject({ id: "scene_1" });
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

  it("switches generated image adoption atomically through the adapter helper", async () => {
    await withDatabase(async ({ db, repositories }) => {
      await seedGenerationFixture(repositories);

      await repositories.generatedImages.save(buildGeneratedImage("image_1"));
      await repositories.generatedImages.save(buildGeneratedImage("image_2"));
      await repositories.generatedImages.adoptGeneratedImage(
        "scene_1",
        "image_1",
        now,
      );
      await repositories.generatedImages.adoptGeneratedImage(
        "scene_1",
        "image_2",
        later,
      );

      await expect(
        repositories.scenes.findById("scene_1"),
      ).resolves.toMatchObject({ adoptedGeneratedImageId: "image_2" });
      await expect(
        repositories.generatedImages.findById("image_1"),
      ).resolves.toMatchObject({ adoptedAt: null });
      await expect(
        repositories.generatedImages.findById("image_2"),
      ).resolves.toMatchObject({ adoptedAt: later });

      const adoptedRows = await db
        .select({ id: generatedImages.id })
        .from(generatedImages)
        .where(
          and(
            eq(generatedImages.sceneId, "scene_1"),
            isNotNull(generatedImages.adoptedAt),
          ),
        );

      expect(adoptedRows).toEqual([{ id: "image_2" }]);
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
      await expect(repositories.aiJobs.findRunning()).resolves.toHaveLength(1);
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

async function withDatabase(
  test: (database: TestDatabase) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "gen-story-sqlite-"));
  const databasePath = join(directory, "test.sqlite");
  const client = openDatabase(databasePath);

  try {
    migrateDatabase(client.db);
    await test({
      client,
      db: client.db,
      repositories: createSqliteRepositories(client.db),
    });
  } finally {
    client.close();
    rmSync(directory, { force: true, recursive: true });
  }
}

async function seedBase(
  repositories: ReturnType<typeof createSqliteRepositories>,
) {
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

function buildPhotoAsset(photoAssetId: string) {
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

function buildStoryboard(
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

function buildScene(
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

function buildChangeProposal() {
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

async function seedGenerationFixture(
  repositories: ReturnType<typeof createSqliteRepositories>,
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

function buildGeneratedImage(generatedImageId: string) {
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
