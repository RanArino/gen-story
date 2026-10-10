import { randomUUID } from "node:crypto";
import type { PersistedDeletionDispatch } from "../jobs/persisted-work";
import type { Firestore, Transaction } from "@google-cloud/firestore";
import { MediaError } from "../photos/upload-session";
import { requireMediaOwner } from "./media-ownership";
import {
  documentPages,
  ownedProjectIds,
  type DeletionTarget,
  type InventoryItem,
} from "../media/media-inventory";

export const MEDIA_RECOVERY_MS = 7 * 24 * 60 * 60 * 1000;
export type MediaDeletion = DeletionTarget & {
  id: string;
  state: "recoverable" | "purging" | "completed" | "canceled";
  notBefore: string;
  createdAt: string;
  token: number;
  executorId: string | null;
  leaseUntil: string | null;
  manifestReady: boolean;
  failureCode: string | null;
  finalizing?: boolean;
  dispatch?: {
    generation: number;
    state: "pending" | "enqueued" | "exhausted";
    taskName: string | null;
    leaseUntil: string | null;
    token: number;
    enqueuedAt: string | null;
  };
  lastAttemptAt?: string;
  attemptCount?: number;
};
export type DeletionClaim = {
  deletion: MediaDeletion;
  token: number;
  executorId: string;
};

