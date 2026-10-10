import { FirestoreMediaDeletionRepository } from "../firestore/media-deletion-repository";
import { toProjectDto } from "../http/dto-mappers";
import type { Project } from "@gen-story/domain";
import { randomUUID } from "node:crypto";
import type { AuthPrincipal } from "@gen-story/application";
import type { PersistedDeletionDispatch } from "../jobs/persisted-work";
import type { Firestore } from "@google-cloud/firestore";
import type { MediaVariant, UploadGrantRequestDto } from "@gen-story/shared";
import { requireMediaOwner } from "../firestore/media-ownership";
import {
  MediaError,
  type UploadSessionRepository,
} from "../photos/upload-session";
import { temporaryUploadKey, mediaPrefix } from "../storage/r2-storage-keys";
import type { R2UploadGrantService } from "../storage/r2-object-storage";
import { toPhotoAssetDto } from "../http/dto-mappers";

export class PrivateMediaService {
  readonly deletions: FirestoreMediaDeletionRepository;
  constructor(
    readonly db: Firestore,
    readonly sessions: UploadSessionRepository,
    readonly grants: R2UploadGrantService,
    readonly clock = () => new Date(),
    dispatch?: PersistedDeletionDispatch,
  ) {
    this.deletions = new FirestoreMediaDeletionRepository(db, dispatch, clock);
  }
  async issue(
    principal: AuthPrincipal,
    projectId: string,
    request: UploadGrantRequestDto,
  ) {
    assertIds(projectId);
    const now = this.clock();
    const id = randomUUID();
    const key = temporaryUploadKey(principal.user.id, projectId, id);
    // The URL is transient; persist only its policy and object identity.
    await this.sessions.issue({
      id,
      userId: principal.user.id,
      organizationId: principal.organization.id,
      projectId,
      photoAssetId: randomUUID(),
      name: request.name,
      mimeType: request.mimeType,
      size: request.size,
      sha256: request.sha256,
      notes: request.notes ?? null,
      usage: request.usage ?? "candidate",
      temporaryKey: key,
      expiresAt: new Date(now.getTime() + 600_000).toISOString(),
      createdAt: now.toISOString(),
      status: "issued",
      token: 0,
      executorId: null,
      leaseUntil: null,
      manifest: null,
      retiredManifests: [],
      failureCode: null,
    });
    const grant = await this.grants.issue({
      uploadId: id,
      key,
      mimeType: request.mimeType,
      sha256: request.sha256,
      issuedAt: now.toISOString(),
    });
    await this.sessions.status(principal.user.id, projectId, id);
    return grant;
  }
  async complete(
    principal: AuthPrincipal,
    projectId: string,
    uploadId: string,
  ) {
    assertIds(projectId, uploadId);
    await this.sessions.accept(
      principal.user.id,
      projectId,
      uploadId,
      this.clock().toISOString(),
    );
    return {
      uploadId,
      status: "processing" as const,
      failureCode: null,
      photo: null,
    };
  }
  async status(principal: AuthPrincipal, projectId: string, uploadId: string) {
    assertIds(projectId, uploadId);
    const { session, photo } = await this.sessions.status(
      principal.user.id,
      projectId,
      uploadId,
    );
    return {
      uploadId,
      status: session.status,
      failureCode: session.failureCode,
      photo: photo ? toPhotoAssetDto(photo) : null,
    };
  }
  async deleteProject(principal: AuthPrincipal, projectId: string) {
    assertIds(projectId);
    return this.deletions.schedule(
      { kind: "project", userId: principal.user.id, projectId },
      principal.organization.id,
      this.clock().toISOString(),
    );
  }
  async restoreProject(principal: AuthPrincipal, projectId: string) {
    assertIds(projectId);
    const snapshot = await this.db.collection("projects").doc(projectId).get();
    const project = snapshot.data();
    if (
      !project ||
      project.ownerUserId !== principal.user.id ||
      project.organizationId !== principal.organization.id ||
      typeof project.mediaDeletionId !== "string"
    )
      throw new MediaError("not_found");
    await this.deletions.restore(
      project.mediaDeletionId,
      principal.user.id,
      this.clock().toISOString(),
    );
    return toProjectDto((await snapshot.ref.get()).data() as Project);
  }
  async url(
    principal: AuthPrincipal,
    entity: "photo" | "generated" | "character-sheet",
    id: string,
    variant: MediaVariant,
  ) {
    assertIds(id);
    const access = await this.db.runTransaction(async (tx) => {
      const collection =
        entity === "photo"
          ? "photo_assets"
          : entity === "generated"
            ? "generated_images"
            : "ai_jobs";
      const data = (
        await tx.get(this.db.collection(collection).doc(id))
      ).data();
      if (
        !data ||
        data.deletedAt != null ||
        (entity === "character-sheet" &&
          (data.kind !== "character_sheet_generation" ||
            data.status !== "succeeded"))
      )
        throw new MediaError("not_found");
      let projectId = data.projectId as string | undefined;
      if (entity === "generated" && typeof data.sceneId !== "string")
        throw new MediaError("not_found");
      if (entity === "generated" && typeof data.sceneId === "string") {
        const scene = (
          await tx.get(this.db.collection("scenes").doc(data.sceneId))
        ).data();
        if (
          !scene ||
          scene.deletedAt != null ||
          (projectId && projectId !== scene.projectId)
        )
          throw new MediaError("not_found");
        projectId = scene.projectId as string | undefined;
      }
      if (entity === "character-sheet") {
        const storyboardId = data.inputJson?.storyboardId;
        if (typeof storyboardId !== "string") throw new MediaError("not_found");
        const board = (
          await tx.get(this.db.collection("storyboards").doc(storyboardId))
        ).data();
        if (!board || board.deletedAt != null || board.projectId !== projectId)
          throw new MediaError("not_found");
      }
      if (!projectId) throw new MediaError("not_found");
      await requireMediaOwner(
        this.db,
        tx,
        principal.user.id,
        projectId,
        principal.organization.id,
      );
      const asset =
        entity === "character-sheet"
          ? (data.resultJson as Record<string, unknown>)
          : data;
      if (!asset || typeof asset !== "object")
        throw new MediaError("not_found");
      const key =
        entity === "photo"
          ? variant === "original"
            ? asset.storageKey
            : variant === "preview"
              ? asset.previewStorageKey
              : asset.agentPreviewStorageKey
          : asset.storageKey;
      if (
        typeof key !== "string" ||
        !key.startsWith(mediaPrefix(principal.user.id, projectId))
      )
        throw new MediaError("not_found");
      return { key, name: typeof data.name === "string" ? data.name : "image" };
    });
    return this.grants.read(
      access.key,
      variant === "original" ? access.name : undefined,
    );
  }
}

function assertIds(...ids: string[]) {
  if (ids.some((id) => !/^[A-Za-z0-9_-]{1,200}$/.test(id)))
    throw new MediaError("not_found");
}
