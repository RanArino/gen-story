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

export const FILM_DIRECTION_PROMPT_VERSION = "film-direction-prompt@3";

const object = (properties: Record<string, unknown>) => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const string = { type: "string" };
const number = { type: "number" };
const oneOf = (values: readonly string[]) => ({ type: "string", enum: values });

export function filmDirectionResponseSchema(
  template?: FilmDirectionPlanRequest["template"],
) {
  const bounds = template?.bounds;
  const scene = object({
    sceneId: string,
    observation: string,
    camera: object({
      move: oneOf(bounds?.cameraMoves ?? FILM_CAMERA_MOVES),
      focus: object({ x: number, y: number }),
      speed: { ...number, minimum: 0, maximum: bounds?.maxSpeed ?? 1 },
      reason: string,
    }),
    effects: object({
      rays: { ...number, minimum: 0, maximum: bounds?.maxEffects.rays ?? 1 },
      motes: { ...number, minimum: 0, maximum: bounds?.maxEffects.motes ?? 1 },
      leaves: {
        ...number,
        minimum: 0,
        maximum: bounds?.maxEffects.leaves ?? 1,
      },
      ...(!template?.fixed && { warmth: number }),
    }),
    footsteps: oneOf(FILM_FOOTSTEP_SURFACES),
    ambience: object({ wind: number, stream: number }),
    sounds: {
      type: "array",
      maxItems: 6,
      items: object({
        sound: oneOf(bounds?.sounds ?? FILM_SCENE_SOUNDS),
        at: number,
        gain: number,
      }),
    },
    captions: object({ ja: string, en: string }),
  });
  return object({
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
            ...(!template?.fixed ? { tempoBpm: number } : {}),
            key: oneOf(bounds?.musicKeys ?? FILM_MUSIC_KEYS),
            mode: oneOf(["major", "minor"]),
            ...(!template?.fixed
              ? {
                  instruments: {
                    type: "array",
                    minItems: 1,
                    maxItems: 3,
                    items: oneOf(FILM_MUSIC_INSTRUMENTS),
                  },
                }
              : {}),
            melody: oneOf(FILM_MELODY_DENSITIES),
            arc: oneOf(bounds?.musicArcs ?? FILM_MUSIC_ARCS),
            fromPrevious: oneOf(FILM_MUSIC_JOINS),
          }),
          scenes: { type: "array", minItems: 1, items: scene },
        }),
      }),
    },
  });
}

export const FILM_DIRECTION_RESPONSE_JSON_SCHEMA =
  filmDirectionResponseSchema();

const ASPECT_WORDS = {
  "16:9": "landscape 16:9",
  "9:16": "vertical 9:16 (phone)",
  "1:1": "square 1:1",
} as const;

