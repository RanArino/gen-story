import { describe, expect, it } from "vitest";
import { loadFilmTemplateCatalog } from "../template-catalog.js";
import { digestOf } from "../contracts/canonical.js";
import type { ResolvedRenderPlan } from "../contracts/types.js";
import type { RuntimeChapter, RuntimeInput } from "../index.js";
import {
  cameraForMove,
  directApprovedChapter,
  scoreForDirection,
  type ApprovedChapterDirection,
  type ApprovedSceneDirection,
} from "./agent-direction.js";
import {
  camAt,
  frameForImage,
  paperCardBox,
  paperNoteFrame,
  photoBox,
} from "./math.js";
import { validateDirection } from "./validate.js";
import { previewFrame, previewLayout } from "./camera-preview.js";

const scene = (
  sceneId: string,
  over: Partial<ApprovedSceneDirection> = {},
): ApprovedSceneDirection => ({
  sceneId,
  camera: { move: "push-in", focus: { x: 0.4, y: 0.4 }, speed: 0.5 },
  effects: { rays: 0.3, motes: 0.2, leaves: 0, warmth: 0.2 },
  footsteps: "none",
  ambience: { wind: 0.3, stream: 0 },
  sounds: [],
  ...over,
});
const approved = (
  over: Partial<ApprovedChapterDirection["music"]> = {},
): ApprovedChapterDirection => ({
  music: {
    tempoBpm: 72,
    key: "D",
    mode: "minor",
    instruments: ["pad", "koto-pluck", "low-swell"],
    melody: "medium",
    arc: "rise",
    fromPrevious: "continue",
    ...over,
  },
  scenes: [
    scene("stairs", {
      camera: { move: "climb", focus: { x: 0.5, y: 0.25 }, speed: 0.7 },
      footsteps: "stair",
      sounds: [{ sound: "bird-chirp", at: 0.4, gain: 0.6 }],
    }),
    scene("sea", {
      camera: { move: "pan-right", focus: { x: 0.5, y: 0.5 }, speed: 0.3 },
      ambience: { wind: 0.1, stream: 0.8 },
      sounds: [{ sound: "temple-bell", at: 0.8, gain: 0.5 }],
    }),
  ],
});
const windows = [
  { id: "stairs", t0: 1.5, t1: 7 },
  { id: "sea", t0: 6.4, t1: 12 },
];
const timingPlan = {
  timing: { proposal: { runtimeMs: 13000, overlapMs: 600 } },
  segments: [
    { kind: "title", startMs: 0, endMs: 1500 },
    { kind: "scene", sceneId: "stairs", startMs: 1500, endMs: 7000 },
    { kind: "scene", sceneId: "sea", startMs: 6400, endMs: 12000 },
    { kind: "title", startMs: 12000, endMs: 13000 },
  ],
  lock: { environment: "e", painter: { abi: "p" }, fonts: [] },
} as unknown as ResolvedRenderPlan;
const input = {
  projectId: "project",
  revision: 2,
  title: "Film",
  worldview: "",
  recipe: "quiet-cinema",
  reducedMotion: false,
  outputProfile: "portrait-1080p30@1",
  chapters: [],
  scenes: [
    {
      id: "stairs",
      asset: "images/a.png",
      caption: "一段ずつ",
      subtitle: "Step by step",
      source: "a",
    },
    {
      id: "sea",
      asset: "images/b.png",
      caption: "",
      subtitle: "",
      source: "b",
    },
  ],
  media: [
    {
      path: "images/a.png",
      kind: "image",
      sha256: digestOf("a"),
      widthPx: 800,
      heightPx: 1200,
    },
    {
      path: "images/b.png",
      kind: "image",
      sha256: digestOf("b"),
      widthPx: 1600,
      heightPx: 900,
    },
  ],
} as unknown as RuntimeInput;
const chapter: RuntimeChapter = {
  id: "chapter",
  title: "石段の先の社",
  limitMs: null,
  scenes: [{ sceneId: "stairs" }, { sceneId: "sea" }],
};

