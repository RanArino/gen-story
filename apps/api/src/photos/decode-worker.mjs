// Runs only inside the resource-constrained decoder container.
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import decode from "heic-decode";
import { fileTypeFromBuffer } from "file-type";

const limit = { bytes: 10 * 1024 * 1024, pixels: 40_000_000 };
const supported = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
]);
function dimensions(width, height, frames) {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > limit.pixels ||
    frames !== 1
  )
    throw new Error("resource_limit");
}
try {
  const body = await readFile("/work/input");
  if (!body.length || body.length > limit.bytes)
    throw new Error("resource_limit");
  const type = await fileTypeFromBuffer(body);
  if (!type || !supported.has(type.mime)) throw new Error("unsupported_type");
  if (type.mime === "image/png") {
    // libpng may decode only the default image of APNG and omit its frame count.
    // Inspect animation control before accepting that single decoded image.
    let offset = 8;
    while (offset + 12 <= body.length) {
      const length = body.readUInt32BE(offset);
      if (offset + 12 + length > body.length) throw new Error("invalid_png");
      const chunk = body.toString("ascii", offset + 4, offset + 8);
      if (
        chunk === "acTL" &&
        (length !== 8 || body.readUInt32BE(offset + 8) !== 1)
      )
        throw new Error("resource_limit");
      offset += length + 12;
      if (chunk === "IEND") break;
    }
  }
  let width, height;
  let pipeline;
  if (type.mime === "image/heic" || type.mime === "image/heif") {
    const metadata = await sharp(body, {
      limitInputPixels: limit.pixels,
      failOn: "warning",
    }).metadata();
    const orientation = exifOrientation(metadata.exif);
    const images = await decode.all({ buffer: body });
    try {
      if (images.length !== 1) throw new Error("resource_limit");
      const image = images[0];
      dimensions(image.width, image.height, images.length);
      const raw = await image.decode();
      width = raw.width;
      height = raw.height;
      dimensions(width, height, 1);
      pipeline = sharp(Buffer.from(raw.data), {
        raw: { width, height, channels: 4 },
        limitInputPixels: limit.pixels,
      });
      if (orientation === 2) pipeline = pipeline.flop();
      if (orientation === 3) pipeline = pipeline.rotate(180);
      if (orientation === 4) pipeline = pipeline.flip();
      if (orientation === 5) pipeline = pipeline.rotate(90).flip();
      if (orientation === 6) pipeline = pipeline.rotate(90);
      if (orientation === 7) pipeline = pipeline.rotate(90).flop();
      if (orientation === 8) pipeline = pipeline.rotate(270);
      if (orientation >= 5) [width, height] = [height, width];
    } finally {
      images.dispose();
    }
  } else {
    const image = sharp(body, {
      limitInputPixels: limit.pixels,
      failOn: "warning",
      animated: true,
    });
    const metadata = await image.metadata();
    dimensions(metadata.width, metadata.height, metadata.pages ?? 1);
    // Full pixel decoding is required even when the derivative is small.
    const raw = await image
      .autoOrient()
      .raw()
      .toBuffer({ resolveWithObject: true });
    width = raw.info.width;
    height = raw.info.height;
    dimensions(width, height, 1);
    pipeline = sharp(raw.data, {
      raw: raw.info,
      limitInputPixels: limit.pixels,
    });
  }
  for (const [name, edge] of [
    ["preview", 640],
    ["agent-preview", 1024],
  ]) {
    const output = await pipeline
      .clone()
      .resize({
        width: edge,
        height: edge,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .toBuffer();
    if (output.length > limit.bytes) throw new Error("resource_limit");
    await writeFile(`/work/${name}.jpg`, output);
  }
  await writeFile(
    "/work/result.json",
    JSON.stringify({
      mimeType: type.mime,
      extension: supported.get(type.mime),
      width,
      height,
    }),
  );
} catch {
  // Never emit bytes, filenames, metadata, or decoder exceptions.
  process.stderr.write("Image validation failed.\n");
  process.exitCode = 1;
}

function exifOrientation(exif) {
  if (!exif) return 1;
  const offset = exif.subarray(0, 6).toString() === "Exif\0\0" ? 6 : 0;
  const bytes = exif.subarray(offset);
  if (bytes.length < 8) throw new Error("invalid_metadata");
  const little = bytes.subarray(0, 2).toString() === "II";
  if (!little && bytes.subarray(0, 2).toString() !== "MM")
    throw new Error("invalid_metadata");
  const u16 = (position) =>
    little ? bytes.readUInt16LE(position) : bytes.readUInt16BE(position);
  const u32 = (position) =>
    little ? bytes.readUInt32LE(position) : bytes.readUInt32BE(position);
  if (u16(2) !== 42) throw new Error("invalid_metadata");
  const directory = u32(4);
  if (directory + 2 > bytes.length) throw new Error("invalid_metadata");
  const entries = u16(directory);
  if (entries > 1024 || directory + 2 + entries * 12 > bytes.length)
    throw new Error("invalid_metadata");
  for (let index = 0; index < entries; index++) {
    const position = directory + 2 + index * 12;
    if (u16(position) === 0x112) {
      if (u16(position + 2) !== 3 || u32(position + 4) !== 1)
        throw new Error("invalid_metadata");
      const orientation = u16(position + 8);
      if (orientation < 1 || orientation > 8)
        throw new Error("invalid_metadata");
      return orientation;
    }
  }
  return 1;
}
