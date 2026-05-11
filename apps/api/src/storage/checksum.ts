import { createHash } from "node:crypto";

export function calculateSha256Hex(body: Uint8Array): string {
  return createHash("sha256").update(body).digest("hex");
}
