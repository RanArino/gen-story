import type {
  FilmDirectionPlannerPort,
  FilmDirectionPlanRequest,
  ObjectStoragePort,
} from "@gen-story/application";
import {
  FILM_CAMERA_MOVES,
  FILM_FOOTSTEP_SURFACES,
  FILM_MELODY_DENSITIES,
  FILM_MUSIC_ARCS,
  FILM_MUSIC_INSTRUMENTS,
  FILM_MUSIC_JOINS,
  FILM_MUSIC_KEYS,
  FILM_SCENE_SOUNDS,
  directionContentProblems,
} from "@gen-story/domain";
import { runClaudeJsonGeneration } from "../agent-runtime/stateless/claude-json-generation";
import { runCodexJsonGeneration } from "../agent-runtime/stateless/codex-json-generation";
import type { AgentRuntimeSelection } from "../agent-runtime/runtime-config";
import { createAiInputImage } from "../images/image-metadata";

export const FILM_DIRECTION_PROMPT_VERSION = "film-direction-prompt@1";

const object = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const string = { type: "string" };
const number = { type: "number" };
const oneOf = (values: readonly string[]) => ({ type: "string", enum: values });

const SCENE_SCHEMA = object({
  sceneId: string,
  observation: string,
  camera: object({
    move: oneOf(FILM_CAMERA_MOVES),
    focus: object({ x: number, y: number }),
    speed: number,
    reason: string,
  }),
  effects: object({
    rays: number,
    motes: number,
    leaves: number,
    warmth: number,
  }),
  footsteps: oneOf(FILM_FOOTSTEP_SURFACES),
  ambience: object({ wind: number, stream: number }),
  sounds: {
    type: "array",
    maxItems: 6,
    items: object({
      sound: oneOf(FILM_SCENE_SOUNDS),
      at: number,
      gain: number,
    }),
  },
  captions: object({ ja: string, en: string }),
});
export const FILM_DIRECTION_RESPONSE_JSON_SCHEMA = object({
  arc: string,
  chapters: {
    type: "array",
    minItems: 1,
    items: object({
      chapterId: string,
      content: object({
        chapterName: string,
        nameReason: string,
        music: object({
          mood: string,
          tempoBpm: number,
          key: oneOf(FILM_MUSIC_KEYS),
          mode: oneOf(["major", "minor"]),
          instruments: {
            type: "array",
            minItems: 1,
            maxItems: 3,
            items: oneOf(FILM_MUSIC_INSTRUMENTS),
          },
          melody: oneOf(FILM_MELODY_DENSITIES),
          arc: oneOf(FILM_MUSIC_ARCS),
          fromPrevious: oneOf(FILM_MUSIC_JOINS),
        }),
        scenes: { type: "array", minItems: 1, items: SCENE_SCHEMA },
      }),
    }),
  },
});

const ASPECT_WORDS = {
  "16:9": "landscape 16:9",
  "9:16": "vertical 9:16 (phone)",
  "1:1": "square 1:1",
} as const;

