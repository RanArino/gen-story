import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import { readJsonBody } from "./json";

function request(body: string, headers: Record<string, string> = {}) {
  const stream = Readable.from([Buffer.from(body)]);
  return Object.assign(stream, { headers }) as Parameters<
    typeof readJsonBody
  >[0];
}

describe("readJsonBody", () => {
  it("accepts JSON media types with parameters", async () => {
    await expect(
      readJsonBody(
        request('{"ok":true}', {
          "content-type": "application/json; charset=utf-8",
        }),
      ),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects an unexpected content type", async () => {
    await expect(
      readJsonBody(request("{}", { "content-type": "text/plain" })),
    ).rejects.toMatchObject({ statusCode: 415 });
  });

  it("rejects a declared oversized body before parsing", async () => {
    await expect(
      readJsonBody(
        request("{}", {
          "content-type": "application/json",
          "content-length": "100",
        }),
        8,
      ),
    ).rejects.toMatchObject({ statusCode: 413 });
  });

  it("rejects a streamed body that crosses the byte limit", async () => {
    await expect(
      readJsonBody(
        request('{"long":"value"}', { "content-type": "application/json" }),
        8,
      ),
    ).rejects.toMatchObject({ statusCode: 413 });
  });

  it("distinguishes malformed JSON from media and size errors", async () => {
    await expect(
      readJsonBody(request("not-json", { "content-type": "application/json" })),
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
