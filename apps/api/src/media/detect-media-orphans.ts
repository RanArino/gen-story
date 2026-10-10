import type { Firestore } from "@google-cloud/firestore";
import type { PrivateMediaStorage } from "../storage/r2-object-storage";
import {
  documentPages,
  ENTITY_COLLECTIONS,
  storageKeys,
} from "./media-inventory";

export type OrphanFinding = {
  key: string;
  category:
    | "missing_reference"
    | "unreferenced_finalized"
    | "active_temporary"
    | "expired_candidate"
    | "recoverable"
    | "uncertain_concurrent_write";
};
// The storage dependency deliberately exposes no mutations.
export async function detectMediaOrphans(input: {
  db: Firestore;
  storage: Pick<PrivateMediaStorage, "list" | "head">;
  now: string;
}): Promise<OrphanFinding[]> {
  const references = new Map<
    string,
    "reference" | "recoverable" | "uncertain_concurrent_write"
  >();
  const activeTemporary = new Set<string>();
  const pendingProjects = new Set<string>();
  const pendingUsers = new Set<string>();
  const recoverableProjects = new Set<string>();
  const recoverableUsers = new Set<string>();
  for await (const docs of documentPages(input.db.collection("projects")))
    for (const doc of docs)
      if (doc.data().deletedAt != null) recoverableProjects.add(doc.id);
  for await (const docs of documentPages(
    input.db.collection("account_deletion_guards"),
  ))
    for (const doc of docs) {
      if (doc.data().state === "recoverable") recoverableUsers.add(doc.id);
      if (doc.data().state === "purging") pendingUsers.add(doc.id);
    }
  for await (const docs of documentPages(
    input.db.collection("media_deletions"),
  ))
    for (const doc of docs)
      if (doc.data().state === "purging") {
        if (doc.data().kind === "account")
          pendingUsers.add(String(doc.data().userId));
        else pendingProjects.add(String(doc.data().projectId));
      }
  for (const name of [
    ...ENTITY_COLLECTIONS,
    "upload_sessions",
    "media_deletion_items",
  ]) {
    for await (const docs of documentPages(input.db.collection(name)))
      for (const doc of docs) {
        const data = doc.data();
        if (name === "upload_sessions" && data.status === "processing")
          pendingProjects.add(String(data.projectId));
        if (
          name === "upload_sessions" &&
          (data.expiresAt > input.now || data.leaseUntil > input.now)
        )
          activeTemporary.add(String(data.temporaryKey));
        const recoverable =
          data.deletedAt != null ||
          recoverableProjects.has(String(data.projectId)) ||
          recoverableUsers.has(String(data.userId));
        for (const key of storageKeys(data)) {
          if (recoverable) references.set(key, "recoverable");
          else if (name === "upload_sessions") {
            // A session intent is not a committed photo reference. Retired attempts
            // become unreferenced once execution settles, while active writes stay uncertain.
            if (
              data.status === "processing" &&
              references.get(key) !== "reference"
            )
              references.set(key, "uncertain_concurrent_write");
          } else references.set(key, "reference");
        }
      }
  }
  const findings: OrphanFinding[] = [];
  // Service HEAD checks avoid downloading private originals.
  for (const [key, category] of references) {
    if (!(await input.storage.head(key))) {
      // Completed/expired temporary references are expected to be absent.
      if (key.startsWith("media/") || activeTemporary.has(key))
        findings.push({
          key,
          category:
            category === "uncertain_concurrent_write"
              ? category
              : "missing_reference",
        });
    }
  }
  for (const prefix of ["tmp/", "media/"]) {
    let cursor: string | undefined;
    do {
      const page = await input.storage.list(prefix, cursor);
      for (const object of page.objects) {
        const reference = references.get(object.key);
        const match =
          /^(?:tmp|media)\/users\/([^/]+)\/projects\/([^/]+)\//.exec(
            object.key,
          );
        if (
          match &&
          (pendingProjects.has(match[2]!) || pendingUsers.has(match[1]!))
        )
          findings.push({
            key: object.key,
            category: "uncertain_concurrent_write",
          });
        else if (
          reference === "recoverable" ||
          (match &&
            (recoverableProjects.has(match[2]!) ||
              recoverableUsers.has(match[1]!)))
        )
          findings.push({ key: object.key, category: "recoverable" });
        else if (activeTemporary.has(object.key))
          findings.push({ key: object.key, category: "active_temporary" });
        else if (reference === "uncertain_concurrent_write")
          findings.push({
            key: object.key,
            category: "uncertain_concurrent_write",
          });
        else if (object.key.startsWith("tmp/")) {
          const old =
            object.lastModified != null &&
            Date.parse(object.lastModified) + 24 * 3600 * 1000 <=
              Date.parse(input.now);
          findings.push({
            key: object.key,
            category: old ? "expired_candidate" : "uncertain_concurrent_write",
          });
        } else if (!reference)
          findings.push({
            key: object.key,
            category: "unreferenced_finalized",
          });
      }
      cursor = page.cursor;
    } while (cursor);
  }
  return findings;
}
