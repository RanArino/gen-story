import type { CapabilityFunction } from "../../../../capability-sdk/abi.js";
import { empty, keys } from "../../../../capability-sdk/helpers.js";

const dissolve: CapabilityFunction = (input) => {
  if (input.segment !== "transition") return empty();
  const { startMs, endMs } = input.window;
  const ease = input.params.curve === "linear" ? "linear" : "ease-in-out";
  return { layers: [], audio: [], envelopes: { incoming: { opacity: keys([startMs, 0, ease], [endMs, 1, ease]) } } };
};
export default dissolve;
