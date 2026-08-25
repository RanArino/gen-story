import type {
  ProjectId,
  ProjectPhotoAnalysis,
  Storyboard,
  StoryboardId,
} from "./model";

// A semantic target is the canonical, provider-agnostic reference an agent
// uses to read or propose a change to one field, e.g. the GUI/CLI `@style-preset`
// mention. It intentionally excludes the DB row shape: agents address product
// concepts, not storage columns.
export type ProjectSemanticField = "photoAnalysis";
export type StorySemanticField = "tone" | "stylePresetId";
export type SemanticField = ProjectSemanticField | StorySemanticField;

export type SemanticTarget =
  | { entityType: "project"; entityId: ProjectId; field: ProjectSemanticField }
  | {
      entityType: "storyboard";
      entityId: StoryboardId;
      field: StorySemanticField;
    };

export const SEMANTIC_FIELDS: SemanticField[] = [
  "photoAnalysis",
  "tone",
  "stylePresetId",
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
    (input.field === "tone" || input.field === "stylePresetId")
  ) {
    return { entityType: "storyboard", entityId, field: input.field };
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
