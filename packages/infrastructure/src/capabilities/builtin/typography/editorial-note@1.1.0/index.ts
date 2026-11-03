import type { CapabilityFunction } from "../../../../capability-sdk/abi.js";
import { empty, holdWindow, keys } from "../../../../capability-sdk/helpers.js";
import type { PainterNode } from "../../../../contracts/types.js";

const editorialNote: CapabilityFunction = (input) => {
  const { widthPx: W, heightPx: H } = input.profile;
  const { palette, fonts } = input.theme;
  const { startMs, endMs } = input.window;
  if (input.segment === "title" || input.segment === "overall-title") {
    const text = input.segment === "title" ? input.chapter.title : (input.theme.overallTitle ?? "");
    const opacity = keys([startMs, 0], [startMs + 500, 1], [endMs - 500, 1], [endMs, 0]);
    return {
      layers: [
        { type: "rect", startMs, endMs, x: 0, y: 0, w: W, h: H, color: palette.background },
        { type: "rect", startMs, endMs, x: 160, y: H * 0.38, w: 6, h: 96, color: palette.accent, opacity },
        {
          type: "text", role: "title", startMs, endMs, text, font: fonts.title, sizePx: 64, weight: 400, color: palette.text,
          letterSpacingPx: 2, align: "left", x: 190, y: H * 0.38, maxWidthPx: W * 0.6, lineHeight: 1.2, opacity,
        },
      ],
      audio: [],
    };
  }
  const caption = input.scene?.caption;
  if (input.segment !== "scene" || !caption || (!caption.ja && !caption.en)) return empty();
  const hold = holdWindow(input);
  const opacity = keys([hold.start, 0], [hold.start + 500, 1], [hold.end - 500, 1], [hold.end, 0]);
  // 1.1.0: a 0.6 scrim keeps captions at 4.5:1 or better over bright fixture images (1.0.0 used 0.5).
  const scrim = { color: palette.scrim, opacity: 0.6, padPx: 14 };
  const layers: PainterNode[] = [{ type: "rect", startMs, endMs, x: 150, y: H * 0.7, w: 5, h: 104, color: palette.accent, opacity }];
  if (caption.ja) {
    layers.push({
      type: "text", role: "caption", startMs, endMs, text: caption.ja, font: fonts.caption, sizePx: 40, weight: 400,
      color: palette.text, letterSpacingPx: 1, align: "left", x: 178, y: H * 0.7, maxWidthPx: W * 0.55, lineHeight: 1.3, opacity, scrim,
    });
  }
  if (caption.en) {
    layers.push({
      type: "text", role: "caption", startMs, endMs, text: caption.en, font: fonts.caption, sizePx: 26, weight: 400,
      color: palette.text, letterSpacingPx: 0.5, align: "left", x: 178, y: H * 0.7 + 60, maxWidthPx: W * 0.55, lineHeight: 1.3, opacity, scrim,
    });
  }
  return { layers, audio: [] };
};
export default editorialNote;
