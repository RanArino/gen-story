import type { CapabilityFunction } from "../../../../capability-sdk/abi.js";
import { keys, mapImages, seeded, staticRect, subjectPx, tighten } from "../../../../capability-sdk/helpers.js";

const slowCamera: CapabilityFunction = (input) => {
  if (input.segment !== "scene" || !input.scene) return { layers: input.upstream ?? [], audio: [] };
  const amount = Number(input.params.motionAmount) * (input.options.reducedMotion ? 0.25 : 1);
  const pushIn = seeded(input.options.seed)() < 0.6;
  const subject = subjectPx(input);
  const { startMs, endMs } = input.window;
  const layers = mapImages(input.upstream ?? [], (image) => {
    const wide = staticRect(image.src);
    const tight = tighten(wide, subject, 1 - 0.1 * amount);
    const [from, to] = pushIn ? [wide, tight] : [tight, wide];
    return {
      ...image,
      src: {
        x: keys([startMs, from.x], [endMs, to.x]),
        y: keys([startMs, from.y], [endMs, to.y]),
        w: keys([startMs, from.w], [endMs, to.w]),
        h: keys([startMs, from.h], [endMs, to.h]),
      },
    };
  });
  return { layers, audio: [] };
};
export default slowCamera;
