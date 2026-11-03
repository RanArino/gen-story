import type { ResolvedRenderPlan } from "../contracts/types.js";
import type { RuntimeChapter, RuntimeInput } from "../index.js";
import { rngFor } from "./math.js";
import { chapterCopy, chapterTimeline, sealDirection } from "./project.js";
import type {
  CameraKey,
  CinematicDirection,
  CinematicScene,
  CinematicScore,
  CurvePoint,
  SoundEvent,
} from "./types.js";

/**
 * Structural copy of the approved, user-reviewed Agent direction (domain `FilmDirectionContent`).
 * Only named, bounded choices arrive here; this module converts them to exact keys and events.
 */
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
export interface ApprovedChapterDirection {
  music: {
    tempoBpm: number;
    key: "C" | "D" | "Eb" | "E" | "F" | "G" | "A" | "Bb";
    mode: "major" | "minor";
    instruments: ("pad" | "koto-pluck" | "low-swell")[];
    melody: "sparse" | "medium" | "flowing";
    arc: "steady" | "rise" | "fall" | "swell";
    fromPrevious: "continue" | "lift" | "settle" | "contrast";
  };
  scenes: ApprovedSceneDirection[];
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

const ROOT = { C: 0, D: 2, Eb: 3, E: 4, F: 5, G: 7, A: 9, Bb: 10 } as const;
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);
const named = (midi: number) =>
  `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
/** Diatonic progressions as [semitones from the tonic, minor third?]. */
const PROGRESSIONS = {
  major: [
    [
      [0, false],
      [7, false],
      [9, true],
      [5, false],
    ],
    [
      [0, false],
      [5, false],
      [9, true],
      [7, false],
    ],
  ],
  minor: [
    [
      [0, true],
      [8, false],
      [3, false],
      [10, false],
    ],
    [
      [0, true],
      [5, true],
      [8, false],
      [7, false],
    ],
  ],
} as const;
const SCALE = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10] };

function arcLevel(arc: ApprovedChapterDirection["music"]["arc"], p: number) {
  if (arc === "rise") return 0.7 + 0.4 * p;
  if (arc === "fall") return 1.1 - 0.4 * p;
  if (arc === "swell")
    return 0.75 + 0.4 * Math.sin(Math.PI * Math.min(1, p / 0.8));
  return 1;
}

/** Builds a Chapter score from the approved music spec and per-scene sound choices. */
export function scoreForDirection(
  approved: ApprovedChapterDirection,
  windows: { id: string; t0: number; t1: number }[],
  duration: number,
  seed: number,
  sfxLevel: number,
): { score: CinematicScore; steps: CinematicDirection["steps"] } {
  const music = approved.music;
  const rng = rngFor(seed, 31);
  const tonic = 36 + ROOT[music.key];
  const beat = 60 / music.tempoBpm;
  const chordSeconds = 8 * beat;
  const progression = PROGRESSIONS[music.mode][
    rng() < 0.5 ? 0 : 1
  ] as readonly (readonly [number, boolean])[];
  const chordAt = (t: number) =>
    progression[Math.floor(t / chordSeconds) % progression.length]!;
  const voicing = ([degree, minor]: readonly [number, boolean]) => {
    const bass = tonic + (degree % 12);
    return [bass, bass + 7, bass + 12, bass + 12 + (minor ? 3 : 4) + 12];
  };
  const events: Omit<SoundEvent, "i">[] = [];
  const has = (i: ApprovedChapterDirection["music"]["instruments"][number]) =>
    music.instruments.includes(i);
  const start =
    music.fromPrevious === "contrast"
      ? 0.4
      : music.fromPrevious === "settle"
        ? 0.2
        : 0;
  if (has("pad"))
    for (let t = start; t < duration - 1; t += chordSeconds) {
      const hold = Math.min(chordSeconds, duration - t - 0.5);
      const midi = voicing(chordAt(t));
      events.push({
        t: round(t),
        sound: "pad",
        params: {
          freqs: midi.map(hz),
          notes: midi.map(named),
          level: round(0.3 * arcLevel(music.arc, t / duration)),
          hold: round(hold),
          fadeIn: round(
            Math.min(music.fromPrevious === "settle" ? 2.5 : 1.5, hold / 2),
          ),
          fadeOut: 1.4,
        },
        sustain: true,
      });
    }
  if (has("koto-pluck")) {
    const every = { sparse: 4, medium: 2, flowing: 1 }[music.melody] * beat;
    const scale = SCALE[music.mode];
    let degree = 4;
    for (let t = start + 0.8; t < duration - 1; t += every) {
      if (music.melody === "flowing" && rng() < 0.25) continue;
      // A gentle random walk over the scale, pulled toward the current chord root.
      const [root] = chordAt(t);
      const pull = scale.indexOf(root % 12);
      degree +=
        Math.round((rng() - 0.5) * 3) +
        (pull >= 0 && rng() < 0.3 ? Math.sign(pull - (degree % 7)) : 0);
      degree = clamp(degree, 0, 11);
      const midi =
        tonic + 24 + scale[degree % 7]! + 12 * Math.floor(degree / 7);
      const level = arcLevel(music.arc, t / duration);
      events.push({
        t: round(t),
        sound: "koto-pluck",
        params: {
          freq: hz(midi),
          note: named(midi),
          vel: round(clamp((0.38 + 0.3 * rng()) * level, 0.05, 1)),
          gain: 0.7,
        },
      });
    }
  }
  const swell = (t: number, gain: number) => {
    const [bass] = voicing(chordAt(t));
    events.push({
      t: round(t),
      sound: "low-swell",
      params: {
        gain: round(gain),
        freqs: [hz(bass!), hz(bass! + 7), hz(bass! + 12)],
      },
    });
  };
  if (has("low-swell")) {
    swell(Math.min(0.6, duration / 4), 0.7);
    if (music.arc !== "steady" && duration > 8)
      swell(duration * (music.arc === "fall" ? 0.25 : 0.6), 0.6);
  } else if (music.fromPrevious === "lift")
    swell(Math.min(0.6, duration / 4), 0.5);

  const steps: CinematicDirection["steps"] = [];
  approved.scenes.forEach((scene, i) => {
    const w = windows[i]!;
    const length = w.t1 - w.t0;
    if (scene.footsteps !== "none") {
      const pace = 0.62 - 0.12 * clamp(scene.camera.speed, 0, 1);
      for (let t = w.t0 + 0.35; t < w.t1 - 0.5; t += pace) {
        steps.push({ t: round(t), surface: scene.footsteps });
        events.push({
          t: round(t),
          sound: "footstep",
          params: { surface: scene.footsteps, gain: 0.75 },
        });
      }
    }
    for (const s of scene.sounds) {
      const t = round(Math.min(duration - 0.05, w.t0 + s.at * length));
      const gain = clamp(s.gain, 0, 1);
      if (s.sound === "bird-chirp")
        events.push({
          t,
          sound: "bird-chirp",
          params: {
            freq: [2800, 4500],
            count: [2, 4],
            gain: round(gain),
            f: round(2800 + rng() * 1700),
            n: 2 + Math.floor(rng() * 3),
            pan: round(rng() * 2 - 1),
          },
        });
      else if (s.sound === "temple-bell")
        events.push({
          t,
          sound: "temple-bell",
          params: {
            gain: round(gain),
            pitch: round(clamp(hz(tonic + 12), 60, 400)),
          },
        });
      else if (s.sound === "low-swell") swell(t, gain);
      else if (s.sound === "clap")
        events.push({
          t,
          sound: "clap",
          params: { gain: round(clamp(gain, 0.05, 1.5)) },
        });
      else events.push({ t, sound: "suzu", params: { gain: round(gain) } });
    }
  });
  // Ambience beds follow each photo: keyed at scene midpoints, silent at the edges.
  const bed = (
    pick: (s: ApprovedSceneDirection) => number,
    max: number,
  ): CurvePoint[] => {
    const points: CurvePoint[] = [[0, 0]];
    approved.scenes.forEach((scene, i) => {
      const w = windows[i]!;
      const mid = round((w.t0 + w.t1) / 2);
      if (mid > points.at(-1)![0]) points.push([mid, round(pick(scene) * max)]);
    });
    if (duration > points.at(-1)![0]) points.push([round(duration), 0]);
    return points;
  };
  const beds: CinematicScore["beds"] = [];
  if (approved.scenes.some((s) => s.ambience.wind > 0))
    beds.push({
      name: "wind",
      sound: "wind",
      params: { center: 420 },
      curve: bed((s) => s.ambience.wind, 0.11),
      salt: 11,
    });
  if (approved.scenes.some((s) => s.ambience.stream > 0))
    beds.push({
      name: "stream",
      sound: "stream",
      params: { pan: 0.3 },
      curve: bed((s) => s.ambience.stream, 0.12),
      salt: 12,
    });
  const fadeIn =
    music.fromPrevious === "settle"
      ? 2.2
      : music.fromPrevious === "contrast"
        ? 0.5
        : 0.8;
  const ordered = events
    .filter((e) => e.t < duration)
    .sort((a, b) => a.t - b.t)
    .map((e, i) => ({ ...e, i }) as SoundEvent);
  return {
    steps,
    score: {
      seed,
      duration,
      events: ordered,
      beds,
      master: [
        [0, 0],
        [round(Math.min(fadeIn, duration / 4)), 0.9],
        [round(duration - Math.min(1.2, duration / 4)), 0.9],
        [duration, 0],
      ],
      mix: {
        reverb: {
          seconds: 3,
          decay: 2.5,
          wet:
            music.mode === "minor" || music.melody === "sparse" ? 0.45 : 0.35,
        },
        buses: { music: 1, foley: 1, ambience: sfxLevel, sfx: sfxLevel },
      },
    },
  };
}

/** Per-scene look keyed at scene midpoints, so each photo carries its own light and particles. */
function lookCurves(
  approved: ApprovedChapterDirection,
  windows: { t0: number; t1: number }[],
  duration: number,
): CinematicDirection["params"] {
  const curve = (pick: (s: ApprovedSceneDirection) => number): CurvePoint[] => {
    const points: CurvePoint[] = [];
    approved.scenes.forEach((scene, i) => {
      const w = windows[i]!;
      const mid = round((w.t0 + w.t1) / 2);
      const value = round(clamp(pick(scene), 0, 1));
      if (!points.length) points.push([0, value]);
      if (mid > points.at(-1)![0]) points.push([mid, value]);
    });
    if (duration > points.at(-1)![0])
      points.push([round(duration), points.at(-1)![1]]);
    return points;
  };
  return {
    cool: curve((s) => 0.04 + 0.45 * Math.max(0, -s.effects.warmth)),
    warm: curve((s) => 0.55 * Math.max(0, s.effects.warmth)),
    vignette: curve((s) => 0.25 + 0.2 * (1 - s.effects.rays)),
    rays: curve((s) => 0.8 * s.effects.rays),
    motes: curve((s) => 0.65 * s.effects.motes),
    leaves: curve((s) => 0.85 * s.effects.leaves),
    speed: curve((s) => 0.55 + 0.4 * s.camera.speed),
    bloom: curve((s) => 0.03 + 0.22 * s.effects.rays),
  };
}

/** Materialize an approved Agent direction for one Chapter into renderable, validated data. */
export function directApprovedChapter(
  input: RuntimeInput,
  chapter: RuntimeChapter,
  timingPlan: ResolvedRenderPlan,
  approved: ApprovedChapterDirection,
): { direction: CinematicDirection; fingerprint: string } {
  const { duration, seed, assets, windows } = chapterTimeline(
    input,
    chapter,
    timingPlan,
  );
  if (
    approved.scenes.length !== windows.length ||
    approved.scenes.some((s, i) => s.sceneId !== windows[i]!.id)
  )
    throw new Error(
      "The approved direction no longer matches this Chapter's photos. Ask the AI for a new direction.",
    );
  const { score, steps } = scoreForDirection(
    approved,
    windows,
    duration,
    seed,
    chapter.settings?.sfxLevel ?? 1,
  );
  const scenes: CinematicScene[] = windows.map((w, i) => {
    const scene = approved.scenes[i]!;
    const { keys, bob } = cameraForMove(
      scene.camera,
      scene.footsteps !== "none",
    );
    return {
      id: w.id,
      image: w.image,
      framing: "follow",
      t0: w.t0,
      t1: w.t1,
      fadeIn: w.fadeIn,
      fadeOut: w.fadeOut,
      bob,
      camera: keys,
    };
  });
  const leaves = approved.scenes.some((s) => s.effects.leaves > 0);
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
    params: lookCurves(approved, windows, duration),
    options: {
      rays: 9,
      motes: 72,
      leaves: leaves ? 18 : 0,
      leafColors: ["#9bb84f", "#c3cc62", "#e1b64e", "#7ea23e", "#d98f3e"],
      light: [255, 236, 190],
      coolWash: "#5f7b94",
      warmWash: "#ffbf70",
      grain: 0.06,
      transitionGlow: 0.12,
    },
    steps,
    ...chapterCopy(input, chapter, scenes),
    slates: [],
    credits: null,
    score,
  };
  return sealDirection(direction, timingPlan);
}
