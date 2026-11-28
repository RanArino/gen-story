export type FilmRecipe = string;
export const FILM_ASPECTS = ["16:9", "9:16", "1:1"] as const;
export type FilmAspect = (typeof FILM_ASPECTS)[number];
/** Which caption lines are burned in; chosen per export, never stored on the treatment. */
export const FILM_SUBTITLE_MODES = ["both", "ja", "en", "none"] as const;
export type FilmSubtitleMode = (typeof FILM_SUBTITLE_MODES)[number];
export interface FilmSceneCaption {
  ja: string;
  en: string;
}
export interface FilmChapter {
  id: string;
  title: string;
  limitMs: number | null;
  settings?: {
    pacing?: number;
    motionAmount?: number;
    emphasis?: number;
    sfxLevel?: number;
    visualIntensity?: number;
  };
  scenes: { sceneId: string; durationMs?: number }[];
}
export interface FilmTreatment {
  projectId: string;
  revision: number;
  title: string;
  recipe: FilmRecipe;
  reducedMotion: boolean;
  /** Absent means 16:9. */
  outputAspect?: FilmAspect;
  sceneCaptions?: Record<string, FilmSceneCaption>;
  /** The user's photo and caption placement for every photo; absent parts use the template's. */
  layout?: FilmLayoutOverride;
  /** Per-photo placement that replaces the Film layout for that photo only. */
  sceneLayouts?: Record<string, FilmLayoutOverride>;
  chapters: FilmChapter[];
}
/** Photo box center and size, as fractions of the frame width and height. */
export interface FilmPhotoBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Crop shape; the height follows it at every video size. Absent: the video's shape. */
  crop?: FilmAspect;
}
/** Caption block center x and top y (frame fractions); size is a fraction of the shorter side. */
export interface FilmCaptionPlace {
  x: number;
  y: number;
  size: number;
}
export interface FilmFrameLayout {
  photo: FilmPhotoBox;
  caption: FilmCaptionPlace;
}
export interface FilmLayoutOverride {
  photo?: FilmPhotoBox;
  caption?: FilmCaptionPlace;
}
export interface FilmJob {
  id: string;
  projectId: string;
  revision: number;
  chapterId: string | null;
  fingerprint: string;
  status: "queued" | "running" | "succeeded" | "failed";
  error: string | null;
  artifactKey: string | null;
  artifactDigest: string | null;
  runtimeMs: number | null;
  createdAt: string;
}
export interface FilmSceneDto {
  id: string;
  title: string;
  selectedImageId: string | null;
  original: { storageKey: string } | null;
  images: { id: string; storageKey: string }[];
}
export const FILM_CAMERA_MOVES = [
  "hold",
  "push-in",
  "pull-out",
  "pan-left",
  "pan-right",
  "tilt-up",
  "tilt-down",
  "climb",
  "walk-in",
  "reveal",
] as const;
export const FILM_FOOTSTEP_SURFACES = [
  "none",
  "gravel",
  "stone",
  "stair",
] as const;
export const FILM_SCENE_SOUNDS = [
  "bird-chirp",
  "suzu",
  "clap",
  "temple-bell",
  "low-swell",
  "ocean-wave",
  "light-rain",
  "cicadas",
  "leaf-rustle",
  "train-pass",
  "cafe-cup",
  "camera-shutter",
  "wind-chime",
] as const;
export const FILM_MUSIC_INSTRUMENTS = [
  "pad",
  "koto-pluck",
  "low-swell",
] as const;
export const FILM_MUSIC_KEYS = [
  "C",
  "D",
  "Eb",
  "E",
  "F",
  "G",
  "A",
  "Bb",
] as const;
export const FILM_MELODY_DENSITIES = ["sparse", "medium", "flowing"] as const;
export const FILM_MUSIC_ARCS = ["steady", "rise", "fall", "swell"] as const;
export const FILM_MUSIC_JOINS = [
  "continue",
  "lift",
  "settle",
  "contrast",
] as const;
export interface FilmSceneDirectionDto {
  sceneId: string;
  observation: string;
  camera: {
    move: (typeof FILM_CAMERA_MOVES)[number];
    focus: { x: number; y: number };
    speed: number;
    reason: string;
  };
  effects: { rays: number; motes: number; leaves: number; warmth: number };
  footsteps: (typeof FILM_FOOTSTEP_SURFACES)[number];
  ambience: { wind: number; stream: number };
  sounds: {
    sound: (typeof FILM_SCENE_SOUNDS)[number];
    at: number;
    gain: number;
  }[];
  captions: FilmSceneCaption;
}
export interface FilmDirectionContentDto {
  chapterName: string;
  nameReason: string;
  music: {
    mood: string;
    tempoBpm: number;
    key: (typeof FILM_MUSIC_KEYS)[number];
    mode: "major" | "minor";
    instruments: (typeof FILM_MUSIC_INSTRUMENTS)[number][];
    melody: (typeof FILM_MELODY_DENSITIES)[number];
    arc: (typeof FILM_MUSIC_ARCS)[number];
    fromPrevious: (typeof FILM_MUSIC_JOINS)[number];
  };
  scenes: FilmSceneDirectionDto[];
}
export interface FilmDirectionDto {
  id: string;
  projectId: string;
  chapterId: string;
  requestId: string;
  scope: "film" | "chapter";
  status: "generating" | "proposed" | "approved" | "superseded" | "failed";
  inputDigest: string;
  model: string | null;
  error: string | null;
  content: FilmDirectionContentDto | null;
  /** Saved Chapter name and captions when the request started; absent on older proposals. */
  base?: {
    chapterName: string;
    captions: Record<string, FilmSceneCaption | null>;
  };
  createdAt: string;
  updatedAt: string;
}
/** A value that both an AI draft and a newer manual edit changed (409 `direction_conflict`). */
export interface FilmDirectionConflictDto {
  /** `chapterName` or `caption:<sceneId>`. */
  field: string;
  mine: string | FilmSceneCaption | null;
  draft: string | FilmSceneCaption;
}
export interface FilmTemplateDto {
  id: FilmRecipe;
  revision: string;
  offered: boolean;
  name: { en: string; ja: string };
  description: FilmTemplateDto["name"];
  facts: FilmTemplateDto["name"][];
  layout: "full-frame" | "paper-cards";
  /** Default photo and caption placement for each output size. */
  frame: Record<FilmAspect, FilmFrameLayout>;
  hasFixedStyle: boolean;
  bounds: {
    cameraMoves: readonly FilmSceneDirectionDto["camera"]["move"][];
    defaultMove: FilmSceneDirectionDto["camera"]["move"];
    maxSpeed: number;
    maxEffects: Pick<
      FilmSceneDirectionDto["effects"],
      "rays" | "motes" | "leaves"
    >;
    sounds: readonly FilmSceneDirectionDto["sounds"][number]["sound"][];
    musicKeys: readonly FilmDirectionContentDto["music"]["key"][];
    musicArcs: readonly FilmDirectionContentDto["music"]["arc"][];
  };
}
export interface FilmDetailDto {
  currentAssemblyFingerprint: string | null;
  treatment: FilmTreatment;
  scenes: FilmSceneDto[];
  jobs: FilmJob[];
  preflight: {
    chapterId: string;
    runtimeMs: number;
    fingerprint: string;
    durations: { sceneId: string; durationMs: number }[];
    error: string | null;
  }[];
  /** Non-superseded AI directions, newest first. */
  directions: FilmDirectionDto[];
  /** Current photos/order/size digest per Chapter; a direction with another digest is stale. */
  directionInputDigests: Record<string, string>;
}
