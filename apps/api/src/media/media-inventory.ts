import { createHash } from "node:crypto";
import {
  FieldPath,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
} from "@google-cloud/firestore";

export const ENTITY_COLLECTIONS = [
  "organizations",
  "users",
  "projects",
  "photo_assets",
  "storyboards",
  "scenes",
  "style_presets",
  "generation_requests",
  "ai_jobs",
  "generated_images",
  "project_photo_analyses",
  "change_proposals",
  "agent_conversations",
  "agent_provider_bindings",
  "agent_conversation_turns",
  "agent_conversation_messages",
  "test_generation_batches",
  "user_preferences",
] as const;
export const AUXILIARY_COLLECTIONS = [
  "change_proposal_request_keys",
  "agent_turn_request_keys",
  "agent_message_sequence_keys",
  "agent_conversation_counters",
] as const;
export const MEDIA_COLLECTIONS = [
  "upload_sessions",
  "media_deletions",
  "media_deletion_items",
  "account_deletion_guards",
  "media_deletion_locks",
] as const;
export type DeletionTarget = {
  kind: "project" | "account";
  userId: string;
  projectId: string | null;
};
export type InventoryItem = {
  path: string;
  objectKeys: string[];
  parent: boolean;
  projectId?: string;
};
export const MANIFEST_PAGE_SIZE = 100;

export async function* documentPages(
  query: Query,
): AsyncGenerator<QueryDocumentSnapshot[]> {
  let cursor: QueryDocumentSnapshot | undefined;
  while (true) {
    const ordered = query
      .orderBy(FieldPath.documentId())
      .limit(MANIFEST_PAGE_SIZE);
    const snapshot = await (
      cursor ? ordered.startAfter(cursor) : ordered
    ).get();
    if (snapshot.empty) return;
    yield snapshot.docs;
    cursor = snapshot.docs.at(-1);
  }
}
export async function ownedProjectIds(
  db: Firestore,
  target: DeletionTarget,
): Promise<string[]> {
  if (target.kind === "project") return [target.projectId!];
  const ids: string[] = [];
  for await (const docs of documentPages(
    db.collection("projects").where("ownerUserId", "==", target.userId),
  ))
    ids.push(...docs.map((doc) => doc.id));
  return ids;
}

