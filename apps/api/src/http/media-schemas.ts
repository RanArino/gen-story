import { z } from "zod";
import { IMAGE_RESOURCE_LIMITS } from "./security-policy";
export const UploadGrantSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    mimeType: z.enum([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
    ]),
    size: z.number().int().positive().max(IMAGE_RESOURCE_LIMITS.encodedBytes),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    notes: z.string().max(10_000).nullable().optional(),
    usage: z.enum(["candidate", "reference", "excluded"]).optional(),
  })
  .strict();
export const MediaVariantSchema = z.enum([
  "preview",
  "agent-preview",
  "original",
]);
