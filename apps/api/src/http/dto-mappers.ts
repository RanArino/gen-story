import type {
  AiJob,
  ChangeProposal,
  GeneratedImage,
  GenerationRequest,
  PhotoAsset,
  Project,
  ProjectPhotoAnalysis,
  Scene,
  SemanticTargetSnapshot,
  Storyboard,
  StylePreset,
  TestGenerationBatch,
} from "@gen-story/domain";
import type {
  AiJobDto,
  AiRuntimeInfoDto,
  ChangeProposalDto,
  CreativeDirectionDto,
  SemanticTargetSnapshotDto,
  GeneratedImageDto,
  GenerationRequestDto,
  MeDto,
  PhotoAssetDto,
  ProjectDto,
  ProjectPhotoAnalysisDto,
  SceneDto,
  StylePresetDto,
  StoryboardDto,
  TestGenerationBatchDto,
  TestGenerationBatchWithVariantsDto,
  GenerationRequestWithSceneTitleDto,
} from "@gen-story/shared";

import type {
  AuthPrincipal,
  ComplementSceneProposal,
  CreativeDirection,
  StoryboardSetup,
  TestGenerationBatchWithVariants,
  UserPreference,
} from "@gen-story/application";
import type {
  ComplementSceneProposalDto,
  UserPreferenceDto,
} from "@gen-story/shared";

import type { ApiAgentRuntimeInfo } from "../app/create-api-context";

export function toAiRuntimeInfoDto(
  info: ApiAgentRuntimeInfo,
): AiRuntimeInfoDto {
  return {
    runtime: info.selection,
    wallet: info.wallet,
    availability: info.availability,
    capabilities: info.capabilities
      ? {
          supportsExplicitCompact: info.capabilities.supportsExplicitCompact,
          supportsMidTurnCancellationWithoutEndingSession:
            info.capabilities.supportsMidTurnCancellationWithoutEndingSession,
          supportsApprovalRequests: info.capabilities.supportsApprovalRequests,
          sessionIdKnownBeforeStart:
            info.capabilities.sessionIdKnownBeforeStart,
        }
      : null,
  };
}

export function toUserPreferenceDto(
  preference: UserPreference,
): UserPreferenceDto {
  return {
    userId: preference.userId,
    language: preference.language,
    updatedAt: preference.updatedAt,
  };
}

export function toComplementSceneProposalDto(
  proposal: ComplementSceneProposal,
): ComplementSceneProposalDto {
  return {
    title: proposal.title,
    description: proposal.description,
    imagePrompt: proposal.imagePrompt,
    emotion: proposal.emotion,
    cameraDirection: proposal.cameraDirection,
    lightingDirection: proposal.lightingDirection,
    motionDirection: proposal.motionDirection,
  };
}

export function toMeDto(principal: AuthPrincipal): MeDto {
  return {
    userId: principal.user.id,
    organizationId: principal.organization.id,
    displayName: principal.user.displayName,
    email: principal.user.email,
  };
}

