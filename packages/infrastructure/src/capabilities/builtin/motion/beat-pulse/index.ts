import type { CapabilityFunction } from "../../../../capability-sdk/abi.js";
import { mapImages, round3, staticRect, subjectPx, tighten } from "../../../../capability-sdk/helpers.js";
import type { Anim, Ease } from "../../../../contracts/types.js";

const MAX_PULSES = 24;
const PULSE_MS = 180;

const beatPulse: CapabilityFunction = (input) => {
  if (input.segment !== "scene" || !input.scene || !input.beat) return { layers: input.upstream ?? [], audio: [] };
  const beatMs = Math.round(60000 / input.beat.bpm);
  const { startMs, endMs } = input.window;
  const first = input.beat.offsetMs + Math.ceil((startMs - input.beat.offsetMs) / beatMs) * beatMs;
  const beats: number[] = [];
  for (let t = first; t + PULSE_MS <= endMs && beats.length < MAX_PULSES; t += beatMs) beats.push(t);
  const subject = subjectPx(input);
  const amount = Number(input.params.motionAmount);
  const layers = mapImages(input.upstream ?? [], (image) => {
    const base = staticRect(image.src);
    const hit = tighten(base, subject, 1 - 0.08 * amount);
    const track = (field: "x" | "y" | "w" | "h"): Anim => ({
      keys: [
        { t: startMs, v: base[field], ease: "step" as Ease },
        ...beats.flatMap((t) => [
          { t, v: round3(hit[field]), ease: "ease-in-out" as Ease },
          { t: t + PULSE_MS, v: base[field], ease: "step" as Ease },
        ]),
      ],
    });
    return { ...image, src: { x: track("x"), y: track("y"), w: track("w"), h: track("h") } };
  });
  return { layers, audio: [] };
};
export default beatPulse;
