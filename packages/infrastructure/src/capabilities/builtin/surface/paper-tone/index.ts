import type { CapabilityFunction } from "../../../../capability-sdk/abi.js";
import { empty, round3 } from "../../../../capability-sdk/helpers.js";

const paperTone: CapabilityFunction = (input) => {
  if (input.segment !== "scene") return empty();
  const { widthPx: W, heightPx: H } = input.profile;
  const { startMs, endMs } = input.window;
  const intensity = Number(input.params.visualIntensity);
  return {
    layers: [
      {
        type: "group",
        startMs,
        endMs,
        blend: "multiply",
        opacity: round3(0.35 + 0.3 * intensity),
        children: [
          { type: "rect", startMs, endMs, x: 0, y: 0, w: W, h: H, color: "#f1e4cc" },
          {
            type: "linearGradient", startMs, endMs, x: 0, y: 0, w: W, h: H, from: { x: 0, y: 0 }, to: { x: W, y: H },
            stops: [
              { at: 0, color: "#ffffff" },
              { at: 1, color: "#d9c7a6" },
            ],
          },
        ],
      },
    ],
    audio: [],
  };
};
export default paperTone;
