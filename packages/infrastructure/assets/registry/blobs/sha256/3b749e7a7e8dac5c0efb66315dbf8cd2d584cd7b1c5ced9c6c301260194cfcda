import type { CapabilityFunction } from "../../../../capability-sdk/abi.js";
import { empty, holdWindow, keys } from "../../../../capability-sdk/helpers.js";
import type { PainterNode } from "../../../../contracts/types.js";

const subtitle: CapabilityFunction = (input) => {
  const { widthPx: W, heightPx: H } = input.profile;
  const { palette, fonts } = input.theme;
  const { startMs, endMs } = input.window;
  if (input.segment === "title" || input.segment === "overall-title") {
    const text = input.segment === "title" ? input.chapter.title : (input.theme.overallTitle ?? "");
    return {
      layers: [
        { type: "rect", startMs, endMs, x: 0, y: 0, w: W, h: H, color: palette.background },
        {
          type: "text", role: "title", startMs, endMs, text, font: fonts.title, sizePx: 72, weight: 400, color: palette.text,
          letterSpacingPx: 4, align: "center", x: W / 2, y: H * 0.42, maxWidthPx: W * 0.8, lineHeight: 1.25,
          opacity: keys([startMs, 0], [startMs + 600, 1], [endMs - 600, 1], [endMs, 0]),
        },
      ],
      audio: [],
    };
  }
  const caption = input.scene?.caption;
  if (input.segment !== "scene" || !caption || (!caption.ja && !caption.en)) return empty();
  const hold = holdWindow(input);
  const opacity = keys([hold.start, 0], [hold.start + 400, 1], [hold.end - 400, 1], [hold.end, 0]);
  const scrim = { color: palette.scrim, opacity: 0.45, padPx: 16 };
  const layers: PainterNode[] = [];
  if (caption.ja) {
    layers.push({
      type: "text", role: "caption", startMs, endMs, text: caption.ja, font: fonts.caption, sizePx: 44, weight: 400,
      color: palette.text, letterSpacingPx: 1, align: "center", x: W / 2, y: H * 0.79, maxWidthPx: W * 0.8, lineHeight: 1.3, opacity, scrim,
    });
  }
  if (caption.en) {
    layers.push({
      type: "text", role: "caption", startMs, endMs, text: caption.en, font: fonts.caption, sizePx: 30, weight: 400,
      color: palette.text, letterSpacingPx: 0, align: "center", x: W / 2, y: H * 0.79 + 66, maxWidthPx: W * 0.8, lineHeight: 1.3, opacity, scrim,
    });
  }
  return { layers, audio: [] };
};
export default subtitle;
