export type CurvePoint = [number, number];
export type Look =
  | "cool"
  | "warm"
  | "vignette"
  | "rays"
  | "motes"
  | "leaves"
  | "speed"
  | "bloom";
export interface CameraKey {
  p: number;
  fx: number;
  fy: number;
  z: number;
}
export interface CinematicScene {
  id: string;
  image: string;
  t0: number;
  t1: number;
  fadeIn: number;
  fadeOut: number;
  bob: number;
  camera: CameraKey[];
}
export interface Show {
  in: number;
  fadeIn: number;
  out: number | null;
  fadeOut?: number;
}
export interface Card {
  display: string;
  name?: string;
  tagline?: string;
  taglineSub?: string;
  lines?: string[];
  footer?: string;
  show: Show;
}
export interface SoundEvent {
  t: number;
  sound: SoundId;
  params: Record<string, number | string | number[] | string[]>;
  i: number;
  sustain?: boolean;
}
export type SoundId =
  | "pad"
  | "koto-pluck"
  | "footstep"
  | "wind"
  | "stream"
  | "bird-chirp"
  | "suzu"
  | "clap"
  | "temple-bell"
  | "low-swell";
export interface CinematicScore {
  seed: number;
  duration: number;
  events: SoundEvent[];
  beds: {
    name: string;
    sound: "wind" | "stream";
    params: Record<string, number>;
    curve: CurvePoint[];
    salt: number;
  }[];
  master: CurvePoint[];
  mix: {
    reverb: { seconds: number; decay: number; wet: number };
    buses: { music: number; foley: number; ambience: number; sfx: number };
  };
}
/** Authored, versioned data. All times in seconds; no executable fields or remote URLs. */
export interface CinematicDirection {
  schema: "film.cinematic-direction@1";
  projectId: string;
  chapterId: string;
  revision: number;
  title: string;
  seed: number;
  duration: number;
  reducedMotion: boolean;
  assets: Record<
    string,
    { asset: string; sha256: string; widthPx: number; heightPx: number }
  >;
  scenes: CinematicScene[];
  params: Record<Look, CurvePoint[]>;
  options: {
    rays: number;
    motes: number;
    leaves: number;
    leafColors: string[];
    light: [number, number, number];
    coolWash: string;
    warmWash: string;
    grain: number;
    transitionGlow: number;
  };
  steps: { t: number; surface: string }[];
  captions: {
    t0: number;
    t1: number;
    text: string;
    sub: string;
    mid: boolean;
  }[];
  titleCard: Card | null;
  slates: { display: string; text: string; show: Show }[];
  credits: Card | null;
  score: CinematicScore;
}
