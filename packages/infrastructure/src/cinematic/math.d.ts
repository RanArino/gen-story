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
): { left: number; top: number; width: number; height: number };