export function buildFilmDirectionPrompt(
  request: FilmDirectionPlanRequest,
): string {
  let image = 0;
  const chapters = request.chapters
    .map((chapter, c) => {
      const scenes = chapter.scenes
        .map((scene) => {
          image += 1;
          const lock = chapter.locks.captions[scene.sceneId];
          return [
            `  - Image ${image}: sceneId "${scene.sceneId}", storyboard title "${scene.storyboardTitle}"`,
            lock
              ? `    LOCKED captions (return exactly): ${JSON.stringify(lock)}`
              : "",
            scene.keep
              ? `    KEEP this scene (return exactly this JSON): ${JSON.stringify(scene.keep)}`
              : "",
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n");
      return [
        `Chapter ${c + 1}: chapterId "${chapter.chapterId}", current title "${chapter.title}"`,
        chapter.locks.chapterName
          ? `  LOCKED chapterName (return exactly): "${chapter.locks.chapterName}"`
          : "  The title is a placeholder; propose a chapterName.",
        scenes,
      ].join("\n");
    })
    .join("\n\n");
  const neighbors = request.neighbors.length
    ? request.neighbors
        .map(
          (n) =>
            `- ${n.position} Chapter "${n.title}": ${n.music ? JSON.stringify(n.music) : "no direction yet"}`,
        )
        .join("\n")
    : "- none";
  return `You are the film director for a short photo film. Rendering is deterministic, so every creative decision is yours and must come from what you actually see in each photo.

Film title: "${request.filmTitle}"
Story / worldview: ${request.story ? JSON.stringify(request.story) : "(not provided)"}
Output frame: ${ASPECT_WORDS[request.outputAspect]}
Scope: ${request.scope === "film" ? "the whole film; design one emotional arc across all Chapters (opening, development, peak, resolution) with related keys and tempos" : "one Chapter; it must connect musically to its neighbors"}
Neighboring Chapters:
${neighbors}

The attached images are in this order:
${chapters}

Return JSON with "arc" (one sentence about the overall arc) and one "chapters" entry per Chapter above, in order, with every scene of that Chapter in order.

Camera move vocabulary (choose by the photo's content and composition, not for variety alone):
- hold: nearly still. Calm, contemplative, portraits, dense group photos.
- push-in: move closer to the focus point. Draws attention to a subject or emotion.
- pull-out: start close on the focus, widen to the whole photo. Reveals context.
- reveal: start very close on a detail, open to the whole photo, then rest.
- pan-left / pan-right: travel horizontally across a wide scene; follow motion or gaze direction.
- tilt-up / tilt-down: travel vertically across tall subjects (towers, trees, waterfalls, buildings).
- climb: for stairs, slopes and ascending paths. Starts low and rises toward the focus with walking bob. Pair with footsteps "stair" or "stone".
- walk-in: for paths, corridors, gates and roads. Moves forward toward the focus with walking bob. Pair with footsteps "gravel" or "stone".
focus.x / focus.y: where the subject actually is in that photo, 0..1 from the top-left. Be precise; the camera centers on it.
speed: 0..1. Slow and subtle for quiet moments; larger for energy or journeys.
Do not use the same move on consecutive photos unless the content calls for it.

Look (each 0..1 unless stated): rays = visible light shafts, only when sunlight or strong light is in or implied by the photo; motes = floating dust or particles in light; leaves = falling leaves, only for foliage, forests or autumn; warmth = -1 (cool blue) .. 1 (warm golden), from the photo's actual light.
footsteps: "none" unless the camera represents someone walking on that ground.
ambience: wind = outdoor air (0..1); stream = water present (river, sea, fountain) (0..1). Indoors usually both near 0.
sounds (0-6, each with at = 0..1 position within the photo and gain 0..1). Use only when motivated by the photo; silence is a valid choice:
- bird-chirp: outdoors, nature, mornings. - suzu: small bell; shrines, charms, gentle accents. - clap: a shrine prayer clap, only at shrines.
- temple-bell: temples, shrines, solemn or culminating moments. - low-swell: a deep emotional swell at a meaningful moment.

Music for each Chapter: mood (a few words), tempoBpm 50-140, key, mode, instruments (pad = warm sustained harmony; koto-pluck = plucked melody; low-swell = deep swells at the start or peak), melody density, arc within the Chapter, and fromPrevious (how it relates to the previous Chapter's music). Each Chapter should feel distinct while belonging to one film.

Words: chapterName is a short evocative title (at most 20 characters) grounded in the Chapter's photos, written in the language of the film title. captions.ja is natural Japanese (aim for at most 30 characters, hard limit 120) and captions.en is a natural English line with the same meaning (aim for at most 70 characters, hard limit 200). Captions should add feeling or story, not merely describe the picture. observation, reason, nameReason and mood are short explanations for the user, in the language of the film title.
Respect every LOCKED or KEEP value exactly.`;
}

function parseFilmDirectionResult(
  request: FilmDirectionPlanRequest,
  text: string,
  model: string,
) {
  const parsed = JSON.parse(text) as {
    chapters?: { chapterId?: unknown; content?: unknown }[];
  };
  if (!Array.isArray(parsed.chapters))
    throw new Error("Film direction output has no chapters.");
  const chapters = parsed.chapters.map((c) => ({
    chapterId: String(c.chapterId),
    content: c.content,
  }));
  // Invalid output throws here so the runtime adapter retries before the request fails.
  const problems = request.chapters.flatMap((chapter) => {
    const found = chapters.find((c) => c.chapterId === chapter.chapterId);
    if (!found) return [`Missing Chapter ${chapter.chapterId}.`];
    return directionContentProblems(
      found.content,
      chapter.scenes.map((s) => s.sceneId),
    );
  });
  if (problems.length)
    throw new Error(`Invalid film direction: ${problems.join(" ")}`);
  return { model, chapters };
}

/** Plans Film direction through the user's selected local Agent runtime (Claude or Codex). */
export class AgentFilmDirectionPlanner implements FilmDirectionPlannerPort {
  constructor(
    private readonly objectStorage: ObjectStoragePort,
    private readonly selection: () => AgentRuntimeSelection,
    private readonly claude = runClaudeJsonGeneration,
    private readonly codex = runCodexJsonGeneration,
  ) {}
  async plan(request: FilmDirectionPlanRequest) {
    const runtime = this.selection();
    if (runtime !== "claude" && runtime !== "codex")
      throw new Error(
        "AI film direction needs the Claude or Codex runtime. Change the AI runtime in Settings.",
      );
    const images = [];
    for (const chapter of request.chapters)
      for (const scene of chapter.scenes) {
        const body = await this.objectStorage.getObject(scene.imageKey);
        if (!body)
          throw new Error(
            `The image for “${scene.storyboardTitle}” is missing. Choose another image.`,
          );
        const normalized = await createAiInputImage(body);
        images.push({ mimeType: normalized.mimeType, body: normalized.body });
      }
    const input = {
      prompt: buildFilmDirectionPrompt(request),
      jsonSchema: FILM_DIRECTION_RESPONSE_JSON_SCHEMA,
      images,
      // Several photos and a whole film take longer than a single-photo analysis.
      timeoutMs: 600_000,
    };
    const parse = (text: string, model: string) =>
      parseFilmDirectionResult(request, text, model);
    return runtime === "claude"
      ? this.claude(input, parse)
      : this.codex(input, parse);
  }
}
