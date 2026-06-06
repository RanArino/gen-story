import {
  and,
  asc,
  desc,
  eq,
  gte,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import {
  createGeneratedImage,
  createGenerationRequest,
  createOrganization,
  createPhotoAsset,
  createProject,
  createProjectPhotoAnalysis,
  createScene,
  createStoryboard,
  createStylePreset,
  createTestGenerationBatch,
  createUser,
  isTestAdjustmentId,
  sortScenesByOrderIndex,
  type GeneratedImage,
  type GenerationRequest,
  type GenerationRequestStatus,
  type Organization,
  type PhotoAsset,
  type PhotoUsage,
  type Project,
  type ProjectPhotoAnalysis,
  type ProjectStatus,
  type Scene,
  type SceneKind,
  type ScenePhotoAsset,
  type ScenePhotoRole,
  type SceneStatus,
  type Storyboard,
  type StoryboardStatus,
  type StylePreset,
  type StylePresetScope,
  type TestAdjustmentId,
  type TestGenerationBatch,
  type TestGenerationBatchStatus,
  type User,
} from "@gen-story/domain";
import type {
  GeneratedImageRepositoryPort,
  GenerationRequestRepositoryPort,
  Language,
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
import { isLanguage } from "@gen-story/application";

import type { GenStoryDatabase } from "./client";
import {
  generatedImages,
  generationRequests,
  organizations,
  photoAssets,
  projectPhotoAnalyses,
  projects,
  scenePhotoAssets,
  scenes,
  storyboards,
  stylePresets,
  testGenerationBatches,
  userPreferences,
  users,
} from "./schema";

type OrganizationRow = typeof organizations.$inferSelect;
type UserRow = typeof users.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;
type PhotoAssetRow = typeof photoAssets.$inferSelect;
type ProjectPhotoAnalysisRow = typeof projectPhotoAnalyses.$inferSelect;
type StoryboardRow = typeof storyboards.$inferSelect;
type SceneRow = typeof scenes.$inferSelect;
type StylePresetRow = typeof stylePresets.$inferSelect;
type GenerationRequestRow = typeof generationRequests.$inferSelect;
type GeneratedImageRow = typeof generatedImages.$inferSelect;

export type PhotoAssetClassification = {
  used: string[];
  referenceOnly: string[];
  unused: string[];
};

function parseInputJson(value: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(value);

  if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }

  return {};
}

function parseJsonArray<T>(value: string): T[] {
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? (parsed as T[]) : [];
}

function mapOrganization(row: OrganizationRow): Organization {
  return createOrganization({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapUser(row: UserRow): User {
  return createUser({
    id: row.id,
    organizationId: row.organizationId,
    displayName: row.displayName,
    email: row.email,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapProject(row: ProjectRow): Project {
  return createProject({
    id: row.id,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    name: row.name,
    status: row.status as ProjectStatus,
    deletedAt: row.deletedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapPhotoAsset(row: PhotoAssetRow): PhotoAsset {
  return createPhotoAsset({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    usage: row.usage as PhotoUsage,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    size: row.size,
    width: row.width,
    height: row.height,
    checksum: row.checksum,
    sourceKind: row.sourceKind,
    notes: row.notes,
    position: row.position,
    deletedAt: row.deletedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapProjectPhotoAnalysis(
  row: ProjectPhotoAnalysisRow,
): ProjectPhotoAnalysis {
  return createProjectPhotoAnalysis({
    id: row.id,
    projectId: row.projectId,
    emotionCandidates: parseJsonArray(row.emotionCandidatesJson),
    photoInsights: parseJsonArray(row.photoInsightsJson),
    storySummary: row.storySummary,
    model: row.model,
    deletedAt: row.deletedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapStoryboard(row: StoryboardRow, sceneIds: string[]): Storyboard {
  return createStoryboard({
    id: row.id,
    projectId: row.projectId,
    status: row.status as StoryboardStatus,
    tone: row.tone,
    stylePresetId: row.stylePresetId,
    commonPrompt: row.commonPrompt,
    negativePrompt: row.negativePrompt,
    sceneIds,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapScene(row: SceneRow, photos: ScenePhotoAsset[]): Scene {
  return createScene({
    id: row.id,
    projectId: row.projectId,
    storyboardId: row.storyboardId,
    orderIndex: row.orderIndex,
    status: row.status as SceneStatus,
    kind: row.kind as SceneKind,
    bridge:
      row.bridgeFromSceneId != null && row.bridgeToSceneId != null
        ? {
            fromSceneId: row.bridgeFromSceneId,
            toSceneId: row.bridgeToSceneId,
          }
        : null,
    title: row.title,
    description: row.description,
    imagePrompt: row.imagePrompt,
    emotion: row.emotion,
    cameraDirection: row.cameraDirection,
    lightingDirection: row.lightingDirection,
    motionDirection: row.motionDirection,
    notes: row.notes,
    negativePrompt: row.negativePrompt,
    photoAssets: photos,
    adoptedGeneratedImageId: row.adoptedGeneratedImageId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapStylePreset(row: StylePresetRow): StylePreset {
  return createStylePreset({
    id: row.id,
    scope: row.scope as StylePresetScope,
    name: row.name,
    description: row.description,
    prompt: row.prompt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapGenerationRequest(row: GenerationRequestRow): GenerationRequest {
  return createGenerationRequest({
    id: row.id,
    projectId: row.projectId,
    storyboardId: row.storyboardId,
    sceneId: row.sceneId,
    status: row.status as GenerationRequestStatus,
    inputJson: parseInputJson(row.inputJson),
    errorMessage: row.errorMessage,
    sourceGenerationRequestId: row.sourceGenerationRequestId,
    appliedAdjustments: parseAppliedAdjustments(row.appliedAdjustmentsJson),
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function parseAppliedAdjustments(value: string | null): TestAdjustmentId[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTestAdjustmentId);
  } catch {
    return [];
  }
}

function mapGeneratedImage(row: GeneratedImageRow): GeneratedImage {
  return createGeneratedImage({
    id: row.id,
    projectId: row.projectId,
    storyboardId: row.storyboardId,
    sceneId: row.sceneId,
    generationRequestId: row.generationRequestId,
    storageKey: row.storageKey,
    mimeType: row.mimeType,
    size: row.size,
    width: row.width,
    height: row.height,
    checksum: row.checksum,
    adoptedAt: row.adoptedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

async function sceneIdsForStoryboard(
  db: GenStoryDatabase,
  storyboardId: string,
): Promise<string[]> {
  const rows = await db
    .select({ id: scenes.id })
    .from(scenes)
    .where(and(eq(scenes.storyboardId, storyboardId), isNull(scenes.deletedAt)))
    .orderBy(scenes.orderIndex, scenes.id);

  return rows.map((row) => row.id);
}

async function scenePhotoAssetsForScene(
  db: GenStoryDatabase,
  sceneId: string,
): Promise<ScenePhotoAsset[]> {
  const rows = await db
    .select({
      photoAssetId: scenePhotoAssets.photoAssetId,
      role: scenePhotoAssets.role,
    })
    .from(scenePhotoAssets)
    .where(eq(scenePhotoAssets.sceneId, sceneId))
    .orderBy(scenePhotoAssets.orderIndex, scenePhotoAssets.photoAssetId);

  return rows.map((row) => ({
    photoAssetId: row.photoAssetId,
    role: row.role as ScenePhotoRole,
  }));
}

export class SqliteOrganizationRepository implements OrganizationRepositoryPort {
  constructor(private readonly db: GenStoryDatabase) {}

  async findById(organizationId: string): Promise<Organization | null> {
    const row = await this.db
      .select()
      .from(organizations)
      .where(
        and(
          eq(organizations.id, organizationId),
          isNull(organizations.deletedAt),
        ),
      )
      .get();

    return row == null ? null : mapOrganization(row);
  }

  async save(organization: Organization): Promise<void> {
    await this.db
      .insert(organizations)
      .values({
        id: organization.id,
        name: organization.name,
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt,
      })
      .onConflictDoUpdate({
        target: organizations.id,
        set: {
          name: organization.name,
          updatedAt: organization.updatedAt,
          deletedAt: null,
        },
      });
  }

  async softDelete(organizationId: string, deletedAt: string): Promise<void> {
    await this.db
      .update(organizations)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(eq(organizations.id, organizationId));
  }

  async restore(organizationId: string, restoredAt: string): Promise<void> {
    await this.db
      .update(organizations)
      .set({ deletedAt: null, updatedAt: restoredAt })
      .where(eq(organizations.id, organizationId));
  }
}

export class SqliteUserRepository implements UserRepositoryPort {
  constructor(private readonly db: GenStoryDatabase) {}

  async findById(userId: string): Promise<User | null> {
    const row = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .get();

    return row == null ? null : mapUser(row);
  }

  async save(user: User): Promise<void> {
    await this.db
      .insert(users)
      .values({
        id: user.id,
        organizationId: user.organizationId,
        displayName: user.displayName,
        email: user.email,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      })
      .onConflictDoUpdate({
        target: users.id,
        set: {
          organizationId: user.organizationId,
          displayName: user.displayName,
          email: user.email,
          updatedAt: user.updatedAt,
          deletedAt: null,
        },
      });
  }

  async softDelete(userId: string, deletedAt: string): Promise<void> {
    await this.db
      .update(users)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(eq(users.id, userId));
  }

  async restore(userId: string, restoredAt: string): Promise<void> {
    await this.db
      .update(users)
      .set({ deletedAt: null, updatedAt: restoredAt })
      .where(eq(users.id, userId));
  }
}

export class SqliteProjectRepository implements ProjectRepositoryPort {
  constructor(private readonly db: GenStoryDatabase) {}

  async findById(projectId: string): Promise<Project | null> {
    const row = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
      .get();

    return row == null ? null : mapProject(row);
  }

  async findByOrganizationId(
    organizationId: string,
    includeDeleted = false,
  ): Promise<Project[]> {
    const sevenDaysAgo = new Date(
      Date.now() - 7 * 24 * 3600 * 1000,
    ).toISOString();
    const rows = await this.db
      .select()
      .from(projects)
      .where(
        includeDeleted
          ? and(
              eq(projects.organizationId, organizationId),
              or(
                isNull(projects.deletedAt),
                and(
                  isNotNull(projects.deletedAt),
                  gte(projects.deletedAt, sevenDaysAgo),
                ),
              ),
            )
          : and(
              eq(projects.organizationId, organizationId),
              isNull(projects.deletedAt),
            ),
      )
      .orderBy(asc(projects.createdAt), asc(projects.id));

    return rows.map(mapProject);
  }

  async save(project: Project): Promise<void> {
    await this.db
      .insert(projects)
      .values({
        id: project.id,
        organizationId: project.organizationId,
        ownerUserId: project.ownerUserId,
        name: project.name,
        status: project.status,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      })
      .onConflictDoUpdate({
        target: projects.id,
        set: {
          organizationId: project.organizationId,
          ownerUserId: project.ownerUserId,
          name: project.name,
          status: project.status,
          updatedAt: project.updatedAt,
          deletedAt: null,
        },
      });
  }

  async softDelete(projectId: string, deletedAt: string): Promise<void> {
    await this.db
      .update(projects)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(eq(projects.id, projectId));
  }

  async restore(projectId: string, restoredAt: string): Promise<void> {
    await this.db
      .update(projects)
      .set({ deletedAt: null, updatedAt: restoredAt })
      .where(eq(projects.id, projectId));
  }
}

export class SqlitePhotoAssetRepository implements PhotoAssetRepositoryPort {
  constructor(private readonly db: GenStoryDatabase) {}

  async findById(photoAssetId: string): Promise<PhotoAsset | null> {
    const row = await this.db
      .select()
      .from(photoAssets)
      .where(
        and(eq(photoAssets.id, photoAssetId), isNull(photoAssets.deletedAt)),
      )
      .get();

    return row == null ? null : mapPhotoAsset(row);
  }

  async findByProjectId(
    projectId: string,
    includeDeleted = false,
  ): Promise<PhotoAsset[]> {
    const sevenDaysAgo = new Date(
      Date.now() - 7 * 24 * 3600 * 1000,
    ).toISOString();
    const rows = await this.db
      .select()
      .from(photoAssets)
      .where(
        includeDeleted
          ? and(
              eq(photoAssets.projectId, projectId),
              or(
                isNull(photoAssets.deletedAt),
                and(
                  isNotNull(photoAssets.deletedAt),
                  gte(photoAssets.deletedAt, sevenDaysAgo),
                ),
              ),
            )
          : and(
              eq(photoAssets.projectId, projectId),
              isNull(photoAssets.deletedAt),
            ),
      )
      .orderBy(photoAssets.position, photoAssets.createdAt, photoAssets.id);

    return rows.map(mapPhotoAsset);
  }

  async findByProjectIdAndChecksum(
    projectId: string,
    checksum: string,
  ): Promise<PhotoAsset | null> {
    const row = await this.db
      .select()
      .from(photoAssets)
      .where(
        and(
          eq(photoAssets.projectId, projectId),
          eq(photoAssets.checksum, checksum),
          isNull(photoAssets.deletedAt),
        ),
      )
      .get();

    return row == null ? null : mapPhotoAsset(row);
  }

  async save(photoAsset: PhotoAsset): Promise<void> {
    await this.db
      .insert(photoAssets)
      .values({
        id: photoAsset.id,
        projectId: photoAsset.projectId,
        name: photoAsset.name,
        usage: photoAsset.usage,
        storageKey: photoAsset.storageKey,
        mimeType: photoAsset.mimeType,
        size: photoAsset.size,
        width: photoAsset.width,
        height: photoAsset.height,
        checksum: photoAsset.checksum,
        sourceKind: photoAsset.sourceKind,
        notes: photoAsset.notes,
        position: photoAsset.position,
        createdAt: photoAsset.createdAt,
        updatedAt: photoAsset.updatedAt,
      })
      .onConflictDoUpdate({
        target: photoAssets.id,
        set: {
          projectId: photoAsset.projectId,
          name: photoAsset.name,
          usage: photoAsset.usage,
          storageKey: photoAsset.storageKey,
          mimeType: photoAsset.mimeType,
          size: photoAsset.size,
          width: photoAsset.width,
          height: photoAsset.height,
          checksum: photoAsset.checksum,
          sourceKind: photoAsset.sourceKind,
          notes: photoAsset.notes,
          position: photoAsset.position,
          updatedAt: photoAsset.updatedAt,
          deletedAt: null,
        },
      });
  }

  async softDelete(photoAssetId: string, deletedAt: string): Promise<void> {
    await this.db
      .update(photoAssets)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(eq(photoAssets.id, photoAssetId));
  }

  async restore(photoAssetId: string, restoredAt: string): Promise<void> {
    await this.db
      .update(photoAssets)
      .set({ deletedAt: null, updatedAt: restoredAt })
      .where(eq(photoAssets.id, photoAssetId));
  }

  async classifyPhotoAssetsForProject(
    projectId: string,
  ): Promise<PhotoAssetClassification> {
    const projectPhotos = await this.findByProjectId(projectId);
    const photoIds = new Set(projectPhotos.map((photoAsset) => photoAsset.id));
    const rolesByPhotoId = new Map<string, Set<ScenePhotoRole>>();
    const assignmentRows = await this.db
      .select({
        photoAssetId: scenePhotoAssets.photoAssetId,
        role: scenePhotoAssets.role,
      })
      .from(scenePhotoAssets)
      .innerJoin(scenes, eq(scenePhotoAssets.sceneId, scenes.id))
      .innerJoin(storyboards, eq(scenes.storyboardId, storyboards.id))
      .where(
        and(
          eq(scenes.projectId, projectId),
          isNull(scenes.deletedAt),
          isNull(storyboards.deletedAt),
        ),
      );

    for (const assignmentRow of assignmentRows) {
      if (!photoIds.has(assignmentRow.photoAssetId)) {
        continue;
      }

      const roles = rolesByPhotoId.get(assignmentRow.photoAssetId) ?? new Set();

      roles.add(assignmentRow.role as ScenePhotoRole);
      rolesByPhotoId.set(assignmentRow.photoAssetId, roles);
    }

    const classification: PhotoAssetClassification = {
      used: [],
      referenceOnly: [],
      unused: [],
    };

    for (const photoAsset of projectPhotos) {
      const roles = rolesByPhotoId.get(photoAsset.id);

      if (roles == null) {
        classification.unused.push(photoAsset.id);
      } else if (roles.has("primary")) {
        classification.used.push(photoAsset.id);
      } else {
        classification.referenceOnly.push(photoAsset.id);
      }
    }

    return classification;
  }
}

export class SqliteStoryboardRepository implements StoryboardRepositoryPort {
  constructor(private readonly db: GenStoryDatabase) {}

  async findById(storyboardId: string): Promise<Storyboard | null> {
    const row = await this.db
      .select()
      .from(storyboards)
      .where(
        and(eq(storyboards.id, storyboardId), isNull(storyboards.deletedAt)),
      )
      .get();

    if (row == null) {
      return null;
    }

    return mapStoryboard(row, await sceneIdsForStoryboard(this.db, row.id));
  }

  async findByProjectId(projectId: string): Promise<Storyboard[]> {
    const rows = await this.db
      .select()
      .from(storyboards)
      .where(
        and(
          eq(storyboards.projectId, projectId),
          isNull(storyboards.deletedAt),
        ),
      )
      .orderBy(storyboards.createdAt, storyboards.id);

    return Promise.all(
      rows.map(async (row) =>
        mapStoryboard(row, await sceneIdsForStoryboard(this.db, row.id)),
      ),
    );
  }

  async save(storyboard: Storyboard): Promise<void> {
    await this.db
      .insert(storyboards)
      .values({
        id: storyboard.id,
        projectId: storyboard.projectId,
        status: storyboard.status,
        tone: storyboard.tone,
        stylePresetId: storyboard.stylePresetId,
        commonPrompt: storyboard.commonPrompt,
        negativePrompt: storyboard.negativePrompt,
        createdAt: storyboard.createdAt,
        updatedAt: storyboard.updatedAt,
      })
      .onConflictDoUpdate({
        target: storyboards.id,
        set: {
          projectId: storyboard.projectId,
          status: storyboard.status,
          tone: storyboard.tone,
          stylePresetId: storyboard.stylePresetId,
          commonPrompt: storyboard.commonPrompt,
          negativePrompt: storyboard.negativePrompt,
          updatedAt: storyboard.updatedAt,
          deletedAt: null,
        },
      });
  }

  async softDelete(storyboardId: string, deletedAt: string): Promise<void> {
    await this.db
      .update(storyboards)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(eq(storyboards.id, storyboardId));
  }

  async restore(storyboardId: string, restoredAt: string): Promise<void> {
    await this.db
      .update(storyboards)
      .set({ deletedAt: null, updatedAt: restoredAt })
      .where(eq(storyboards.id, storyboardId));
  }
}

export class SqliteSceneRepository implements SceneRepositoryPort {
  constructor(private readonly db: GenStoryDatabase) {}

  async findById(sceneId: string): Promise<Scene | null> {
    const row = await this.db
      .select({ scene: scenes })
      .from(scenes)
      .innerJoin(storyboards, eq(scenes.storyboardId, storyboards.id))
      .where(
        and(
          eq(scenes.id, sceneId),
          isNull(scenes.deletedAt),
          isNull(storyboards.deletedAt),
        ),
      )
      .get();

    if (row == null) {
      return null;
    }

    return mapScene(
      row.scene,
      await scenePhotoAssetsForScene(this.db, row.scene.id),
    );
  }

  async findByStoryboardId(storyboardId: string): Promise<Scene[]> {
    const rows = await this.db
      .select({ scene: scenes })
      .from(scenes)
      .innerJoin(storyboards, eq(scenes.storyboardId, storyboards.id))
      .where(
        and(
          eq(scenes.storyboardId, storyboardId),
          isNull(scenes.deletedAt),
          isNull(storyboards.deletedAt),
        ),
      )
      .orderBy(scenes.orderIndex, scenes.id);

    const mappedScenes = await Promise.all(
      rows.map(async (row) =>
        mapScene(
          row.scene,
          await scenePhotoAssetsForScene(this.db, row.scene.id),
        ),
      ),
    );

    return sortScenesByOrderIndex(mappedScenes);
  }

  async save(scene: Scene): Promise<void> {
    this.db.transaction((tx) => {
      tx.insert(scenes)
        .values({
          id: scene.id,
          projectId: scene.projectId,
          storyboardId: scene.storyboardId,
          orderIndex: scene.orderIndex,
          status: scene.status,
          kind: scene.kind,
          bridgeFromSceneId: scene.bridge?.fromSceneId ?? null,
          bridgeToSceneId: scene.bridge?.toSceneId ?? null,
          title: scene.title,
          description: scene.description,
          imagePrompt: scene.imagePrompt,
          emotion: scene.emotion,
          cameraDirection: scene.cameraDirection,
          lightingDirection: scene.lightingDirection,
          motionDirection: scene.motionDirection,
          notes: scene.notes,
          negativePrompt: scene.negativePrompt,
          adoptedGeneratedImageId: scene.adoptedGeneratedImageId,
          createdAt: scene.createdAt,
          updatedAt: scene.updatedAt,
        })
        .onConflictDoUpdate({
          target: scenes.id,
          set: {
            projectId: scene.projectId,
            storyboardId: scene.storyboardId,
            orderIndex: scene.orderIndex,
            status: scene.status,
            kind: scene.kind,
            bridgeFromSceneId: scene.bridge?.fromSceneId ?? null,
            bridgeToSceneId: scene.bridge?.toSceneId ?? null,
            title: scene.title,
            description: scene.description,
            imagePrompt: scene.imagePrompt,
            emotion: scene.emotion,
            cameraDirection: scene.cameraDirection,
            lightingDirection: scene.lightingDirection,
            motionDirection: scene.motionDirection,
            notes: scene.notes,
            negativePrompt: scene.negativePrompt,
            adoptedGeneratedImageId: scene.adoptedGeneratedImageId,
            updatedAt: scene.updatedAt,
            deletedAt: null,
          },
        })
        .run();

      tx.delete(scenePhotoAssets)
        .where(eq(scenePhotoAssets.sceneId, scene.id))
        .run();

      if (scene.photoAssets.length > 0) {
        tx.insert(scenePhotoAssets)
          .values(
            scene.photoAssets.map((scenePhotoAsset, orderIndex) => ({
              sceneId: scene.id,
              photoAssetId: scenePhotoAsset.photoAssetId,
              role: scenePhotoAsset.role,
              orderIndex,
              createdAt: scene.updatedAt,
            })),
          )
          .run();
      }
    });
  }

  async softDelete(sceneId: string, deletedAt: string): Promise<void> {
    await this.db
      .update(scenes)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(eq(scenes.id, sceneId));
  }

  async restore(sceneId: string, restoredAt: string): Promise<void> {
    await this.db
      .update(scenes)
      .set({ deletedAt: null, updatedAt: restoredAt })
      .where(eq(scenes.id, sceneId));
  }
}

export class SqliteStylePresetRepository implements StylePresetRepositoryPort {
  constructor(private readonly db: GenStoryDatabase) {}

  async findById(stylePresetId: string): Promise<StylePreset | null> {
    const row = await this.db
      .select()
      .from(stylePresets)
      .where(
        and(eq(stylePresets.id, stylePresetId), isNull(stylePresets.deletedAt)),
      )
      .get();

    return row == null ? null : mapStylePreset(row);
  }

  async findAll(): Promise<StylePreset[]> {
    const rows = await this.db
      .select()
      .from(stylePresets)
      .where(isNull(stylePresets.deletedAt))
      .orderBy(
        asc(stylePresets.scope),
        asc(stylePresets.name),
        asc(stylePresets.id),
      );

    return rows.map(mapStylePreset);
  }

  async save(stylePreset: StylePreset): Promise<void> {
    const existing = await this.db
      .select()
      .from(stylePresets)
      .where(eq(stylePresets.id, stylePreset.id))
      .get();

    if (
      existing?.scope === "system" &&
      (stylePreset.scope !== existing.scope ||
        stylePreset.name !== existing.name ||
        stylePreset.description !== existing.description ||
        stylePreset.prompt !== existing.prompt)
    ) {
      throw new Error("System style presets cannot be edited directly.");
    }

    await this.db
      .insert(stylePresets)
      .values({
        id: stylePreset.id,
        scope: stylePreset.scope,
        name: stylePreset.name,
        description: stylePreset.description,
        prompt: stylePreset.prompt,
        createdAt: stylePreset.createdAt,
        updatedAt: stylePreset.updatedAt,
      })
      .onConflictDoUpdate({
        target: stylePresets.id,
        set: {
          scope: stylePreset.scope,
          name: stylePreset.name,
          description: stylePreset.description,
          prompt: stylePreset.prompt,
          updatedAt: stylePreset.updatedAt,
          deletedAt: null,
        },
      });
  }

  async softDelete(stylePresetId: string, deletedAt: string): Promise<void> {
    await this.db
      .update(stylePresets)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(eq(stylePresets.id, stylePresetId));
  }

  async restore(stylePresetId: string, restoredAt: string): Promise<void> {
    await this.db
      .update(stylePresets)
      .set({ deletedAt: null, updatedAt: restoredAt })
      .where(eq(stylePresets.id, stylePresetId));
  }
}

export class SqliteGenerationRequestRepository implements GenerationRequestRepositoryPort {
  constructor(private readonly db: GenStoryDatabase) {}

  async findById(
    generationRequestId: string,
  ): Promise<GenerationRequest | null> {
    const row = await this.db
      .select()
      .from(generationRequests)
      .where(
        and(
          eq(generationRequests.id, generationRequestId),
          isNull(generationRequests.deletedAt),
        ),
      )
      .get();

    return row == null ? null : mapGenerationRequest(row);
  }

  async findBySceneId(sceneId: string): Promise<GenerationRequest[]> {
    const rows = await this.db
      .select()
      .from(generationRequests)
      .where(
        and(
          eq(generationRequests.sceneId, sceneId),
          isNull(generationRequests.deletedAt),
        ),
      )
      .orderBy(generationRequests.createdAt, generationRequests.id);

    return rows.map(mapGenerationRequest);
  }

  async findRunningCountByProjectId(projectId: string): Promise<number> {
    const result = this.db
      .select({ count: sql<number>`count(*)` })
      .from(generationRequests)
      .where(
        and(
          eq(generationRequests.projectId, projectId),
          eq(generationRequests.status, "running"),
          isNull(generationRequests.deletedAt),
        ),
      )
      .get();

    return result?.count ?? 0;
  }

  async findByProjectIdAndStatus(
    projectId: string,
    status: GenerationRequestStatus,
  ): Promise<GenerationRequest[]> {
    const rows = await this.db
      .select()
      .from(generationRequests)
      .where(
        and(
          eq(generationRequests.projectId, projectId),
          eq(generationRequests.status, status),
          isNull(generationRequests.deletedAt),
        ),
      )
      .orderBy(generationRequests.createdAt, generationRequests.id);

    return rows.map(mapGenerationRequest);
  }

  async findQueued(): Promise<GenerationRequest[]> {
    const rows = await this.db
      .select()
      .from(generationRequests)
      .where(
        and(
          eq(generationRequests.status, "queued"),
          isNull(generationRequests.deletedAt),
        ),
      )
      .orderBy(generationRequests.createdAt, generationRequests.id);

    return rows.map(mapGenerationRequest);
  }

  async findRecent(limit: number): Promise<GenerationRequest[]> {
    const rows = await this.db
      .select()
      .from(generationRequests)
      .orderBy(generationRequests.createdAt)
      .limit(limit);

    return rows.map(mapGenerationRequest);
  }

  async findByStoryboardId(storyboardId: string): Promise<GenerationRequest[]> {
    const rows = await this.db
      .select()
      .from(generationRequests)
      .where(
        and(
          eq(generationRequests.storyboardId, storyboardId),
          isNull(generationRequests.deletedAt),
        ),
      )
      .orderBy(desc(generationRequests.createdAt), desc(generationRequests.id));

    return rows.map(mapGenerationRequest);
  }

  async save(generationRequest: GenerationRequest): Promise<void> {
    const appliedAdjustmentsJson = JSON.stringify(
      generationRequest.appliedAdjustments,
    );

    await this.db
      .insert(generationRequests)
      .values({
        id: generationRequest.id,
        projectId: generationRequest.projectId,
        storyboardId: generationRequest.storyboardId,
        sceneId: generationRequest.sceneId,
        status: generationRequest.status,
        inputJson: JSON.stringify(generationRequest.inputJson),
        errorMessage: generationRequest.errorMessage,
        sourceGenerationRequestId: generationRequest.sourceGenerationRequestId,
        appliedAdjustmentsJson,
        startedAt: generationRequest.startedAt,
        completedAt: generationRequest.completedAt,
        createdAt: generationRequest.createdAt,
        updatedAt: generationRequest.updatedAt,
      })
      .onConflictDoUpdate({
        target: generationRequests.id,
        set: {
          projectId: generationRequest.projectId,
          storyboardId: generationRequest.storyboardId,
          sceneId: generationRequest.sceneId,
          status: generationRequest.status,
          inputJson: JSON.stringify(generationRequest.inputJson),
          errorMessage: generationRequest.errorMessage,
          sourceGenerationRequestId:
            generationRequest.sourceGenerationRequestId,
          appliedAdjustmentsJson,
          startedAt: generationRequest.startedAt,
          completedAt: generationRequest.completedAt,
          updatedAt: generationRequest.updatedAt,
          deletedAt: null,
        },
      });
  }

  async softDelete(
    generationRequestId: string,
    deletedAt: string,
  ): Promise<void> {
    await this.db
      .update(generationRequests)
      .set({ deletedAt, updatedAt: deletedAt })
      .where(eq(generationRequests.id, generationRequestId));
  }

  async restore(
    generationRequestId: string,
    restoredAt: string,
  ): Promise<void> {
    await this.db
      .update(generationRequests)
      .set({ deletedAt: null, updatedAt: restoredAt })
      .where(eq(generationRequests.id, generationRequestId));
  }
}

export class SqliteGeneratedImageRepository implements GeneratedImageRepositoryPort {
  constructor(private readonly db: GenStoryDatabase) {}

  async findById(generatedImageId: string): Promise<GeneratedImage | null> {
    const row = await this.db
      .select()
      .from(generatedImages)
      .where(
        and(
          eq(generatedImages.id, generatedImageId),
          isNull(generatedImages.deletedAt),
        ),
      )
      .get();

    return row == null ? null : mapGeneratedImage(row);
  }

  async findBySceneId(sceneId: string): Promise<GeneratedImage[]> {
    const rows = await this.db
      .select()
      .from(generatedImages)
      .where(
        and(
          eq(generatedImages.sceneId, sceneId),
          isNull(generatedImages.deletedAt),
        ),
      )
      .orderBy(generatedImages.createdAt, generatedImages.id);

    return rows.map(mapGeneratedImage);
  }

  async save(generatedImage: GeneratedImage): Promise<void> {
    const adoptedAt = generatedImage.adoptedAt;

    await this.db
      .insert(generatedImages)
      .values({
        id: generatedImage.id,
        projectId: generatedImage.projectId,
        storyboardId: generatedImage.storyboardId,
        sceneId: generatedImage.sceneId,
        generationRequestId: generatedImage.generationRequestId,
        storageKey: generatedImage.storageKey,
        mimeType: generatedImage.mimeType,
        size: generatedImage.size,
        width: generatedImage.width,
        height: generatedImage.height,
        checksum: generatedImage.checksum,
        adoptedAt: null,
        createdAt: generatedImage.createdAt,
        updatedAt: generatedImage.updatedAt,
      })
      .onConflictDoUpdate({
        target: generatedImages.id,
        set: {
          projectId: generatedImage.projectId,
          storyboardId: generatedImage.storyboardId,
          sceneId: generatedImage.sceneId,
          generationRequestId: generatedImage.generationRequestId,
          storageKey: generatedImage.storageKey,
          mimeType: generatedImage.mimeType,
          size: generatedImage.size,
          width: generatedImage.width,
          height: generatedImage.height,
          checksum: generatedImage.checksum,
          adoptedAt: null,
          updatedAt: generatedImage.updatedAt,
          deletedAt: null,
        },
      });

    if (adoptedAt != null) {
      await this.adoptGeneratedImage(
        generatedImage.sceneId,
        generatedImage.id,
        adoptedAt,
      );
    } else {
      await this.db
        .update(scenes)
        .set({
          adoptedGeneratedImageId: null,
          updatedAt: generatedImage.updatedAt,
        })
        .where(eq(scenes.adoptedGeneratedImageId, generatedImage.id));
    }
  }

  async adoptGeneratedImage(
    sceneId: string,
    generatedImageId: string,
    adoptedAt: string,
  ): Promise<void> {
    this.db.transaction((tx) => {
      const scene = tx
        .select()
        .from(scenes)
        .where(and(eq(scenes.id, sceneId), isNull(scenes.deletedAt)))
        .get();

      if (scene == null) {
        throw new Error("Scene not found.");
      }

      const targetImage = tx
        .select()
        .from(generatedImages)
        .where(
          and(
            eq(generatedImages.id, generatedImageId),
            isNull(generatedImages.deletedAt),
          ),
        )
        .get();

      if (targetImage == null) {
        throw new Error("Generated image not found.");
      }

      if (targetImage.sceneId !== sceneId) {
        throw new Error("Generated image does not belong to this scene.");
      }

      tx.update(generatedImages)
        .set({ adoptedAt: null, updatedAt: adoptedAt })
        .where(
          and(
            eq(generatedImages.sceneId, sceneId),
            isNull(generatedImages.deletedAt),
          ),
        )
        .run();

      tx.update(generatedImages)
        .set({ adoptedAt, updatedAt: adoptedAt })
        .where(eq(generatedImages.id, generatedImageId))
        .run();

      tx.update(scenes)
        .set({
          adoptedGeneratedImageId: generatedImageId,
          updatedAt: adoptedAt,
        })
        .where(eq(scenes.id, sceneId))
        .run();
    });
  }

  async softDelete(generatedImageId: string, deletedAt: string): Promise<void> {
    this.db.transaction((tx) => {
      tx.update(generatedImages)
        .set({ deletedAt, updatedAt: deletedAt, adoptedAt: null })
        .where(eq(generatedImages.id, generatedImageId))
        .run();

      tx.update(scenes)
        .set({ adoptedGeneratedImageId: null, updatedAt: deletedAt })
        .where(eq(scenes.adoptedGeneratedImageId, generatedImageId))
        .run();
    });
  }

  async restore(generatedImageId: string, restoredAt: string): Promise<void> {
    await this.db
      .update(generatedImages)
      .set({ deletedAt: null, updatedAt: restoredAt })
      .where(eq(generatedImages.id, generatedImageId));
  }
}

export class SqliteProjectPhotoAnalysisRepository implements ProjectPhotoAnalysisRepositoryPort {
  constructor(private readonly db: GenStoryDatabase) {}

  async findLatestByProjectId(
    projectId: string,
  ): Promise<ProjectPhotoAnalysis | null> {
    const row = await this.db
      .select()
      .from(projectPhotoAnalyses)
      .where(
        and(
          eq(projectPhotoAnalyses.projectId, projectId),
          isNull(projectPhotoAnalyses.deletedAt),
        ),
      )
      .orderBy(sql`${projectPhotoAnalyses.updatedAt} desc`)
      .get();

    return row == null ? null : mapProjectPhotoAnalysis(row);
  }

  async save(projectPhotoAnalysis: ProjectPhotoAnalysis): Promise<void> {
    await this.db
      .insert(projectPhotoAnalyses)
      .values({
        id: projectPhotoAnalysis.id,
        projectId: projectPhotoAnalysis.projectId,
        emotionCandidatesJson: JSON.stringify(
          projectPhotoAnalysis.emotionCandidates,
        ),
        photoInsightsJson: JSON.stringify(projectPhotoAnalysis.photoInsights),
        storySummary: projectPhotoAnalysis.storySummary,
        model: projectPhotoAnalysis.model,
        createdAt: projectPhotoAnalysis.createdAt,
        updatedAt: projectPhotoAnalysis.updatedAt,
        deletedAt: projectPhotoAnalysis.deletedAt,
      })
      .onConflictDoUpdate({
        target: projectPhotoAnalyses.projectId,
        set: {
          id: projectPhotoAnalysis.id,
          emotionCandidatesJson: JSON.stringify(
            projectPhotoAnalysis.emotionCandidates,
          ),
          photoInsightsJson: JSON.stringify(projectPhotoAnalysis.photoInsights),
          storySummary: projectPhotoAnalysis.storySummary,
          model: projectPhotoAnalysis.model,
          updatedAt: projectPhotoAnalysis.updatedAt,
          deletedAt: projectPhotoAnalysis.deletedAt,
        },
      });
  }
}

type TestGenerationBatchRow = typeof testGenerationBatches.$inferSelect;

function mapTestGenerationBatch(
  row: TestGenerationBatchRow,
): TestGenerationBatch {
  return createTestGenerationBatch({
    id: row.id,
    storyboardId: row.storyboardId,
    status: row.status as TestGenerationBatchStatus,
    confirmedGenerationRequestId: row.confirmedGenerationRequestId ?? null,
    createdAt: row.createdAt,
    completedAt: row.completedAt ?? null,
  });
}

export class SqliteTestGenerationBatchRepository implements TestGenerationBatchRepositoryPort {
  constructor(private readonly db: GenStoryDatabase) {}

  async findLatestByStoryboardId(
    storyboardId: string,
  ): Promise<TestGenerationBatch | null> {
    const row = await this.db
      .select()
      .from(testGenerationBatches)
      .where(eq(testGenerationBatches.storyboardId, storyboardId))
      .orderBy(sql`${testGenerationBatches.createdAt} desc`)
      .get();

    return row == null ? null : mapTestGenerationBatch(row);
  }

  async save(batch: TestGenerationBatch): Promise<void> {
    await this.db
      .insert(testGenerationBatches)
      .values({
        id: batch.id,
        storyboardId: batch.storyboardId,
        status: batch.status,
        confirmedGenerationRequestId: batch.confirmedGenerationRequestId,
        createdAt: batch.createdAt,
        completedAt: batch.completedAt,
      })
      .onConflictDoUpdate({
        target: testGenerationBatches.id,
        set: {
          status: batch.status,
          confirmedGenerationRequestId: batch.confirmedGenerationRequestId,
          completedAt: batch.completedAt,
        },
      });
  }
}

type UserPreferenceRow = typeof userPreferences.$inferSelect;

function mapUserPreference(row: UserPreferenceRow): UserPreference {
  const language: Language = isLanguage(row.language) ? row.language : "en";
  return {
    userId: row.userId,
    language,
    updatedAt: row.updatedAt,
  };
}

export class SqliteUserPreferenceRepository implements UserPreferenceRepositoryPort {
  constructor(private readonly db: GenStoryDatabase) {}

  async findByUserId(userId: string): Promise<UserPreference | null> {
    const row = await this.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .get();

    return row == null ? null : mapUserPreference(row);
  }

  async upsert(preference: UserPreference): Promise<void> {
    await this.db
      .insert(userPreferences)
      .values({
        userId: preference.userId,
        language: preference.language,
        updatedAt: preference.updatedAt,
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: {
          language: preference.language,
          updatedAt: preference.updatedAt,
        },
      });
  }
}

export function createSqliteRepositories(db: GenStoryDatabase) {
  return {
    users: new SqliteUserRepository(db),
    organizations: new SqliteOrganizationRepository(db),
    projects: new SqliteProjectRepository(db),
    photoAssets: new SqlitePhotoAssetRepository(db),
    storyboards: new SqliteStoryboardRepository(db),
    scenes: new SqliteSceneRepository(db),
    stylePresets: new SqliteStylePresetRepository(db),
    generationRequests: new SqliteGenerationRequestRepository(db),
    generatedImages: new SqliteGeneratedImageRepository(db),
    projectPhotoAnalyses: new SqliteProjectPhotoAnalysisRepository(db),
    testGenerationBatches: new SqliteTestGenerationBatchRepository(db),
    userPreferences: new SqliteUserPreferenceRepository(db),
  };
}
