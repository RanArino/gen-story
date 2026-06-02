import OpenAI, { toFile } from "openai";
import sharp from "sharp";

// Rendering helpers for the storyboard style-preview images.
// Used by scripts/generate-style-previews.ts.
//
// This lives in apps/api (not scripts/) so the `openai` and `sharp` packages
// resolve from the api package's dependencies.
//
// Approach follows OpenAI's gpt-image prompting guide, "Character Anchor"
// pattern (guide §6.4): generate ONE base image, then restyle that exact image
// for every other style via images.edit — so all previews show the same
// person. Independent text-to-image calls would invent a new person each time.
//
// Parameter notes from the guide:
// - `quality` is supported (low/medium/high); `high` is used here because the
//   previews are identity-sensitive close-up portraits.
// - gpt-image models return base64 by default and reject `response_format`.
// - `input_fidelity` is disabled for gpt-image-2, so it is not sent.

export const STYLE_PREVIEW_WIDTH = 480;

const DEFAULT_MODEL = "gpt-image-2";
const DEFAULT_QUALITY = "high";

// Text-to-image: produces the full-resolution base image (PNG bytes).
export async function generateBaseImage(input: {
  apiKey: string;
  prompt: string;
  model?: string;
  quality?: string;
}): Promise<Buffer> {
  const client = new OpenAI({ apiKey: input.apiKey });

  const response = await client.images.generate({
    model: (input.model ?? DEFAULT_MODEL) as Parameters<
      typeof client.images.generate
    >[0]["model"],
    prompt: input.prompt,
    size: "1024x1024",
    quality: (input.quality ?? DEFAULT_QUALITY) as Parameters<
      typeof client.images.generate
    >[0]["quality"],
    n: 1,
  });

  const b64 = response.data?.[0]?.b64_json ?? "";
  if (!b64) {
    throw new Error("OpenAI returned an empty image response.");
  }
  return Buffer.from(b64, "base64");
}

// Image-to-image: restyles an existing image, preserving its subject, pose,
// and composition so every preview shows the same person.
export async function restyleImage(input: {
  apiKey: string;
  prompt: string;
  baseImage: Buffer;
  model?: string;
  quality?: string;
}): Promise<Buffer> {
  const client = new OpenAI({ apiKey: input.apiKey });

  const imageFile = await toFile(input.baseImage, "base.png", {
    type: "image/png",
  });

  const response = await client.images.edit({
    model: (input.model ?? DEFAULT_MODEL) as Parameters<
      typeof client.images.edit
    >[0]["model"],
    image: [imageFile],
    prompt: input.prompt,
    size: "1024x1024",
    quality: (input.quality ?? DEFAULT_QUALITY) as Parameters<
      typeof client.images.edit
    >[0]["quality"],
  });

  const b64 = response.data?.[0]?.b64_json ?? "";
  if (!b64) {
    throw new Error("OpenAI returned an empty image response.");
  }
  return Buffer.from(b64, "base64");
}

// Downscales a full-resolution image to a gallery-sized preview JPEG.
export async function toPreviewJpeg(image: Buffer): Promise<Buffer> {
  return sharp(image)
    .resize({ width: STYLE_PREVIEW_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
}
