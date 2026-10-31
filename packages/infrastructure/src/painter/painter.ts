// Trusted, import-free painter. Draws Resolved Render Plan primitives onto a Canvas 2D context at
// time t. Capture (runtime/render.html) and preview (runtime/preview.html) load this same file, so
// both draw the same Plan the same way. Capabilities never run here; only type imports are allowed.
import type {
  Anim,
  Blend,
  ConcatPlan,
  PainterNode,
  PlanFont,
  ResolvedRenderPlan,
  TextNode,
} from "../contracts/types.js";
import type { DrawOptions, MeasuredText } from "./protocol.js";

export type { Box, DrawOptions, MeasuredText } from "./protocol.js";

export const PAINTER_ABI = "film-painter@1";

export interface Surface {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  /** A cleared offscreen context of the same size, used to composite one group as a unit. */
  layer(depth: number): {
    ctx: CanvasRenderingContext2D;
    canvas: CanvasImageSource;
  };
  image(asset: string): CanvasImageSource | undefined;
}

/**
 * Value of an animated property at time t (ms). A segment between two keys uses the ease of its
 * starting key: `step` holds the starting value, `ease-in-out` is smoothstep, `linear` is linear.
 * Before the first key the first value holds; after the last key the last value holds.
 */
export function valueAt(
  anim: Anim | undefined,
  t: number,
  fallback = 0,
): number {
  if (anim === undefined) return fallback;
  if (typeof anim === "number") return anim;
  const keys = anim.keys;
  const first = keys[0];
  if (!first) return fallback;
  if (t <= first.t) return first.v;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i]!;
    const b = keys[i + 1]!;
    if (t >= b.t) continue;
    if (a.ease === "step" || b.t <= a.t) return a.v;
    const p = (t - a.t) / (b.t - a.t);
    const e = a.ease === "ease-in-out" ? p * p * (3 - 2 * p) : p;
    return a.v + (b.v - a.v) * e;
  }
  return keys[keys.length - 1]!.v;
}

function visible(node: PainterNode, t: number): boolean {
  return t >= node.startMs && t < node.endMs;
}

export function fontString(
  node: Pick<TextNode, "weight" | "sizePx" | "font">,
): string {
  return `${node.weight} ${node.sizePx}px ${node.font.map((alias) => `"${alias}"`).join(", ")}`;
}

function isCjk(ch: string): boolean {
  const c = ch.codePointAt(0)!;
  return (
    (c >= 0x3000 && c <= 0x30ff) ||
    (c >= 0x3400 && c <= 0x9fff) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xff00 && c <= 0xffef)
  );
}

