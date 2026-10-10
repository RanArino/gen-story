import { createProject, createStoryboard, createUser } from "@gen-story/domain";
import { createEmulatorClient } from "./firestore-emulator";
import { temporaryUploadKey } from "../storage/r2-storage-keys";
import type { UploadSession } from "../photos/upload-session";

export const mediaNow = "2026-10-10T00:00:00.000Z";
export function sessionFixture(
  id = "upload",
  sha256 = "a".repeat(64),
): UploadSession {
  return {
    id,
    userId: "user-a",
    organizationId: "org-a",
    projectId: "project-a",
    photoAssetId: `photo-${id}`,
    name: "photo.png",
    mimeType: "image/png",
    size: 100,
    sha256,
    notes: null,
    usage: "candidate",
    temporaryKey: temporaryUploadKey("user-a", "project-a", id),
    expiresAt: "2026-10-10T00:10:00.000Z",
    createdAt: mediaNow,
    status: "issued",
    failureCode: null,
    token: 0,
    executorId: null,
    leaseUntil: null,
    manifest: null,
    retiredManifests: [],
  };
}
export async function seedMedia(db: ReturnType<typeof createEmulatorClient>) {
  await db
    .collection("users")
    .doc("user-a")
    .set(
      createUser({
        id: "user-a",
        organizationId: "org-a",
        displayName: "A",
        email: null,
        createdAt: mediaNow,
        updatedAt: mediaNow,
      }),
    );
  await db
    .collection("users")
    .doc("user-b")
    .set(
      createUser({
        id: "user-b",
        organizationId: "org-b",
        displayName: "B",
        email: null,
        createdAt: mediaNow,
        updatedAt: mediaNow,
      }),
    );
  await db
    .collection("projects")
    .doc("project-a")
    .set(
      createProject({
        id: "project-a",
        organizationId: "org-a",
        ownerUserId: "user-a",
        name: "Private",
        createdAt: mediaNow,
        updatedAt: mediaNow,
      }),
    );
  await db
    .collection("projects")
    .doc("project-b")
    .set(
      createProject({
        id: "project-b",
        organizationId: "org-b",
        ownerUserId: "user-b",
        name: "Foreign",
        createdAt: mediaNow,
        updatedAt: mediaNow,
      }),
    );
  await db
    .collection("storyboards")
    .doc("storyboard-a")
    .set(
      createStoryboard({
        id: "storyboard-a",
        projectId: "project-a",
        createdAt: mediaNow,
        updatedAt: mediaNow,
      }),
    );
}
