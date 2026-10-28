// An artifact is downloadable only after ffprobe confirms the profile and the exact frame count.
import { filmError, type FilmError } from "../contracts/errors.js";
import type { OutputProfile } from "../contracts/types.js";
import { probe } from "./ffmpeg.js";

export async function verifyMp4(file: string, expectedFrames: number, profile: OutputProfile, limitMs: number | null = null): Promise<FilmError[]> {
  const p = await probe(file);
  const problems: string[] = [];
  if (!p.video) problems.push("no video stream");
  else {
    if (p.video.codec !== "h264") problems.push(`video codec ${p.video.codec}`);
    if (p.video.width !== profile.widthPx || p.video.height !== profile.heightPx) problems.push(`size ${p.video.width}x${p.video.height}`);
    if (p.video.rate !== `${profile.fps}/1`) problems.push(`frame rate ${p.video.rate}`);
    if (p.video.frames !== expectedFrames) problems.push(`${p.video.frames} frames, expected ${expectedFrames}`);
  }
  if (!p.audio) problems.push("no audio stream");
  else {
    if (p.audio.codec !== "aac") problems.push(`audio codec ${p.audio.codec}`);
    if (p.audio.sampleRate !== 48000) problems.push(`audio ${p.audio.sampleRate} Hz`);
    if (p.audio.channels !== 2) problems.push(`${p.audio.channels} audio channels`);
  }
  if (limitMs !== null) {
    for (const [name, stream] of [["video", p.video], ["audio", p.audio]] as const) {
      if (!stream) continue;
      const [num, den] = stream.timeBase.split("/").map(Number);
      if (!Number.isSafeInteger(stream.durationTicks) || !num || !den) problems.push(`${name} has no integer duration timebase`);
      else if (BigInt(stream.durationTicks) * BigInt(num) * 1000n > BigInt(limitMs) * BigInt(den)) problems.push(`${name} presented duration exceeds ${limitMs} ms`);
    }
    if (p.containerDurationUs === undefined || p.containerDurationUs > limitMs * 1000) problems.push(`container duration exceeds ${limitMs} ms or is unavailable`);
  }
  return problems.length ? [filmError("FS_ARTIFACT_VERIFY_FAILED", "", `${file} failed verification: ${problems.join("; ")}`, { probe: p, expectedFrames })] : [];
}
