import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { S3Client } from "@aws-sdk/client-s3";
import { R2ObjectStorage } from "./r2-object-storage";
import { createSignedStorageFixture } from "../test-support/signed-storage-fixture";

describe("R2 storage and signed capabilities", () => {
  it("binds real SDK PUT signatures to method/key/type/checksum/expiry", async () => {
    let now = new Date("2026-10-10T00:00:00.000Z");
    const fixture = await createSignedStorageFixture(() => now);
    try {
      const grant = await fixture.grants.issue({
        uploadId: "upload",
        key: "tmp/test",
        mimeType: "image/png",
        sha256: "a".repeat(64),
      });
      const put = (url = grant.url, headers = grant.headers, method = "PUT") =>
        fetch(url, {
          method,
          headers,
          ...(method === "PUT" ? { body: Buffer.from("bytes") } : {}),
        });
      expect((await put()).status).toBe(200);
      expect((await put()).status).toBe(200); // A grant is reusable; sessions enforce completion.
      expect(
        (await put(grant.url.replace("tmp/test", "tmp/foreign"))).status,
      ).toBe(403);
      expect(
        (
          await put(grant.url, {
            ...grant.headers,
            "Content-Type": "image/jpeg",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await put(grant.url, {
            ...grant.headers,
            "x-amz-meta-sha256": "b".repeat(64),
          })
        ).status,
      ).toBe(403);
      expect((await put(grant.url, grant.headers, "GET")).status).toBe(403);
      const read = await fixture.grants.read("tmp/test");
      expect(await (await fetch(read.url)).text()).toBe("bytes");
      const head = await fixture.grants.read("tmp/test", undefined, true);
      expect((await fetch(head.url, { method: "HEAD" })).status).toBe(200);
      expect((await fetch(head.url)).status).toBe(403);
      now = new Date(now.getTime() + 600_000);
      expect((await put()).status).toBe(403);
      expect((await fetch(read.url)).status).toBe(403);
    } finally {
      await fixture.close();
    }
  });
  it("implements bounded stream reads, HEAD, paginated listing, and missing-object semantics", async () => {
    const requests: unknown[] = [];
    let reply: unknown = {};
    const client = {
      async send(command: { input: unknown }) {
        requests.push(command.input);
        if (reply instanceof Error) throw reply;
        return reply;
      },
    } as unknown as S3Client;
    const storage = new R2ObjectStorage(client, "bucket");
    reply = { Body: Readable.from([Buffer.from("ab"), Buffer.from("cd")]) };
    expect(Buffer.from((await storage.readBounded("key", 4))!).toString()).toBe(
      "abcd",
    );
    reply = { Body: Readable.from([Buffer.alloc(5)]) };
    await expect(storage.readBounded("key", 4)).rejects.toThrow("byte limit");
    reply = { ContentLength: 5, ContentType: "image/png" };
    expect(await storage.head("key")).toEqual({
      size: 5,
      contentType: "image/png",
    });
    reply = {
      Contents: [{ Key: "key", Size: 5 }],
      IsTruncated: true,
      NextContinuationToken: "next",
    };
    expect(await storage.list("prefix", "cursor")).toMatchObject({
      cursor: "next",
      objects: [{ key: "key", size: 5 }],
    });
    expect(requests.at(-1)).toMatchObject({
      Bucket: "bucket",
      Prefix: "prefix",
      ContinuationToken: "cursor",
      MaxKeys: 200,
    });
    reply = Object.assign(new Error("missing"), { name: "NoSuchKey" });
    expect(await storage.getObject("missing")).toBeNull();
    expect(await storage.head("missing")).toBeNull();
    await storage.deleteObject("missing");
    reply = new Error("Access denied");
    await expect(storage.getObject("key")).rejects.toThrow("Access denied");
  });
});
