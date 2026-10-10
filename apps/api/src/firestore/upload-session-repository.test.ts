import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createEmulatorClient,
  clearEmulatorData,
} from "../test-support/firestore-emulator";
import { FirestoreUploadSessionRepository } from "./upload-session-repository";
import { uploadManifest } from "../storage/r2-storage-keys";

import {
  mediaNow,
  sessionFixture,
  seedMedia,
} from "../test-support/private-media-fixture";

describe.runIf(process.env.FIRESTORE_EMULATOR_HOST != null)(
  "durable private upload sessions",
  () => {
    let db: ReturnType<typeof createEmulatorClient>;
    let sessions: FirestoreUploadSessionRepository;
    beforeEach(async () => {
      await clearEmulatorData();
      db = createEmulatorClient();
      sessions = new FirestoreUploadSessionRepository(db);
      await seedMedia(db);
    });
    afterEach(async () => {
      await db?.terminate();
    });
    it("reopens durable sessions and has one concurrent browser completion winner", async () => {
      await sessions.issue(sessionFixture());
      await db.terminate();
      db = createEmulatorClient();
      sessions = new FirestoreUploadSessionRepository(db);
      expect(
        (await sessions.status("user-a", "project-a", "upload")).session.name,
      ).toBe("photo.png");
      const results = await Promise.allSettled([
        sessions.accept("user-a", "project-a", "upload", mediaNow),
        sessions.accept("user-a", "project-a", "upload", mediaNow),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      await expect(
        sessions.accept("user-a", "project-a", "upload", mediaNow),
      ).rejects.toMatchObject({ code: "conflict" });
    }, 30_000);
    it("returns indistinguishable not-found for foreign, missing, and deleted ownership", async () => {
      await sessions.issue(sessionFixture());
      await expect(
        sessions.status("user-b", "project-a", "upload"),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        sessions.status("user-b", "missing", "upload"),
      ).rejects.toMatchObject({ code: "not_found" });
      await expect(
        sessions.accept("user-a", "project-b", "upload", mediaNow),
      ).rejects.toMatchObject({ code: "not_found" });
      await db
        .collection("projects")
        .doc("project-a")
        .update({ deletedAt: mediaNow });
      await expect(
        sessions.accept("user-a", "project-a", "upload", mediaNow),
      ).rejects.toMatchObject({ code: "not_found" });
    });
    it("fences expired executors and atomically serializes duplicate publication", async () => {
      for (const id of ["one", "two"]) {
        await sessions.issue(sessionFixture(id));
        await sessions.accept("user-a", "project-a", id, mediaNow);
      }
      const first = (await sessions.claim("one", "old", mediaNow))!;
      expect(await sessions.claim("one", "second", mediaNow)).toBeNull();
      const later = "2026-10-10T00:01:01.000Z";
      const winner = (await sessions.claim("one", "new", later))!;
      const other = (await sessions.claim("two", "other", later))!;
      await expect(
        sessions.writeIntent(
          first,
          uploadManifest("user-a", "project-a", "one", first.token, "png"),
          later,
        ),
      ).rejects.toMatchObject({ code: "lost_claim" });
      for (const claim of [winner, other])
        await sessions.writeIntent(
          claim,
          uploadManifest(
            "user-a",
            "project-a",
            claim.session.id,
            claim.token,
            "png",
          ),
          later,
        );
      const results = await Promise.allSettled([
        sessions.publish(
          winner,
          { mimeType: "image/png", width: 1, height: 1 },
          later,
        ),
        sessions.publish(
          other,
          { mimeType: "image/png", width: 1, height: 1 },
          later,
        ),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((await db.collection("photo_assets").get()).size).toBe(1);
      const scenes = await db.collection("scenes").get();
      expect(scenes.size).toBe(1);
      expect(scenes.docs[0]!.data().photoAssets[0].role).toBe("primary");
      expect(
        (await db.collection("storyboards").doc("storyboard-a").get()).data()
          ?.sceneIds,
      ).toHaveLength(1);
    }, 30_000);
    it("checks ownership again at publication and retains persisted write intent", async () => {
      await sessions.issue(sessionFixture());
      await sessions.accept("user-a", "project-a", "upload", mediaNow);
      const claim = (await sessions.claim("upload", "worker", mediaNow))!;
      await sessions.writeIntent(
        claim,
        uploadManifest("user-a", "project-a", "upload", claim.token, "png"),
        mediaNow,
      );
      await db
        .collection("account_deletion_guards")
        .doc("user-a")
        .set({ state: "recoverable" });
      await expect(
        sessions.publish(
          claim,
          { mimeType: "image/png", width: 1, height: 1 },
          mediaNow,
        ),
      ).rejects.toMatchObject({ code: "not_found" });
      expect((await sessions.find("upload"))?.manifest).not.toBeNull();
      expect((await db.collection("photo_assets").get()).empty).toBe(true);
    });
  },
);
