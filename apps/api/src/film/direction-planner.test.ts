import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { FilmDirectionPlanRequest } from "@gen-story/application";
import {
  AgentFilmDirectionPlanner,
  buildFilmDirectionPrompt,
  FILM_DIRECTION_RESPONSE_JSON_SCHEMA,
} from "./direction-planner";

const request = (): FilmDirectionPlanRequest => ({
  scope: "chapter",
  filmTitle: "海辺の一日",
  story: "A quiet trip",
  outputAspect: "9:16",
  neighbors: [{ position: "previous", title: "朝", music: null }],
  chapters: [
    {
      chapterId: "c1",
      title: "思い出",
      locks: {
        chapterName: "思い出",
        captions: { s2: { ja: "私の言葉", en: "My words" } },
      },
      scenes: [
        {
          sceneId: "s1",
          storyboardTitle: "Stairs",
          imageKey: "k1",
          keep: null,
        },
        { sceneId: "s2", storyboardTitle: "Sea", imageKey: "k2", keep: null },
      ],
    },
  ],
});
const content = (sceneIds: string[]) => ({
  chapterName: "思い出",
  nameReason: "r",
  music: {
    mood: "calm",
    tempoBpm: 70,
    key: "C",
    mode: "major",
    instruments: ["pad"],
    melody: "sparse",
    arc: "steady",
    fromPrevious: "continue",
  },
  scenes: sceneIds.map((sceneId) => ({
    sceneId,
    observation: "o",
    camera: {
      move: "hold",
      focus: { x: 0.5, y: 0.5 },
      speed: 0.2,
      reason: "r",
    },
    effects: { rays: 0, motes: 0, leaves: 0, warmth: 0 },
    footsteps: "none",
    ambience: { wind: 0, stream: 0 },
    sounds: [],
    captions: { ja: "", en: "" },
  })),
});

describe("Agent film direction planner", () => {
  it("states locks, neighbors, the frame and image order in the prompt", () => {
    const prompt = buildFilmDirectionPrompt(request());
    expect(prompt).toContain('LOCKED chapterName (return exactly): "思い出"');
    expect(prompt).toContain(
      'LOCKED captions (return exactly): {"ja":"私の言葉"',
    );
    expect(prompt).toContain("vertical 9:16");
    expect(prompt).toContain('Image 2: sceneId "s2"');
    expect(prompt).toContain('previous Chapter "朝"');
    expect(FILM_DIRECTION_RESPONSE_JSON_SCHEMA.required).toEqual([
      "arc",
      "chapters",
    ]);
  });
  it("refuses the API runtime instead of silently using a paid fallback", async () => {
    const planner = new AgentFilmDirectionPlanner(
      { getObject: vi.fn() } as never,
      () => "api",
    );
    await expect(planner.plan(request())).rejects.toThrow(/Claude or Codex/);
  });
  it("sends every photo to the selected runtime and rejects invalid output so it retries", async () => {
    const png = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "#123456" },
    })
      .png()
      .toBuffer();
    const storage = { getObject: vi.fn(async () => new Uint8Array(png)) };
    const claude = vi.fn(async (input, parse) => {
      expect(input.images).toHaveLength(2);
      expect(() =>
        parse(JSON.stringify({ arc: "", chapters: [] }), "claude-test"),
      ).toThrow(/Missing Chapter c1/);
      expect(() =>
        parse(
          JSON.stringify({
            arc: "",
            chapters: [{ chapterId: "c1", content: content(["s1"]) }],
          }),
          "claude-test",
        ),
      ).toThrow(/every Chapter photo/);
      return parse(
        JSON.stringify({
          arc: "",
          chapters: [{ chapterId: "c1", content: content(["s1", "s2"]) }],
        }),
        "claude-test",
      );
    });
    const codex = vi.fn();
    const planner = new AgentFilmDirectionPlanner(
      storage as never,
      () => "claude",
      claude as never,
      codex as never,
    );
    const result = await planner.plan(request());
    expect(result.model).toBe("claude-test");
    expect(storage.getObject).toHaveBeenCalledWith("k1");
    expect(codex).not.toHaveBeenCalled();
  });
});
