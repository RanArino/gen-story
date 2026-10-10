import { randomUUID } from "node:crypto";
import type { Firestore, Transaction } from "@google-cloud/firestore";
import {
  createPhotoAsset,
  createTemplateScene,
  type PhotoAsset,
  type Scene,
  type Storyboard,
} from "@gen-story/domain";
import {
  MediaError,
  type UploadClaim,
  type UploadManifest,
  type UploadSession,
  type UploadSessionRepository,
} from "../photos/upload-session";
import { requireMediaOwner } from "./media-ownership";

export class FirestoreUploadSessionRepository implements UploadSessionRepository {
  constructor(readonly db: Firestore) {}
  private ref(id: string) {
    return this.db.collection("upload_sessions").doc(id);
  }
  async find(id: string) {
    const s = await this.ref(id).get();
    return s.exists ? (s.data() as UploadSession) : null;
  }
  async issue(session: UploadSession) {
    await this.db.runTransaction(async (tx) => {
      await requireMediaOwner(
        this.db,
        tx,
        session.userId,
        session.projectId,
        session.organizationId,
      );
      tx.create(this.ref(session.id), session);
    });
  }
  async status(userId: string, projectId: string, uploadId: string) {
    return this.db.runTransaction(async (tx) => {
      await requireMediaOwner(this.db, tx, userId, projectId);
      const session = (await tx.get(this.ref(uploadId))).data() as
        | UploadSession
        | undefined;
      if (
        !session ||
        session.userId !== userId ||
        session.projectId !== projectId
      )
        throw new MediaError("not_found");
      const photo =
        session.status === "completed"
          ? ((
              await tx.get(
                this.db.collection("photo_assets").doc(session.photoAssetId),
              )
            ).data() as PhotoAsset | undefined)
          : null;
      return {
        session,
        photo: photo?.deletedAt == null ? (photo ?? null) : null,
      };
    });
  }
  async accept(
    userId: string,
    projectId: string,
    uploadId: string,
    now: string,
  ) {
    await this.db.runTransaction(async (tx) => {
      await requireMediaOwner(this.db, tx, userId, projectId);
      const session = (await tx.get(this.ref(uploadId))).data() as
        | UploadSession
        | undefined;
      if (
        !session ||
        session.userId !== userId ||
        session.projectId !== projectId
      )
        throw new MediaError("not_found");
      if (session.status !== "issued") throw new MediaError("conflict");
      if (session.expiresAt <= now)
        throw new MediaError("conflict", "Upload grant expired.");
      tx.update(this.ref(uploadId), { status: "processing" });
    });
  }
  async claim(
    uploadId: string,
    executorId: string,
    now: string,
  ): Promise<UploadClaim | null> {
    return this.db.runTransaction(async (tx) => {
      const session = (await tx.get(this.ref(uploadId))).data() as
        | UploadSession
        | undefined;
      if (!session || session.status !== "processing") return null;
      await requireMediaOwner(this.db, tx, session.userId, session.projectId);
      if (session.leaseUntil != null && session.leaseUntil > now) return null;
      const next: UploadSession = {
        ...session,
        token: session.token + 1,
        executorId,
        leaseUntil: new Date(Date.parse(now) + 60_000).toISOString(),
        manifest: null,
        retiredManifests: [
          ...session.retiredManifests,
          ...(session.manifest ? [session.manifest] : []),
        ],
      };
      tx.set(this.ref(uploadId), next);
      return { session: next, token: next.token, executorId };
    });
  }
  private async fenced(tx: Transaction, claim: UploadClaim, now?: string) {
    const session = (await tx.get(this.ref(claim.session.id))).data() as
      | UploadSession
      | undefined;
    if (
      !session ||
      session.status !== "processing" ||
      session.token !== claim.token ||
      session.executorId !== claim.executorId ||
      (now != null && (session.leaseUntil ?? "") <= now)
    )
      throw new MediaError("lost_claim");
    return session;
  }
  async writeIntent(claim: UploadClaim, manifest: UploadManifest, now: string) {
    await this.db.runTransaction(async (tx) => {
      const session = await this.fenced(tx, claim, now);
      await requireMediaOwner(this.db, tx, session.userId, session.projectId);
      tx.update(this.ref(session.id), {
        manifest,
        leaseUntil: new Date(Date.parse(now) + 60_000).toISOString(),
      });
    });
    claim.session.manifest = manifest;
  }
  async publish(
    claim: UploadClaim,
    input: { mimeType: string; width: number; height: number },
    now: string,
  ): Promise<PhotoAsset> {
    return this.db.runTransaction(async (tx) => {
      const session = await this.fenced(tx, claim, now);
      const project = await requireMediaOwner(
        this.db,
        tx,
        session.userId,
        session.projectId,
      );
      if (!session.manifest) throw new MediaError("lost_claim");
      const [photos, storyboards, scenes, reserved] = await Promise.all([
        tx.get(
          this.db
            .collection("photo_assets")
            .where("projectId", "==", session.projectId),
        ),
        tx.get(
          this.db
            .collection("storyboards")
            .where("projectId", "==", session.projectId),
        ),
        tx.get(
          this.db
            .collection("scenes")
            .where("projectId", "==", session.projectId),
        ),
        tx.get(this.db.collection("photo_assets").doc(session.photoAssetId)),
      ]);
      if (
        reserved.exists ||
        photos.docs.some((doc) => doc.data().checksum === session.sha256)
      )
        throw new MediaError(
          "conflict",
          "Photo asset already exists in this project.",
        );
      const activePhotos = photos.docs
        .map((doc) => doc.data() as PhotoAsset)
        .filter((p) => p.deletedAt == null);
      if (activePhotos.length >= 30)
        throw new MediaError("validation_error", "Photo limit reached.");
      const photo = createPhotoAsset({
        id: session.photoAssetId,
        projectId: session.projectId,
        name: session.name,
        storageKey: session.manifest.original,
        mimeType: input.mimeType,
        size: session.size,
        width: input.width,
        height: input.height,
        checksum: session.sha256,
        sourceKind: "upload",
        notes: session.notes,
        usage: session.usage,
        position:
          activePhotos.reduce((max, p) => Math.max(max, p.position), -1) + 1,
        createdAt: now,
        updatedAt: now,
      });
      const visiblePhotos = [...activePhotos, photo].sort(
        (a, b) => a.position - b.position,
      );
      const activeScenes = scenes.docs
        .filter((doc) => doc.data().deletedAt == null)
        .map((doc) => doc.data() as Scene);
      const writes: { scene: Scene; storyboard: string }[] = [];
      const updates: { storyboard: Storyboard; sceneIds: string[] }[] = [];
      for (const doc of storyboards.docs.filter(
        (doc) => doc.data().deletedAt == null,
      )) {
        const storyboard = doc.data() as Storyboard;
        const existing = activeScenes.filter(
          (s) => s.storyboardId === storyboard.id,
        );
        const primary = new Set(
          existing.flatMap((s) =>
            s.photoAssets
              .filter((p) => p.role === "primary")
              .map((p) => p.photoAssetId),
          ),
        );
        let index =
          existing.reduce((max, s) => Math.max(max, s.orderIndex), -1) + 1;
        const created = visiblePhotos
          .filter((p) => !primary.has(p.id))
          .map((p) =>
            createTemplateScene({
              id: randomUUID(),
              projectId: project.id,
              storyboardId: storyboard.id,
              photoAssetId: p.id,
              orderIndex: index++,
              createdAt: now,
              updatedAt: now,
            }),
          );
        writes.push(
          ...created.map((scene) => ({ scene, storyboard: storyboard.id })),
        );
        updates.push({
          storyboard,
          sceneIds: [...existing, ...created]
            .sort((a, b) => a.orderIndex - b.orderIndex)
            .map((s) => s.id),
        });
      }
      if (writes.length + updates.length > 450)
        throw new MediaError(
          "validation_error",
          "Publication exceeds transaction budget.",
        );
      tx.update(this.db.collection("projects").doc(project.id), {
        mediaRevision:
          (Number(
            (project as typeof project & { mediaRevision?: number })
              .mediaRevision,
          ) || 0) + 1,
      });
      tx.create(this.db.collection("photo_assets").doc(photo.id), {
        ...photo,
        previewStorageKey: session.manifest.preview,
        agentPreviewStorageKey: session.manifest.agentPreview,
      });
      for (const { scene } of writes)
        tx.create(this.db.collection("scenes").doc(scene.id), scene);
      for (const { storyboard, sceneIds } of updates)
        tx.update(this.db.collection("storyboards").doc(storyboard.id), {
          sceneIds,
          updatedAt: now,
        });
      tx.update(this.ref(session.id), {
        status: "completed",
        failureCode: null,
        leaseUntil: null,
      });
      return photo;
    });
  }
  async fail(claim: UploadClaim, code: string, now: string) {
    await this.db.runTransaction(async (tx) => {
      const session = await this.fenced(tx, claim, now);
      tx.update(this.ref(session.id), {
        status: "failed",
        failureCode: code,
        leaseUntil: null,
      });
    });
  }
  async release(claim: UploadClaim) {
    await this.db.runTransaction(async (tx) => {
      await this.fenced(tx, claim);
      tx.update(this.ref(claim.session.id), { leaseUntil: null });
    });
  }
}