export class FirestoreMediaDeletionRepository {
  constructor(
    readonly db: Firestore,
    private readonly dispatch?: PersistedDeletionDispatch,
    private readonly clock = () => new Date(),
  ) {}
  private lock(userId: string) {
    return this.db.collection("media_deletion_locks").doc(userId);
  }
  private ref(id: string) {
    return this.db.collection("media_deletions").doc(id);
  }
  async find(id: string) {
    const snapshot = await this.ref(id).get();
    return snapshot.exists ? (snapshot.data() as MediaDeletion) : null;
  }
  async schedule(target: DeletionTarget, organizationId: string, now: string) {
    const record: MediaDeletion = {
      ...target,
      id: randomUUID(),
      state: "recoverable",
      notBefore: new Date(Date.parse(now) + MEDIA_RECOVERY_MS).toISOString(),
      createdAt: now,
      token: 0,
      executorId: null,
      leaseUntil: null,
      manifestReady: false,
      failureCode: null,
      dispatch: {
        generation: 0,
        state: "pending",
        taskName: null,
        leaseUntil: null,
        token: 0,
        enqueuedAt: null,
      },
    };
    const saved = await this.db.runTransaction(async (tx) => {
      if (target.kind === "project") {
        await requireMediaOwner(
          this.db,
          tx,
          target.userId,
          target.projectId!,
          organizationId,
        );
        tx.update(this.db.collection("projects").doc(target.projectId!), {
          deletedAt: now,
          updatedAt: now,
          mediaDeletionId: record.id,
        });
      } else {
        const [user, guard] = await Promise.all([
          tx.get(this.db.collection("users").doc(target.userId)),
          tx.get(
            this.db.collection("account_deletion_guards").doc(target.userId),
          ),
        ]);
        if (!user.exists || user.data()?.organizationId !== organizationId)
          throw new MediaError("not_found");
        if (guard.exists) throw new MediaError("conflict");
        tx.create(
          this.db.collection("account_deletion_guards").doc(target.userId),
          { deletionId: record.id, state: "recoverable" },
        );
      }
      tx.create(this.ref(record.id), record);
      return record;
    });
    // The persisted intent remains repairable even when enqueue or its response fails.
    if (this.dispatch) {
      try {
        await this.dispatch.dispatch({
          workType: "media_deletion",
          workId: saved.id,
          notBefore: saved.notBefore,
          generation: 0,
        });
      } catch {
        /* The authenticated repair sweep owns delivery recovery. */
      }
    }
    return saved;
  }
  async restore(id: string, userId: string, now: string) {
    await this.db.runTransaction(async (tx) => {
      const record = (await tx.get(this.ref(id))).data() as
        | MediaDeletion
        | undefined;
      if (!record || record.userId !== userId)
        throw new MediaError("not_found");
      if (record.state !== "recoverable" || now >= record.notBefore)
        throw new MediaError("conflict");
      if (record.kind === "project") {
        const ref = this.db.collection("projects").doc(record.projectId!);
        const project = await tx.get(ref);
        if (
          !project.exists ||
          project.data()?.ownerUserId !== userId ||
          project.data()?.mediaDeletionId !== id
        )
          throw new MediaError("not_found");
        tx.update(ref, {
          deletedAt: null,
          updatedAt: now,
          mediaDeletionId: null,
        });
      } else {
        const guard = this.db.collection("account_deletion_guards").doc(userId);
        const snapshot = await tx.get(guard);
        if (snapshot.data()?.deletionId !== id)
          throw new MediaError("conflict");
        tx.delete(guard);
      }
      tx.update(this.ref(id), { state: "canceled" });
    });
  }
  async claim(
    id: string,
    executorId: string,
    now: string,
  ): Promise<DeletionClaim | null> {
    const record = await this.find(id);
    if (
      !record ||
      record.state === "canceled" ||
      record.state === "completed" ||
      record.notBefore > now
    )
      return null;
    const projectIds = await ownedProjectIds(this.db, record);
    // Irreversible claim is delayed until all issued uploads and live processing leases settle.
    // Existing unfenced generation executors must finish before M4 deletion; M5 supplies their claims.
    for (const projectId of projectIds) {
      for (const collection of [
        "upload_sessions",
        "ai_jobs",
        "generation_requests",
      ]) {
        for await (const docs of documentPages(
          this.db.collection(collection).where("projectId", "==", projectId),
        )) {
          if (
            docs.some((doc) =>
              collection === "upload_sessions"
                ? doc.data().expiresAt > now ||
                  (doc.data().leaseUntil != null &&
                    Date.parse(doc.data().leaseUntil) + 60_000 >
                      Date.parse(now))
                : doc.data().status === "running",
            )
          )
            return null;
        }
      }
    }
    return this.db.runTransaction(async (tx) => {
      const latest = (await tx.get(this.ref(id))).data() as
        | MediaDeletion
        | undefined;
      if (
        !latest ||
        !["recoverable", "purging"].includes(latest.state) ||
        latest.notBefore > now ||
        (latest.leaseUntil != null && latest.leaseUntil > now)
      )
        return null;
      const lock = await tx.get(this.lock(latest.userId));
      if (lock.exists && lock.data()?.leaseUntil > now) return null;
      if (latest.kind === "project") {
        const project = await tx.get(
          this.db.collection("projects").doc(latest.projectId!),
        );
        if (
          latest.state === "recoverable" &&
          (project.data()?.mediaDeletionId !== id ||
            project.data()?.deletedAt == null)
        )
          return null;
      } else {
        const guard = await tx.get(
          this.db.collection("account_deletion_guards").doc(latest.userId),
        );
        if (guard.data()?.deletionId !== id) return null;
      }
      const claimed: MediaDeletion = {
        ...latest,
        state: "purging",
        token: latest.token + 1,
        executorId,
        leaseUntil: new Date(Date.parse(now) + 60_000).toISOString(),
        failureCode: null,
        lastAttemptAt: now,
        attemptCount: (latest.attemptCount ?? 0) + 1,
      };
      tx.set(this.lock(latest.userId), {
        deletionId: id,
        token: claimed.token,
        executorId,
        leaseUntil: claimed.leaseUntil,
      });
      tx.set(this.ref(id), claimed);
      if (latest.kind === "account")
        tx.update(
          this.db.collection("account_deletion_guards").doc(latest.userId),
          { state: "purging" },
        );
      return { deletion: claimed, token: claimed.token, executorId };
    });
  }
  async fenced(tx: Transaction, claim: DeletionClaim) {
    const [record, lock] = await Promise.all([
      tx.get(this.ref(claim.deletion.id)),
      tx.get(this.lock(claim.deletion.userId)),
    ]);
    const current = record.data() as MediaDeletion | undefined;
    if (
      !current ||
      current.state !== "purging" ||
      current.token !== claim.token ||
      current.executorId !== claim.executorId ||
      (current.leaseUntil ?? "") <= this.clock().toISOString() ||
      lock.data()?.deletionId !== current.id ||
      lock.data()?.token !== claim.token ||
      lock.data()?.executorId !== claim.executorId
    )
      throw new MediaError("lost_claim");
    return current;
  }
  async heartbeat(claim: DeletionClaim, now: string) {
    await this.db.runTransaction(async (tx) => {
      await this.fenced(tx, claim);
      tx.update(this.ref(claim.deletion.id), {
        leaseUntil: new Date(Date.parse(now) + 60_000).toISOString(),
      });
      tx.update(this.lock(claim.deletion.userId), {
        leaseUntil: new Date(Date.parse(now) + 60_000).toISOString(),
      });
    });
  }
  async savePage(claim: DeletionClaim, page: number, items: InventoryItem[]) {
    await this.db.runTransaction(async (tx) => {
      await this.fenced(tx, claim);
      tx.set(
        this.db
          .collection("media_deletion_items")
          .doc(`${claim.deletion.id}-${String(page).padStart(10, "0")}`),
        {
          deletionId: claim.deletion.id,
          page,
          items,
          done: false,
          objectIndex: 0,
        },
      );
    });
  }
  async ready(claim: DeletionClaim) {
    await this.db.runTransaction(async (tx) => {
      await this.fenced(tx, claim);
      tx.update(this.ref(claim.deletion.id), { manifestReady: true });
    });
  }
  async removePage(claim: DeletionClaim, path: string, items: InventoryItem[]) {
    await this.db.runTransaction(async (tx) => {
      await this.fenced(tx, claim);
      for (const item of items) tx.delete(this.db.doc(item.path));
      tx.update(this.db.doc(path), { done: true });
    });
  }
  async complete(claim: DeletionClaim) {
    await this.db.runTransaction(async (tx) => {
      await this.fenced(tx, claim);
      tx.update(this.ref(claim.deletion.id), {
        state: "completed",
        leaseUntil: null,
        completedAt: this.clock().toISOString(),
      });
      tx.delete(this.lock(claim.deletion.userId));
      if (claim.deletion.kind === "account")
        tx.set(
          this.db
            .collection("account_deletion_guards")
            .doc(claim.deletion.userId),
          { state: "purged" },
        );
    });
  }
  async release(claim: DeletionClaim) {
    await this.db.runTransaction(async (tx) => {
      await this.fenced(tx, claim);
      tx.update(this.ref(claim.deletion.id), {
        leaseUntil: null,
        failureCode: "interrupted",
      });
      tx.delete(this.lock(claim.deletion.userId));
    });
  }
  async unclaimedOutcome(id: string, now: string) {
    const record = await this.find(id);
    if (!record) return { status: "missing" as const };
    if (record.state === "completed" || record.state === "canceled")
      return { status: record.state };
    if (record.notBefore > now)
      return { status: "deferred" as const, reason: "recovery" };
    const lock = await this.lock(record.userId).get();
    if ((record.leaseUntil ?? "") > now || lock.data()?.leaseUntil > now)
      return { status: "busy" as const, reason: "active_lease" };
    return { status: "deferred" as const, reason: "settlement" };
  }
  async objectProgress(
    claim: DeletionClaim,
    path: string,
    objectIndex: number,
  ) {
    await this.db.runTransaction(async (tx) => {
      await this.fenced(tx, claim);
      tx.update(this.db.doc(path), { objectIndex });
    });
  }
  async beginFinalization(claim: DeletionClaim) {
    await this.db.runTransaction(async (tx) => {
      await this.fenced(tx, claim);
      tx.update(this.ref(claim.deletion.id), { finalizing: true });
    });
  }
  async cleanupPages(claim: DeletionClaim, paths: string[]) {
    await this.db.runTransaction(async (tx) => {
      await this.fenced(tx, claim);
      for (const path of paths) tx.delete(this.db.doc(path));
    });
  }
  async removeParents(claim: DeletionClaim, items: InventoryItem[]) {
    await this.db.runTransaction(async (tx) => {
      await this.fenced(tx, claim);
      for (const item of items) tx.delete(this.db.doc(item.path));
    });
  }
}
