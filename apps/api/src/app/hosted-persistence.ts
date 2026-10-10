import { createFirestorePrincipalProvisioner } from "../firestore/firebase-principal-provisioner";
import { createOwnedStylePresetRepository } from "../firestore/owned-style-presets";
import {
  createFirebaseRequestContextFactory,
  FirebaseTenantTokenVerifier,
  rejectServiceAccountKeyEnvironment,
} from "../auth/firebase-auth";
import {
  createFirestoreClient,
  createFirestoreRepositories,
} from "../firestore/repositories";
import type { ApiDependencies } from "./api-dependencies";

export function readHostedDatabaseConfig(env: NodeJS.ProcessEnv) {
  rejectServiceAccountKeyEnvironment(env);
  if (env.FIREBASE_PROJECT_ID !== "gen-story-496911") {
    throw new Error(
      "Hosted persistence requires FIREBASE_PROJECT_ID=gen-story-496911.",
    );
  }
  const databaseId = env.FIRESTORE_DATABASE_ID;
  if (
    databaseId !== "gen-story-staging" &&
    databaseId !== "gen-story-production"
  ) {
    throw new Error(
      "Hosted persistence requires an explicit staging or production FIRESTORE_DATABASE_ID.",
    );
  }
  return { projectId: env.FIREBASE_PROJECT_ID, databaseId };
}

export function readHostedPersistenceConfig(env: NodeJS.ProcessEnv) {
  const database = readHostedDatabaseConfig(env);
  const tenantId = env.FIREBASE_TENANT_ID?.trim();
  if (!tenantId)
    throw new Error("Hosted persistence requires FIREBASE_TENANT_ID.");
  return { ...database, tenantId };
}

export function createHostedPersistenceContext(env: NodeJS.ProcessEnv) {
  const config = readHostedPersistenceConfig(env);
  const db = createFirestoreClient(config);
  const repositories = createFirestoreRepositories(db);
  const sessions = new FirebaseTenantTokenVerifier(
    config.projectId,
    config.tenantId,
  );
  return {
    db,
    repositories,
    sessions,
    createRequestContextFactory(dependencies: ApiDependencies) {
      return createFirebaseRequestContextFactory(
        { ...dependencies, ...repositories },
        sessions,
        {
          provision: createFirestorePrincipalProvisioner(db),
          scope: (principal, dependencies) => ({
            ...dependencies,
            stylePresets: createOwnedStylePresetRepository(
              db,
              principal.user.id,
            ),
          }),
        },
      );
    },
    close: () => db.terminate(),
  };
}
