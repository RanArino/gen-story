import { empty, keys, seeded } from "film-capability-sdk";

/** @type {import("../../../../src/capability-sdk/abi.js").CapabilityFunction} */
const tornReveal = (input) => {
  if (input.segment !== "transition") return empty();
  const { startMs, endMs } = input.window;
  const { widthPx, heightPx } = input.profile;
  const jaggedness = input.params.jaggedness;
  if (typeof jaggedness !== "number") throw new Error("jaggedness must be resolved by the compiler");
  const amplitude = widthPx * jaggedness;
  const random = seeded(input.options.seed);
  const edge = Array.from({ length: 13 }, (_, index) => {
    const offset = (random() * 2 - 1) * amplitude;
    return {
      x: keys([startMs, -2 * amplitude + offset], [endMs, widthPx + 2 * amplitude + offset]),
      y: heightPx * index / 12,
    };
  });
  // The entire edge starts outside the left boundary and ends outside the right boundary.
  return {
    layers: [],
    audio: [],
    envelopes: { incoming: { clipPolygon: [{ x: 0, y: 0 }, ...edge, { x: 0, y: heightPx }] } },
  };
};

export default tornReveal;
