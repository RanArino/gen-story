import type {
  GeneratedImage,
  GenerationRequest,
  PhotoAsset,
  Project,
  Scene,
  Storyboard,
  StylePreset,
} from "@gen-story/domain";
import type {
  GeneratedImageDto,
  GenerationRequestDto,
  MeDto,
  PhotoAssetDto,
  ProjectDto,
  SceneDto,
  StylePresetDto,
  StoryboardDto,
} from "@gen-story/shared";

import type { AuthPrincipal } from "@gen-story/application";

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
    deletedAt: asset.deletedAt,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

export function toStoryboardDto(storyboard: Storyboard): StoryboardDto {
  return {
    id: storyboard.id,
    projectId: storyboard.projectId,
    status: storyboard.status,
    tone: storyboard.tone,
    stylePresetId: storyboard.stylePresetId,
    sceneIds: storyboard.sceneIds,
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
    title: scene.title,
    description: scene.description,
    imagePrompt: scene.imagePrompt,
    emotion: scene.emotion,
    cameraDirection: scene.cameraDirection,
    lightingDirection: scene.lightingDirection,
    motionDirection: scene.motionDirection,
    notes: scene.notes,
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
  return {
    id: preset.id,
    scope: preset.scope,
    name: preset.name,
    description: preset.description,
    prompt: preset.prompt,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
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
    startedAt: req.startedAt,
    completedAt: req.completedAt,
    createdAt: req.createdAt,
    updatedAt: req.updatedAt,
  };
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