/** Splits text into lines no wider than maxWidthPx: per character for CJK, per word otherwise. */
export function wrapLines(
  measure: (s: string) => number,
  text: string,
  maxWidthPx: number,
): string[] {
  const tokens: string[] = [];
  let word = "";
  for (const ch of text) {
    if (isCjk(ch)) {
      if (word) tokens.push(word);
      word = "";
      tokens.push(ch);
    } else if (ch === " ") {
      tokens.push(`${word} `);
      word = "";
    } else word += ch;
  }
  if (word) tokens.push(word);
  const lines: string[] = [];
  let line = "";
  for (const token of tokens) {
    const next = line + token;
    if (line && measure(next.trimEnd()) > maxWidthPx) {
      lines.push(line.trimEnd());
      line = token.trimStart();
    } else line = next;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.length ? lines : [""];
}

function drawText(
  ctx: CanvasRenderingContext2D,
  node: TextNode,
  t: number,
  alpha: number,
  out: MeasuredText[],
  omit: boolean,
): void {
  ctx.font = fontString(node);
  ctx.letterSpacing = `${node.letterSpacingPx}px`;
  const lines = wrapLines(
    (s) => ctx.measureText(s).width,
    node.text,
    node.maxWidthPx,
  );
  const lineH = node.sizePx * node.lineHeight;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const top = node.y + valueAt(node.translateY, t);
  const left =
    node.align === "center"
      ? node.x - w / 2
      : node.align === "right"
        ? node.x - w
        : node.x;
  const box = { x: left, y: top, w, h: lines.length * lineH };
  out.push({ role: node.role, text: node.text, color: node.color, box });
  if (node.scrim) {
    ctx.globalAlpha = alpha * node.scrim.opacity;
    ctx.fillStyle = node.scrim.color;
    const pad = node.scrim.padPx;
    ctx.fillRect(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2);
  }
  if (omit) return;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = node.color;
  ctx.textAlign = node.align;
  ctx.textBaseline = "middle";
  lines.forEach((line, i) =>
    ctx.fillText(line, node.x, top + (i + 0.5) * lineH),
  );
}

function needsLayer(
  alpha: number,
  blend: Blend | undefined,
  blur: number,
  brightness: number,
): boolean {
  return (
    alpha < 1 ||
    (blend !== undefined && blend !== "source-over") ||
    blur > 0 ||
    brightness !== 1
  );
}

function drawNodes(
  surface: Surface,
  ctx: CanvasRenderingContext2D,
  nodes: PainterNode[],
  t: number,
  depth: number,
  opts: DrawOptions,
  out: MeasuredText[],
): void {
  for (const node of nodes) {
    if (!visible(node, t)) continue;
    const alpha = Math.min(1, Math.max(0, valueAt(node.opacity, t, 1)));
    if (alpha <= 0) continue;
    ctx.save();
    switch (node.type) {
      case "rect":
        ctx.globalAlpha = alpha;
        ctx.fillStyle = node.color;
        ctx.fillRect(node.x, node.y, node.w, node.h);
        break;
      case "linearGradient": {
        const g = ctx.createLinearGradient(
          node.from.x,
          node.from.y,
          node.to.x,
          node.to.y,
        );
        for (const stop of node.stops) g.addColorStop(stop.at, stop.color);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = g;
        ctx.fillRect(node.x, node.y, node.w, node.h);
        break;
      }
      case "image": {
        const img = surface.image(node.asset);
        if (!img) throw new Error(`painter: image ${node.asset} is not loaded`);
        const dx = valueAt(node.dst.x, t);
        const dy = valueAt(node.dst.y, t);
        const dw = valueAt(node.dst.w, t);
        const dh = valueAt(node.dst.h, t);
        const rotate = valueAt(node.rotateDeg, t);
        if (rotate) {
          ctx.translate(dx + dw / 2, dy + dh / 2);
          ctx.rotate((rotate * Math.PI) / 180);
          ctx.translate(-(dx + dw / 2), -(dy + dh / 2));
        }
        ctx.globalAlpha = alpha;
        ctx.drawImage(
          img,
          valueAt(node.src.x, t),
          valueAt(node.src.y, t),
          valueAt(node.src.w, t),
          valueAt(node.src.h, t),
          dx,
          dy,
          dw,
          dh,
        );
        break;
      }
      case "text":
        drawText(
          ctx,
          node,
          t,
          alpha,
          out,
          opts.omitRoles?.includes(node.role) ?? false,
        );
        break;
      case "group": {
        const blur = valueAt(node.filter?.blur, t);
        const brightness = valueAt(node.filter?.brightness, t, 1);
        ctx.translate(valueAt(node.translateX, t), valueAt(node.translateY, t));
        if (node.clipRect || node.clipPolygon) {
          ctx.beginPath();
          if (node.clipRect)
            ctx.rect(
              node.clipRect.x,
              node.clipRect.y,
              node.clipRect.w,
              node.clipRect.h,
            );
          if (node.clipPolygon) {
            node.clipPolygon.forEach((p, i) =>
              i === 0
                ? ctx.moveTo(valueAt(p.x, t), valueAt(p.y, t))
                : ctx.lineTo(valueAt(p.x, t), valueAt(p.y, t)),
            );
            ctx.closePath();
          }
          ctx.clip();
        }
        if (!needsLayer(alpha, node.blend, blur, brightness)) {
          drawNodes(surface, ctx, node.children, t, depth, opts, out);
          break;
        }
        // Composite the group as one unit so overlapping children do not show through each other.
        const layer = surface.layer(depth + 1);
        layer.ctx.setTransform(ctx.getTransform());
        drawNodes(surface, layer.ctx, node.children, t, depth + 1, opts, out);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = alpha;
        ctx.globalCompositeOperation = node.blend ?? "source-over";
        const filters = [
          blur > 0 ? `blur(${blur}px)` : "",
          brightness !== 1 ? `brightness(${brightness})` : "",
        ].filter(Boolean);
        if (filters.length) ctx.filter = filters.join(" ");
        ctx.drawImage(layer.canvas, 0, 0);
        break;
      }
    }
    ctx.restore();
  }
}

/** Draws one frame and returns every text node it measured. */
export function drawFrame(
  surface: Surface,
  nodes: PainterNode[],
  t: number,
  opts: DrawOptions = {},
): MeasuredText[] {
  const out: MeasuredText[] = [];
  const { ctx } = surface;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, surface.width, surface.height);
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, surface.width, surface.height);
  ctx.restore();
  drawNodes(surface, ctx, nodes, t, 0, opts, out);
  return out;
}

