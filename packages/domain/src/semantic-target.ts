import type {
  ProjectId,
  ProjectPhotoAnalysis,
  Scene,
  SceneId,
  Storyboard,
  StoryboardId,
} from "./model";

// A semantic target is the canonical, provider-agnostic reference an agent
// uses to read or propose a change to one field, e.g. the GUI/CLI `@style-preset`
// mention. It intentionally excludes the DB row shape: agents address product
// concepts, not storage columns.
export type ProjectSemanticField = "photoAnalysis";
// The storyboard-level story setup: tone and style preset, plus the four
// fields the guided setup flow writes (common prompt, story/worldview,
// negative prompt, and the one-time character decision).
export type StorySemanticField =
  | "tone"
  | "stylePresetId"
  | "commonPrompt"
  | "story"
  | "negativePrompt"
  | "characterPolicy";
// A scene is addressed as one unit rather than field by field: the operator
// refers to "scene 3", and its creative fields (prompt, emotion, camera,
// lighting, motion) are only meaningful to review together.
export type SceneSemanticField = "scene";
export type SemanticField =
  | ProjectSemanticField
  | StorySemanticField
  | SceneSemanticField;

export type SemanticTarget =
  | { entityType: "project"; entityId: ProjectId; field: ProjectSemanticField }
  | {
      entityType: "storyboard";
      entityId: StoryboardId;
      field: StorySemanticField;
    }
  | { entityType: "scene"; entityId: SceneId; field: SceneSemanticField };

export const STORY_SEMANTIC_FIELDS: StorySemanticField[] = [
  "tone",
  "stylePresetId",
  "commonPrompt",
  "story",
  "negativePrompt",
  "characterPolicy",
];

export const SEMANTIC_FIELDS: SemanticField[] = [
  "photoAnalysis",
  ...STORY_SEMANTIC_FIELDS,
  "scene",
];

export function isSemanticField(value: unknown): value is SemanticField {
  return (
    typeof value === "string" && (SEMANTIC_FIELDS as string[]).includes(value)
  );
}

export function projectSemanticTarget(
  projectId: ProjectId,
  field: ProjectSemanticField,
): SemanticTarget {
  return { entityType: "project", entityId: projectId, field };
}

export function storyboardSemanticTarget(
  storyboardId: StoryboardId,
  field: StorySemanticField,
): SemanticTarget {
  return { entityType: "storyboard", entityId: storyboardId, field };
}

export function sceneSemanticTarget(sceneId: SceneId): SemanticTarget {
  return { entityType: "scene", entityId: sceneId, field: "scene" };
}

// Validates an untrusted { entityType, entityId, field } tuple (e.g. from an
// MCP tool call) into a well-formed SemanticTarget. Throws on any
// entityType/field pair this slice does not support.
export function createSemanticTarget(input: {
  entityType: string;
  entityId: string;
  field: string;
}): SemanticTarget {
  const entityId = input.entityId.trim();
  if (entityId.length === 0) {
    throw new Error("Semantic target entity ID is required.");
  }

  if (input.entityType === "project" && input.field === "photoAnalysis") {
    return { entityType: "project", entityId, field: "photoAnalysis" };
  }

  if (
    input.entityType === "storyboard" &&
    (STORY_SEMANTIC_FIELDS as string[]).includes(input.field)
  ) {
    return {
      entityType: "storyboard",
      entityId,
      field: input.field as StorySemanticField,
    };
  }

  if (input.entityType === "scene" && input.field === "scene") {
    return { entityType: "scene", entityId, field: "scene" };
  }

  throw new Error(
    `Unsupported semantic target: ${input.entityType}.${input.field}`,
  );
}

// Stable string form for indexing, logging, and audit records. Not a
// database key and not guaranteed unique across entity types with colliding
// IDs (entity type is part of the string precisely to avoid that).
export function semanticTargetKey(target: SemanticTarget): string {
  return `${target.entityType}:${target.entityId}#${target.field}`;
}

// A proposal's "base revision" is the target entity's updatedAt at the
// moment the agent read it. Neither Storyboard nor ProjectPhotoAnalysis has
// a dedicated per-field version column, so the whole-row updatedAt is the
// revision: coarser than per-field, but conflict-safe (any concurrent edit
// to the row invalidates a stale proposal, which is the direction that
// matters for M2's apply-time check).
export type SemanticTargetRevision = string;

export type SemanticTargetSnapshot = {
  target: SemanticTarget;
  value: unknown;
  revision: SemanticTargetRevision;
};

export function readStoryboardSemanticTarget(
  storyboard: Storyboard,
  field: StorySemanticField,
): SemanticTargetSnapshot {
  return {
    target: storyboardSemanticTarget(storyboard.id, field),
    value: storyboard[field],
    revision: storyboard.updatedAt,
  };
}

// The creative content of one scene — deliberately not the whole row: order,
// status, photo assignments, and the adopted image are workflow state the
// operator manages in the storyboard UI, not something a chat should rewrite.
export type SceneSemanticValue = {
  orderIndex: number;
  title: string;
  description: string;
  imagePrompt: string;
  emotion: string;
  cameraDirection: string;
  lightingDirection: string;
  motionDirection: string;
  notes: string;
  negativePrompt: string;
};

export function readSceneSemanticTarget(scene: Scene): SemanticTargetSnapshot {
  const value: SceneSemanticValue = {
    orderIndex: scene.orderIndex,
    title: scene.title,
    description: scene.description,
    imagePrompt: scene.imagePrompt,
    emotion: scene.emotion,
    cameraDirection: scene.cameraDirection,
    lightingDirection: scene.lightingDirection,
    motionDirection: scene.motionDirection,
    notes: scene.notes,
    negativePrompt: scene.negativePrompt,
  };
  return {
    target: sceneSemanticTarget(scene.id),
    value,
    revision: scene.updatedAt,
  };
}

export function readProjectPhotoAnalysisSemanticTarget(
  analysis: ProjectPhotoAnalysis,
): SemanticTargetSnapshot {
  return {
    target: projectSemanticTarget(analysis.projectId, "photoAnalysis"),
    value: {
      emotionCandidates: analysis.emotionCandidates,
      photoInsights: analysis.photoInsights,
      storySummary: analysis.storySummary,
    },
    revision: analysis.updatedAt,
  };
}
