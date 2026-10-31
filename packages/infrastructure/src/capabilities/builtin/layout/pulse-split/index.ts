import type { CapabilityFunction } from "../../../../capability-sdk/abi.js";
import { empty, round3, safeCrop } from "../../../../capability-sdk/helpers.js";
import type { PainterNode } from "../../../../contracts/types.js";

const pulseSplit: CapabilityFunction = (input) => {
  const media = input.scene?.media[0];
  if (input.segment !== "scene" || !media) return empty();
  const { widthPx: W, heightPx: H } = input.profile;
  const { startMs, endMs } = input.window;
  const panels = Number(input.params.panels);
  const gap = 12;
  const panelW = round3((W - gap * (panels - 1)) / panels);
  const layers: PainterNode[] = [{ type: "rect", startMs, endMs, x: 0, y: 0, w: W, h: H, color: "#000000" }];
  for (let i = 0; i < panels; i += 1) {
    layers.push({
      type: "image",
      startMs,
      endMs,
      asset: media.asset,
      sha256: media.sha256,
      src: safeCrop(input, panelW / H, 1 - 0.2 * i),
      dst: { x: round3(i * (panelW + gap)), y: 0, w: panelW, h: H },
    });
  }
  return { layers, audio: [] };
};
export default pulseSplit;
