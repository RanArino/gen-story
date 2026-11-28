import type { CinematicScene, CurvePoint, Show } from "./types.js";
export function clamp01(x: number): number;
export function smooth(x: number): number;
export function lerp(a: number, b: number, t: number): number;
export function easeIO(x: number): number;
export function rngFor(seed: number, salt: number): () => number;
export function curve(
  points: CurvePoint[],
  time: number,
  fallback?: number,
): number;
export function camAt(
  scene: CinematicScene,
  time: number,
): { fx: number; fy: number; z: number };
export function frameFor(
  width: number,
  height: number,
  camera: { fx: number; fy: number; z: number },
  margin?: number,
): { left: number; top: number; B: number; S: number };
export function sceneOpacity(scene: CinematicScene, time: number): number;
export function showAlpha(show: Show, time: number): number;
export function bobAt(
  steps: { t: number }[],
  time: number,
  amount: number,
  reduced?: boolean,
): number;
export function frameForImage(
  vw: number,
  vh: number,
  camera: { fx: number; fy: number; z: number },
  width: number,
  height: number,
  framing?: "contain" | "follow",
): { left: number; top: number; width: number; height: number };
export function wrapBalanced(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
  maxLines?: number,
): string[];
export interface PaperNoteInput {
  text: string;
  sub: string;
  /** Width of `text` set at `size`, in the same units as the frame. */
  measure: (text: string, size: number) => number;
}
export interface PaperNote {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  main: string[];
  sub: string[];
  size: number;
  subSize: number;
  lineHeight: number;
  gapLines: number;
  padY: number;
}
export function paperCardFrame(
  width: number,
  height: number,
  camera: { fx: number; fy: number; z: number },
  imageWidth: number,
  imageHeight: number,
  index: number,
  note?: PaperNoteInput | null,
): {
  x: number;
  y: number;
  width: number;
  height: number;
  border: number;
  rotation: number;
  note?: PaperNote;
};
export interface FrameBox {
  x: number;
  y: number;
  width: number;
  height: number;
  crop?: "16:9" | "9:16" | "1:1";
}
export interface FramePlace {
  x: number;
  y: number;
  size: number;
}
export function photoBox(
  width: number,
  height: number,
  box: FrameBox,
): FrameBox & { left: number; top: number };
export function paperCardBox(
  width: number,
  height: number,
  box: FrameBox,
  index: number,
): {
  x: number;
  y: number;
  width: number;
  height: number;
  outerWidth: number;
  outerHeight: number;
  border: number;
  rotation: number;
};
export function paperNoteFrame(
  width: number,
  height: number,
  place: FramePlace,
  note: PaperNoteInput | null | undefined,
  cardWidth?: number,
): PaperNote | null;
