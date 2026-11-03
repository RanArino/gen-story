// Audio is read once, verified against the approved Plan, then staged for ffmpeg.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { digestBytes } from "../contracts/canonical.js";
import { fail } from "../contracts/errors.js";

export function verifyAudio(
  mediaDir: string,
  inputs: { asset: string; sha256: string }[],
  stageDir?: string,
): void {
  for (const input of inputs) {
    const source = `${mediaDir}${input.asset}`;
    if (!existsSync(source))
      fail(
        "FS_DIGEST_MISMATCH",
        "/audio",
        `missing approved audio ${input.asset}`,
      );
    const bytes = readFileSync(source);
    if (digestBytes(bytes) !== input.sha256)
      fail(
        "FS_DIGEST_MISMATCH",
        "/audio",
        `approved audio changed: ${input.asset}`,
      );
    if (stageDir) {
      const target = `${stageDir}${input.asset}`;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, bytes);
    }
  }
}
