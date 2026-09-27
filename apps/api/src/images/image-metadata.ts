import convert from "heic-convert";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

import { calculateSha256Hex } from "../storage/checksum";
import { AI_INPUT_PRESET, PREVIEW_640_PRESET } from "../storage/storage-keys";
import { IMAGE_RESOURCE_LIMITS } from "../http/security-policy";

export const PREVIEW_MAX_EDGE = 640;
export const AI_INPUT_MAX_EDGE = 1536;
export const CONTACT_SHEET_COLUMNS = 5;
export const CONTACT_SHEET_CELL_WIDTH = 200;
export const CONTACT_SHEET_CELL_HEIGHT = 150;
const CONTACT_SHEET_LABEL_HEIGHT = 24;

export async function convertHeicToJpeg(body: Uint8Array): Promise<Uint8Array> {
  // heic-decode reads the buffer as a typed array (it spreads `buffer.slice(...)`),
  // so it must receive a Uint8Array/Buffer — passing a raw ArrayBuffer throws
  // "Spread syntax requires ...iterable". The @types/heic-convert `ArrayBufferLike`
  // annotation is wrong, hence the cast.
  const output = await convert({
    buffer: Buffer.from(body) as unknown as ArrayBufferLike,
    format: "JPEG",
    quality: 0.95,
  });
  return new Uint8Array(output);
}

export type SupportedImageType = {
  extension: "jpg" | "png" | "webp" | "heic" | "heif";
  mimeType:
    | "image/jpeg"
    | "image/png"
    | "image/webp"
    | "image/heic"
    | "image/heif";
};

export type ImageObjectMetadata = {
  body: Uint8Array;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  checksum: string;
};

const supportedTypes = new Map<string, SupportedImageType>([
  ["image/jpeg", { extension: "jpg", mimeType: "image/jpeg" }],
  ["image/png", { extension: "png", mimeType: "image/png" }],
  ["image/webp", { extension: "webp", mimeType: "image/webp" }],
  ["image/heic", { extension: "heic", mimeType: "image/heic" }],
  ["image/heif", { extension: "heif", mimeType: "image/heif" }],
]);

export async function detectSupportedImageType(
  body: Uint8Array,
): Promise<SupportedImageType> {
  requireEncodedByteLimit(body);
  const detectedType = await fileTypeFromBuffer(body);
  const supportedType =
    detectedType == null ? null : supportedTypes.get(detectedType.mime);

  if (supportedType == null) {
    throw new Error("Unsupported image type.");
  }

  return supportedType;
}

// Generated images are stored as PNG so the extension and Content-Type always
// match the bytes. gpt-image already returns PNG by default, but that is a
// response-side default rather than something we can pin in the request:
// GPT Image endpoints can reject unsupported parameters, and a 400 on an image
// call is a wasted paid request. Re-encoding is lossless, so the non-PNG branch
// costs quality nothing.
export async function ensurePngImage(body: Uint8Array): Promise<Uint8Array> {
  await validateImageResourceLimits(body);
  const detectedType = await fileTypeFromBuffer(body);

  if (detectedType?.mime === "image/png") {
    return body;
  }

  return new Uint8Array(await sharp(Buffer.from(body)).png().toBuffer());
}

export async function readOriginalImageMetadata(input: {
  body: Uint8Array;
  mimeType: string;
}): Promise<Omit<ImageObjectMetadata, "body">> {
  const metadata = await validateImageResourceLimits(input.body);

  return {
    mimeType: input.mimeType,
    size: input.body.byteLength,
    width: requireDimension(metadata.width, "width"),
    height: requireDimension(metadata.height, "height"),
    checksum: calculateSha256Hex(input.body),
  };
}

export async function createPreviewImage(
  body: Uint8Array,
): Promise<ImageObjectMetadata & { preset: typeof PREVIEW_640_PRESET }> {
  const image = await createJpegDerivative(body, PREVIEW_MAX_EDGE);

  return {
    ...image,
    preset: PREVIEW_640_PRESET,
  };
}

export async function createAiInputImage(
  body: Uint8Array,
): Promise<ImageObjectMetadata & { preset: typeof AI_INPUT_PRESET }> {
  const image = await createJpegDerivative(body, AI_INPUT_MAX_EDGE);

  return {
    ...image,
    preset: AI_INPUT_PRESET,
  };
}

