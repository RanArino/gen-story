export const PREVIEW_640_PRESET = "preview_640";
export const AI_INPUT_PRESET = "ai-input";

export function buildOriginalPhotoStorageKey(input: {
  projectId: string;
  photoAssetId: string;
  extension: string;
}): string {
  return `data/uploads/originals/projects/${input.projectId}/${input.photoAssetId}.${normalizeExtension(input.extension)}`;
}

export function buildPhotoPreviewStorageKey(input: {
  projectId: string;
  photoAssetId: string;
}): string {
  return `data/uploads/previews/projects/${input.projectId}/${input.photoAssetId}_${PREVIEW_640_PRESET}.jpg`;
}

export function buildPhotoAiInputStorageKey(input: {
  projectId: string;
  photoAssetId: string;
}): string {
  return `data/uploads/previews/projects/${input.projectId}/${input.photoAssetId}_${AI_INPUT_PRESET}.jpg`;
}

export function buildGeneratedImageStorageKey(input: {
  projectId: string;
  sceneId: string;
  generatedImageId: string;
  extension: string;
}): string {
  return `data/uploads/generated/images/projects/${input.projectId}/scenes/${input.sceneId}/${input.generatedImageId}.${normalizeExtension(input.extension)}`;
}

export function buildCharacterSheetStorageKey(input: {
  projectId: string;
  storyboardId: string;
  jobId: string;
}): string {
  return `data/uploads/generated/character-sheets/projects/${input.projectId}/storyboards/${input.storyboardId}/${input.jobId}.png`;
}

function normalizeExtension(extension: string): string {
  const normalizedExtension = extension.trim().toLowerCase().replace(/^\./, "");

  if (normalizedExtension.length === 0 || normalizedExtension.includes("/")) {
    throw new Error("Storage key extension must be a file extension.");
  }

  return normalizedExtension === "jpeg" ? "jpg" : normalizedExtension;
}
