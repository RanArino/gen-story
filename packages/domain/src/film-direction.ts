import type { FilmSceneCaption, FilmTreatment } from "./film";

/**
 * Agent-proposed, user-approved direction for one Chapter. It names choices from fixed
 * vocabularies; the renderer converts them to exact camera keys and score events.
 */
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
export type FilmCameraMove = (typeof FILM_CAMERA_MOVES)[number];
/** Moves that carry walking bob; they only bob when the scene also has footsteps. */
export const FILM_WALKING_MOVES: readonly FilmCameraMove[] = [
  "climb",
  "walk-in",
];
export const FILM_FOOTSTEP_SURFACES = [
  "none",
  "gravel",
  "stone",
  "stair",
] as const;
export type FilmFootstepSurface = (typeof FILM_FOOTSTEP_SURFACES)[number];
export const FILM_SCENE_SOUNDS = [
  "bird-chirp",
  "suzu",
  "clap",
  "temple-bell",
  "low-swell",
] as const;
export type FilmSceneSound = (typeof FILM_SCENE_SOUNDS)[number];
export const FILM_MUSIC_INSTRUMENTS = [
  "pad",
  "koto-pluck",
  "low-swell",
] as const;
export type FilmMusicInstrument = (typeof FILM_MUSIC_INSTRUMENTS)[number];
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
export type FilmMusicKey = (typeof FILM_MUSIC_KEYS)[number];
export const FILM_MELODY_DENSITIES = ["sparse", "medium", "flowing"] as const;
export const FILM_MUSIC_ARCS = ["steady", "rise", "fall", "swell"] as const;
export const FILM_MUSIC_JOINS = [
  "continue",
  "lift",
  "settle",
  "contrast",
] as const;

export interface FilmSceneDirection {
  sceneId: string;
  /** What the Agent saw, shown to the user as the reason for its choices. */
  observation: string;
  camera: {
    move: FilmCameraMove;
    /** Point of interest in the photo, 0..1 from the top-left. */
    focus: { x: number; y: number };
    /** 0 = barely moving, 1 = the most pronounced version of the move. */
    speed: number;
    reason: string;
  };
  effects: { rays: number; motes: number; leaves: number; warmth: number };
  footsteps: FilmFootstepSurface;
  ambience: { wind: number; stream: number };
  /** One-shot sounds; `at` is the position within the scene window, 0..1. */
  sounds: { sound: FilmSceneSound; at: number; gain: number }[];
  captions: FilmSceneCaption;
}
export interface FilmDirectionContent {
  chapterName: string;
  nameReason: string;
  music: {
    mood: string;
    tempoBpm: number;
    key: FilmMusicKey;
    mode: "major" | "minor";
    instruments: FilmMusicInstrument[];
    melody: (typeof FILM_MELODY_DENSITIES)[number];
    arc: (typeof FILM_MUSIC_ARCS)[number];
    fromPrevious: (typeof FILM_MUSIC_JOINS)[number];
  };
  scenes: FilmSceneDirection[];
}
export type FilmDirectionStatus =
  | "generating"
  | "proposed"
  | "approved"
  | "superseded"
  | "failed";
