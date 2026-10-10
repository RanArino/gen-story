import type {
  MediaUrlDto,
  MediaVariant,
  PhotoAssetDto,
  UploadGrantDto,
  UploadGrantRequestDto,
  UploadSessionDto,
} from "@gen-story/shared";

export type UploadPhase = "uploading" | "processing" | "succeeded" | "failed";
export type MediaEntity =
  | "photo-assets"
  | "generated-images"
  | "character-sheets";
export type JsonRequest = <T>(
  method: string,
  path: string,
  body?: unknown,
) => Promise<T>;
const urls = new Map<string, MediaUrlDto>();
const pending = new Map<string, Promise<MediaUrlDto>>();
const listeners = new Set<() => void>();
let account: string | null = null;
let epoch = 0;
export function setMediaAccount(id: string | null) {
  if (account === id) return;
  account = id;
  epoch++;
  urls.clear();
  pending.clear();
  listeners.forEach((listener) => listener());
}
export function clearMediaUrls() {
  account = null;
  epoch++;
  urls.clear();
  pending.clear();
  listeners.forEach((listener) => listener());
}
export function subscribeMediaUrls(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function mediaCacheEpoch() {
  return epoch;
}
export async function resolveMediaUrl(
  request: JsonRequest,
  entity: MediaEntity,
  id: string,
  variant: MediaVariant,
  fresh = false,
): Promise<MediaUrlDto> {
  const key = `${entity}/${id}/${variant}`;
  const cached = urls.get(key);
  if (!fresh && cached && Date.parse(cached.expiresAt) > Date.now() + 30_000)
    return cached;
  if (!fresh && pending.has(key)) return pending.get(key)!;
  const started = epoch;
  const promise = request<MediaUrlDto>(
    "GET",
    `/api/${entity}/${encodeURIComponent(id)}/media-url?variant=${variant}`,
  ).then((result) => {
    if (started !== epoch) throw new Error("Media account changed.");
    urls.set(key, result);
    return result;
  });
  pending.set(key, promise);
  try {
    return await promise;
  } finally {
    if (pending.get(key) === promise) pending.delete(key);
  }
}
export async function uploadPrivatePhoto(
  request: JsonRequest,
  projectId: string,
  file: File,
  notes: string | undefined,
  onPhase?: (phase: UploadPhase) => void,
): Promise<PhotoAssetDto> {
  const started = epoch;
  const checkAccount = () => {
    if (started !== epoch) throw new Error("Media account changed.");
  };
  onPhase?.("uploading");
  try {
    if (file.size < 1 || file.size > 10 * 1024 * 1024)
      throw new Error("Photos must be between 1 byte and 10 MiB.");
    const bytes = await file.arrayBuffer();
    const sha256 = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    ]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    checkAccount();
    const fallback = /\.hei[cf]$/i.test(file.name)
      ? file.name.toLowerCase().endsWith(".heif")
        ? "image/heif"
        : "image/heic"
      : "image/jpeg";
    const mimeType = (
      file.type === "image/jpg" ? "image/jpeg" : file.type || fallback
    ) as UploadGrantRequestDto["mimeType"];
    const grant = await request<UploadGrantDto>(
      "POST",
      `/api/projects/${encodeURIComponent(projectId)}/upload-grants`,
      {
        name: file.name,
        mimeType,
        size: file.size,
        sha256,
        notes: notes ?? null,
      },
    );
    checkAccount();
    const response = await fetch(grant.url, {
      method: grant.method,
      headers: grant.headers,
      body: file,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error("Photo upload failed.");
    checkAccount();
    onPhase?.("processing");
    const path = `/api/projects/${encodeURIComponent(projectId)}/upload-sessions/${encodeURIComponent(grant.uploadId)}`;
    try {
      await request<UploadSessionDto>("POST", `${path}/complete`);
    } catch (error) {
      // Completion is deliberately not repeated after an uncertain response.
      if (
        error != null &&
        typeof error === "object" &&
        "status" in error &&
        typeof error.status === "number" &&
        error.status > 0 &&
        error.status < 500
      )
        throw error;
    }
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      checkAccount();
      const status = await request<UploadSessionDto>("GET", path);
      checkAccount();
      if (status.status === "completed" && status.photo) {
        onPhase?.("succeeded");
        return status.photo;
      }
      if (
        status.status === "failed" ||
        status.status === "expired" ||
        status.status === "issued"
      )
        throw new Error(
          status.failureCode === "duplicate_source"
            ? "This photo already exists in the project."
            : "Photo processing failed.",
        );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("Photo is still processing. Refresh the photo list later.");
  } catch (error) {
    onPhase?.("failed");
    throw error;
  }
}
