import type { CinematicScore } from "./types.js";
export class AudioHost {
  static renderOffline(
    score: CinematicScore,
    sounds: Record<string, unknown>,
    options?: { sampleRate?: number; tail?: number },
  ): Promise<AudioBuffer>;
}
export function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer;
