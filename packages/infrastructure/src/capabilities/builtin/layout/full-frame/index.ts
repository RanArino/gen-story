import type { CapabilityFunction } from "../../../../capability-sdk/abi.js";
import { empty, safeCrop } from "../../../../capability-sdk/helpers.js";

const fullFrame: CapabilityFunction = (input) => {
  const media = input.scene?.media[0];
  if (input.segment !== "scene" || !media) return empty();
  const { widthPx: W, heightPx: H } = input.profile;
  return {
    layers: [
      {
        type: "image",
        startMs: input.window.startMs,
        endMs: input.window.endMs,
        asset: media.asset,
        sha256: media.sha256,
        src: safeCrop(input, W / H),
        dst: { x: 0, y: 0, w: W, h: H },
      },
    ],
    audio: [],
  };
};
export default fullFrame;
