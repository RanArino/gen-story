import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

import { calculateSha256Hex } from "../storage/checksum";
import { AI_INPUT_PRESET, PREVIEW_640_PRESET } from "../storage/storage-keys";

export const PREVIEW_MAX_EDGE = 640;
export const AI_INPUT_MAX_EDGE = 1536;

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
  const detectedType = await fileTypeFromBuffer(body);
  const supportedType =
    detectedType == null ? null : supportedTypes.get(detectedType.mime);

  if (supportedType == null) {
    throw new Error("Unsupported image type.");
  }

  return supportedType;
}

export async function readOriginalImageMetadata(input: {
  body: Uint8Array;
  mimeType: string;
}): Promise<Omit<ImageObjectMetadata, "body">> {
  const metadata = await sharp(Buffer.from(input.body)).metadata();

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

async function createJpegDerivative(
  body: Uint8Array,
  maxEdge: number,
): Promise<ImageObjectMetadata> {
  const output = await sharp(Buffer.from(body))
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

function requireDimension(value: number | undefined, name: string): number {
  if (value == null) {
    throw new Error(`Image ${name} could not be read.`);
  }

  return value;
}
