import type { CapabilityFunction } from "../../../../capability-sdk/abi.js";
import { empty, keys } from "../../../../capability-sdk/helpers.js";

const cardSlide: CapabilityFunction = (input) => {
  if (input.segment !== "transition") return empty();
  const { startMs, endMs } = input.window;
  const W = input.profile.widthPx;
  return {
    layers: [],
    audio: [],
    envelopes: {
      incoming: { translateX: keys([startMs, W], [endMs, 0]) },
      outgoing: { translateX: keys([startMs, 0], [endMs, -W * 0.25]), brightness: keys([startMs, 1], [endMs, 0.75]) },
    },
  };
};
export default cardSlide;
