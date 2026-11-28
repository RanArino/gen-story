import type {
  FilmDirectionContent,
  FilmMusicInstrument,
  FilmSceneDirection,
} from "./film-direction";
import type { FilmFrameLayout } from "./film-layout";

type Move = FilmSceneDirection["camera"]["move"];
type Effects = Pick<FilmSceneDirection["effects"], "rays" | "motes" | "leaves">;
type Music = FilmDirectionContent["music"];

export interface FilmTemplateBounds {
  cameraMoves: readonly Move[];
  defaultMove: Move;
  maxSpeed: number;
  maxEffects: Effects;
  sounds: readonly FilmSceneDirection["sounds"][number]["sound"][];
  musicKeys: readonly Music["key"][];
  musicArcs: readonly Music["arc"][];
}

export interface FilmTemplate {
  schema: "film.template@1";
  id: string;
  revision: string;
  offered: boolean;
  recipe: string;
  name: { en: string; ja: string };
  description: FilmTemplate["name"];
  facts: FilmTemplate["name"][];
  fixed: {
    layout: "full-frame" | "paper-cards";
    transitions: [{ kind: "dissolve" | "card-slide"; weight: number }];
    look: {
      warmWash: string;
      coolWash: string;
      warm: number;
      cool: number;
      grain: number;
      vignette: number;
    };
    captions: { font: "serif" | "sans"; position: "lower" | "note" };
    structure: { titleCard: boolean; credits: boolean };
    music: { instruments: FilmMusicInstrument[]; tempoBpm: [number, number] };
  } | null;
  bounds: FilmTemplateBounds;
  /**
   * Default photo and caption placement per output size. These are defaults only: the user
   * moves and resizes both in the Film preview. Missing sizes use the full-frame layout.
   */
  frame?: Partial<Record<"16:9" | "9:16" | "1:1", FilmFrameLayout>>;
}

/** Accepts both complete proposals and the renderer's subset of approved fields. */
export function clampDirectionToTemplate<
  M extends Pick<Music, "key" | "arc">,
  S extends Pick<FilmSceneDirection, "effects" | "sounds"> & {
    camera: Omit<FilmSceneDirection["camera"], "reason">;
  },
  C extends { music: M; scenes: S[] },
>(content: C, bounds: FilmTemplateBounds): C {
  return {
    ...content,
    music: {
      ...content.music,
      key: bounds.musicKeys.includes(content.music.key)
        ? content.music.key
        : bounds.musicKeys[0]!,
      arc: bounds.musicArcs.includes(content.music.arc)
        ? content.music.arc
        : bounds.musicArcs[0]!,
    },
    scenes: content.scenes.map((scene) => ({
      ...scene,
      camera: {
        ...scene.camera,
        move: bounds.cameraMoves.includes(scene.camera.move)
          ? scene.camera.move
          : bounds.defaultMove,
        speed: Math.min(scene.camera.speed, bounds.maxSpeed),
      },
      effects: {
        ...scene.effects,
        rays: Math.min(scene.effects.rays, bounds.maxEffects.rays),
        motes: Math.min(scene.effects.motes, bounds.maxEffects.motes),
        leaves: Math.min(scene.effects.leaves, bounds.maxEffects.leaves),
      },
      sounds: scene.sounds.filter(({ sound }) => bounds.sounds.includes(sound)),
    })),
  };
}

export function validateDirectionTemplateBounds(
  content: FilmDirectionContent,
  bounds: FilmTemplateBounds,
): void {
  const effective = clampDirectionToTemplate(content, bounds);
  if (
    content.music.key !== effective.music.key ||
    content.music.arc !== effective.music.arc
  )
    throw new Error(
      "Music key or arc is outside the selected Film template's choices.",
    );
  for (const [i, scene] of content.scenes.entries()) {
    const allowed = effective.scenes[i]!;
    if (
      scene.camera.move !== allowed.camera.move ||
      scene.camera.speed !== allowed.camera.speed
    )
      throw new Error(
        `Photo ${i + 1}: camera move or speed is outside the selected Film template's choices.`,
      );
    if (
      scene.effects.rays !== allowed.effects.rays ||
      scene.effects.motes !== allowed.effects.motes ||
      scene.effects.leaves !== allowed.effects.leaves
    )
      throw new Error(
        `Photo ${i + 1}: a light effect exceeds the selected Film template's limit.`,
      );
    if (scene.sounds.length !== allowed.sounds.length)
      throw new Error(
        `Photo ${i + 1}: a sound is outside the selected Film template's choices.`,
      );
  }
}
