import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  CONTACT_SHEET_CELL_HEIGHT,
  CONTACT_SHEET_CELL_WIDTH,
  CONTACT_SHEET_COLUMNS,
  createPhotoContactSheet,
  ensurePngImage,
  validateImageResourceLimits,
} from "./image-metadata";
import { IMAGE_RESOURCE_LIMITS } from "../http/security-policy";

async function solidImage(format: "png" | "jpeg"): Promise<Uint8Array> {
  const image = sharp({
    create: {
      width: 4,
      height: 4,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  });
  const output =
    format === "png"
      ? await image.png().toBuffer()
      : await image.jpeg().toBuffer();
  return new Uint8Array(output);
}

describe("ensurePngImage", () => {
  it("returns PNG bytes untouched so no re-encode cost is paid", async () => {
    const png = await solidImage("png");

    const result = await ensurePngImage(png);

    expect(result).toBe(png);
  });

  it("converts a non-PNG response to PNG", async () => {
    const jpeg = await solidImage("jpeg");

    const result = await ensurePngImage(jpeg);

    expect((await sharp(Buffer.from(result)).metadata()).format).toBe("png");
  });
});

describe("createPhotoContactSheet", () => {
  it("uses five contained cells per row and produces a JPEG overview", async () => {
    const image = await solidImage("jpeg");

    const result = await createPhotoContactSheet(
      Array.from({ length: 6 }, (_, index) => ({
        body: image,
        globalIndex: index + 1,
      })),
    );

    expect(result.mimeType).toBe("image/jpeg");
    expect(await sharp(Buffer.from(result.body)).metadata()).toMatchObject({
      format: "jpeg",
      width: CONTACT_SHEET_COLUMNS * CONTACT_SHEET_CELL_WIDTH,
      height: 2 * (CONTACT_SHEET_CELL_HEIGHT + 24),
    });
  });
});

describe("validateImageResourceLimits", () => {
  it("rejects encoded input before decoding when it exceeds the byte ceiling", async () => {
    await expect(
      validateImageResourceLimits(
        new Uint8Array(IMAGE_RESOURCE_LIMITS.encodedBytes + 1),
      ),
    ).rejects.toThrow("encoded size");
  });

  it("rejects an image whose declared pixel count exceeds the ceiling", async () => {
    const oversizedSvg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10000" height="10000"/>',
    );
    await expect(validateImageResourceLimits(oversizedSvg)).rejects.toThrow();
  });
});
