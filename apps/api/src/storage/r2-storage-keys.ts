export function mediaPrefix(
  userId: string,
  projectId: string,
  temporary = false,
): string {
  return `${temporary ? "tmp" : "media"}/users/${segment(userId)}/projects/${segment(projectId)}/`;
}
export function temporaryUploadKey(
  userId: string,
  projectId: string,
  uploadId: string,
): string {
  return `${mediaPrefix(userId, projectId, true)}uploads/${segment(uploadId)}`;
}
export function uploadManifest(
  userId: string,
  projectId: string,
  uploadId: string,
  attempt: number,
  extension: string,
) {
  const prefix = `${mediaPrefix(userId, projectId)}uploads/${segment(uploadId)}/attempt-${attempt}/`;
  return {
    original: `${prefix}original.${segment(extension)}`,
    preview: `${prefix}preview.jpg`,
    agentPreview: `${prefix}agent-preview.jpg`,
  };
}
function segment(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error("Invalid media identifier.");
  return value;
}
