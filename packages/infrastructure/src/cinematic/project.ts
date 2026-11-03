import type { FilmRuntimePaths } from "../paths.js";
import { compileCinematicFilm } from "./compile.js";
import type { PreparedScore } from "./prepare.js";
import { digestOf } from "../contracts/canonical.js";
import type { ResolvedRenderPlan } from "../contracts/types.js";
import type { RuntimeChapter, RuntimeInput } from "../index.js";
import { cinematicIdentity } from "./sources.js";
import { validateDirection } from "./validate.js";
import type {
  CinematicDirection,
  CinematicScore,
  CurvePoint,
} from "./types.js";

/** Scene windows, locked source images and seed shared by every Chapter direction. */
export function chapterTimeline(
  input: RuntimeInput,
  chapter: RuntimeChapter,
  timingPlan: ResolvedRenderPlan,
) {
  const duration = timingPlan.timing.proposal.runtimeMs / 1000;
  const seed = parseInt(digestOf(chapter.id).slice(7, 15), 16);
  const sources = new Map(input.scenes.map((scene) => [scene.id, scene]));
  const assets: CinematicDirection["assets"] = {};
  const windows = timingPlan.segments
    .filter((s) => s.kind === "scene")
    .map((segment, i) => {
      const source = sources.get(segment.sceneId!)!;
      const media = input.media.find((m) => m.path === source.asset)!;
      const image = `photo-${i}`;
      assets[image] = {
        asset: source.asset,
        sha256: media.sha256,
        widthPx: media.widthPx!,
        heightPx: media.heightPx!,
      };
      return {
        id: source.id,
        image,
        t0: segment.startMs / 1000,
        t1: segment.endMs / 1000,
        fadeIn: Math.max(0.1, timingPlan.timing.proposal.overlapMs / 1000),
        fadeOut:
          i === chapter.scenes.length - 1
            ? 0.6
            : Math.max(0.1, timingPlan.timing.proposal.overlapMs / 1000),
      };
    });
  return { duration, seed, sources, assets, windows };
}

/** Burned-in caption windows and the Chapter title card. */
export function chapterCopy(
  input: RuntimeInput,
  chapter: RuntimeChapter,
  scenes: { id: string; t0: number; t1: number }[],
): Pick<CinematicDirection, "captions" | "titleCard"> {
  const sources = new Map(input.scenes.map((scene) => [scene.id, scene]));
  return {
    captions: scenes.flatMap((scene) => {
      const source = sources.get(scene.id)!;
      return source.caption || source.subtitle
        ? [
            {
              t0: scene.t0 + 0.45,
              t1: scene.t1 - 0.25,
              text: source.caption,
              sub: source.subtitle ?? "",
              mid: false,
            },
          ]
        : [];
    }),
    titleCard: {
      display: chapter.title,
      show: {
        in: 0.15,
        fadeIn: 0.6,
        out: Math.max(0.8, scenes[0]!.t0 - 0.4),
        fadeOut: 0.5,
      },
    },
  };
}

/** Validates a materialized direction and binds it to the exact toolchain identity. */
export function sealDirection(
  direction: CinematicDirection,
  timingPlan: ResolvedRenderPlan,
): { direction: CinematicDirection; fingerprint: string } {
  validateDirection(direction);
  return {
    direction,
    fingerprint: digestOf({
      direction: { ...direction, revision: 0 },
      compiler: cinematicIdentity(),
      environment: timingPlan.lock.environment,
      painter: timingPlan.lock.painter,
      fonts: timingPlan.lock.fonts,
    }),
  };
}

/**
 * Materialize deterministic project style data; this is not an image-aware Agent.
 * New renders use approved Agent direction; this remains to reproduce historical jobs.
 */
