import type { CapabilityFunction } from "../../../../capability-sdk/abi.js";
import { empty, holdWindow, round3 } from "../../../../capability-sdk/helpers.js";
import type { AudioEvent } from "../../../../contracts/types.js";

const ambienceLed: CapabilityFunction = (input) => {
  if (input.segment !== "scene") return empty();
  const level = Number(input.params.sfxLevel);
  const { startMs, endMs } = input.window;
  const ambience = input.assets.ambience!;
  const audio: AudioEvent[] = [
    { ...ambience, startMs, durationMs: endMs - startMs, gain: round3(0.5 * level), loop: true, fadeInMs: 600, fadeOutMs: 600 },
  ];
  if (input.params.hits === true) {
    audio.push({ ...input.assets.hit!, startMs: holdWindow(input).start, durationMs: null, gain: round3(0.6 * level), loop: false, fadeInMs: 0, fadeOutMs: 0 });
  }
  return { layers: [], audio };
};
export default ambienceLed;
