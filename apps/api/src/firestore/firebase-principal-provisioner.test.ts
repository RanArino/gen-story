import { describe, expect, it } from "vitest";
import { createFirestorePrincipalProvisioner } from "./firebase-principal-provisioner";
import { createOwnedStylePresetRepository } from "./owned-style-presets";
import {
  clearEmulatorData,
  createEmulatorClient,
} from "../test-support/firestore-emulator";

describe.runIf(process.env.FIRESTORE_EMULATOR_HOST != null)(
  "hosted account provisioning guard",
  () => {
    it("blocks guarded principal recreation and isolates private presets", async () => {
      await clearEmulatorData();
      const db = createEmulatorClient();
      try {
        const provision = createFirestorePrincipalProvisioner(db);
        const identity = {
          uid: "guard-fixture",
          tenantId: "test",
          email: null,
          displayName: null,
        };
        const principal = (await provision(identity))!;
        const owned = createOwnedStylePresetRepository(db, principal.user.id);
        const now = new Date().toISOString();
        await owned.save({
          id: "private",
          scope: "user",
          name: "Private",
          description: "",
          prompt: "Colors",
          createdAt: now,
          updatedAt: now,
        });
        expect(await owned.findById("private")).not.toBeNull();
        const foreign = createOwnedStylePresetRepository(db, "foreign");
        expect(await foreign.findById("private")).toBeNull();
        await db
          .collection("account_deletion_guards")
          .doc(principal.user.id)
          .set({ state: "purged" });
        await db.collection("users").doc(principal.user.id).delete();
        expect(await provision(identity)).toBeNull();
        expect(
          (await db.collection("users").doc(principal.user.id).get()).exists,
        ).toBe(false);
        await expect(
          owned.save({
            id: "blocked",
            scope: "user",
            name: "Blocked",
            description: "",
            prompt: "Colors",
            createdAt: now,
            updatedAt: now,
          }),
        ).rejects.toThrow();
      } finally {
        await db.terminate();
      }
    });
  },
);
