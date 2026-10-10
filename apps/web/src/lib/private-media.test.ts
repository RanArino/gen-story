import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearMediaUrls,
  resolveMediaUrl,
  setMediaAccount,
  uploadPrivatePhoto,
  type JsonRequest,
} from "./private-media";
import type { MediaUrlDto, PhotoAssetDto } from "@gen-story/shared";

afterEach(() => {
  clearMediaUrls();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
describe("private browser media", () => {
  it("sends raw file bytes with exactly grant headers and observes status after uncertain completion", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "private.png", {
      type: "image/png",
    });
    const phases: string[] = [];
    const calls: { method: string; path: string; body: unknown }[] = [];
    const photo = {
      id: "photo",
      storageKey: "media/users/a/projects/p/original.png",
    } as PhotoAssetDto;
    const request: JsonRequest = async <T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<T> => {
      calls.push({ method, path, body });
      if (path.endsWith("upload-grants"))
        return {
          uploadId: "upload",
          url: "https://storage.invalid/object?signed=secret",
          method: "PUT",
          headers: { "Content-Type": "image/png", "x-amz-meta-sha256": "hash" },
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        } as T;
      if (path.endsWith("complete"))
        throw Object.assign(new Error("Uncertain response"), { status: 0 });
      return { uploadId: "upload", status: "completed", photo } as T;
    };
    const put = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    expect(
      await uploadPrivatePhoto(request, "p", file, undefined, (phase) =>
        phases.push(phase),
      ),
    ).toBe(photo);
    expect(put).toHaveBeenCalledWith(
      "https://storage.invalid/object?signed=secret",
      {
        method: "PUT",
        headers: { "Content-Type": "image/png", "x-amz-meta-sha256": "hash" },
        body: file,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      },
    );
    expect(calls[0]!.body).toMatchObject({
      name: "private.png",
      size: 3,
      sha256:
        "039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81",
    });
    expect(calls.filter((call) => call.path.endsWith("complete"))).toHaveLength(
      1,
    );
    expect(phases).toEqual(["uploading", "processing", "succeeded"]);
  });
  it("refreshes reads before expiry and clears them on principal changes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T00:00:00.000Z"));
    let index = 0;
    const request: JsonRequest = async <T>() =>
      ({
        url: `https://storage.invalid/${++index}`,
        method: "GET",
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      }) as T;
    setMediaAccount("a");
    const first = await resolveMediaUrl(
      request,
      "photo-assets",
      "photo",
      "preview",
    );
    expect(
      await resolveMediaUrl(request, "photo-assets", "photo", "preview"),
    ).toBe(first);
    vi.advanceTimersByTime(271_000);
    expect(
      (await resolveMediaUrl(request, "photo-assets", "photo", "preview")).url,
    ).not.toBe(first.url);
    setMediaAccount("b");
    expect(
      (await resolveMediaUrl(request, "photo-assets", "photo", "preview")).url,
    ).toContain("/3");
    clearMediaUrls();
    expect(
      (await resolveMediaUrl(request, "photo-assets", "photo", "preview")).url,
    ).toContain("/4");
  });
  it("does not populate a new account's cache from an old pending request", async () => {
    let finish!: (value: MediaUrlDto) => void;
    const request: JsonRequest = <T>() =>
      new Promise<T>((resolve) => {
        finish = (value) => resolve(value as T);
      });
    setMediaAccount("a");
    const pending = resolveMediaUrl(
      request,
      "photo-assets",
      "photo",
      "preview",
    );
    setMediaAccount("b");
    finish({
      url: "https://storage.invalid/a",
      method: "GET",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    });
    await expect(pending).rejects.toThrow("account changed");
  });
});
