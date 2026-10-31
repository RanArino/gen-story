// Capability ABI v1: a pure, synchronous compile-time function from a typed input to declarative
// painter primitives and audio events. Capabilities never run in the browser or the encoder.
import type {
  Anim,
  AudioEvent,
  CapabilityKind,
  Curves,
  FilmStyleRecipe,
  PainterNode,
  ParamValue,
  Rect,
} from "../contracts/types.js";

export const CAPABILITY_ABI = "film-capability@1";

export interface MediaRef {
  asset: string;
  sha256: string;
  widthPx: number;
  heightPx: number;
}

/**
 * Which part of the timeline the function is asked for. `title` is the Chapter title card,
 * `overall-title` the concatenated film's title, `transition` the window between two segments,
 * and `join` the connection between two Chapter artifacts.
 */
export type Segment =
  | "title"
  | "scene"
  | "transition"
  | "overall-title"
  | "join";

export interface CapabilityInput {
  abi: typeof CAPABILITY_ABI;
  kind: CapabilityKind;
  segment: Segment;
  profile: { id: string; widthPx: number; heightPx: number; fps: number };
  window: {
    startMs: number;
    endMs: number;
    inOverlapMs: number;
    outOverlapMs: number;
  };
  scene?: {
    id: string;
    media: MediaRef[];
    analysis: { subject: Rect };
    caption?: { ja: string; en: string };
  };
  chapter: {
    id: string;
    title: string;
    index: number;
    sceneIndex: number;
    sceneCount: number;
  };
  curves: Curves;
  params: Record<string, ParamValue>;
  options: { reducedMotion: boolean; seed: number };
  beat?: { bpm: number; offsetMs: number };
  theme: {
    palette: FilmStyleRecipe["palette"];
    fonts: { caption: string[]; title: string[] };
    overallTitle?: string;
  };
  /** Bundled assets declared in the Manifest, resolved to locked media. */
  assets: Record<string, { asset: string; sha256: string }>;
  /** Layers produced by earlier slots for the same segment (layout output for motion). */
  upstream?: PainterNode[];
}

/** Group-level animation a transition applies to the outgoing or incoming segment. */
export interface Envelope {
  opacity?: Anim;
  translateX?: Anim;
  clipPolygon?: { x: Anim; y: Anim }[];
  brightness?: Anim;
  blur?: Anim;
}

export interface CapabilityOutput {
  layers: PainterNode[];
  audio: AudioEvent[];
  envelopes?: { outgoing?: Envelope; incoming?: Envelope };
}

export type CapabilityFunction = (input: CapabilityInput) => CapabilityOutput;
