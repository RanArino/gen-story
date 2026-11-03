import type { CapabilityFunction } from "../../../../capability-sdk/abi.js";
import { empty, keys } from "../../../../capability-sdk/helpers.js";

const FADE_MS = 300;

const dip: CapabilityFunction = (input) => {
  if (input.segment !== "transition") return empty();
  const { startMs, endMs } = input.window;
  const { widthPx: W, heightPx: H } = input.profile;
  const color = input.params.color === "paper" ? "#f1e4cc" : "#000000";
  return {
    // Drawn beneath both segments: it shows through while they fade and fills the gap.
    layers: [{ type: "rect", startMs: Math.max(0, startMs - FADE_MS), endMs: endMs + FADE_MS, x: 0, y: 0, w: W, h: H, color }],
    audio: [],
    envelopes: {
      outgoing: { opacity: keys([startMs - FADE_MS, 1], [startMs, 0]) },
      incoming: { opacity: keys([endMs, 0], [endMs + FADE_MS, 1]) },
    },
  };
};
export default dip;
