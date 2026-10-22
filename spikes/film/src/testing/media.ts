// Media measurements for render acceptance tests. ffmpeg decodes every frame and sample, so the
// spike needs no image or audio decoder dependency.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { Box } from "../painter/protocol.js";
import { ffmpegOut, run } from "../render/ffmpeg.js";

/** MD5 of every decoded video frame, in order. */
export async function frameMd5s(file: string): Promise<string[]> {
  return (await ffmpegOut(["-i", file, "-map", "0:v", "-f", "framemd5", "-"]))
    .toString()
    .split("\n")
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.split(",").at(-1)!.trim());
}

function frameFilter(frame: number): string {
  return `select=eq(n\\,${frame})`;
}

/** Decoded RGB bytes of one MP4 frame, optionally cropped to a box. */
export function mp4Rgb(file: string, frame: number, box?: Box): Promise<Buffer> {
  const crop = box ? `,crop=${Math.round(box.w)}:${Math.round(box.h)}:${Math.round(box.x)}:${Math.round(box.y)}` : "";
  return ffmpegOut(["-i", file, "-vf", `${frameFilter(frame)}${crop},format=rgb24`, "-frames:v", "1", "-f", "rawvideo", "-"]);
}

/** Decoded RGB bytes of a PNG, optionally cropped to a box. */
export async function pngRgb(png: Buffer, box?: Box): Promise<Buffer> {
  const dir = mkdtempSync(`${tmpdir()}/film-png-`);
  try {
    writeFileSync(`${dir}/f.png`, png);
    const crop = box ? `crop=${Math.round(box.w)}:${Math.round(box.h)}:${Math.round(box.x)}:${Math.round(box.y)},` : "";
    return await ffmpegOut(["-i", `${dir}/f.png`, "-vf", `${crop}format=rgb24`, "-frames:v", "1", "-f", "rawvideo", "-"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function linear(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an sRGB colour. */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function hexLuminance(hex: string): number {
  return luminance(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
}

export function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Pixel luminances of RGB bytes. */
export function luminances(rgb: Buffer): number[] {
  const out: number[] = [];
  for (let i = 0; i + 2 < rgb.length; i += 3) out.push(luminance(rgb[i]!, rgb[i + 1]!, rgb[i + 2]!));
  return out;
}

export function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]!;
}

/** Mono 48 kHz float samples of a window of any audio-bearing file. */
export async function pcm(file: string, startMs: number, durationMs: number): Promise<Float32Array> {
  const bytes = await ffmpegOut(["-i", file, "-ss", String(startMs / 1000), "-t", String(durationMs / 1000), "-map", "0:a", "-ac", "1", "-ar", "48000", "-f", "f32le", "-"]);
  return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
}

/** Normalized cross-correlation at zero lag. */
export function ncc(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i += 1) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i]! - ma;
    const y = b[i]! - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  return num / Math.sqrt(da * db);
}

/** PSNR in dB between a PNG frame and one decoded MP4 frame, over RGB. */
export async function psnr(png: Buffer, file: string, frame: number): Promise<number> {
  const dir = mkdtempSync(`${tmpdir()}/film-psnr-`);
  try {
    writeFileSync(`${dir}/f.png`, png);
    const r = await run("ffmpeg", ["-hide_banner", "-i", `${dir}/f.png`, "-i", file, "-filter_complex", `[0:v]format=rgb24[a];[1:v]${frameFilter(frame)},format=rgb24[b];[a][b]psnr`, "-frames:v", "1", "-f", "null", "-"]);
    const match = /average:([0-9.]+|inf)/.exec(r.stderr);
    if (!match?.[1]) throw new Error(`psnr failed: ${r.stderr.slice(-500)}`);
    return match[1] === "inf" ? Infinity : Number(match[1]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
