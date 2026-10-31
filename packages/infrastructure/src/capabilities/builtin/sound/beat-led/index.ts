import type { CapabilityFunction } from "../../../../capability-sdk/abi.js";
import { empty, round3 } from "../../../../capability-sdk/helpers.js";
import type { AudioEvent } from "../../../../contracts/types.js";

const MAX_HITS = 12;

const beatLed: CapabilityFunction = (input) => {
  if (input.segment !== "scene" || !input.beat) return empty();
  const barMs = Math.round(60000 / input.beat.bpm) * 4;
  const { startMs, endMs } = input.window;
  const first = input.beat.offsetMs + Math.ceil((startMs - input.beat.offsetMs) / barMs) * barMs;
  const gain = round3(0.7 * Number(input.params.sfxLevel));
  const audio: AudioEvent[] = [];
  for (let t = first; t < endMs && audio.length < MAX_HITS; t += barMs) {
    audio.push({ ...input.assets.hit!, startMs: t, durationMs: null, gain, loop: false, fadeInMs: 0, fadeOutMs: 0 });
  }
  return { layers: [], audio };
};
export default beatLed;