/** The layers a document paints: a Chapter Plan's layers, or a concatenation Plan's overall title. */
export function paintedLayers(
  doc: ResolvedRenderPlan | ConcatPlan,
): PainterNode[] {
  return "overallTitle" in doc ? doc.overallTitle.layers : doc.layers;
}

export function imageAssets(
  nodes: PainterNode[],
  out = new Set<string>(),
): Set<string> {
  for (const node of nodes) {
    if (node.type === "image") out.add(node.asset);
    if (node.type === "group") imageAssets(node.children, out);
  }
  return out;
}

export function fontUrl(font: PlanFont): string {
  return `/fonts/${font.sha256.slice("sha256:".length)}`;
}

// ------------------------------------------------------------------------------------------------
// Browser bootstrap. Loads the Plan named by ?plan=, its pinned fonts, and its images, then exposes
// window.__painter for the capture driver and the preview page.

export interface PainterHandle {
  digest: string;
  runtimeMs: number;
  fps: number;
  draw(t: number, opts?: DrawOptions): MeasuredText[];
  fonts(): string[];
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const planPath = params.get("plan");
  if (!planPath) throw new Error("painter: missing ?plan=");
  const response = await fetch(`/plan?path=${encodeURIComponent(planPath)}`);
  if (!response.ok)
    throw new Error(`painter: cannot load ${planPath}: ${response.status}`);
  const digest = response.headers.get("x-plan-digest") ?? "";
  const doc = (await response.json()) as ResolvedRenderPlan | ConcatPlan;
  const nodes = paintedLayers(doc);

  for (const font of doc.fonts) {
    const bytes = await (await fetch(fontUrl(font))).arrayBuffer();
    const face = new FontFace(font.alias, bytes, {
      weight: String(font.weight),
      style: font.style,
    });
    await face.load();
    document.fonts.add(face);
  }
  const images = new Map<string, HTMLImageElement>();
  for (const asset of imageAssets(nodes)) {
    const img = new Image();
    img.src = `/media/${asset}`;
    await img.decode();
    images.set(asset, img);
  }
  await document.fonts.ready;

  const canvas = document.getElementById("frame") as HTMLCanvasElement;
  canvas.width = doc.profile.widthPx;
  canvas.height = doc.profile.heightPx;
  const layers: { ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement }[] =
    [];
  const surface: Surface = {
    ctx: canvas.getContext("2d")!,
    width: canvas.width,
    height: canvas.height,
    image: (asset) => images.get(asset),
    layer(depth) {
      let layer = layers[depth];
      if (!layer) {
        const c = document.createElement("canvas");
        c.width = canvas.width;
        c.height = canvas.height;
        layer = { ctx: c.getContext("2d")!, canvas: c };
        layers[depth] = layer;
      }
      layer.ctx.setTransform(1, 0, 0, 1, 0, 0);
      layer.ctx.clearRect(0, 0, canvas.width, canvas.height);
      return layer;
    },
  };
  const runtimeMs =
    "overallTitle" in doc
      ? doc.overallTitle.titleMs
      : doc.timing.proposal.runtimeMs;
  const handle: PainterHandle = {
    digest,
    runtimeMs,
    fps: doc.profile.fps,
    draw: (t, opts) => drawFrame(surface, nodes, t, opts),
    fonts: () =>
      [...document.fonts].map((f) => f.family.replace(/^"|"$/g, "")).sort(),
  };
  (window as unknown as { __painter: PainterHandle }).__painter = handle;
  handle.draw(0);
  document.documentElement.dataset.ready = "1";
}

if (
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  document.getElementById("frame")
) {
  boot().catch((error: unknown) => {
    document.documentElement.dataset.error = String(
      error instanceof Error ? error.message : error,
    );
  });
}
