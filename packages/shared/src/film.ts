export const FILM_RECIPES = [
  "quiet-cinema",
  "memory-board",
  "pulse-cut",
] as const;
export type FilmRecipe = (typeof FILM_RECIPES)[number];
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
  chapters: FilmChapter[];
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
}