export function directProjectChapter(
  input: RuntimeInput,
  chapter: RuntimeChapter,
  timingPlan: ResolvedRenderPlan,
): { direction: CinematicDirection; fingerprint: string } {
  const { duration, seed, assets, windows } = chapterTimeline(
    input,
    chapter,
    timingPlan,
  );
  const settings = chapter.settings ?? {};
  const intensity = settings.visualIntensity ?? 0.65;
  const motion = settings.motionAmount ?? 0.65;
  const emphasis = 0.6 + 0.8 * (settings.emphasis ?? 0.5);
  const memory = input.recipe === "memory-board";
  const scenes = windows.map((window, i) => {
    const reverse = i % 2 === 1;
    return {
      id: window.id,
      image: window.image,
      framing: "contain" as const,
      t0: window.t0,
      t1: window.t1,
      fadeIn: window.fadeIn,
      fadeOut: window.fadeOut,
      bob: 0,
      camera: [
        {
          p: 0,
          fx: reverse ? 0.5 + 0.18 * motion : 0.5 - 0.18 * motion,
          fy: 0.5 - 0.05 * motion,
          z: reverse ? 1 + motion * 0.12 : 1,
        },
        { p: 0.45, fx: 0.5, fy: 0.5 + 0.05 * motion, z: 1 + motion * 0.055 },
        {
          p: 1,
          fx: reverse ? 0.5 - 0.18 * motion : 0.5 + 0.18 * motion,
          fy: 0.5 - 0.02 * motion,
          z: reverse ? 1 : 1 + motion * 0.12,
        },
      ],
    };
  });
  const curve = (a: number, b: number, c: number): CurvePoint[] => [
    [0, a],
    [duration * 0.45, b],
    [duration, c],
  ];
  const events: CinematicScore["events"] = [];
  const chords = [
    [130.81, 196, 261.63, 329.63],
    [110, 164.81, 220, 329.63],
    [87.31, 130.81, 174.61, 261.63],
    [98, 146.83, 196, 293.66],
  ];
  for (let t = 0, i = 0; t < duration - 1; t += 8, i++) {
    const hold = Math.min(8, duration - t - 0.5);
    events.push({
      t,
      sound: "pad",
      params: {
        freqs: chords[i % chords.length]!,
        notes: [
          ["C3", "G3", "C4", "E4"],
          ["A2", "E3", "A3", "E4"],
          ["F2", "C3", "F3", "C4"],
          ["G2", "D3", "G3", "D4"],
        ][i % chords.length]!,
        level: 0.32,
        hold,
        fadeIn: Math.min(1.5, hold / 2),
        fadeOut: 1.4,
      },
      i: 0,
      sustain: true,
    });
  }
  const notes = memory
    ? [329.63, 392, 523.25, 440, 392, 261.63]
    : [261.63, 392, 329.63, 523.25, 392, 293.66];
  for (let t = 0.8, i = 0; t < duration - 1; t += memory ? 1.8 : 2.4, i++)
    events.push({
      t,
      sound: "koto-pluck",
      params: {
        freq: notes[i % notes.length]!,
        note: String(notes[i % notes.length]!),
        vel: i % 3 === 0 ? 0.7 : 0.45,
        gain: 0.65,
      },
      i: 0,
    });
  for (const scene of scenes.slice(1))
    events.push({
      t: scene.t0,
      sound: "suzu",
      params: { gain: 0.18 * emphasis },
      i: 0,
    });
  events
    .sort((a, b) => a.t - b.t)
    .forEach((e, i) => {
      e.i = i;
    });
  const score: CinematicScore = {
    seed,
    duration,
    events,
    beds: [
      {
        name: "air",
        sound: "wind",
        params: { center: 420 },
        curve: curve(0, 0.025, 0),
        salt: 11,
      },
    ],
    master: [
      [0, 0],
      [Math.min(0.8, duration / 4), 0.9],
      [duration - Math.min(1.2, duration / 4), 0.9],
      [duration, 0],
    ],
    mix: {
      reverb: { seconds: 2.4, decay: 2.2, wet: 0.3 },
      buses: {
        music: 1,
        foley: 0,
        ambience: settings.sfxLevel ?? 1,
        sfx: settings.sfxLevel ?? 1,
      },
    },
  };
  const direction: CinematicDirection = {
    schema: "film.cinematic-direction@1",
    projectId: input.projectId,
    chapterId: chapter.id,
    revision: input.revision,
    title: chapter.title,
    seed,
    duration,
    reducedMotion: input.reducedMotion,
    profile: input.outputProfile ?? "landscape-1080p30@1",
    assets,
    scenes,
    params: {
      cool: curve(0.2 * intensity, 0.04, 0.1 * intensity),
      warm: curve(0.08, (memory ? 0.5 : 0.35) * intensity, 0.15),
      vignette: curve(0.3, 0.16, 0.3),
      rays: curve(0, 0.65 * intensity * emphasis, 0.05),
      motes: curve(0.08, 0.35 * intensity, 0.1),
      leaves: [[0, 0]],
      speed: curve(0.55, 0.85, 0.5),
      bloom: curve(0.02, 0.22 * intensity * emphasis, 0.03),
    },
    options: {
      rays: 8,
      motes: 48,
      leaves: 0,
      leafColors: ["#e1b64e"],
      light: [255, 236, 190],
      coolWash: "#5f7b94",
      warmWash: memory ? "#ffc38c" : "#ffbf70",
      grain: 0.045 * intensity,
      transitionGlow: 0.1 * intensity,
    },
    steps: [],
    ...chapterCopy(input, chapter, scenes),
    slates: [],
    credits: null,
    score,
  };
  return sealDirection(direction, timingPlan);
}

/** Reusable Chapter stems include music as well as effects; concatenation preserves both. */
export function compileProjectChapter(
  paths: FilmRuntimePaths,
  direction: CinematicDirection,
  timingPlan: ResolvedRenderPlan,
  score: PreparedScore,
) {
  const plan = compileCinematicFilm(paths, direction, score);
  plan.audio.events.unshift({
    asset: score.music.path,
    sha256: score.music.sha256,
    startMs: 0,
    durationMs: Math.round(direction.duration * 1000),
    gain: 1,
    loop: false,
    fadeInMs: 0,
    fadeOutMs: 0,
  });
  plan.audio.bgm = {
    ...timingPlan.audio.bgm,
    gain: 0,
    durationMs: Math.round(direction.duration * 1000),
  };
  if (!plan.lock.media.some((m) => m.asset === plan.audio.bgm.asset))
    plan.lock.media.push({
      asset: plan.audio.bgm.asset,
      sha256: plan.audio.bgm.sha256,
    });
  plan.chapter.index = timingPlan.chapter.index;
  plan.fingerprint = digestOf({
    cinematic: plan.fingerprint,
    audio: plan.audio,
    lock: plan.lock,
  });
  return plan;
}
