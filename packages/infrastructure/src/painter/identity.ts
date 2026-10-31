import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { digestBytes, digestOf } from "../contracts/canonical.js";
export function painterSourceDigest(): string {
  return digestOf(
    ["./painter.ts", "../cinematic/visual.js", "../cinematic/math.js"].map(
      (name) => [
        name,
        digestBytes(
          readFileSync(fileURLToPath(new URL(name, import.meta.url))),
        ),
      ],
    ),
  );
}
