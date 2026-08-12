import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { ensurePngImage } from "./image-metadata";

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
