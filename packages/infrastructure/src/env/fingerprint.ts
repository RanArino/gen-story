import { painterSourceDigest } from "../painter/identity.js";
import { resolveChromePath } from "./chrome.js";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { release, platform } from "node:os";
import { fileURLToPath } from "node:url";

export const PAINTER_SOURCE = fileURLToPath(
  new URL("../painter/painter.ts", import.meta.url),
);

export interface EnvFingerprint {
  node: string;
  chrome: { path: string; version: string } | null;
  ffmpeg: string;
  ffprobe: string;
  os: string;
  painterDigest: string;
}

export function sha256(data: string | Buffer): string {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`;
}

function firstLineVersion(bin: string): string {
  const out = execFileSync(bin, ["-version"], { encoding: "utf8" });
  const match = /version (\S+)/.exec(out);
  if (!match?.[1]) throw new Error(`cannot read ${bin} version`);
  return match[1];
}

function chromeVersion(path: string): string {
  const out = execFileSync(path, ["--version"], { encoding: "utf8" });
  const match = /(\d+\.\d+\.\d+\.\d+)/.exec(out);
  if (!match?.[1]) throw new Error(`cannot read Chrome version from ${path}`);
  return match[1];
}

export function readFingerprint(
  chromePath = resolveChromePath(),
): EnvFingerprint {
  return {
    node: process.version,
    chrome: chromePath
      ? { path: chromePath, version: chromeVersion(chromePath) }
      : null,
    ffmpeg: firstLineVersion("ffmpeg"),
    ffprobe: firstLineVersion("ffprobe"),
    os: `${platform()} ${release()}`,
    painterDigest: painterSourceDigest(),
  };
}
