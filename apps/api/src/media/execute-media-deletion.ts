import type { FirestoreMediaDeletionRepository } from "../firestore/media-deletion-repository";
import type { PrivateMediaStorage } from "../storage/r2-object-storage";
import { mediaPrefix } from "../storage/r2-storage-keys";
import {
  documentPages,
  ownedInventory,
  ownedProjectIds,
  MANIFEST_PAGE_SIZE,
  type InventoryItem,
} from "./media-inventory";

class DeletionBudgetExceeded extends Error {}

export async function executeMediaDeletion(input: {
  deletionId: string;
  executorId: string;
  deletions: FirestoreMediaDeletionRepository;
  storage: PrivateMediaStorage;
  clock?: () => Date;
  budgetMs?: number;
}) {
  const clock = input.clock ?? (() => new Date());
  const deadline = clock().getTime() + (input.budgetMs ?? 240_000);
  const claim = await input.deletions.claim(
    input.deletionId,
    input.executorId,
    clock().toISOString(),
  );
  if (!claim)
    return input.deletions.unclaimedOutcome(
      input.deletionId,
      clock().toISOString(),
    );
  const beforeOperation = async () => {
    if (clock().getTime() >= deadline) throw new DeletionBudgetExceeded();
    await input.deletions.heartbeat(claim, clock().toISOString());
  };
  const db = input.deletions.db;
  const target = claim.deletion;
  try {
    const pages = db
      .collection("media_deletion_items")
      .where("deletionId", "==", target.id);
    const finalize = async () => {
      for await (const docs of documentPages(pages)) {
        await beforeOperation();
        await input.deletions.cleanupPages(
          claim,
          docs.map((doc) => doc.ref.path),
        );
      }
      await beforeOperation();
      await input.deletions.complete(claim);
    };
    if (target.finalizing) {
      await finalize();
      return { status: "completed" as const };
    }
    // Inventory is complete and durable before the first descendant is removed.
    if (!claim.deletion.manifestReady) {
      let items: InventoryItem[] = [];
      let page = 0;
      for await (const item of ownedInventory(db, target, target.id)) {
        if (clock().getTime() >= deadline) throw new DeletionBudgetExceeded();
        items.push(item);
        if (items.length === MANIFEST_PAGE_SIZE) {
          await input.deletions.savePage(claim, page++, items);
          items = [];
          await input.deletions.heartbeat(claim, clock().toISOString());
        }
      }
      if (items.length) await input.deletions.savePage(claim, page, items);
      await input.deletions.ready(claim);
    }
    const prefixes: string[] = [];
    // Account prefixes also cover writes belonging to already-removed projects.
    if (target.kind === "account")
      prefixes.push(
        `tmp/users/${target.userId}/`,
        `media/users/${target.userId}/`,
      );
    else
      for (const id of await ownedProjectIds(db, target))
        prefixes.push(
          mediaPrefix(target.userId, id, true),
          mediaPrefix(target.userId, id),
        );
    // Capture links before removing flat parents; retries also use these durable identities.
    const captured: InventoryItem[] = [];
    for await (const docs of documentPages(pages))
      for (const doc of docs)
        captured.push(...(doc.data().items as InventoryItem[]));
    for await (const docs of documentPages(pages))
      for (const doc of docs) {
        const keys = (doc.data().items as InventoryItem[]).flatMap(
          (item) => item.objectKeys,
        );
        for (
          let index = Number(doc.data().objectIndex ?? 0);
          index < keys.length;
          index++
        ) {
          const key = keys[index]!;
          if (!prefixes.some((prefix) => key.startsWith(prefix)))
            throw new Error("Deletion inventory contains a foreign object.");
          await beforeOperation();
          await input.storage.deleteObject(key);
          await input.deletions.objectProgress(claim, doc.ref.path, index + 1);
        }
      }
    // Drain the first page repeatedly: deleting objects cannot invalidate a saved R2 cursor.
    for (const prefix of prefixes) {
      while (true) {
        await beforeOperation();
        const page = await input.storage.list(prefix);
        if (!page.objects.length) break;
        for (const object of page.objects) {
          if (!object.key.startsWith(prefix))
            throw new Error("Foreign listed object.");
          await beforeOperation();
          await input.storage.deleteObject(object.key);
        }
      }
    }
    const parents: InventoryItem[] = [];
    for await (const docs of documentPages(pages))
      for (const doc of docs) {
        const items = doc.data().items as InventoryItem[];
        parents.push(...items.filter((item) => item.parent));
        if (!doc.data().done) {
          await beforeOperation();
          await input.deletions.removePage(
            claim,
            doc.ref.path,
            items.filter((item) => !item.parent),
          );
        }
      }
    // Validate every captured flat record and all object pages before parent removal.
    for await (const docs of documentPages(pages))
      for (const doc of docs) {
        const items = (doc.data().items as InventoryItem[]).filter(
          (item) => !item.parent,
        );
        if (
          items.length &&
          (await db.getAll(...items.map((item) => db.doc(item.path)))).some(
            (doc) => doc.exists,
          )
        )
          throw new Error("Descendants remain.");
      }
    // Capture late descendants before interruption so a retry can remove them.
    // Keep earlier pages: their hashed reservations may no longer be derivable.
    let nextPage = 0;
    for await (const docs of documentPages(pages))
      for (const doc of docs)
        nextPage = Math.max(nextPage, Number(doc.data().page) + 1);
    let late: InventoryItem[] = [];
    let foundLate = false;
    for await (const item of ownedInventory(db, target, target.id, captured))
      if (!item.parent) {
        foundLate = true;
        late.push(item);
        if (late.length === MANIFEST_PAGE_SIZE) {
          await input.deletions.savePage(claim, nextPage++, late);
          late = [];
        }
      }
    if (late.length) await input.deletions.savePage(claim, nextPage, late);
    if (foundLate) throw new Error("Concurrent descendant writes remain.");
    for (const prefix of prefixes)
      if ((await input.storage.list(prefix)).objects.length)
        throw new Error("Concurrent media writes remain.");
    for (let index = 0; index < parents.length; index += MANIFEST_PAGE_SIZE) {
      await beforeOperation();
      const batch = parents.slice(index, index + MANIFEST_PAGE_SIZE);
      await input.deletions.removeParents(claim, batch);
    }
    // The durable phase marker makes interrupted cleanup safe after parent removal.
    await beforeOperation();
    await input.deletions.beginFinalization(claim);
    await finalize();
    return { status: "completed" as const };
  } catch (error) {
    const latest = await input.deletions.find(target.id);
    if (latest?.state === "completed") return { status: "completed" as const };
    try {
      await input.deletions.release(claim);
    } catch (releaseError) {
      if (
        !(
          releaseError instanceof Error &&
          "code" in releaseError &&
          releaseError.code === "lost_claim"
        )
      )
        throw releaseError;
    }
    if (error instanceof DeletionBudgetExceeded)
      return { status: "deferred" as const, reason: "execution_budget" };
    throw new Error("Media deletion interrupted; retry persisted work.");
  }
}