export function buildFilmDirectionPrompt(
  request: FilmDirectionPlanRequest,
): string {
  const template = request.template;
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
              ? `    KEEP this scene within the current schema: ${JSON.stringify(scene.keep, template?.fixed ? (key, value) => (key === "warmth" ? undefined : value) : undefined)}`
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
  const bounds = template?.bounds;
  const moves = bounds?.cameraMoves ?? FILM_CAMERA_MOVES;
  const cameraNotes = {
    hold: "Nearly still. Calm, contemplative, portraits, dense group photos.",
    "push-in": "Move closer to the focus point.",
    "pull-out": "Start close on the focus, widen to the whole photo.",
    reveal: "Start very close on a detail, open to the whole photo, then rest.",
    "pan-left": "Travel horizontally to the left across a wide scene.",
    "pan-right": "Travel horizontally to the right across a wide scene.",
    "tilt-up": "Travel upward across a tall subject.",
    "tilt-down": "Travel downward across a tall subject.",
    climb:
      'Ascend stairs or slopes with walking bob. Pair with "stair" or "stone".',
    "walk-in":
      'Move forward along a path with walking bob. Pair with "gravel" or "stone".',
  };
  const sounds = bounds?.sounds ?? FILM_SCENE_SOUNDS;
  const soundNotes = {
    "bird-chirp": "Outdoors, nature, mornings.",
    suzu: "Small bell for shrines, charms or gentle accents.",
    clap: "Shrine prayer clap, only at shrines.",
    "temple-bell": "Temples, shrines or solemn moments.",
    "low-swell": "A deep emotional swell at a meaningful moment.",
    "ocean-wave":
      "A wash and retreat of surf for exposed beaches or rocky shores.",
    "light-rain": "A soft patter for visible rain, wet windows or umbrellas.",
    cicadas: "Summer insect chorus for hot, leafy outdoor scenes.",
    "leaf-rustle":
      "A close, brief rustle when foliage frames a path or viewpoint.",
    "train-pass":
      "Rolling rails and wheel clicks for a moving train or tracks at a platform.",
    "cafe-cup":
      "A small ceramic clink for a visible cup and saucer or café table.",
    "camera-shutter":
      "A quick click for a deliberate snapshot or photo-album beat.",
    "wind-chime":
      "A light metallic ring for a visible chime or a breezy, open storefront.",
  };
  return `You are the film director for a short photo film. Base your choices on what you actually see in each photo and stay within the selected template.

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
${moves.map((move) => `- ${move}: ${cameraNotes[move]}`).join("\n")}
focus.x / focus.y: where the subject actually is in that photo, 0..1 from the top-left. Be precise; the camera centers on it.
speed: 0..${bounds?.maxSpeed ?? 1}. Slow and subtle for quiet moments; larger for energy or journeys.
Do not use the same move on consecutive photos unless the content calls for it.

Look (maxima for rays, motes, leaves: ${bounds ? Object.values(bounds.maxEffects).join(", ") : "1, 1, 1"}): rays = visible light shafts, only when sunlight or strong light is in or implied by the photo; motes = floating dust or particles in light; leaves = falling leaves, only for foliage, forests or autumn${template?.fixed ? ". The template supplies the color treatment." : "; warmth = -1 (cool blue) .. 1 (warm golden), from the photo’s actual light."}
footsteps: "none" unless the camera represents someone walking on that ground.
ambience: wind = outdoor air (0..1); stream = flowing water such as a river or fountain (0..1). Indoors usually both near 0. Use ocean-wave for surf.
sounds (0-6, each with at = 0..1 position within the photo and gain 0..1). Ground choices in the photo and its place in the journey. Usually choose one recognizable place or action cue, or leave it empty. Put longer cues such as waves or a passing train early in the photo, and time quick cues to a specific beat. Keep most gains around 0.2–0.5 so they sit under the music. Avoid duplicating the same ambience across adjacent photos or layering cues that describe the same thing:
${sounds.map((sound) => `- ${sound}: ${soundNotes[sound]}`).join("\n")}

Music for each Chapter: mood (a few words), key (${(bounds?.musicKeys ?? FILM_MUSIC_KEYS).join(", ")}), mode, melody density, arc (${(bounds?.musicArcs ?? FILM_MUSIC_ARCS).join(", ")}) and fromPrevious (how it relates to the previous Chapter's music). ${template?.fixed ? `The ${template.name.en} template supplies tempo and instruments.` : "Include tempoBpm 50–140 and instruments (pad, koto-pluck, low-swell)."} Each Chapter should feel distinct while belonging to one film.

Words: chapterName is a short evocative title (at most 20 characters) grounded in the Chapter's photos, written in the language of the film title. captions.ja is natural Japanese (aim for at most 30 characters, hard limit 120) and captions.en is a natural English line with the same meaning (aim for at most 70 characters, hard limit 200). Captions should add feeling or story, not merely describe the picture. observation, reason, nameReason and mood are short explanations for the user, in the language of the film title.
Respect every LOCKED or KEEP value exactly.`;
}

function withFixedFields(
  content: unknown,
  music:
    | NonNullable<
        NonNullable<FilmDirectionPlanRequest["template"]>["fixed"]
      >["music"]
    | undefined,
) {
  if (
    !music ||
    !content ||
    typeof content !== "object" ||
    !("music" in content) ||
    !content.music ||
    typeof content.music !== "object"
  )
    return content;
  return {
    ...content,
    ...("scenes" in content &&
      Array.isArray(content.scenes) && {
        scenes: content.scenes.map((scene) =>
          scene && typeof scene.effects === "object" && scene.effects
            ? { ...scene, effects: { ...scene.effects, warmth: 0 } }
            : scene,
        ),
      }),
    music: {
      ...content.music,
      instruments: music.instruments,
      tempoBpm: (music.tempoBpm[0] + music.tempoBpm[1]) / 2,
    },
  };
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
    content: withFixedFields(c.content, request.template?.fixed?.music),
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
      jsonSchema: filmDirectionResponseSchema(request.template),
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
