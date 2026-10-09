import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, it } from "vitest";
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import {
  emulatorProjectId,
  requireFirestoreEmulator,
} from "../test-support/firestore-emulator";

describe.runIf(process.env.FIRESTORE_EMULATOR_HOST != null)(
  "deny-all Firestore Rules",
  () => {
    let environment: RulesTestEnvironment;
    beforeAll(async () => {
      requireFirestoreEmulator();
      const url = new URL(`http://${process.env.FIRESTORE_EMULATOR_HOST}`);
      environment = await initializeTestEnvironment({
        projectId: emulatorProjectId,
        firestore: {
          host: url.hostname,
          port: Number(url.port),
          rules: readFileSync(
            fileURLToPath(
              new URL("../../../../firestore.rules", import.meta.url),
            ),
            "utf8",
          ),
        },
      });
      await environment.clearFirestore();
      await environment.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), "projects/project-a"), {
          ownerUserId: "user-a",
          organizationId: "org-a",
        });
        await setDoc(doc(context.firestore(), "users/user-a"), {
          email: "private@example.test",
        });
        await setDoc(
          doc(context.firestore(), "projects/missing/scenes/orphan"),
          { title: "Orphan" },
        );
      });
    });
    afterAll(async () => {
      await environment?.cleanup();
    });

    it.each([
      ["unauthenticated", null, {}],
      ["authenticated owner", "user-a", { firebase: { tenant: "tenant-a" } }],
      ["foreign tenant", "user-b", { firebase: { tenant: "tenant-b" } }],
      [
        "deleted user fixture",
        "deleted-user",
        { firebase: { tenant: "tenant-a" } },
      ],
      [
        "stale claim fixture",
        "user-a",
        { firebase: { tenant: "retired-tenant" }, admin: true },
      ],
    ] as const)(
      "denies direct operations for %s",
      async (_label, uid, claims) => {
        const context =
          uid == null
            ? environment.unauthenticatedContext()
            : environment.authenticatedContext(uid, {
                ...claims,
                firebase: {
                  ...("firebase" in claims ? claims.firebase : {}),
                  sign_in_provider: "custom",
                },
              });
        const db = context.firestore();
        for (const path of [
          "projects/project-a",
          "users/user-a",
          "projects/missing/scenes/orphan",
        ]) {
          await assertFails(getDoc(doc(db, path)));
          await assertFails(
            updateDoc(doc(db, path), {
              ownerUserId: "user-b",
              extraData: "injected",
            }),
          );
          await assertFails(deleteDoc(doc(db, path)));
        }
        await assertFails(getDocs(collection(db, "projects")));
        await assertFails(
          setDoc(doc(db, "projects/new"), {
            ownerUserId: "user-b",
            role: "admin",
          }),
        );
        await assertFails(
          setDoc(doc(db, "projects/new/scenes/child"), { title: "Unowned" }),
        );
      },
    );
  },
);
