export interface ReferenceMediaEvidence {
  expectedSeconds: number;
  video: {
    codec: string;
    width: number;
    height: number;
    fps: string;
    frames: number;
  };
  audio: {
    codec: string;
    sampleRate: number;
    channels: number;
    integratedLufs: number;
    truePeakDb: number;
  };
  durationSeconds: number;
}

/** Technical integrity only; this never records a human artistic or listening verdict. */
export function verifyReferenceMedia(evidence: ReferenceMediaEvidence): void {
  const { video, audio, expectedSeconds, durationSeconds } = evidence;
  if (
    !Number.isFinite(durationSeconds) ||
    Math.abs(durationSeconds - expectedSeconds) > 1 / 30 + 0.001
  )
    throw new Error(
      "Reference duration does not match the full requested timeline.",
    );
  if (
    video.codec !== "h264" ||
    video.width !== 1280 ||
    video.height !== 720 ||
    video.fps !== "30/1" ||
    video.frames !== Math.round(expectedSeconds * 30)
  )
    throw new Error(
      "Reference video does not match the 720p30 capture profile.",
    );
  if (
    audio.codec !== "aac" ||
    audio.sampleRate !== 48000 ||
    audio.channels !== 2
  )
    throw new Error("Reference audio must be 48 kHz stereo AAC.");
  if (
    !Number.isFinite(audio.integratedLufs) ||
    !Number.isFinite(audio.truePeakDb)
  )
    throw new Error(
      "Reference audio is silent or its loudness could not be measured.",
    );
  if (audio.truePeakDb >= 0)
    throw new Error("Reference audio has no true-peak headroom.");
}