export function toProjectDto(project: Project): ProjectDto {
  return {
    id: project.id,
    organizationId: project.organizationId,
    ownerUserId: project.ownerUserId,
    name: project.name,
    status: project.status,
    deletedAt: project.deletedAt,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export function toPhotoAssetDto(asset: PhotoAsset): PhotoAssetDto {
  return {
    id: asset.id,
    projectId: asset.projectId,
    name: asset.name,
    usage: asset.usage,
    storageKey: asset.storageKey,
    mimeType: asset.mimeType,
    size: asset.size,
    width: asset.width,
    height: asset.height,
    checksum: asset.checksum,
    sourceKind: asset.sourceKind,
    notes: asset.notes,
    position: asset.position,
    deletedAt: asset.deletedAt,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

export function toProjectPhotoAnalysisDto(
  analysis: ProjectPhotoAnalysis,
): ProjectPhotoAnalysisDto {
  return {
    id: analysis.id,
    projectId: analysis.projectId,
    emotionCandidates: analysis.emotionCandidates.map((candidate) => ({
      value: candidate.value,
      label: candidate.label,
      description: candidate.description,
      reason: candidate.reason,
    })),
    photoInsights: analysis.photoInsights.map((insight) => ({
      photoAssetId: insight.photoAssetId,
      summary: insight.summary,
      people: insight.people,
      setting: insight.setting,
      event: insight.event,
      atmosphere: insight.atmosphere,
    })),
    storySummary: analysis.storySummary,
    model: analysis.model,
    deletedAt: analysis.deletedAt,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
  };
}

// The derived setup step is passed in rather than computed here: it needs the
// project's photos and the storyboard's scenes, which the mapper has no way to
// read. Callers get it from `getStoryboardSetup`.
export function toStoryboardDto(
  storyboard: Storyboard,
  setup: StoryboardSetup,
): StoryboardDto {
  return {
    id: storyboard.id,
    projectId: storyboard.projectId,
    status: storyboard.status,
    tone: storyboard.tone,
    stylePresetId: storyboard.stylePresetId,
    commonPrompt: storyboard.commonPrompt,
    story: storyboard.story,
    negativePrompt: storyboard.negativePrompt,
    characterPolicy: storyboard.characterPolicy,
    sceneIds: storyboard.sceneIds,
    setupStep: setup.step,
    setupCompletedAt: setup.setupCompletedAt,
    pendingSceneFillCount: setup.pendingSceneFillCount,
    createdAt: storyboard.createdAt,
    updatedAt: storyboard.updatedAt,
  };
}

export function toSceneDto(scene: Scene): SceneDto {
  return {
    id: scene.id,
    projectId: scene.projectId,
    storyboardId: scene.storyboardId,
    orderIndex: scene.orderIndex,
    status: scene.status,
    kind: scene.kind,
    bridge: scene.bridge,
    title: scene.title,
    description: scene.description,
    imagePrompt: scene.imagePrompt,
    emotion: scene.emotion,
    cameraDirection: scene.cameraDirection,
    lightingDirection: scene.lightingDirection,
    motionDirection: scene.motionDirection,
    notes: scene.notes,
    negativePrompt: scene.negativePrompt,
    photoFidelity: scene.photoFidelity,
    photoAssets: scene.photoAssets.map((spa) => ({
      photoAssetId: spa.photoAssetId,
      role: spa.role,
    })),
    adoptedGeneratedImageId: scene.adoptedGeneratedImageId,
    createdAt: scene.createdAt,
    updatedAt: scene.updatedAt,
  };
}

export function toStylePresetDto(preset: StylePreset): StylePresetDto {
  const previewImageUrl =
    preset.scope === "system"
      ? `/style-previews/${preset.name.toLowerCase().replace(/\s+/g, "-")}.jpg`
      : null;
  return {
    id: preset.id,
    scope: preset.scope,
    name: preset.name,
    description: preset.description,
    prompt: preset.prompt,
    previewImageUrl,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
  };
}

export function toTestGenerationBatchDto(
  batch: TestGenerationBatch,
): TestGenerationBatchDto {
  return {
    id: batch.id,
    storyboardId: batch.storyboardId,
    status: batch.status,
    confirmedGenerationRequestId: batch.confirmedGenerationRequestId,
    createdAt: batch.createdAt,
    completedAt: batch.completedAt,
  };
}

export function toTestGenerationBatchWithVariantsDto(
  entry: TestGenerationBatchWithVariants,
): TestGenerationBatchWithVariantsDto {
  return {
    batch: toTestGenerationBatchDto(entry.batch),
    variants: entry.variants.map((variant) => ({
      request: toGenerationRequestDto(variant.request),
      generatedImage:
        variant.generatedImage == null
          ? null
          : toGeneratedImageDto(variant.generatedImage),
    })),
  };
}

export function toGenerationRequestDto(
  req: GenerationRequest,
): GenerationRequestDto {
  return {
    id: req.id,
    projectId: req.projectId,
    storyboardId: req.storyboardId,
    sceneId: req.sceneId,
    status: req.status,
    inputJson: req.inputJson,
    errorMessage: req.errorMessage,
    sourceGenerationRequestId: req.sourceGenerationRequestId,
    testGenerationBatchId: req.testGenerationBatchId,
    appliedAdjustments: req.appliedAdjustments ?? [],
    startedAt: req.startedAt,
    completedAt: req.completedAt,
    createdAt: req.createdAt,
    updatedAt: req.updatedAt,
  };
}

export function toAiJobDto(job: AiJob): AiJobDto {
  return {
    id: job.id,
    projectId: job.projectId,
    kind: job.kind,
    status: job.status,
    inputJson: job.inputJson,
    resultJson: job.resultJson,
    errorMessage: job.errorMessage,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export function toGenerationRequestWithSceneTitleDto(
  req: GenerationRequest,
  sceneTitle: string | null,
): GenerationRequestWithSceneTitleDto {
  return { ...toGenerationRequestDto(req), sceneTitle };
}

export function toGeneratedImageDto(img: GeneratedImage): GeneratedImageDto {
  return {
    id: img.id,
    projectId: img.projectId,
    storyboardId: img.storyboardId,
    sceneId: img.sceneId,
    generationRequestId: img.generationRequestId,
    storageKey: img.storageKey,
    mimeType: img.mimeType,
    size: img.size,
    width: img.width,
    height: img.height,
    checksum: img.checksum,
    adoptedAt: img.adoptedAt,
    createdAt: img.createdAt,
    updatedAt: img.updatedAt,
  };
}

export function toSemanticTargetSnapshotDto(
  snapshot: SemanticTargetSnapshot,
): SemanticTargetSnapshotDto {
  return {
    target: { ...snapshot.target },
    value: snapshot.value,
    revision: snapshot.revision,
  };
}

export function toCreativeDirectionDto(
  direction: CreativeDirection,
): CreativeDirectionDto {
  return {
    projectId: direction.projectId,
    projectName: direction.projectName,
    storyboardId: direction.storyboardId,
    fields: direction.fields.map(toSemanticTargetSnapshotDto),
  };
}

// Flattens provenance onto the DTO the way the other mappers flatten nested
// value objects, and keeps `before`/`after` as opaque JSON: their shape
// depends on which semantic field the item targets.
export function toChangeProposalDto(
  proposal: ChangeProposal,
): ChangeProposalDto {
  return {
    id: proposal.id,
    projectId: proposal.projectId,
    provider: proposal.provenance.provider,
    conversationId: proposal.provenance.conversationId,
    turnId: proposal.provenance.turnId,
    rationale: proposal.rationale,
    status: proposal.status,
    items: proposal.items.map((item) => ({
      id: item.id,
      target: { ...item.target },
      before: item.before,
      after: item.after,
      rationale: item.rationale,
      baseRevision: item.baseRevision,
      approval: item.approval,
    })),
    choices: proposal.choices.map((choice) => ({
      targetItemId: choice.targetItemId,
      options: choice.options.map((option) => ({
        id: option.id,
        label: option.label,
        value: option.value,
        reason: option.reason,
        impact: option.impact,
      })),
      selectedOptionId: choice.selectedOptionId,
    })),
    clientRequestId: proposal.clientRequestId,
    approvedBy: proposal.approvedBy,
    resolvedAt: proposal.resolvedAt,
    applyOutcome: proposal.applyOutcome,
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  };
}
