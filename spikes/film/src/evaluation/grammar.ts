// Editing-grammar metrics read from compiled Chapter Plans. Pure: classes come from what the Plan
// paints (image geometry, keyframes, segment timing), not from Capability names, so two Recipes
// that differ only in naming cannot look different here.
import type { Anim, PainterNode, ResolvedRenderPlan } from "../contracts/types.js";

export interface GrammarMetrics {
  shotCount: number;
  shotMeanMs: number;
  shotVarianceMs2: number;
  layout: Record<string, number>; // per scene: full-frame | card | split-<n>
  transition: Record<string, number>; // per join: cut | gap | overlap-fade | overlap-slide
  motion: Record<string, number>; // per scene: still | push | parallax | pulse
  textWindows: number;
}

type Image = Extract<PainterNode, { type: "image" }>;
type Group = Extract<PainterNode, { type: "group" }>;

const keyCount = (a: Anim | undefined): number => (a !== undefined && typeof a === "object" ? a.keys.length : 0);
const first = (a: Anim): number => (typeof a === "number" ? a : a.keys[0]!.v);
/** Animated across the whole window, as layout motion is; transition envelopes cover only an overlap. */
const spans = (a: Anim | undefined, startMs: number, endMs: number): boolean =>
  a !== undefined && typeof a === "object" && a.keys[0]!.t === startMs && a.keys.at(-1)!.t === endMs;

function images(nodes: PainterNode[], ancestors: Group[] = [], out: { image: Image; ancestors: Group[] }[] = []) {
  for (const node of nodes) {
    if (node.type === "image") out.push({ image: node, ancestors });
    if (node.type === "group") images(node.children, [...ancestors, node], out);
  }
  return out;
}

function count(into: Record<string, number>, key: string): void {
  into[key] = (into[key] ?? 0) + 1;
}

const sorted = (h: Record<string, number>): Record<string, number> => Object.fromEntries(Object.entries(h).sort(([a], [b]) => (a < b ? -1 : 1)));

const MOTION_RANK = ["still", "push", "parallax", "pulse"];

function motionOf(image: Image, ancestors: Group[]): string {
  const geometry = [image.src.x, image.src.y, image.src.w, image.src.h, image.dst.x, image.dst.y, image.dst.w, image.dst.h, image.rotateDeg];
  const keys = Math.max(...geometry.map(keyCount));
  if (keys > 2) return "pulse";
  if (ancestors.some((g) => spans(g.translateX, image.startMs, image.endMs) || spans(g.translateY, image.startMs, image.endMs))) return "parallax";
  return keys === 2 ? "push" : "still";
}

function hasSlideEnvelope(nodes: PainterNode[]): boolean {
  return nodes.some((n) => n.type === "group" && ((keyCount(n.translateX) > 0 && !spans(n.translateX, n.startMs, n.endMs)) || hasSlideEnvelope(n.children)));
}

export function grammarMetrics(plans: ResolvedRenderPlan[]): GrammarMetrics {
  const shots: number[] = [];
  const layout: Record<string, number> = {};
  const transition: Record<string, number> = {};
  const motion: Record<string, number> = {};
  let textWindows = 0;
  for (const plan of plans) {
    const { widthPx: W, heightPx: H } = plan.profile;
    const placed = images(plan.layers);
    for (const seg of plan.segments.filter((s) => s.kind === "scene")) {
      shots.push(seg.endMs - seg.startMs);
      const own = placed.filter(({ image }) => image.startMs === seg.startMs && image.endMs === seg.endMs);
      const partial = own.filter(({ image }) => first(image.dst.w) < W * 0.99 || first(image.dst.h) < H * 0.99).length;
      count(layout, partial >= 2 ? `split-${partial}` : partial === 1 ? "card" : "full-frame");
      const ranks = own.map(({ image, ancestors }) => MOTION_RANK.indexOf(motionOf(image, ancestors)));
      count(motion, MOTION_RANK[Math.max(0, ...ranks)]!);
    }
    const { overlapMs, gapMs } = plan.timing.proposal;
    const kind = overlapMs > 0 ? (hasSlideEnvelope(plan.layers) ? "overlap-slide" : "overlap-fade") : gapMs > 0 ? "gap" : "cut";
    for (let i = 1; i < plan.segments.length; i += 1) count(transition, kind);
    textWindows += plan.texts.length;
  }
  const mean = shots.reduce((a, b) => a + b, 0) / shots.length;
  const variance = shots.reduce((a, b) => a + (b - mean) ** 2, 0) / shots.length;
  return { shotCount: shots.length, shotMeanMs: Math.round(mean), shotVarianceMs2: Math.round(variance), layout: sorted(layout), transition: sorted(transition), motion: sorted(motion), textWindows };
}

/** Names of the metrics on which two films differ. */
export function differingMetrics(a: GrammarMetrics, b: GrammarMetrics): string[] {
  return (Object.keys(a) as (keyof GrammarMetrics)[]).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
