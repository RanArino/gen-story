import type { Firestore, Transaction } from "@google-cloud/firestore";
import { MediaError } from "../photos/upload-session";

// Re-read deletion authority in the same transaction as every application write.
export async function guardDeletionWrite(
  db: Firestore,
  tx: Transaction,
  collection: string,
  value: Record<string, unknown>,
  previous?: Record<string, unknown>,
  restoring = false,
) {
  if (collection === "organizations" || collection === "style_presets") return;
  if (collection === "projects" && typeof value.ownerUserId === "string") {
    const [user, guard] = await Promise.all([
      tx.get(db.collection("users").doc(value.ownerUserId)),
      tx.get(db.collection("account_deletion_guards").doc(value.ownerUserId)),
    ]);
    if (!user.exists || guard.exists || user.data()?.deletedAt != null)
      throw new MediaError("not_found");
  }
  if (collection === "users" || collection === "user_preferences") {
    const userId = String(collection === "users" ? value.id : value.userId);
    const [user, guard] = await Promise.all([
      tx.get(db.collection("users").doc(userId)),
      tx.get(db.collection("account_deletion_guards").doc(userId)),
    ]);
    if (
      guard.exists ||
      user.data()?.deletedAt != null ||
      (collection !== "users" && !user.exists)
    )
      throw new MediaError("not_found");
    return;
  }
  for (const data of [previous, value]) {
    if (!data) continue;
    let projectId =
      collection === "projects" ? String(data.id) : data.projectId;
    if (typeof projectId !== "string") {
      const [parentCollection, field] =
        typeof data.conversationId === "string"
          ? ["agent_conversations", "conversationId"]
          : typeof data.storyboardId === "string"
            ? ["storyboards", "storyboardId"]
            : ["scenes", "sceneId"];
      if (typeof data[field!] !== "string") throw new MediaError("not_found");
      const parent = await tx.get(
        db.collection(parentCollection!).doc(data[field!] as string),
      );
      if (!parent.exists) throw new MediaError("not_found");
      projectId = parent.data()?.projectId;
    }
    if (typeof projectId !== "string") throw new MediaError("not_found");
    const project = await tx.get(db.collection("projects").doc(projectId));
    const root = project.exists
      ? project.data()!
      : collection === "projects" && !previous
        ? value
        : null;
    if (!root || typeof root.ownerUserId !== "string")
      throw new MediaError("not_found");
    const [user, guard] = await Promise.all([
      tx.get(db.collection("users").doc(root.ownerUserId)),
      tx.get(db.collection("account_deletion_guards").doc(root.ownerUserId)),
    ]);
    const settling =
      ["ai_jobs", "generation_requests"].includes(collection) &&
      previous?.status === "running" &&
      ["succeeded", "failed", "canceled"].includes(String(value.status));
    const canSettle =
      settling && (!guard.exists || guard.data()?.state === "recoverable");
    if (
      !user.exists ||
      user.data()?.deletedAt != null ||
      (guard.exists && !canSettle) ||
      (root.deletedAt != null &&
        !canSettle &&
        !(
          restoring &&
          collection === "projects" &&
          root.mediaDeletionId == null
        )) ||
      (root.mediaDeletionId != null && !canSettle)
    )
      throw new MediaError("not_found");
  }
}
