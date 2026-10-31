import type { CapabilityFunction } from "../../../../capability-sdk/abi.js";
import { empty, keys, round3, seeded } from "../../../../capability-sdk/helpers.js";

const lightLeak: CapabilityFunction = (input) => {
  if (input.segment !== "scene") return empty();
  const { widthPx: W, heightPx: H } = input.profile;
  const { startMs, endMs } = input.window;
  const direction = seeded(input.options.seed)() < 0.5 ? -1 : 1;
  const travel = input.options.reducedMotion ? 0 : W * 0.4 * direction;
  return {
    layers: [
      {
        type: "group",
        startMs,
        endMs,
        blend: "screen",
        opacity: round3(0.18 + 0.3 * Number(input.params.visualIntensity)),
        translateX: keys([startMs, -travel], [endMs, travel]),
        children: [
          {
            type: "linearGradient", startMs, endMs, x: W * 0.25, y: 0, w: W * 0.5, h: H, from: { x: W * 0.25, y: 0 }, to: { x: W * 0.75, y: 0 },
            stops: [
              { at: 0, color: "#ffb36b00" },
              { at: 0.5, color: "#ffb36bcc" },
              { at: 1, color: "#ffb36b00" },
            ],
          },
        ],
      },
    ],
    audio: [],
  };
};
export default lightLeak;
