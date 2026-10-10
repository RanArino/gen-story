import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { readR2StorageConfig } from "../app/hosted-media";
import {
  createR2Client,
  R2ObjectStorage,
  R2UploadGrantService,
} from "./r2-object-storage";
import { calculateSha256Hex } from "./checksum";

describe.runIf(process.env.GEN_STORY_R2_LIVE_TEST === "authorized")(
  "separately authorized staging R2 compatibility",
  () => {
    it("probes only its unique temporary prefix", async () => {
      const config = readR2StorageConfig(process.env);
      if (
        config.bucket !== "gen-story-staging-media" ||
        process.env.FIRESTORE_DATABASE_ID !== "gen-story-staging"
      )
        throw new Error("Live probe refuses production.");
      const prefix = `tmp/m4-compatibility/${randomUUID()}/`;
      const key = `${prefix}probe`;
      const client = createR2Client(config);
      const storage = new R2ObjectStorage(client, config.bucket);
      const signer = new R2UploadGrantService(storage);
      try {
        const bytes = Buffer.from("Gen Story isolated R2 compatibility probe");
        const grant = await signer.issue({
          uploadId: "probe",
          key,
          mimeType: "application/octet-stream",
          sha256: calculateSha256Hex(bytes),
        });
        expect(
          (
            await fetch(grant.url, {
              method: "PUT",
              headers: grant.headers,
              body: bytes,
            })
          ).ok,
        ).toBe(true);
        expect(await storage.getObject(key)).toEqual(bytes);
        expect((await storage.head(key))?.size).toBe(bytes.length);
        const read = await signer.read(key);
        expect(
          Buffer.from(await (await fetch(read.url)).arrayBuffer()),
        ).toEqual(bytes);
        const head = await signer.read(key, undefined, true);
        expect((await fetch(head.url, { method: "HEAD" })).ok).toBe(true);
        expect((await storage.list(prefix)).objects.map((o) => o.key)).toEqual([
          key,
        ]);
      } finally {
        await storage.deleteObject(key);
        client.destroy();
      }
    }, 30_000);
  },
);
