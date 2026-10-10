import { createHash } from "node:crypto";
import type { Firestore } from "@google-cloud/firestore";
import { createOrganization, createUser } from "@gen-story/domain";
import {
  DEFAULT_AGENT_RUNTIME_SELECTION,
  DEFAULT_LANGUAGE,
} from "@gen-story/application";
import type { FirebaseIdentity } from "../auth/firebase-auth";

export function createFirestorePrincipalProvisioner(db: Firestore) {
  return async (identity: FirebaseIdentity) => {
    const digest = createHash("sha256")
      .update(`${identity.tenantId}:${identity.uid}`)
      .digest("hex");
    const userId = `firebase-user-${digest}`;
    const organizationId = `firebase-org-${digest}`;
    const now = new Date().toISOString();
    return db.runTransaction(async (tx) => {
      const userRef = db.collection("users").doc(userId);
      const orgRef = db.collection("organizations").doc(organizationId);
      const prefRef = db.collection("user_preferences").doc(userId);
      const [userSnapshot, orgSnapshot, prefSnapshot, guard] =
        await Promise.all([
          tx.get(userRef),
          tx.get(orgRef),
          tx.get(prefRef),
          tx.get(db.collection("account_deletion_guards").doc(userId)),
        ]);
      if (guard.exists || userSnapshot.data()?.deletedAt != null) return null;
      const user = createUser({
        id: userId,
        organizationId,
        displayName: identity.displayName ?? identity.email ?? "Gen Story User",
        email: identity.email,
        createdAt: now,
        updatedAt: now,
      });
      const organization = createOrganization({
        id: organizationId,
        name:
          identity.displayName == null && identity.email == null
            ? "Personal Organization"
            : `${identity.displayName ?? identity.email}'s Organization`,
        createdAt: now,
        updatedAt: now,
      });
      if (!userSnapshot.exists) tx.create(userRef, user);
      if (!orgSnapshot.exists) tx.create(orgRef, organization);
      if (!prefSnapshot.exists)
        tx.create(prefRef, {
          userId,
          language: DEFAULT_LANGUAGE,
          agentRuntime: DEFAULT_AGENT_RUNTIME_SELECTION,
          updatedAt: now,
        });
      return {
        user: userSnapshot.exists ? (userSnapshot.data() as typeof user) : user,
        organization: orgSnapshot.exists
          ? (orgSnapshot.data() as typeof organization)
          : organization,
      };
    });
  };
}
