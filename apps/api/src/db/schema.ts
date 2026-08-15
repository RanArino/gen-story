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

export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  language: text("language").notNull().default("en"),
  updatedAt: text("updated_at").notNull(),
});

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
    position: integer("position").notNull().default(0),
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
    story: text("story").notNull().default(""),
    negativePrompt: text("negative_prompt").notNull().default(""),
    characterPolicy: text("character_policy")
      .notNull()
      .default("background_only"),
    // Null while the guided five-step setup is still gating this storyboard.
    // Stamped once it has been through all five steps, after which every
    // section is freely editable.
    setupCompletedAt: text("setup_completed_at"),
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
    kind: text("kind").notNull().default("photo"),
    bridgeFromSceneId: text("bridge_from_scene_id"),
    bridgeToSceneId: text("bridge_to_scene_id"),
    title: text("title").notNull(),
    description: text("description").notNull(),
    imagePrompt: text("image_prompt").notNull(),
    emotion: text("emotion").notNull(),
    cameraDirection: text("camera_direction").notNull(),
    lightingDirection: text("lighting_direction").notNull(),
    motionDirection: text("motion_direction").notNull(),
    notes: text("notes").notNull(),
    negativePrompt: text("negative_prompt").notNull().default(""),
    photoFidelity: text("photo_fidelity").notNull().default("off"),
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
    appliedAdjustmentsJson: text("applied_adjustments_json")
      .notNull()
      .default("[]"),
    testGenerationBatchId: text("test_generation_batch_id"),
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
    index("generation_requests_test_generation_batch_id_idx").on(
      table.testGenerationBatchId,
    ),
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
    inputsHash: text("inputs_hash").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
  (table) => [
    uniqueIndex("project_photo_analyses_project_id_unique").on(table.projectId),
    index("project_photo_analyses_project_id_idx").on(table.projectId),
  ],
);

// Background jobs for the text/vision AI operations (photo analysis, scene AI
// fill, complement scene proposals). Image generation keeps its own
// image-specific `generation_requests` table.
export const aiJobs = sqliteTable(
  "ai_jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    inputJson: text("input_json").notNull(),
    resultJson: text("result_json"),
    errorMessage: text("error_message"),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("ai_jobs_project_id_idx").on(table.projectId),
    index("ai_jobs_status_idx").on(table.status),
  ],
);

// Durable propose -> approve -> apply review unit for agent-authored data
// changes (M2). Items and choices are stored in child tables and replaced
// wholesale on every save, mirroring how scene_photo_assets tracks scenes.
export const changeProposals = sqliteTable(
  "change_proposals",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    provider: text("provider").notNull(),
    conversationId: text("conversation_id").notNull(),
    turnId: text("turn_id").notNull(),
    rationale: text("rationale").notNull(),
    status: text("status").notNull(),
    clientRequestId: text("client_request_id").notNull(),
    approvedBy: text("approved_by"),
    resolvedAt: text("resolved_at"),
    applyOutcomeJson: text("apply_outcome_json"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("change_proposals_project_id_idx").on(table.projectId),
    index("change_proposals_project_status_idx").on(
      table.projectId,
      table.status,
    ),
    uniqueIndex("change_proposals_project_client_request_unique").on(
      table.projectId,
      table.clientRequestId,
    ),
  ],
);

export const changeProposalItems = sqliteTable(
  "change_proposal_items",
  {
    id: text("id").primaryKey(),
    changeProposalId: text("change_proposal_id")
      .notNull()
      .references(() => changeProposals.id),
    orderIndex: integer("order_index").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    field: text("field").notNull(),
    beforeJson: text("before_json").notNull(),
    afterJson: text("after_json").notNull(),
    rationale: text("rationale").notNull(),
    baseRevision: text("base_revision").notNull(),
    approval: text("approval").notNull(),
  },
  (table) => [
    index("change_proposal_items_proposal_id_idx").on(table.changeProposalId),
  ],
);

export const changeProposalChoices = sqliteTable(
  "change_proposal_choices",
  {
    changeProposalId: text("change_proposal_id")
      .notNull()
      .references(() => changeProposals.id),
    targetItemId: text("target_item_id")
      .notNull()
      .references(() => changeProposalItems.id),
    optionsJson: text("options_json").notNull(),
    selectedOptionId: text("selected_option_id"),
  },
  (table) => [
    uniqueIndex("change_proposal_choices_target_item_unique").on(
      table.targetItemId,
    ),
    index("change_proposal_choices_proposal_id_idx").on(table.changeProposalId),
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