export interface FilmDirectionProposal {
  id: string;
  projectId: string;
  chapterId: string;
  /** Shared by every Chapter proposal produced by one whole-film request. */
  requestId: string;
  scope: "film" | "chapter";
  status: FilmDirectionStatus;
  /** Digest of the photos, Chapter membership/order, size and locks it was made for. */
  inputDigest: string;
  model: string | null;
  error: string | null;
  content: FilmDirectionContent | null;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_CHAPTER_TITLE = /^(チャプター|Chapter)\s*\d+$/u;
/** A Chapter still carrying the app's default "Chapter N" title has not been named by the user. */
export function isDefaultChapterTitle(title: string): boolean {
  return DEFAULT_CHAPTER_TITLE.test(title.trim());
}

const unit = (value: unknown) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1;
const text = (value: unknown, max: number, required = false) =>
  typeof value === "string" &&
  value.length <= max &&
  (!required || value.trim().length > 0);
const oneOf = <T extends string>(list: readonly T[], value: unknown) =>
  typeof value === "string" && (list as readonly string[]).includes(value);

/**
 * Returns every problem with a proposal for exactly these scenes, in order; empty means valid.
 * Messages name the field so an Agent retry or the review screen can show what is wrong.
 */
export function directionContentProblems(
  content: unknown,
  sceneIds: readonly string[],
): string[] {
  const problems: string[] = [];
  const c = content as Partial<FilmDirectionContent> | null;
  if (!c || typeof c !== "object") return ["The direction must be an object."];
  if (!text(c.chapterName, 200, true))
    problems.push("chapterName must be 1-200 characters.");
  if (!text(c.nameReason, 400)) problems.push("nameReason is too long.");
  const m = c.music as Partial<FilmDirectionContent["music"]> | undefined;
  if (!m || typeof m !== "object") problems.push("music is required.");
  else {
    if (!text(m.mood, 60, true))
      problems.push("music.mood must be 1-60 characters.");
    if (
      typeof m.tempoBpm !== "number" ||
      !Number.isFinite(m.tempoBpm) ||
      m.tempoBpm < 50 ||
      m.tempoBpm > 140
    )
      problems.push("music.tempoBpm must be between 50 and 140.");
    if (!oneOf(FILM_MUSIC_KEYS, m.key))
      problems.push("music.key is not supported.");
    if (m.mode !== "major" && m.mode !== "minor")
      problems.push("music.mode must be major or minor.");
    if (
      !Array.isArray(m.instruments) ||
      !m.instruments.length ||
      new Set(m.instruments).size !== m.instruments.length ||
      !m.instruments.every((i) => oneOf(FILM_MUSIC_INSTRUMENTS, i))
    )
      problems.push(
        "music.instruments must list distinct registered instruments.",
      );
    if (!oneOf(FILM_MELODY_DENSITIES, m.melody))
      problems.push("music.melody is not supported.");
    if (!oneOf(FILM_MUSIC_ARCS, m.arc))
      problems.push("music.arc is not supported.");
    if (!oneOf(FILM_MUSIC_JOINS, m.fromPrevious))
      problems.push("music.fromPrevious is not supported.");
  }
  const scenes = Array.isArray(c.scenes) ? c.scenes : [];
  if (
    scenes.length !== sceneIds.length ||
    scenes.some((s, i) => s?.sceneId !== sceneIds[i])
  )
    problems.push(
      "scenes must cover every Chapter photo exactly once, in order.",
    );
  scenes.forEach((s, i) => {
    const at = `scenes[${i}]`;
    if (!s || typeof s !== "object") {
      problems.push(`${at} must be an object.`);
      return;
    }
    if (!text(s.observation, 400, true))
      problems.push(`${at}.observation must be 1-400 characters.`);
    if (!oneOf(FILM_CAMERA_MOVES, s.camera?.move))
      problems.push(`${at}.camera.move is not supported.`);
    if (!unit(s.camera?.focus?.x) || !unit(s.camera?.focus?.y))
      problems.push(`${at}.camera.focus must be within 0..1.`);
    if (!unit(s.camera?.speed))
      problems.push(`${at}.camera.speed must be within 0..1.`);
    if (!text(s.camera?.reason, 400))
      problems.push(`${at}.camera.reason is too long.`);
    const e = s.effects;
    if (
      !e ||
      !unit(e.rays) ||
      !unit(e.motes) ||
      !unit(e.leaves) ||
      typeof e.warmth !== "number" ||
      !(e.warmth >= -1 && e.warmth <= 1)
    )
      problems.push(`${at}.effects must be within range.`);
    if (!oneOf(FILM_FOOTSTEP_SURFACES, s.footsteps))
      problems.push(`${at}.footsteps is not supported.`);
    if (!s.ambience || !unit(s.ambience.wind) || !unit(s.ambience.stream))
      problems.push(`${at}.ambience must be within 0..1.`);
    if (
      !Array.isArray(s.sounds) ||
      s.sounds.length > 6 ||
      s.sounds.some(
        (x) =>
          !oneOf(FILM_SCENE_SOUNDS, x?.sound) || !unit(x.at) || !unit(x.gain),
      )
    )
      problems.push(
        `${at}.sounds must be at most 6 registered sounds within range.`,
      );
    if (!text(s.captions?.ja, 120) || !text(s.captions?.en, 200))
      problems.push(
        `${at}.captions must be at most 120 Japanese / 200 English characters.`,
      );
  });
  return problems;
}

export function validateDirectionContent(
  content: unknown,
  sceneIds: readonly string[],
): asserts content is FilmDirectionContent {
  const problems = directionContentProblems(content, sceneIds);
  if (problems.length) throw new Error(problems.join(" "));
}

/** User-entered values the Agent must not change. */
export interface FilmDirectionLocks {
  chapterName: string | null;
  captions: Record<string, FilmSceneCaption>;
}
/**
 * Values the user typed are locks. A default "Chapter N" title, and a name or caption that an
 * earlier proposal for this Chapter wrote, are not: regenerating may improve the Agent's own text.
 */
export function directionLocks(
  treatment: FilmTreatment,
  chapterId: string,
  earlier: readonly FilmDirectionProposal[] = [],
): FilmDirectionLocks {
  const chapter = treatment.chapters.find((c) => c.id === chapterId);
  if (!chapter) throw new Error("Chapter not found.");
  const previous = earlier.filter(
    (p) => p.chapterId === chapterId && p.content,
  );
  const fromAgent = (sceneId: string, caption: FilmSceneCaption) =>
    previous.some((p) =>
      p.content!.scenes.some(
        (s) =>
          s.sceneId === sceneId &&
          s.captions.ja === caption.ja &&
          s.captions.en === caption.en,
      ),
    );
  const captions: Record<string, FilmSceneCaption> = {};
  for (const { sceneId } of chapter.scenes) {
    const caption = treatment.sceneCaptions?.[sceneId];
    if (caption && !fromAgent(sceneId, caption)) captions[sceneId] = caption;
  }
  const named =
    !isDefaultChapterTitle(chapter.title) &&
    !previous.some((p) => p.content!.chapterName === chapter.title);
  return { chapterName: named ? chapter.title : null, captions };
}
/** Re-applies locks to an Agent result so a model that ignored them cannot override the user. */
export function enforceDirectionLocks(
  content: FilmDirectionContent,
  locks: FilmDirectionLocks,
): FilmDirectionContent {
  return {
    ...content,
    chapterName: locks.chapterName ?? content.chapterName,
    scenes: content.scenes.map((scene) => ({
      ...scene,
      captions: locks.captions[scene.sceneId] ?? scene.captions,
    })),
  };
}

/** Writes an approved proposal's reviewed Chapter name and captions into the treatment. */
export function applyApprovedDirection(
  treatment: FilmTreatment,
  proposal: FilmDirectionProposal,
): FilmTreatment {
  if (proposal.status !== "approved" || !proposal.content)
    throw new Error("Only an approved direction can be applied.");
  const content = proposal.content;
  const captions = { ...treatment.sceneCaptions };
  for (const scene of content.scenes) captions[scene.sceneId] = scene.captions;
  return {
    ...treatment,
    sceneCaptions: captions,
    chapters: treatment.chapters.map((c) =>
      c.id === proposal.chapterId ? { ...c, title: content.chapterName } : c,
    ),
  };
}

const TRANSITIONS: Record<FilmDirectionStatus, FilmDirectionStatus[]> = {
  generating: ["proposed", "failed"],
  proposed: ["approved", "superseded"],
  approved: ["superseded"],
  superseded: [],
  failed: [],
};
export function transitionDirection(
  proposal: FilmDirectionProposal,
  next: FilmDirectionStatus,
  at: string,
): FilmDirectionProposal {
  if (!TRANSITIONS[proposal.status].includes(next))
    throw new Error(`A ${proposal.status} direction cannot become ${next}.`);
  return { ...proposal, status: next, updatedAt: at };
}
/** A proposal made for different photos, order, size or locks no longer matches the Chapter. */
export function isDirectionStale(
  proposal: FilmDirectionProposal,
  currentInputDigest: string,
): boolean {
  return proposal.inputDigest !== currentInputDigest;
}
