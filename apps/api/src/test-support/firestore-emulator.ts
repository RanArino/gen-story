import { createFirestoreClient } from "../firestore/repositories";

export const emulatorProjectId = "demo-gen-story";
export const emulatorDatabaseId = "(default)";

export function requireFirestoreEmulator(): void {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (
    host == null ||
    !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host) ||
    (process.env.GCLOUD_PROJECT != null &&
      process.env.GCLOUD_PROJECT !== emulatorProjectId)
  ) {
    throw new Error(
      "Firestore tests require a loopback emulator and demo-gen-story.",
    );
  }
}

export function createEmulatorClient() {
  requireFirestoreEmulator();
  return createFirestoreClient({
    projectId: emulatorProjectId,
    databaseId: emulatorDatabaseId,
  });
}

export async function clearEmulatorData(): Promise<void> {
  requireFirestoreEmulator();
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${emulatorProjectId}/databases/${emulatorDatabaseId}/documents`,
    { method: "DELETE" },
  );
  if (!response.ok)
    throw new Error(`Emulator reset failed: ${response.status}`);
}
