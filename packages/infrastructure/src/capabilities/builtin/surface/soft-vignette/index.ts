import type { CapabilityFunction } from "../../../../capability-sdk/abi.js";
import { empty } from "../../../../capability-sdk/helpers.js";

function alphaHex(alpha: number): string {
  return Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
}

const softVignette: CapabilityFunction = (input) => {
  if (input.segment !== "scene") return empty();
  const { widthPx: W, heightPx: H } = input.profile;
  const { startMs, endMs } = input.window;
  const edge = `#000000${alphaHex(0.6 * Number(input.params.visualIntensity))}`;
  const stops = [
    { at: 0, color: edge },
    { at: 1, color: "#00000000" },
  ];
  const bandX = W * 0.22;
  const bandY = H * 0.22;
  return {
    layers: [
      { type: "linearGradient", startMs, endMs, x: 0, y: 0, w: W, h: bandY, from: { x: 0, y: 0 }, to: { x: 0, y: bandY }, stops },
      { type: "linearGradient", startMs, endMs, x: 0, y: H - bandY, w: W, h: bandY, from: { x: 0, y: H }, to: { x: 0, y: H - bandY }, stops },
      { type: "linearGradient", startMs, endMs, x: 0, y: 0, w: bandX, h: H, from: { x: 0, y: 0 }, to: { x: bandX, y: 0 }, stops },
      { type: "linearGradient", startMs, endMs, x: W - bandX, y: 0, w: bandX, h: H, from: { x: W, y: 0 }, to: { x: W - bandX, y: 0 }, stops },
    ],
    audio: [],
  };
};
export default softVignette;
