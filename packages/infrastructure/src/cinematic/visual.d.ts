import type { MeasuredText } from "../painter/protocol.js";
import type { CinematicDirection } from "./types.js";
export function drawCinematic(
  ctx: CanvasRenderingContext2D,
  data: CinematicDirection,
  timeMs: number,
  width: number,
  height: number,
  image: (asset: string) => CanvasImageSource | undefined,
  omitRoles: string[] | undefined,
  aliases: { serif: string; latin: string },
): MeasuredText[];