export async function createPhotoContactSheet(
  images: readonly { body: Uint8Array; globalIndex: number }[],
): Promise<ImageObjectMetadata> {
  if (images.length === 0) {
    throw new Error("Cannot create a contact sheet without photos.");
  }

  const rows = Math.ceil(images.length / CONTACT_SHEET_COLUMNS);
  const cellHeight = CONTACT_SHEET_CELL_HEIGHT + CONTACT_SHEET_LABEL_HEIGHT;
  const overlays = await Promise.all(
    images.flatMap(async (image, index) => {
      const column = index % CONTACT_SHEET_COLUMNS;
      const row = Math.floor(index / CONTACT_SHEET_COLUMNS);
      const left = column * CONTACT_SHEET_CELL_WIDTH;
      const top = row * cellHeight;
      const tile = await sharp(Buffer.from(image.body))
        .rotate()
        .resize({
          width: CONTACT_SHEET_CELL_WIDTH,
          height: CONTACT_SHEET_CELL_HEIGHT,
          fit: "contain",
          background: "#171717",
        })
        .jpeg({ quality: 82 })
        .toBuffer();

      return [
        { input: tile, left, top },
        {
          input: Buffer.from(
            `<svg width="${CONTACT_SHEET_CELL_WIDTH}" height="${CONTACT_SHEET_LABEL_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#171717"/><text x="10" y="17" fill="#ffffff" font-family="sans-serif" font-size="14">${image.globalIndex}</text></svg>`,
          ),
          left,
          top: top + CONTACT_SHEET_CELL_HEIGHT,
        },
      ];
    }),
  );
  const body = await sharp({
    create: {
      width: CONTACT_SHEET_COLUMNS * CONTACT_SHEET_CELL_WIDTH,
      height: rows * cellHeight,
      channels: 3,
      background: "#171717",
    },
  })
    .composite(overlays.flat())
    .jpeg({ quality: 82 })
    .toBuffer();
  const metadata = await sharp(body).metadata();

  return {
    body,
    mimeType: "image/jpeg",
    size: body.byteLength,
    width: requireDimension(metadata.width, "width"),
    height: requireDimension(metadata.height, "height"),
    checksum: calculateSha256Hex(body),
  };
}

async function createJpegDerivative(
  body: Uint8Array,
  maxEdge: number,
): Promise<ImageObjectMetadata> {
  await validateImageResourceLimits(body);
  const output = await boundedSharp(body)
    .rotate()
    .resize({
      width: maxEdge,
      height: maxEdge,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg()
    .toBuffer();
  const metadata = await sharp(output).metadata();

  return {
    body: output,
    mimeType: "image/jpeg",
    size: output.byteLength,
    width: requireDimension(metadata.width, "width"),
    height: requireDimension(metadata.height, "height"),
    checksum: calculateSha256Hex(output),
  };
}

export async function validateImageResourceLimits(body: Uint8Array) {
  requireEncodedByteLimit(body);
  const metadata = await boundedSharp(body, true).metadata();
  const width = requireDimension(metadata.width, "width");
  const height = requireDimension(metadata.height, "height");
  const pages = metadata.pages ?? 1;

  if (width * height > IMAGE_RESOURCE_LIMITS.pixels) {
    throw new Error("Image pixel count exceeds the supported limit.");
  }
  if (pages > IMAGE_RESOURCE_LIMITS.frames) {
    throw new Error("Animated or multi-frame images are not supported.");
  }

  return metadata;
}

function boundedSharp(body: Uint8Array, animated = false) {
  return sharp(Buffer.from(body), {
    animated,
    limitInputPixels: IMAGE_RESOURCE_LIMITS.pixels,
  });
}

function requireEncodedByteLimit(body: Uint8Array): void {
  if (body.byteLength > IMAGE_RESOURCE_LIMITS.encodedBytes) {
    throw new Error("Image encoded size exceeds the supported limit.");
  }
}

function requireDimension(value: number | undefined, name: string): number {
  if (value == null) {
    throw new Error(`Image ${name} could not be read.`);
  }

  return value;
}
