import type { CapabilityFunction } from "../../../../capability-sdk/abi.js";
import { empty, keys } from "../../../../capability-sdk/helpers.js";

// The join holds the last frame of the outgoing Chapter and ramps its brightness down.
const darkenBriefly: CapabilityFunction = (input) => {
  if (input.segment !== "join") return empty();
  const { startMs, endMs } = input.window;
  return {
    layers: [],
    audio: [],
    envelopes: { outgoing: { brightness: keys([startMs, 1, "linear"], [endMs, Number(input.params.brightnessTo), "linear"]) } },
  };
};
export default darkenBriefly;