// Auxiliary hashes must be captured while their parent fields still exist.
export async function* ownedInventory(
  db: Firestore,
  target: DeletionTarget,
  activeDeletionId?: string,
  captured: InventoryItem[] = [],
): AsyncGenerator<InventoryItem> {
  const projectIds = [
    ...new Set([
      ...(await ownedProjectIds(db, target)),
      ...captured.flatMap((item) =>
        item.path.startsWith("projects/")
          ? [item.path.slice("projects/".length)]
          : item.projectId
            ? [item.projectId]
            : [],
      ),
    ]),
  ];
  const seen = new Set<string>();
  let inventoryProjectId: string | undefined;
  const item = (
    path: string,
    data: Record<string, unknown> = {},
    parent = false,
  ): InventoryItem | null => {
    if (seen.has(path)) return null;
    seen.add(path);
    return {
      path,
      objectKeys: storageKeys(data),
      parent,
      ...(inventoryProjectId ? { projectId: inventoryProjectId } : {}),
    };
  };
  for (const projectId of projectIds) {
    inventoryProjectId = projectId;
    const capturedIds = (collection: string) =>
      captured
        .filter(
          (item) =>
            (item.projectId === projectId ||
              (!item.projectId && projectIds.length === 1)) &&
            item.path.startsWith(`${collection}/`),
        )
        .map((item) => item.path.slice(collection.length + 1));
    const boards = new Set(capturedIds("storyboards"));
    const scenes = new Set(capturedIds("scenes"));
    const conversations = new Set(capturedIds("agent_conversations"));
    for (const name of ["storyboards", "scenes", "agent_conversations"]) {
      for await (const docs of documentPages(
        db.collection(name).where("projectId", "==", projectId),
      )) {
        for (const doc of docs) {
          (name === "storyboards"
            ? boards
            : name === "scenes"
              ? scenes
              : conversations
          ).add(doc.id);
          const found = item(doc.ref.path, doc.data());
          if (found) yield found;
        }
      }
    }
    for (const name of [
      "photo_assets",
      "generation_requests",
      "ai_jobs",
      "project_photo_analyses",
      "change_proposals",
      "upload_sessions",
    ]) {
      for await (const docs of documentPages(
        db.collection(name).where("projectId", "==", projectId),
      ))
        for (const doc of docs) {
          const found = item(doc.ref.path, doc.data());
          if (found) yield found;
          if (
            name === "change_proposals" &&
            typeof doc.data().clientRequestId === "string"
          ) {
            const reservation = item(
              `change_proposal_request_keys/${compound(projectId, doc.data().clientRequestId)}`,
            );
            if (reservation) yield reservation;
          }
        }
    }
    for (const [name, field, ids] of [
      ["generated_images", "sceneId", scenes],
      ["test_generation_batches", "storyboardId", boards],
      ["agent_provider_bindings", "conversationId", conversations],
      ["agent_conversation_turns", "conversationId", conversations],
      ["agent_conversation_messages", "conversationId", conversations],
    ] as const) {
      for (const id of ids)
        for await (const docs of documentPages(
          db.collection(name).where(field, "==", id),
        ))
          for (const doc of docs) {
            const found = item(doc.ref.path, doc.data());
            if (found) yield found;
            if (name === "agent_conversation_turns") {
              const found = item(
                `agent_turn_request_keys/${compound(id, String(doc.data().clientRequestId))}`,
              );
              if (found) yield found;
            }
            if (name === "agent_conversation_messages") {
              const found = item(
                `agent_message_sequence_keys/${compound(id, String(doc.data().sequence))}`,
              );
              if (found) yield found;
            }
          }
    }
    for (const id of conversations) {
      const path = `agent_conversation_counters/${id}`;
      if (!(await db.doc(path).get()).exists) continue;
      const found = item(path);
      if (found) yield found;
    }
    const parent = await db.collection("projects").doc(projectId).get();
    if (parent.exists) {
      const found = item(parent.ref.path, parent.data(), true);
      if (found) yield found;
    }
  }
  inventoryProjectId = undefined;
  if (target.kind === "account") {
    for await (const docs of documentPages(
      db.collection("style_presets").where("ownerUserId", "==", target.userId),
    ))
      for (const doc of docs) {
        if (doc.data().scope === "system") continue;
        const found = item(doc.ref.path, doc.data());
        if (found) yield found;
      }
    for (const name of ["user_preferences", "users"]) {
      const doc = await db.collection(name).doc(target.userId).get();
      if (doc.exists) {
        const found = item(doc.ref.path, doc.data(), name === "users");
        if (found) yield found;
      }
    }
  }
  for await (const docs of documentPages(
    db.collection("media_deletions").where("userId", "==", target.userId),
  )) {
    for (const doc of docs) {
      if (
        doc.id === activeDeletionId ||
        (target.kind === "project" && doc.data().projectId !== target.projectId)
      )
        continue;
      const found = item(doc.ref.path, doc.data());
      if (found) yield found;
      for await (const pages of documentPages(
        db.collection("media_deletion_items").where("deletionId", "==", doc.id),
      )) {
        for (const page of pages) {
          const found = item(page.ref.path, page.data());
          if (found) yield found;
        }
      }
    }
  }
  // Shared organizations/system presets and durable purge guards are deliberately retained.
}
export function storageKeys(value: unknown): string[] {
  const found = new Set<string>();
  function visit(value: unknown, name = "") {
    if (
      typeof value === "string" &&
      (/storageKey$/i.test(name) ||
        [
          "original",
          "preview",
          "agentPreview",
          "temporaryKey",
          "objectKeys",
        ].includes(name)) &&
      /^(media|tmp)\/users\//.test(value)
    )
      found.add(value);
    else if (Array.isArray(value)) value.forEach((item) => visit(item, name));
    else if (value != null && typeof value === "object")
      for (const [key, item] of Object.entries(value)) visit(item, key);
  }
  visit(value);
  return [...found];
}
function compound(...parts: string[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
