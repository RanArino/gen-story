import { execFileSync, spawnSync } from "node:child_process";
import { verifyReferenceMedia } from "./verify.js";

export function inspectReferenceFile(file: string, expectedSeconds: number) {
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_streams", "-show_format", "-of", "json", file],
      { encoding: "utf8" },
    ),
  );
  const measured = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-i",
      file,
      "-af",
      "loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  if (measured.status !== 0)
    throw new Error(`Reference measurement failed: ${measured.stderr}`);
  const match = measured.stderr.match(/\{\s*"input_i"[\s\S]*?\}/);
  if (!match) throw new Error("Missing reference loudness evidence");
  const levels = JSON.parse(match[0]);
  const video = probe.streams.find(
    (s: { codec_type: string }) => s.codec_type === "video",
  );
  const audio = probe.streams.find(
    (s: { codec_type: string }) => s.codec_type === "audio",
  );
  const evidence = {
    expectedSeconds,
    durationSeconds: Number(probe.format.duration),
    video: {
      codec: video?.codec_name,
      width: video?.width,
      height: video?.height,
      fps: video?.r_frame_rate,
      frames: Number(video?.nb_frames),
    },
    audio: {
      codec: audio?.codec_name,
      sampleRate: Number(audio?.sample_rate),
      channels: audio?.channels,
      integratedLufs: Number(levels.input_i),
      truePeakDb: Number(levels.input_tp),
    },
  };
  verifyReferenceMedia(evidence);
  return { probe, evidence, loudnessLog: measured.stderr };
}
