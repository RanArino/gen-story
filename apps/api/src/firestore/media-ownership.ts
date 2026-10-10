import type { Firestore, Transaction } from "@google-cloud/firestore";
import type { Project } from "@gen-story/domain";
import { MediaError } from "../photos/upload-session";

export async function requireMediaOwner(
  db: Firestore,
  transaction: Transaction,
  userId: string,
  projectId: string,
  organizationId?: string,
): Promise<Project> {
  const [user, project, guard] = await Promise.all([
    transaction.get(db.collection("users").doc(userId)),
    transaction.get(db.collection("projects").doc(projectId)),
    transaction.get(db.collection("account_deletion_guards").doc(userId)),
  ]);
  const data = project.data() as
    | (Project & { mediaDeletionId?: string })
    | undefined;
  if (
    !user.exists ||
    user.data()?.deletedAt != null ||
    guard.exists ||
    !data ||
    data.deletedAt != null ||
    data.mediaDeletionId != null ||
    data.ownerUserId !== userId ||
    data.organizationId !== user.data()?.organizationId ||
    (organizationId != null && data.organizationId !== organizationId)
  )
    throw new MediaError("not_found");
  return data;
}
