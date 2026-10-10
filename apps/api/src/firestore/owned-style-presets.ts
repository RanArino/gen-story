import type { Firestore } from "@google-cloud/firestore";
import type { StylePresetRepositoryPort } from "@gen-story/application";
import type { StylePreset } from "@gen-story/domain";
import { createFirestoreRepositories } from "./repositories";
import { MediaError } from "../photos/upload-session";

export function createOwnedStylePresetRepository(
  db: Firestore,
  userId: string,
): StylePresetRepositoryPort {
  const base = createFirestoreRepositories(db).stylePresets;
  async function visible(id: string) {
    const doc = await db.collection("style_presets").doc(id).get();
    return (
      doc.exists &&
      doc.data()?.deletedAt == null &&
      (doc.data()?.scope === "system" || doc.data()?.ownerUserId === userId)
    );
  }
  return {
    async findById(id) {
      return (await visible(id)) ? base.findById(id) : null;
    },
    async findAll() {
      const presets = await base.findAll();
      const permitted = await Promise.all(
        presets.map(async (preset) =>
          (await visible(preset.id)) ? preset : null,
        ),
      );
      return permitted.filter(
        (preset): preset is StylePreset => preset != null,
      );
    },
    async save(value) {
      await db.runTransaction(async (tx) => {
        const ref = db.collection("style_presets").doc(value.id);
        const [previous, user, guard] = await Promise.all([
          tx.get(ref),
          tx.get(db.collection("users").doc(userId)),
          tx.get(db.collection("account_deletion_guards").doc(userId)),
        ]);
        if (!user.exists || guard.exists || user.data()?.deletedAt != null)
          throw new MediaError("not_found");
        if (
          value.scope !== "user" ||
          (previous.exists && previous.data()?.ownerUserId !== userId)
        )
          throw new MediaError("not_found");
        tx.set(ref, {
          ...value,
          ownerUserId: userId,
          createdAt: previous.data()?.createdAt ?? value.createdAt,
          deletedAt: null,
        });
      });
    },
  };
}
