import { camAt, frameForImage } from "./math.js";
import type { CameraKey } from "./types.js";

// Browser-safe: no Node, filesystem or compiler imports, so the web preview runs the same code.

export interface ApprovedSceneDirection {
  sceneId: string;
  camera: {
    move:
      | "hold"
      | "push-in"
      | "pull-out"
      | "pan-left"
      | "pan-right"
      | "tilt-up"
      | "tilt-down"
      | "climb"
      | "walk-in"
      | "reveal";
    focus: { x: number; y: number };
    speed: number;
  };
  effects: { rays: number; motes: number; leaves: number; warmth: number };
  footsteps: "none" | "gravel" | "stone" | "stair";
  ambience: { wind: number; stream: number };
  sounds: {
    sound: "bird-chirp" | "suzu" | "clap" | "temple-bell" | "low-swell";
    at: number;
    gain: number;
  }[];
}
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** Named move → camera keys (p 0..1; fx/fy focus; z ≥ 1 zoom over the whole photo) and bob. */
export function cameraForMove(
  camera: ApprovedSceneDirection["camera"],
  walking: boolean,
): { keys: CameraKey[]; bob: number } {
  const { x, y } = camera.focus;
  const a = 0.35 + 0.65 * clamp(camera.speed, 0, 1);
  const key = (p: number, fx: number, fy: number, z: number): CameraKey => ({
    p,
    fx: round(clamp(fx, 0, 1)),
    fy: round(clamp(fy, 0, 1)),
    z: round(z),
  });
  const span = 0.3 * a,
    near = 1.35 + 0.35 * a;
  let keys: CameraKey[];
  switch (camera.move) {
    case "hold":
      keys = [key(0, x, y, 1), key(1, x, y, 1 + 0.04 * a)];
      break;
    case "push-in":
    case "walk-in":
      keys = [key(0, 0.5, 0.5, 1), key(1, x, y, 1 + 0.65 * a)];
      break;
    case "pull-out":
      keys = [key(0, x, y, 1 + 0.65 * a), key(1, 0.5, 0.5, 1)];
      break;
    case "reveal":
      keys = [
        key(0, x, y, 1 + 1.1 * a),
        key(0.7, 0.5, 0.5, 1),
        key(1, 0.5, 0.5, 1),
      ];
      break;
    case "pan-left":
      keys = [key(0, x + span, y, near), key(1, x - span, y, near)];
      break;
    case "pan-right":
      keys = [key(0, x - span, y, near), key(1, x + span, y, near)];
      break;
    case "tilt-up":
      keys = [key(0, x, y + span, near), key(1, x, y - span, near)];
      break;
    case "tilt-down":
      keys = [key(0, x, y - span, near), key(1, x, y + span, near)];
      break;
    case "climb":
      // Start low on the stairs and rise toward the focus while drawing closer.
      keys = [
        key(0, x, Math.max(y + span, 0.8), 1.3),
        key(0.55, x, (y + Math.max(y + span, 0.8)) / 2, 1.3 + 0.25 * a),
        key(1, x, y, 1.45 + 0.35 * a),
      ];
      break;
  }
  const walkingMove = camera.move === "climb" || camera.move === "walk-in";
  return { keys, bob: walking && walkingMove ? round(1.6 + 1.6 * a) : 0 };
}

/**
 * Where the production painter places a photo for an approved scene at progress `p` (0..1):
 * the same `cameraForMove` keys, `camAt` easing and `follow` framing the MP4 render uses.
 * Walking bob and atmosphere are omitted; reduced motion holds the first frame like the painter.
 */
export function previewFrame(
  camera: ApprovedSceneDirection["camera"],
  p: number,
  viewport: { width: number; height: number },
  photo: { width: number; height: number },
  reducedMotion = false,
): { left: number; top: number; width: number; height: number } {
  const { keys } = cameraForMove(camera, false);
  const at = camAt(
    {
      id: "preview",
      image: "preview",
      t0: 0,
      t1: 1,
      fadeIn: 0,
      fadeOut: 0,
      bob: 0,
      framing: "follow",
      camera: keys,
    },
    reducedMotion ? 0 : Math.min(1, Math.max(0, p)),
  );
  return frameForImage(
    viewport.width,
    viewport.height,
    at,
    photo.width,
    photo.height,
    "follow",
  );
}
