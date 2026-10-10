import type { Firestore } from "@google-cloud/firestore";
import type {
  PersistedDeletionDispatch,
  PersistedDeletionWork,
} from "../jobs/persisted-work";
import type { DeletionTaskQueue } from "../jobs/cloud-tasks-dispatch";
import { documentPages } from "../media/media-inventory";
import type { MediaDeletion } from "./media-deletion-repository";

type DispatchState = NonNullable<MediaDeletion["dispatch"]>;
const initial = (): DispatchState => ({
  generation: 0,
  state: "pending",
  taskName: null,
  token: 0,
  leaseUntil: null,
  enqueuedAt: null,
});

export class FirestoreDeletionDispatch implements PersistedDeletionDispatch {
  constructor(
    readonly db: Firestore,
    private readonly queue: DeletionTaskQueue,
    private readonly clock = () => new Date(),
  ) {}
  async dispatch(work: PersistedDeletionWork) {
    await this.dispatchOne(work.workId);
  }
  async repair() {
    const deadline = this.clock().getTime() + 240_000;
    let examined = 0;
    let failed = 0;
    for (const state of ["recoverable", "purging"]) {
      for await (const docs of documentPages(
        this.db.collection("media_deletions").where("state", "==", state),
      )) {
        for (const doc of docs) {
          if (this.clock().getTime() >= deadline)
            return { examined, failed, yielded: true };
          try {
            await this.dispatchOne(doc.id);
          } catch {
            failed++;
          }
          examined++;
        }
      }
    }
    return { examined, failed, yielded: false };
  }
  async retryExhausted(id: string) {
    const ref = this.db.collection("media_deletions").doc(id);
    await this.db.runTransaction(async (tx) => {
      const record = (await tx.get(ref)).data() as MediaDeletion | undefined;
      if (
        !record ||
        !["recoverable", "purging"].includes(record.state) ||
        record.dispatch?.state !== "exhausted"
      )
        throw new Error("Deletion is not exhausted persisted work.");
      const generation = record.dispatch.generation + 1;
      tx.update(ref, {
        dispatch: {
          ...initial(),
          generation,
          token: record.dispatch.token + 1,
        },
        repairBaseGeneration: generation,
        failureCode: null,
      });
    });
    await this.dispatchOne(id);
  }
  private async dispatchOne(id: string) {
    const ref = this.db.collection("media_deletions").doc(id);
    const now = this.clock().toISOString();
    const claim = await this.db.runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      const record = snapshot.data() as
        | (MediaDeletion & { repairBaseGeneration?: number })
        | undefined;
      if (!record || !["recoverable", "purging"].includes(record.state))
        return null;
      const dispatch = record.dispatch ?? initial();
      if (
        dispatch.state === "exhausted" ||
        (dispatch.leaseUntil ?? "") > now ||
        (record.leaseUntil ?? "") > now
      )
        return null;
      const next = {
        ...dispatch,
        token: dispatch.token + 1,
        leaseUntil: new Date(Date.parse(now) + 60_000).toISOString(),
      };
      tx.update(ref, { dispatch: next });
      return { record, dispatch: next, base: record.repairBaseGeneration ?? 0 };
    });
    if (!claim) return;
    let dispatch = claim.dispatch;
    const finish = async (failureCode: string | null = null) => {
      await this.db.runTransaction(async (tx) => {
        const record = (await tx.get(ref)).data() as MediaDeletion | undefined;
        if (
          !record ||
          record.dispatch?.token !== claim.dispatch.token ||
          !["recoverable", "purging"].includes(record.state)
        )
          return;
        tx.update(ref, {
          dispatch: { ...dispatch, leaseUntil: null },
          ...(failureCode ? { failureCode } : {}),
        });
      });
    };
    try {
      if (dispatch.taskName && (await this.queue.exists(dispatch.taskName))) {
        dispatch = { ...dispatch, state: "enqueued" };
        await finish();
        return;
      }
      if (dispatch.state === "enqueued")
        dispatch = {
          ...dispatch,
          generation: dispatch.generation + 1,
          state: "pending",
          taskName: null,
        };
      if (dispatch.generation - claim.base >= 3) {
        dispatch = { ...dispatch, state: "exhausted" };
        await finish("dispatch_exhausted");
        return;
      }
      const work: PersistedDeletionWork = {
        workType: "media_deletion",
        workId: id,
        generation: dispatch.generation,
        notBefore: claim.record.notBefore > now ? claim.record.notBefore : now,
      };
      dispatch = { ...dispatch, taskName: this.queue.taskName(work) };
      await this.queue.dispatch(work);
      if (await this.queue.exists(dispatch.taskName!)) {
        dispatch = { ...dispatch, state: "enqueued", enqueuedAt: now };
      } else {
        // A completed task name may remain reserved; use a new generation next sweep.
        dispatch = {
          ...dispatch,
          state: "pending",
          generation: dispatch.generation + 1,
          taskName: null,
        };
      }
      await finish();
    } catch {
      await finish("dispatch_interrupted");
      throw new Error("Deletion dispatch interrupted.");
    }
  }
}
