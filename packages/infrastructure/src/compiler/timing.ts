// Chapter timing: preflight, then resolution of blank scene durations. Integer milliseconds only.
// User-entered durations are never changed; they are only accepted or rejected.
//
//   runtime R = titleMs + Σ sceneMs − Σ overlapMs + Σ gapMs
//   minimum of scene i = max(minSceneMs, inOverlap_i + outOverlap_i + minHoldMs), rounded up to a beat
import { digestOf } from "../contracts/canonical.js";
import { filmError, FilmFailure, type FilmError } from "../contracts/errors.js";
import {
  DEFAULT_CHAPTER_LIMIT_MS,
  type FilmChapter,
  type TimingProposal,
} from "../contracts/types.js";

export interface CutTiming {
  preferredSceneMs: number;
  minSceneMs: number;
  maxSceneMs: number;
  minHoldMs: number;
  beatMs: number | null;
}

export interface TimingInput {
  chapter: FilmChapter;
  fps: number;
  chapterPath: string; // JSON pointer of the Chapter in its chapters document
  titleMs: number;
  overlapMs: number; // per adjacent segment pair
  gapMs: number;
  cut: CutTiming;
  weights: number[]; // per scene, from Story Graph emphasis
}

export function chapterLimit(chapter: FilmChapter): number | null {
  return chapter.limitMs === undefined
    ? DEFAULT_CHAPTER_LIMIT_MS
    : chapter.limitMs;
}

/** frame = floor((ms * fps + 500) / 1000), recorded in Plans as round-half-up@1. */
export function frameCount(ms: number, fps: number): number {
  return Math.floor((ms * fps + 500) / 1000);
}

/** The longest runtime within the limit whose frameCount also presents within the limit at fps. */
export function frameSafeLimitMs(limitMs: number, fps: number): number {
  const maxFrames = Math.floor((limitMs * fps) / 1000);
  return Math.min(limitMs, Math.ceil((maxFrames * 1000 + 500) / fps) - 1);
}

function ceilTo(value: number, step: number | null): number {
  return step ? Math.ceil(value / step) * step : value;
}

function floorTo(value: number, step: number | null): number {
  return step ? Math.floor(value / step) * step : value;
}

/** Minimum valid duration of each scene. Every scene has an incoming transition (from the title or the previous scene). */
export function sceneMinimums(input: TimingInput): number[] {
  const n = input.chapter.scenes.length;
  return input.chapter.scenes.map((_, i) => {
    const incoming = input.overlapMs;
    const outgoing = i < n - 1 ? input.overlapMs : 0;
    return ceilTo(
      Math.max(input.cut.minSceneMs, incoming + outgoing + input.cut.minHoldMs),
      input.cut.beatMs,
    );
  });
}

function runtimeOf(input: TimingInput, durations: number[]): number {
  const n = durations.length;
  return (
    input.titleMs +
    durations.reduce((a, b) => a + b, 0) -
    n * input.overlapMs +
    n * input.gapMs
  );
}

export function preflight(input: TimingInput): FilmError[] {
  const errors: FilmError[] = [];
  const minimums = sceneMinimums(input);
  input.chapter.scenes.forEach((s, i) => {
    if (s.durationMs !== undefined && s.durationMs < minimums[i]!) {
      errors.push(
        filmError(
          "FS_SCENE_TOO_SHORT_FOR_TRANSITIONS",
          `${input.chapterPath}/scenes/${i}/durationMs`,
          `${s.sceneId} is ${s.durationMs} ms; its transitions need at least ${minimums[i]} ms`,
          {
            sceneId: s.sceneId,
            durationMs: s.durationMs,
            minMs: minimums[i],
          },
        ),
      );
    }
  });
  if (errors.length) return errors;
  const limit = chapterLimit(input.chapter);
  if (limit === null) return [];
  const requiredMinMs = runtimeOf(
    input,
    input.chapter.scenes.map((s, i) => s.durationMs ?? minimums[i]!),
  );
  const { fps } = input;
  const maxRuntimeMs = frameSafeLimitMs(limit, fps);
  if (requiredMinMs > maxRuntimeMs) {
    const frames = frameCount(requiredMinMs, fps);
    const encodedDurationMs = (frames * 1000) / fps;
    const overByMs = requiredMinMs - maxRuntimeMs;
    const need =
      requiredMinMs > limit
        ? `needs at least ${requiredMinMs} ms but its limit is ${limit} ms`
        : `needs at least ${requiredMinMs} ms, which encodes as ${frames} frames (${encodedDurationMs.toFixed(1)} ms) at ${fps} fps, over its ${limit} ms limit`;
    errors.push(
      filmError(
        "FS_PREFLIGHT_OVER_LIMIT",
        input.chapterPath,
        `Chapter ${input.chapter.id} ${need}; shorten it by ${overByMs} ms`,
        {
          chapterId: input.chapter.id,
          limitMs: limit,
          requiredMinMs,
          encodedFrames: frames,
          encodedDurationMs,
          fps,
          overByMs,
          fixedScenes: input.chapter.scenes
            .filter((s) => s.durationMs !== undefined)
            .map((s) => ({ sceneId: s.sceneId, durationMs: s.durationMs })),
        },
      ),
    );
  }
  return errors;
}

