import type { PhotoAsset, PhotoUsage } from "@gen-story/domain";
import type { UploadSessionState } from "@gen-story/shared";

export type UploadManifest = {
  original: string;
  preview: string;
  agentPreview: string;
};
export type UploadSession = {
  id: string;
  userId: string;
  organizationId: string;
  projectId: string;
  photoAssetId: string;
  name: string;
  mimeType: string;
  size: number;
  sha256: string;
  notes: string | null;
  usage: PhotoUsage;
  temporaryKey: string;
  expiresAt: string;
  createdAt: string;
  status: UploadSessionState;
  failureCode: string | null;
  token: number;
  executorId: string | null;
  leaseUntil: string | null;
  manifest: UploadManifest | null;
  retiredManifests: UploadManifest[];
};
export type UploadClaim = {
  session: UploadSession;
  token: number;
  executorId: string;
};
export class MediaError extends Error {
  constructor(
    readonly code: "not_found" | "conflict" | "validation_error" | "lost_claim",
    message = code === "not_found" ? "Not found." : "Media operation rejected.",
  ) {
    super(message);
  }
}
export interface UploadSessionRepository {
  issue(session: UploadSession): Promise<void>;
  status(
    userId: string,
    projectId: string,
    uploadId: string,
  ): Promise<{ session: UploadSession; photo: PhotoAsset | null }>;
  accept(
    userId: string,
    projectId: string,
    uploadId: string,
    now: string,
  ): Promise<void>;
  claim(
    uploadId: string,
    executorId: string,
    now: string,
  ): Promise<UploadClaim | null>;
  writeIntent(
    claim: UploadClaim,
    manifest: UploadManifest,
    now: string,
  ): Promise<void>;
  publish(
    claim: UploadClaim,
    input: { mimeType: string; width: number; height: number },
    now: string,
  ): Promise<PhotoAsset>;
  fail(claim: UploadClaim, code: string, now: string): Promise<void>;
  release(claim: UploadClaim): Promise<void>;
  find(uploadId: string): Promise<UploadSession | null>;
}