describe("approved Agent direction", () => {
  it("turns each named move into distinct camera paths", () => {
    const moves = [
      "hold",
      "push-in",
      "pull-out",
      "pan-left",
      "pan-right",
      "tilt-up",
      "tilt-down",
      "climb",
      "walk-in",
      "reveal",
    ] as const;
    const paths = new Set(
      moves.map((move) =>
        JSON.stringify(
          cameraForMove({ move, focus: { x: 0.4, y: 0.4 }, speed: 0.5 }, false)
            .keys,
        ),
      ),
    );
    // walk-in shares push-in's path and differs only by walking bob.
    expect(paths.size).toBe(moves.length - 1);
  });
  it("climbs upward toward the focus with walking bob only when footsteps exist", () => {
    const camera = {
      move: "climb" as const,
      focus: { x: 0.5, y: 0.25 },
      speed: 0.7,
    };
    const { keys, bob } = cameraForMove(camera, true);
    expect(keys[0]!.fy).toBeGreaterThan(keys.at(-1)!.fy);
    expect(keys.at(-1)!.z).toBeGreaterThan(keys[0]!.z);
    expect(bob).toBeGreaterThan(0);
    expect(cameraForMove(camera, false).bob).toBe(0);
  });
  it("shows the whole photo at rest and moves the frame toward the focus when zoomed", () => {
    const rest = frameForImage(
      1920,
      1080,
      { fx: 0.2, fy: 0.2, z: 1 },
      1600,
      900,
      "follow",
    );
    expect(rest.left).toBeGreaterThanOrEqual(0);
    expect(rest.left + rest.width).toBeLessThanOrEqual(1920);
    const left = frameForImage(
      1920,
      1080,
      { fx: 0.2, fy: 0.5, z: 1.8 },
      1600,
      900,
      "follow",
    );
    const right = frameForImage(
      1920,
      1080,
      { fx: 0.8, fy: 0.5, z: 1.8 },
      1600,
      900,
      "follow",
    );
    expect(left.left).toBeGreaterThan(right.left);
    for (const f of [left, right]) {
      expect(f.left).toBeLessThanOrEqual(0);
      expect(f.left + f.width).toBeGreaterThanOrEqual(1920);
    }
  });
  it("derives different harmony and tempo from different music specs", () => {
    const a = scoreForDirection(approved(), windows, 13, 7, 1).score;
    const b = scoreForDirection(
      approved({ key: "G", mode: "major", tempoBpm: 120, melody: "flowing" }),
      windows,
      13,
      7,
      1,
    ).score;
    const pads = (s: typeof a) =>
      s.events.filter((e) => e.sound === "pad").map((e) => e.params.notes);
    const plucks = (s: typeof a) =>
      s.events.filter((e) => e.sound === "koto-pluck").length;
    expect(pads(a)).not.toEqual(pads(b));
    expect(plucks(b)).toBeGreaterThan(plucks(a));
  });
  it("places footsteps and scene sounds inside their own photo windows", () => {
    const { score, steps } = scoreForDirection(approved(), windows, 13, 7, 1);
    const footsteps = score.events.filter((e) => e.sound === "footstep");
    expect(footsteps.length).toBeGreaterThan(3);
    expect(footsteps.every((e) => e.t >= 1.5 && e.t <= 7)).toBe(true);
    expect(steps.map((s) => s.t)).toEqual(footsteps.map((e) => e.t));
    const bird = score.events.find((e) => e.sound === "bird-chirp")!;
    expect(bird.t).toBeCloseTo(1.5 + 0.4 * 5.5);
    const bell = score.events.find((e) => e.sound === "temple-bell")!;
    expect(bell.t).toBeCloseTo(6.4 + 0.8 * 5.6);
    expect(score.beds.map((b) => b.name)).toEqual(["wind", "stream"]);
    expect(score.mix.buses.foley).toBe(1);
    expect(score.events.map((e) => e.i)).toEqual(score.events.map((_, i) => i));
  });
  it("compiles travel cues to their own sound IDs and timings across Film templates", () => {
    const atmospheres = [
      "ocean-wave",
      "light-rain",
      "cicadas",
      "leaf-rustle",
    ] as const;
    const details = [
      "train-pass",
      "cafe-cup",
      "camera-shutter",
      "wind-chime",
    ] as const;
    const proposal = approved();
    proposal.scenes[0]!.sounds = atmospheres.map((sound) => ({
      sound,
      at: 0.1,
      gain: 0.3,
    }));
    proposal.scenes[1]!.sounds = details.map((sound) => ({
      sound,
      at: 0.25,
      gain: 0.4,
    }));
    for (const template of loadFilmTemplateCatalog().list()) {
      const { direction } = directApprovedChapter(
        input,
        chapter,
        timingPlan,
        proposal,
        template,
      );
      validateDirection(direction);
      for (const [i, scene] of proposal.scenes.entries()) {
        const { t0, t1 } = direction.scenes[i]!;
        for (const { sound, at, gain } of scene.sounds) {
          const event = direction.score.events.find(
            (entry) => entry.sound === sound,
          );
          expect(event?.params).toEqual({ gain });
          expect(event?.t).toBeCloseTo(t0 + at * (t1 - t0), 3);
        }
      }
    }
  });
  it("applies distinct catalog forms and bounds to the same approved direction", () => {
    const catalog = loadFilmTemplateCatalog();
    const proposal = approved({
      instruments: ["low-swell"],
      tempoBpm: 130,
      fromPrevious: "lift",
    });
    const quiet = directApprovedChapter(
      input,
      chapter,
      timingPlan,
      proposal,
      catalog.get("quiet-cinema")!,
    );
    const memory = directApprovedChapter(
      input,
      chapter,
      timingPlan,
      proposal,
      catalog.get("memory-board")!,
    );
    expect(quiet.direction).toMatchObject({
      layout: "full-frame",
      transition: "dissolve",
      captionStyle: { font: "serif", position: "lower" },
      credits: { name: chapter.title },
    });
    expect(memory.direction).toMatchObject({
      layout: "paper-cards",
      transition: "card-slide",
      captionStyle: { font: "sans", position: "note" },
      credits: null,
    });
    expect(quiet.direction.params.warm).not.toEqual(
      memory.direction.params.warm,
    );
    expect(quiet.direction.options.grain).not.toBe(
      memory.direction.options.grain,
    );
    expect(
      quiet.direction.score.events.some(({ sound }) => sound === "pad"),
    ).toBe(true);
    expect(
      memory.direction.score.events.some(({ sound }) => sound === "pad"),
    ).toBe(false);
    expect(
      quiet.direction.score.events.some(({ sound }) => sound === "low-swell"),
    ).toBe(false);
    expect(
      memory.direction.score.events.some(({ sound }) => sound === "low-swell"),
    ).toBe(false);
    const { keys } = cameraForMove(
      { ...proposal.scenes[0]!.camera, move: "hold", speed: 0.55 },
      false,
    );
    expect(quiet.direction.scenes[0]!.camera).toEqual(keys);
    expect(quiet.direction.scenes[0]!.bob).toBe(0);
    expect(quiet.fingerprint).not.toBe(memory.fingerprint);
  });
  it("materializes a valid portrait direction with follow framing and the reviewed copy", () => {
    const { direction, fingerprint } = directApprovedChapter(
      input,
      chapter,
      timingPlan,
      approved(),
    );
    expect(() => validateDirection(direction)).not.toThrow();
    expect(direction.profile).toBe("portrait-1080p30@1");
    expect(direction.scenes.map((s) => s.framing)).toEqual([
      "follow",
      "follow",
    ]);
    expect(direction.scenes[0]!.bob).toBeGreaterThan(0);
    expect(direction.titleCard?.display).toBe("石段の先の社");
    expect(direction.captions).toHaveLength(1);
    expect(direction.captions[0]).toMatchObject({
      text: "一段ずつ",
      sub: "Step by step",
    });
    const mid = camAt(direction.scenes[0]!, 4);
    expect(mid.fy).toBeLessThan(direction.scenes[0]!.camera[0]!.fy);
    const other = directApprovedChapter(input, chapter, timingPlan, {
      ...approved(),
      scenes: [approved().scenes[0]!, scene("sea")],
    });
    expect(other.fingerprint).not.toBe(fingerprint);
  });
  it("previews the same photo placement the rendered chapter paints", () => {
    const { direction } = directApprovedChapter(
      input,
      chapter,
      timingPlan,
      approved(),
    );
    const rendered = direction.scenes[1]!;
    const view = { width: 1080, height: 1920 };
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const t = rendered.t0 + p * (rendered.t1 - rendered.t0);
      const expected = frameForImage(
        view.width,
        view.height,
        camAt(rendered, t),
        1600,
        1200,
        "follow",
      );
      const preview = previewFrame(approved().scenes[1]!.camera, p, view, {
        width: 1600,
        height: 1200,
      });
      for (const key of ["left", "top", "width", "height"] as const)
        expect(preview[key]).toBeCloseTo(expected[key], 6);
    }
    // Reduced motion holds the opening frame, like the painter.
    expect(
      previewFrame(
        approved().scenes[1]!.camera,
        0.8,
        view,
        {
          width: 1600,
          height: 1200,
        },
        true,
      ),
    ).toEqual(
      previewFrame(approved().scenes[1]!.camera, 0, view, {
        width: 1600,
        height: 1200,
      }),
    );
  });
  it("fills a photo box with the video's shape and previews what the painter draws", () => {
    const note = {
      text: "実りの色に背を押され、旅がはじまる",
      sub: "Pushed gently by the color of harvest, the journey begins.",
      measure: (text: string, size: number) => text.length * size * 0.6,
    };
    const views = {
      "16:9": { width: 1920, height: 1080 },
      "9:16": { width: 1080, height: 1920 },
      "1:1": { width: 1080, height: 1080 },
    } as const;
    for (const id of ["memory-board", "quiet-cinema"])
      for (const aspect of ["16:9", "9:16", "1:1"] as const) {
        const template = loadFilmTemplateCatalog().get(id)!;
        const proposal = approved();
        const { direction } = directApprovedChapter(
          { ...input, outputAspect: aspect },
          chapter,
          timingPlan,
          proposal,
          template,
        );
        const view = views[aspect];
        const rendered = direction.scenes[1]!;
        const frame = rendered.frame!;
        expect(frame).toEqual(template.frame![aspect]);
        const paper = direction.layout === "paper-cards";
        // A square photo no longer makes a square: the box keeps the video's shape.
        const outer = paper
          ? paperCardBox(view.width, view.height, frame.photo, 1)
          : null;
        const box = photoBox(view.width, view.height, frame.photo);
        expect(box.width / box.height).toBeCloseTo(view.width / view.height, 6);
        for (const p of [0, 0.5, 1]) {
          const at = camAt(
            rendered,
            rendered.t0 + p * (rendered.t1 - rendered.t0),
          );
          const inner = outer ?? box;
          const preview = previewLayout(
            proposal.scenes[1]!.camera,
            p,
            view,
            { width: 1200, height: 1200 },
            paper ? "paper-cards" : "full-frame",
            frame,
            1,
            false,
            note,
          );
          const fill = frameForImage(inner.width, inner.height, at, 1200, 1200);
          for (const key of ["left", "top", "width", "height"] as const)
            expect(preview.fill[key]).toBeCloseTo(fill[key], 6);
          expect(preview.box.x).toBeCloseTo(box.x, 6);
          expect(preview.box.y).toBeCloseTo(box.y, 6);
          expect(preview.rotation).toBe(outer?.rotation ?? 0);
          expect(preview.note).toEqual(
            paper
              ? paperNoteFrame(
                  view.width,
                  view.height,
                  frame.caption,
                  note,
                  outer!.outerWidth,
                )
              : null,
          );
        }
      }
  });
  it("keeps a chosen photo crop's shape at every video size", () => {
    const photo = {
      x: 0.5,
      y: 0.4,
      width: 0.6,
      height: 0.6,
      crop: "1:1" as const,
    };
    for (const [W, H] of [
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
    ] as const) {
      const box = photoBox(W, H, photo);
      expect(box.width).toBeCloseTo(box.height, 6);
      expect(box.height).toBeLessThanOrEqual(H);
      const card = paperCardBox(W, H, photo, 0);
      expect(card.outerWidth).toBeCloseTo(card.outerHeight, 6);
    }
  });
  it("uses the user's Film layout, then the photo's own, over the template's", () => {
    const template = loadFilmTemplateCatalog().get("memory-board")!;
    const caption = { x: 0.3, y: 0.1, size: 0.05 };
    const photo = { x: 0.6, y: 0.55, width: 0.5, height: 0.7 };
    const { direction } = directApprovedChapter(
      {
        ...input,
        layout: { caption },
        sceneLayouts: { [windows[1]!.id]: { photo } },
      },
      chapter,
      timingPlan,
      approved(),
      template,
    );
    expect(direction.scenes[0]!.frame).toEqual({
      photo: template.frame!["16:9"]!.photo,
      caption,
    });
    expect(direction.scenes[1]!.frame).toEqual({ photo, caption });
    expect(() => validateDirection(direction)).not.toThrow();
  });
  it("refuses a direction made for different photos", () => {
    expect(() =>
      directApprovedChapter(input, chapter, timingPlan, {
        ...approved(),
        scenes: [scene("sea"), scene("stairs")],
      }),
    ).toThrow(/no longer matches/);
  });
});
