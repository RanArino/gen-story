// Pure helpers available to Capability implementations. No I/O, clock, or global randomness.
import type { Anim, Ease, PainterNode, Rect } from "../contracts/types.js";
import type { CapabilityInput, CapabilityOutput } from "./abi.js";

export function keys(...frames: [t: number, v: number, ease?: Ease][]): Anim {
  return { keys: frames.map(([t, v, ease]) => ({ t: Math.round(t), v: round3(v), ease: ease ?? "ease-in-out" })) };
}

export function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Deterministic PRNG (mulberry32) from the seed the compiler supplies. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Subject bounds in source pixels. */
export function subjectPx(input: CapabilityInput): Rect {
  const media = input.scene!.media[0]!;
  const s = input.scene!.analysis.subject;
  return { x: s.x * media.widthPx, y: s.y * media.heightPx, w: s.w * media.widthPx, h: s.h * media.heightPx };
}

/**
 * The largest crop of the given aspect (w/h) that fits the source, scaled by `zoom` (<= 1 is
 * tighter), centred on the subject as far as the source allows, and always containing the subject.
 */
export function safeCrop(input: CapabilityInput, aspect: number, zoom = 1): Rect {
  const media = input.scene!.media[0]!;
  const subject = subjectPx(input);
  let w = Math.min(media.widthPx, media.heightPx * aspect);
  let h = w / aspect;
  const minScale = Math.max(subject.w / w, subject.h / h);
  const scale = clamp(zoom, Math.min(1, minScale), 1);
  w *= scale;
  h *= scale;
  const cx = subject.x + subject.w / 2;
  const cy = subject.y + subject.h / 2;
  const x = clamp(cx - w / 2, Math.max(0, subject.x + subject.w - w), Math.min(media.widthPx - w, subject.x));
  const y = clamp(cy - h / 2, Math.max(0, subject.y + subject.h - h), Math.min(media.heightPx - h, subject.y));
  return { x: round3(x), y: round3(y), w: round3(w), h: round3(h) };
}

export function empty(): CapabilityOutput {
  return { layers: [], audio: [] };
}

/** Visible time of the current segment, excluding overlaps with its neighbours. */
export function holdWindow(input: CapabilityInput): { start: number; end: number } {
  return { start: input.window.startMs + input.window.inOverlapMs, end: input.window.endMs - input.window.outOverlapMs };
}

export function mapImages(nodes: PainterNode[], fn: (node: Extract<PainterNode, { type: "image" }>) => PainterNode): PainterNode[] {
  return nodes.map((node) => {
    if (node.type === "image") return fn(node);
    if (node.type === "group") return { ...node, children: mapImages(node.children, fn) };
    return node;
  });
}

export function hasCjk(text: string): boolean {
  return /[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/.test(text);
}

/**
 * A crop of the same aspect as `crop`, `scale` times its size (<= 1), moved toward the subject,
 * still containing the subject and staying inside `crop`.
 */
export function tighten(crop: Rect, subject: Rect, scale: number): Rect {
  const aspect = crop.w / crop.h;
  const w = Math.min(crop.w, Math.max(crop.w * scale, subject.w, subject.h * aspect));
  const h = w / aspect;
  const cx = subject.x + subject.w / 2;
  const cy = subject.y + subject.h / 2;
  const x = clamp(cx - w / 2, Math.max(subject.x + subject.w - w, crop.x), Math.min(subject.x, crop.x + crop.w - w));
  const y = clamp(cy - h / 2, Math.max(subject.y + subject.h - h, crop.y), Math.min(subject.y, crop.y + crop.h - h));
  return { x: round3(x), y: round3(y), w: round3(w), h: round3(h) };
}

/** The static value of an Anim, or its first key. */
export function valueAt0(anim: Anim): number {
  return typeof anim === "number" ? anim : (anim.keys[0]?.v ?? 0);
}

export function staticRect(box: { x: Anim; y: Anim; w: Anim; h: Anim }): Rect {
  return { x: valueAt0(box.x), y: valueAt0(box.y), w: valueAt0(box.w), h: valueAt0(box.h) };
}
