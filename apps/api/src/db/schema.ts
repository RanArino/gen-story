import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    displayName: text("display_name").notNull(),
    email: text("email"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [index("users_organization_id_idx").on(table.organizationId)],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    status: text("status").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("projects_organization_id_idx").on(table.organizationId),
    index("projects_owner_user_id_idx").on(table.ownerUserId),
  ],
);

export const photoAssets = sqliteTable(
  "photo_assets",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    usage: text("usage").notNull(),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    width: integer("width"),
    height: integer("height"),
    checksum: text("checksum").notNull(),
    sourceKind: text("source_kind").notNull(),
    notes: text("notes"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("photo_assets_project_id_idx").on(table.projectId),
    index("photo_assets_checksum_idx").on(table.checksum),
  ],
);

export const stylePresets = sqliteTable("style_presets", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  prompt: text("prompt").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const storyboards = sqliteTable(
  "storyboards",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    status: text("status").notNull(),
    tone: text("tone").notNull(),
    stylePresetId: text("style_preset_id").references(() => stylePresets.id),
    commonPrompt: text("common_prompt").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("storyboards_project_id_idx").on(table.projectId),
    index("storyboards_style_preset_id_idx").on(table.stylePresetId),
  ],
);

export const scenes = sqliteTable(
  "scenes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    storyboardId: text("storyboard_id")
      .notNull()
      .references(() => storyboards.id),
    orderIndex: integer("order_index").notNull(),
    status: text("status").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    imagePrompt: text("image_prompt").notNull(),
    emotion: text("emotion").notNull(),
    cameraDirection: text("camera_direction").notNull(),
    lightingDirection: text("lighting_direction").notNull(),
    motionDirection: text("motion_direction").notNull(),
    notes: text("notes").notNull(),
    adoptedGeneratedImageId: text("adopted_generated_image_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("scenes_project_id_idx").on(table.projectId),
    index("scenes_storyboard_id_idx").on(table.storyboardId),
    index("scenes_order_idx").on(
      table.storyboardId,
      table.orderIndex,
      table.id,
    ),
  ],
);

export const scenePhotoAssets = sqliteTable(
  "scene_photo_assets",
  {
    sceneId: text("scene_id")
      .notNull()
      .references(() => scenes.id),
    photoAssetId: text("photo_asset_id")
      .notNull()
      .references(() => photoAssets.id),
    role: text("role").notNull(),
    orderIndex: integer("order_index").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("scene_photo_assets_scene_photo_unique").on(
      table.sceneId,
      table.photoAssetId,
    ),
    uniqueIndex("scene_photo_assets_one_primary_idx")
      .on(table.sceneId)
      .where(sql`${table.role} = 'primary'`),
    index("scene_photo_assets_photo_asset_id_idx").on(table.photoAssetId),
    index("scene_photo_assets_order_idx").on(
      table.sceneId,
      table.orderIndex,
      table.photoAssetId,
    ),
  ],
);

export const generationRequests = sqliteTable(
  "generation_requests",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    storyboardId: text("storyboard_id")
      .notNull()
      .references(() => storyboards.id),
    sceneId: text("scene_id")
      .notNull()
      .references(() => scenes.id),
    status: text("status").notNull(),
    inputJson: text("input_json").notNull(),
    errorMessage: text("error_message"),
    sourceGenerationRequestId: text("source_generation_request_id"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("generation_requests_project_id_idx").on(table.projectId),
    index("generation_requests_storyboard_id_idx").on(table.storyboardId),
    index("generation_requests_scene_id_idx").on(table.sceneId),
    index("generation_requests_status_idx").on(table.status),
  ],
);

export const generatedImages = sqliteTable(
  "generated_images",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    storyboardId: text("storyboard_id")
      .notNull()
      .references(() => storyboards.id),
    sceneId: text("scene_id")
      .notNull()
      .references(() => scenes.id),
    generationRequestId: text("generation_request_id")
      .notNull()
      .references(() => generationRequests.id),
    storageKey: text("storage_key").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    width: integer("width"),
    height: integer("height"),
    checksum: text("checksum").notNull(),
    adoptedAt: text("adopted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    index("generated_images_project_id_idx").on(table.projectId),
    index("generated_images_storyboard_id_idx").on(table.storyboardId),
    index("generated_images_scene_id_idx").on(table.sceneId),
    index("generated_images_generation_request_id_idx").on(
      table.generationRequestId,
    ),
    uniqueIndex("generated_images_one_adopted_idx")
      .on(table.sceneId)
      .where(sql`${table.adoptedAt} is not null`),
  ],
);

export const projectPhotoAnalyses = sqliteTable(
  "project_photo_analyses",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    emotionCandidatesJson: text("emotion_candidates_json").notNull(),
    photoInsightsJson: text("photo_insights_json").notNull(),
    storySummary: text("story_summary").notNull(),
    model: text("model").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("project_photo_analyses_project_id_unique").on(table.projectId),
    index("project_photo_analyses_project_id_idx").on(table.projectId),
  ],
);

export const testGenerationBatches = sqliteTable(
  "test_generation_batches",
  {
    id: text("id").primaryKey(),
    storyboardId: text("storyboard_id")
      .notNull()
      .references(() => storyboards.id),
    status: text("status").notNull(),
    confirmedGenerationRequestId: text(
      "confirmed_generation_request_id",
    ).references(() => generationRequests.id),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("test_generation_batches_storyboard_id_idx").on(table.storyboardId),
  ],
);