/**
 * Distributes `available` ms over blank scenes by weight with integer water-filling: each scene
 * gets clamp(floor(λ·w), min, preferred) for the largest λ that fits, and leftover milliseconds go
 * one at a time to the earliest scenes that still have room.
 */
function waterFill(
  available: number,
  weights: number[],
  minimums: number[],
  caps: number[],
): number[] {
  const at = (lambda: number) =>
    weights.map((w, i) =>
      Math.min(caps[i]!, Math.max(minimums[i]!, Math.floor(lambda * w))),
    );
  const total = (values: number[]) => values.reduce((a, b) => a + b, 0);
  let lo = 0;
  let hi = Math.max(...caps.map((c, i) => c / weights[i]!)) + 1;
  for (let k = 0; k < 64; k += 1) {
    const mid = (lo + hi) / 2;
    if (total(at(mid)) <= available) lo = mid;
    else hi = mid;
  }
  const values = at(lo);
  let leftover = available - total(values);
  while (leftover > 0) {
    let gave = false;
    for (let i = 0; i < values.length && leftover > 0; i += 1) {
      if (values[i]! < caps[i]!) {
        values[i]! += 1;
        leftover -= 1;
        gave = true;
      }
    }
    if (!gave) break;
  }
  return values;
}

export function resolveTiming(input: TimingInput): TimingProposal {
  const errors = preflight(input);
  if (errors.length) throw new FilmFailure(errors);
  const { cut } = input;
  const minimums = sceneMinimums(input);
  const limit = chapterLimit(input.chapter);
  const blanks = input.chapter.scenes
    .map((s, i) => (s.durationMs === undefined ? i : -1))
    .filter((i) => i >= 0);
  const preferred = input.chapter.scenes.map((_, i) => {
    const max = Math.max(cut.maxSceneMs, minimums[i]!);
    return Math.min(
      max,
      Math.max(
        minimums[i]!,
        Math.round(cut.preferredSceneMs * input.weights[i]!),
      ),
    );
  });
  const durations = input.chapter.scenes.map(
    (s, i) => s.durationMs ?? preferred[i]!,
  );

  if (limit !== null && blanks.length) {
    const fixedRuntime =
      runtimeOf(input, durations) -
      blanks.reduce((sum, i) => sum + durations[i]!, 0);
    const available = frameSafeLimitMs(limit, input.fps) - fixedRuntime;
    const preferredTotal = blanks.reduce((sum, i) => sum + preferred[i]!, 0);
    if (preferredTotal > available) {
      const filled = waterFill(
        available,
        blanks.map((i) => input.weights[i]!),
        blanks.map((i) => minimums[i]!),
        blanks.map((i) => preferred[i]!),
      );
      blanks.forEach((sceneIndex, k) => (durations[sceneIndex] = filled[k]!));
    }
  }
  for (const i of blanks)
    durations[i] = Math.max(minimums[i]!, floorTo(durations[i]!, cut.beatMs));

  const runtimeMs = runtimeOf(input, durations);
  return {
    schema: "film.timing-proposal@1",
    chapterId: input.chapter.id,
    limitMs: limit,
    titleMs: input.titleMs,
    overlapMs: input.overlapMs,
    gapMs: input.gapMs,
    runtimeMs,
    remainingMs: limit === null ? null : limit - runtimeMs,
    scenes: input.chapter.scenes.map((s, i) => ({
      sceneId: s.sceneId,
      source: s.durationMs === undefined ? "resolved" : "user",
      durationMs: durations[i]!,
      minMs: minimums[i]!,
    })),
  };
}

export function proposalDigest(proposal: TimingProposal): string {
  return digestOf(proposal);
}
