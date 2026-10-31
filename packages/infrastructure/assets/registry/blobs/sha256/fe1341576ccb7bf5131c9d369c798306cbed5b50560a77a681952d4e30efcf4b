import type { CapabilityFunction } from "../../../../capability-sdk/abi.js";
import { empty, holdWindow, keys } from "../../../../capability-sdk/helpers.js";
import type { PainterNode } from "../../../../contracts/types.js";

const kineticPhrase: CapabilityFunction = (input) => {
  const { widthPx: W, heightPx: H } = input.profile;
  const { palette, fonts } = input.theme;
  const { startMs, endMs } = input.window;
  const rise = input.options.reducedMotion ? 0 : 36;
  if (input.segment === "title" || input.segment === "overall-title") {
    const text = input.segment === "title" ? input.chapter.title : (input.theme.overallTitle ?? "");
    return {
      layers: [
        { type: "rect", startMs, endMs, x: 0, y: 0, w: W, h: H, color: palette.background },
        {
          type: "text", role: "title", startMs, endMs, text, font: fonts.title, sizePx: 104, weight: 700, color: palette.text,
          letterSpacingPx: 0, align: "center", x: W / 2, y: H * 0.4, maxWidthPx: W * 0.84, lineHeight: 1.1,
          opacity: keys([startMs, 0], [startMs + 250, 1], [endMs - 250, 1], [endMs, 0]),
          translateY: keys([startMs, rise], [startMs + 450, 0]),
        },
      ],
      audio: [],
    };
  }
  const caption = input.scene?.caption;
  if (input.segment !== "scene" || !caption || (!caption.ja && !caption.en)) return empty();
  const hold = holdWindow(input);
  const opacity = keys([hold.start, 0], [hold.start + 200, 1], [hold.end - 200, 1], [hold.end, 0]);
  // 1.1.0: a 0.6 scrim and the text color on the English line keep captions at 4.5:1 or better
  // (1.0.0 used 0.55 and the accent color, which measured 2.58:1 over bright fixture images).
  const scrim = { color: palette.scrim, opacity: 0.6, padPx: 12 };
  const layers: PainterNode[] = [];
  if (caption.ja) {
    layers.push({
      type: "text", role: "caption", startMs, endMs, text: caption.ja, font: fonts.caption, sizePx: 60, weight: 700,
      color: palette.text, letterSpacingPx: 0, align: "center", x: W / 2, y: H * 0.7, maxWidthPx: W * 0.84, lineHeight: 1.15,
      opacity, scrim, translateY: keys([hold.start, rise], [hold.start + 300, 0]),
    });
  }
  if (caption.en) {
    layers.push({
      type: "text", role: "caption", startMs, endMs, text: caption.en.toUpperCase(), font: fonts.caption, sizePx: 28, weight: 700,
      color: palette.text, letterSpacingPx: 3, align: "center", x: W / 2, y: H * 0.7 + 86, maxWidthPx: W * 0.84, lineHeight: 1.2, opacity, scrim,
    });
  }
  return { layers, audio: [] };
};
export default kineticPhrase;
