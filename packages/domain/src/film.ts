export const FILM_RECIPES = [
  "quiet-cinema",
  "memory-board",
  "pulse-cut",
] as const;
export type FilmRecipe = (typeof FILM_RECIPES)[number];
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
export function validateFilm(
  treatment: FilmTreatment,
  sceneIds: string[],
  stage: "draft" | "render" = "render",
): void {
  if (!FILM_RECIPES.includes(treatment.recipe))
    throw new Error("Choose a supported film template.");
  if (
    treatment.outputAspect !== undefined &&
    !FILM_ASPECTS.includes(treatment.outputAspect)
  )
    throw new Error("Choose a supported video size.");
  if (!treatment.title.trim()) throw new Error("Enter an overall film title.");
  if (stage === "render" && !treatment.chapters.length)
    throw new Error("Add at least one Chapter.");
  for (const [sceneId, caption] of Object.entries(
    treatment.sceneCaptions ?? {},
  )) {
    if (!sceneIds.includes(sceneId))
      throw new Error("A caption references an unavailable project scene.");
    if (
      typeof caption.ja !== "string" ||
      typeof caption.en !== "string" ||
      caption.ja.length > 120 ||
      caption.en.length > 200
    )
      throw new Error(
        "Film captions must contain at most 120 Japanese and 200 English characters.",
      );
  }
  const chapters = new Set<string>();
  const used = new Set<string>();
  for (const chapter of treatment.chapters) {
    if (!chapter.id || chapters.has(chapter.id))
      throw new Error("Chapter IDs must be unique.");
    chapters.add(chapter.id);
    if (!chapter.title.trim())
      throw new Error("Enter a title for every Chapter.");
    if (stage === "render" && !chapter.scenes.length)
      throw new Error("Every Chapter needs at least one scene.");
    if (
      chapter.limitMs !== null &&
      (!Number.isSafeInteger(chapter.limitMs) || chapter.limitMs <= 0)
    )
      throw new Error(
        "Chapter limits must be positive milliseconds or unlimited.",
      );
    for (const [field, value] of Object.entries(chapter.settings ?? {})) {
      const minimum = field === "pacing" ? 0.5 : 0;
      const maximum = field === "pacing" ? 2 : 1;
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < minimum ||
        value > maximum
      )
        throw new Error(
          "Chapter style controls are outside their supported ranges.",
        );
    }
    for (const scene of chapter.scenes) {
      if (!sceneIds.includes(scene.sceneId))
        throw new Error("A Chapter references an unavailable project scene.");
      if (used.has(scene.sceneId))
        throw new Error("A scene can belong to only one Chapter.");
      used.add(scene.sceneId);
      if (
        scene.durationMs !== undefined &&
        (!Number.isSafeInteger(scene.durationMs) || scene.durationMs <= 0)
      )
        throw new Error("Scene durations must be positive milliseconds.");
    }
  }
}

/** Reads captions saved before 2026-11-03 ({text, subtext}) as Japanese and English lines. */
export function normalizeSceneCaptions(
  captions: Record<string, unknown> | undefined,
): Record<string, FilmSceneCaption> | undefined {
  if (!captions) return undefined;
  return Object.fromEntries(
    Object.entries(captions).map(([sceneId, value]) => {
      const c = (value ?? {}) as Record<string, unknown>;
      const ja = typeof c.ja === "string" ? c.ja : c.text;
      const en = typeof c.en === "string" ? c.en : c.subtext;
      return [
        sceneId,
        {
          ja: typeof ja === "string" ? ja : "",
          en: typeof en === "string" ? en : "",
        },
      ];
    }),
  );
}

/** Lines actually burned in for one scene under an export subtitle mode. */
export function subtitleLines(
  caption: FilmSceneCaption,
  mode: FilmSubtitleMode,
): { text: string; sub: string } {
  if (mode === "both") return { text: caption.ja, sub: caption.en };
  if (mode === "ja") return { text: caption.ja, sub: "" };
  if (mode === "en") return { text: caption.en, sub: "" };
  return { text: "", sub: "" };
}
