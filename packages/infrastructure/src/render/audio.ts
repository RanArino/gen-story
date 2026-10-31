// Pure builders for the ffmpeg audio graphs. The Chapter stem holds every non-BGM sound event;
// the Chapter mix and the concatenated film lay the shared BGM under the stems.
import type { AudioEvent } from "../contracts/types.js";

export const SAMPLE_RATE = 48_000;
const FORMAT = `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`;

export interface AudioGraph {
  /** Input arguments, one `-i` group per stream, in input-index order. */
  inputs: string[];
  filter: string;
  /** The filter output label to map. */
  output: string;
}

const sec = (ms: number) => String(ms / 1000);

function fades(
  fadeInMs: number,
  fadeOutMs: number,
  durationMs: number,
): string[] {
  const out: string[] = [];
  if (fadeInMs > 0)
    out.push(`afade=t=in:st=0:d=${sec(Math.min(fadeInMs, durationMs))}`);
  if (fadeOutMs > 0)
    out.push(
      `afade=t=out:st=${sec(Math.max(0, durationMs - fadeOutMs))}:d=${sec(Math.min(fadeOutMs, durationMs))}`,
    );
  return out;
}

/** One event as a filter chain: trim, fade, gain, then delay to its start. */
function eventChain(
  index: number,
  event: AudioEvent,
  assetMs: number,
  label: string,
): string {
  const durationMs = event.durationMs ?? assetMs;
  const delay = Math.round(event.startMs);
  return [
    `[${index}:a]${FORMAT}`,
    `atrim=0:${sec(durationMs)}`,
    "asetpts=PTS-STARTPTS",
    ...fades(event.fadeInMs, event.fadeOutMs, durationMs),
    `volume=${event.gain}`,
    `adelay=${delay}|${delay}[${label}]`,
  ].join(",");
}

function eventInputs(events: AudioEvent[], mediaDir: string): string[] {
  return events.flatMap((e) => [
    ...(e.loop ? ["-stream_loop", "-1"] : []),
    "-i",
    `${mediaDir}${e.asset}`,
  ]);
}

/**
 * Mixes delayed events into one exact-length stream. A Chapter with no events is silence, so
 * every artifact still has a stem of the Chapter's runtime.
 */
export function stemGraph(
  events: AudioEvent[],
  runtimeMs: number,
  mediaDir: string,
  assetMs: (asset: string) => number,
): AudioGraph {
  const end = `apad=whole_dur=${sec(runtimeMs)},atrim=0:${sec(runtimeMs)}[stem]`;
  if (!events.length) {
    return {
      inputs: ["-f", "lavfi", "-i", `anullsrc=r=${SAMPLE_RATE}:cl=stereo`],
      filter: `[0:a]${FORMAT},${end}`,
      output: "[stem]",
    };
  }
  const chains = events.map((e, i) =>
    eventChain(i, e, assetMs(e.asset), `e${i}`),
  );
  const mix = `${events.map((_, i) => `[e${i}]`).join("")}amix=inputs=${events.length}:normalize=0:dropout_transition=0,${end}`;
  return {
    inputs: eventInputs(events, mediaDir),
    filter: [...chains, mix].join(";"),
    output: "[stem]",
  };
}

export interface BedInput {
  bgm: AudioEvent & { offsetMs: number };
  runtimeMs: number;
  /** Stem WAV files and where each starts on the output timeline. */
  stems: { file: string; startMs: number; startSample?: number }[];
  mediaDir: string;
  /** Number of inputs already given to ffmpeg before these (the video for a Chapter mux). */
  firstInput: number;
}

/** Lays the BGM from its offset with its fades, then mixes each stem at its start. */
export function bedGraph(input: BedInput): AudioGraph {
  const { bgm, runtimeMs, stems, firstInput } = input;
  const at = (i: number) => firstInput + i;
  const bed = [
    `[${at(0)}:a]${FORMAT}`,
    `atrim=start=${sec(bgm.offsetMs)}:duration=${sec(runtimeMs)}`,
    "asetpts=PTS-STARTPTS",
    ...fades(bgm.fadeInMs, bgm.fadeOutMs, runtimeMs),
    `volume=${bgm.gain}[bgm]`,
  ].join(",");
  const stemChains = stems.map(
    (s, i) =>
      `[${at(i + 1)}:a]${FORMAT},adelay=${s.startSample ?? Math.round((s.startMs * SAMPLE_RATE) / 1000)}S:all=1[s${i}]`,
  );
  const mix = `[bgm]${stems.map((_, i) => `[s${i}]`).join("")}amix=inputs=${stems.length + 1}:normalize=0:dropout_transition=0,apad=whole_dur=${sec(runtimeMs)},atrim=0:${sec(runtimeMs)}[mix]`;
  return {
    inputs: [
      "-i",
      `${input.mediaDir}${bgm.asset}`,
      ...stems.flatMap((s) => ["-i", s.file]),
    ],
    filter: [bed, ...stemChains, mix].join(";"),
    output: "[mix]",
  };
}
