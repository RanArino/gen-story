import { describe, expect, it } from "vitest";
import type { PainterNode } from "../contracts/types.js";
import { drawFrame, valueAt, wrapLines, type Surface } from "./painter.js";

/** Records every call and property write on a Canvas 2D context, standing in for the browser. */
function recordingCtx(log: string[], name: string): CanvasRenderingContext2D {
  let transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const target: Record<string, unknown> = {
    measureText: (s: string) => ({ width: [...s].length * 10 }),
    getTransform: () => ({ ...transform }),
    setTransform: (...args: unknown[]) => {
      if (typeof args[0] === "object") transform = { ...(args[0] as typeof transform) };
      else transform = { a: 1, b: 0, c: 0, d: 1, e: Number(args[4]), f: Number(args[5]) };
      log.push(`${name}.setTransform`);
    },
    translate: (x: number, y: number) => {
      transform = { ...transform, e: transform.e + x, f: transform.f + y };
      log.push(`${name}.translate(${x},${y})`);
    },
    createLinearGradient: () => ({ addColorStop: () => undefined }),
  };
  return new Proxy(target, {
    get(t, prop: string) {
      if (prop in t) return t[prop];
      return (...args: unknown[]) => log.push(`${name}.${prop}(${args.filter((a) => typeof a !== "object").join(",")})`);
    },
    set(t, prop: string, value) {
      if (typeof value !== "object") log.push(`${name}.${prop}=${value}`);
      t[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function surface(log: string[]): Surface {
  return {
    ctx: recordingCtx(log, "main"),
    width: 1920,
    height: 1080,
    layer: (depth) => ({ ctx: recordingCtx(log, `layer${depth}`), canvas: { layer: depth } as unknown as CanvasImageSource }),
    image: (asset) => ({ asset }) as unknown as CanvasImageSource,
  };
}

describe("painter", () => {
  it("evaluates keyframes with the starting key's ease and holds outside the keys", () => {
    const anim = {
      keys: [
        { t: 0, v: 0, ease: "linear" as const },
        { t: 100, v: 10, ease: "ease-in-out" as const },
        { t: 200, v: 20, ease: "step" as const },
        { t: 300, v: 30, ease: "linear" as const },
      ],
    };
    expect(valueAt(anim, -5)).toBe(0);
    expect(valueAt(anim, 50)).toBe(5);
    expect(valueAt(anim, 150)).toBe(15); // smoothstep is symmetric at the midpoint
    expect(valueAt(anim, 125)).toBeCloseTo(10 + 10 * 0.15625);
    expect(valueAt(anim, 250)).toBe(20);
    expect(valueAt(anim, 400)).toBe(30);
    expect(valueAt(7, 50)).toBe(7);
    expect(valueAt(undefined, 50, 1)).toBe(1);
  });

  it("wraps CJK per character and Latin per word", () => {
    const measure = (s: string) => [...s].length * 10;
    expect(wrapLines(measure, "参道の朝", 25)).toEqual(["参道", "の朝"]);
    expect(wrapLines(measure, "a quiet walk", 70)).toEqual(["a quiet", "walk"]);
  });

  it("culls nodes outside their window and draws only visible ones", () => {
    const log: string[] = [];
    const nodes: PainterNode[] = [
      { type: "rect", startMs: 0, endMs: 100, x: 0, y: 0, w: 10, h: 10, color: "#ff0000" },
      { type: "rect", startMs: 100, endMs: 200, x: 0, y: 0, w: 10, h: 10, color: "#00ff00" },
    ];
    drawFrame(surface(log), nodes, 100);
    expect(log).toContain("main.fillStyle=#00ff00");
    expect(log).not.toContain("main.fillStyle=#ff0000");
  });

  it("composites a translucent, filtered group through one offscreen layer", () => {
    const log: string[] = [];
    const nodes: PainterNode[] = [
      {
        type: "group",
        startMs: 0,
        endMs: 1000,
        opacity: 0.5,
        blend: "screen",
        filter: { brightness: 0.45 },
        clipRect: { x: 0, y: 0, w: 960, h: 1080 },
        translateX: 20,
        children: [{ type: "rect", startMs: 0, endMs: 1000, x: 0, y: 0, w: 10, h: 10, color: "#123456" }],
      },
    ];
    drawFrame(surface(log), nodes, 10);
    const child = log.indexOf("layer1.fillStyle=#123456");
    const composite = log.indexOf("main.drawImage(0,0)");
    expect(child).toBeGreaterThan(-1);
    expect(composite).toBeGreaterThan(child);
    expect(log).toContain("main.translate(20,0)");
    expect(log).toContain("main.clip()");
    expect(log).toContain("main.globalAlpha=0.5");
    expect(log).toContain("main.globalCompositeOperation=screen");
    expect(log).toContain("main.filter=brightness(0.45)");
  });

  it("draws a caption scrim but omits the glyphs when the role is omitted", () => {
    const caption: PainterNode = {
      type: "text", role: "caption", startMs: 0, endMs: 1000, text: "参道", font: ["fs-aaaaaaaaaaaa"], sizePx: 40, weight: 400, color: "#ffffff",
      letterSpacingPx: 0, align: "center", x: 960, y: 800, maxWidthPx: 1000, lineHeight: 1.5, scrim: { color: "#000000", opacity: 0.5, padPx: 8 },
    };
    const drawn: string[] = [];
    const measured = drawFrame(surface(drawn), [caption], 10);
    expect(measured).toEqual([{ role: "caption", text: "参道", color: "#ffffff", box: { x: 950, y: 800, w: 20, h: 60 } }]);
    expect(drawn.some((l) => l.startsWith("main.fillText(参道"))).toBe(true);
    const omitted: string[] = [];
    drawFrame(surface(omitted), [caption], 10, { omitRoles: ["caption"] });
    expect(omitted.some((l) => l.startsWith("main.fillText"))).toBe(false);
    expect(omitted).toContain("main.fillRect(942,792,36,76)");
  });
});
