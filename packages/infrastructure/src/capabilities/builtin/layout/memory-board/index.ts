import type { CapabilityFunction } from "../../../../capability-sdk/abi.js";
import { empty, round3, safeCrop, seeded } from "../../../../capability-sdk/helpers.js";

const memoryBoard: CapabilityFunction = (input) => {
  const media = input.scene?.media[0];
  if (input.segment !== "scene" || !media) return empty();
  const { widthPx: W, heightPx: H } = input.profile;
  const { startMs, endMs } = input.window;
  const random = seeded(input.options.seed);
  const cardH = round3(H * Number(input.params.cardScale));
  const cardW = round3((cardH * 4) / 3);
  const border = 18;
  const cx = W * (0.44 + random() * 0.12);
  const cy = H * (0.47 + random() * 0.04);
  const x = round3(cx - cardW / 2);
  const y = round3(cy - cardH / 2);
  return {
    layers: [
      { type: "rect", startMs, endMs, x: 0, y: 0, w: W, h: H, color: input.theme.palette.background },
      {
        type: "group",
        startMs,
        endMs,
        opacity: 0.35,
        filter: { blur: 18 },
        children: [
          { type: "image", startMs, endMs, asset: media.asset, sha256: media.sha256, src: safeCrop(input, W / H), dst: { x: 0, y: 0, w: W, h: H } },
        ],
      },
      {
        type: "group",
        startMs,
        endMs,
        children: [
          { type: "rect", startMs, endMs, x: x - border + 12, y: y - border + 14, w: cardW + border * 2, h: cardH + border * 2, color: "#00000040" },
          { type: "rect", startMs, endMs, x: x - border, y: y - border, w: cardW + border * 2, h: cardH + border * 2, color: "#f7f3ea" },
          { type: "image", startMs, endMs, asset: media.asset, sha256: media.sha256, src: safeCrop(input, 4 / 3), dst: { x, y, w: cardW, h: cardH } },
        ],
      },
    ],
    audio: [],
  };
};
export default memoryBoard;
