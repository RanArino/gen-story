// ffmpeg and ffprobe invocations shared by Chapter and concatenation rendering.
import { spawn } from "node:child_process";
import { fail } from "../contracts/errors.js";

/**
 * One fixed H.264 configuration for every video part (Chapters, the overall title, and darken
 * holds), so the concatenation can join them with stream copy and keep Chapter frames identical.
 * A 48 kHz movie clock represents both frame boundaries and audio samples without edit rounding.
 */
export const X264 = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-profile:v", "high", "-level:v", "4.1", "-g", "30", "-bf", "2", "-r", "30", "-movie_timescale", "48000"];
export const AAC = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2"];

/** frame = floor((ms * fps + 500) / 1000), recorded in Plans as round-half-up@1. */
export function frameCount(ms: number, fps: number): number {
  return Math.floor((ms * fps + 500) / 1000);
}

/**
 * Runs a binary without blocking the event loop (the render server shares this process) and
 * returns its stdout, stderr, and exit code.
 */
export function run(bin: string, args: string[]): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((done, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => done({ code: code ?? 1, stdout: Buffer.concat(out), stderr }));
  });
}

export async function ffmpeg(args: string[]): Promise<void> {
  const r = await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args]);
  if (r.code !== 0) fail("FS_ARTIFACT_VERIFY_FAILED", "", `ffmpeg failed: ${r.stderr.trim().slice(0, 2000)}`);
}

/** Raw ffmpeg stdout (for decoded pixels and samples). */
export async function ffmpegOut(args: string[]): Promise<Buffer> {
  const r = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args]);
  if (r.code !== 0) fail("FS_ARTIFACT_VERIFY_FAILED", "", `ffmpeg failed: ${r.stderr.trim().slice(0, 2000)}`);
  return r.stdout;
}

export interface FrameSink {
  write(png: Buffer): Promise<void>;
  close(): Promise<void>;
}

/** Starts an encoder reading PNG frames on stdin and writing a video-only MP4. */
export function pngEncoder(out: string, fps: number): FrameSink {
  const child = spawn("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-", ...X264, "-an", out], {
    stdio: ["pipe", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  const exited = new Promise<number>((done) => child.on("close", (code) => done(code ?? 1)));
  return {
    write: (png) =>
      new Promise<void>((done, reject) => {
        child.stdin.write(png, (error) => (error ? reject(error) : done()));
      }),
    async close() {
      child.stdin.end();
      const code = await exited;
      if (code !== 0) fail("FS_ARTIFACT_VERIFY_FAILED", "", `ffmpeg encoder failed: ${stderr.trim().slice(0, 2000)}`);
    },
  };
}

export interface ProbeResult {
  containerDurationUs?: number;
  video?: { durationTicks: number; timeBase: string; codec: string; width: number; height: number; rate: string; frames: number };
  audio?: { durationTicks: number; timeBase: string; codec: string; sampleRate: number; channels: number };
}

export async function probe(file: string): Promise<ProbeResult> {
  const r = await run("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "format=duration:stream=duration_ts,time_base,codec_type,codec_name,width,height,r_frame_rate,nb_read_frames,sample_rate,channels", "-of", "json", file]);
  if (r.code !== 0) fail("FS_ARTIFACT_VERIFY_FAILED", "", `ffprobe failed on ${file}: ${r.stderr.trim()}`);
  const raw = JSON.parse(r.stdout.toString()) as { streams: Record<string, string | number>[]; format: { duration?: string } };
  const streams = raw.streams;
  const v = streams.find((s) => s.codec_type === "video");
  const a = streams.find((s) => s.codec_type === "audio");
  return {
    ...(raw.format.duration ? { containerDurationUs: Math.round(Number(raw.format.duration) * 1000000) } : {}),
    ...(v ? { video: { durationTicks: Number(v.duration_ts), timeBase: String(v.time_base), codec: String(v.codec_name), width: Number(v.width), height: Number(v.height), rate: String(v.r_frame_rate), frames: Number(v.nb_read_frames) } } : {}),
    ...(a ? { audio: { durationTicks: Number(a.duration_ts), timeBase: String(a.time_base), codec: String(a.codec_name), sampleRate: Number(a.sample_rate), channels: Number(a.channels) } } : {}),
  };
}
