import type { CapabilityFunction } from "../../../../capability-sdk/abi.js";
import { keys, mapImages, seeded, staticRect, subjectPx, tighten } from "../../../../capability-sdk/helpers.js";

const parallaxCards: CapabilityFunction = (input) => {
  if (input.segment !== "scene" || !input.scene) return { layers: input.upstream ?? [], audio: [] };
  const amount = Number(input.params.motionAmount);
  const direction = seeded(input.options.seed)() < 0.5 ? -1 : 1;
  const subject = subjectPx(input);
  const { startMs, endMs } = input.window;
  const zoomed = mapImages(input.upstream ?? [], (image) => {
    const wide = staticRect(image.src);
    const tight = tighten(wide, subject, 1 - 0.06 * amount);
    return {
      ...image,
      src: {
        x: keys([startMs, wide.x], [endMs, tight.x]),
        y: keys([startMs, wide.y], [endMs, tight.y]),
        w: keys([startMs, wide.w], [endMs, tight.w]),
        h: keys([startMs, wide.h], [endMs, tight.h]),
      },
    };
  });
  // Backdrop groups (with a filter) drift less than foreground cards, which reads as depth.
  const layers = zoomed.map((node) => {
    if (node.type !== "group") return node;
    const travel = (node.filter ? 12 : 48) * amount * direction;
    return { ...node, translateX: keys([startMs, -travel], [endMs, travel]) };
  });
  return { layers, audio: [] };
};
export default parallaxCards;
