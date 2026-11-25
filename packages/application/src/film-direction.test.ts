import { describe, expect, it } from "vitest";
import type {
  FilmDirectionContent,
  FilmDirectionProposal,
  FilmTreatment,
} from "@gen-story/domain";
import type { FilmRepositoryPort } from "./film";
import {
  approveFilmDirection,
  currentApprovedDirection,
  settlePlannedChapters,
  updateFilmDirection,
  type FilmDirectionPlanRequest,
  type FilmDirectionRepositoryPort,
} from "./film-direction";

const sceneDirection = (sceneId: string, ja = "海へ") => ({
  sceneId,
  observation: "A quiet harbor.",
  camera: {
    move: "push-in" as const,
    focus: { x: 0.5, y: 0.5 },
    speed: 0.4,
    reason: "Draw closer.",
  },
  effects: { rays: 0.2, motes: 0.1, leaves: 0, warmth: 0.1 },
  footsteps: "none" as const,
  ambience: { wind: 0.2, stream: 0 },
  sounds: [],
  captions: { ja, en: "To the sea" },
});
const content = (ja = "海へ"): FilmDirectionContent => ({
  chapterName: "港の朝",
  nameReason: "Harbor at dawn.",
  music: {
    mood: "穏やか",
    tempoBpm: 70,
    key: "C",
    mode: "major",
    instruments: ["pad"],
    melody: "sparse",
    arc: "steady",
    fromPrevious: "continue",
  },
  scenes: [sceneDirection("a", ja), sceneDirection("b", ja)],
});
const treatment = (): FilmTreatment => ({
  projectId: "p",
  revision: 2,
  title: "Film",
  recipe: "quiet-cinema",
  reducedMotion: false,
  chapters: [
    {
      id: "c1",
      title: "チャプター 1",
      limitMs: null,
      scenes: [{ sceneId: "a" }, { sceneId: "b" }],
    },
  ],
});
const proposal = (
  over: Partial<FilmDirectionProposal> = {},
): FilmDirectionProposal => ({
  id: "d1",
  projectId: "p",
  chapterId: "c1",
  requestId: "r1",
  scope: "chapter",
  status: "proposed",
  inputDigest: "sha256:current",
  model: "claude-cli",
  error: null,
  content: content(),
  createdAt: "t0",
  updatedAt: "t0",
  ...over,
});
function stores(initial: FilmDirectionProposal[]) {
  const proposals = new Map(initial.map((p) => [p.id, p]));
  let film = treatment();
  const directions: FilmDirectionRepositoryPort = {
    list: async () => [...proposals.values()],
    save: async (p) => {
      proposals.set(p.id, p);
    },
  };
  const films: FilmRepositoryPort = {
    get: async () => film,
    save: async (t, expected) => {
      if (film.revision !== expected) return false;
      film = t;
      return true;
    },
    jobs: async () => [],
    saveJob: async () => {},
  };
  return { proposals, directions, films, film: () => film };
}
const request = (): FilmDirectionPlanRequest => ({
  scope: "chapter",
  filmTitle: "Film",
  story: "",
  outputAspect: "16:9",
  neighbors: [],
  chapters: [
    {
      chapterId: "c1",
      title: "チャプター 1",
      locks: { chapterName: null, captions: { b: { ja: "私の", en: "Mine" } } },
      scenes: [
        { sceneId: "a", storyboardTitle: "A", imageKey: "a.png", keep: null },
        {
          sceneId: "b",
          storyboardTitle: "B",
          imageKey: "b.png",
          keep: null,
        },
      ],
    },
  ],
});

describe("settling planner output", () => {
  it("accepts valid output and re-applies user locks", () => {
    const settled = settlePlannedChapters(request(), {
      model: "m",
      chapters: [{ chapterId: "c1", content: content() }],
    }).get("c1")!;
    expect("content" in settled && settled.content.scenes[1]!.captions).toEqual(
      {
        ja: "私の",
        en: "Mine",
      },
    );
  });
  it("reports missing or invalid Chapters instead of substituting defaults", () => {
    const bad = { ...content(), scenes: [sceneDirection("a")] };
    const two = request();
    two.chapters.push({ ...two.chapters[0]!, chapterId: "c2" });
    const settled = settlePlannedChapters(two, {
      model: "m",
      chapters: [{ chapterId: "c1", content: bad }],
    });
    expect(settled.get("c1")).toMatchObject({ error: /invalid/ });
    expect(settled.get("c2")).toMatchObject({ error: /did not return/ });
  });
  it("keeps every other photo unchanged when regenerating one photo", () => {
    const keep = sceneDirection("a", "そのまま");
    const one = request();
    one.chapters[0]!.scenes[0]!.keep = keep;
    const settled = settlePlannedChapters(one, {
      model: "m",
      chapters: [{ chapterId: "c1", content: content("新しい") }],
    }).get("c1")!;
    expect("content" in settled && settled.content.scenes[0]).toEqual(keep);
  });
});

describe("reviewing and approving", () => {
  it("edits only proposed directions and validates edits", async () => {
    const s = stores([proposal()]);
    const edited = await updateFilmDirection(s.directions, {
      projectId: "p",
      id: "d1",
      content: content("編集"),
      sceneIds: ["a", "b"],
      now: "t1",
    });
    expect(edited.content!.scenes[0]!.captions.ja).toBe("編集");
    await expect(
      updateFilmDirection(s.directions, {
        projectId: "p",
        id: "d1",
        content: { ...content(), scenes: [] },
        sceneIds: ["a", "b"],
        now: "t1",
      }),
    ).rejects.toThrow();
    s.proposals.set("d1", proposal({ status: "superseded" }));
    await expect(
      updateFilmDirection(s.directions, {
        projectId: "p",
        id: "d1",
        content: content(),
        sceneIds: ["a", "b"],
        now: "t1",
      }),
    ).rejects.toThrow(/proposed/);
  });
  it("revises an applied camera without changing its reviewed text", async () => {
    const s = stores([proposal({ status: "approved" })]);
    const next = content("別の字幕");
    next.chapterName = "別の名前";
    next.scenes[0]!.camera = { ...next.scenes[0]!.camera, move: "pan-left" };
    const revised = await updateFilmDirection(s.directions, {
      projectId: "p",
      id: "d1",
      content: next,
      sceneIds: ["a", "b"],
      now: "t1",
    });
    expect(revised.status).toBe("approved");
    expect(revised.content!.scenes[0]!.camera.move).toBe("pan-left");
    expect(revised.content!.chapterName).toBe("港の朝");
    expect(revised.content!.scenes[0]!.captions.ja).toBe("海へ");
  });
  it("approves, writes name and captions, and supersedes the previous approval", async () => {
    const s = stores([
      proposal({ id: "old", status: "approved" }),
      proposal({ id: "d1" }),
    ]);
    const result = await approveFilmDirection(s.directions, s.films, {
      projectId: "p",
      id: "d1",
      currentInputDigest: "sha256:current",
      sceneIds: ["a", "b"],
      expectedRevision: 2,
      now: "t2",
    });
    expect(result.treatment.revision).toBe(3);
    expect(s.film().chapters[0]!.title).toBe("港の朝");
    expect(s.film().sceneCaptions?.a).toEqual({ ja: "海へ", en: "To the sea" });
    expect(s.proposals.get("old")!.status).toBe("superseded");
    expect(
      currentApprovedDirection(
        [...s.proposals.values()],
        "c1",
        "sha256:current",
      )?.id,
    ).toBe("d1");
    expect(
      currentApprovedDirection([...s.proposals.values()], "c1", "sha256:other"),
    ).toBeNull();
  });
  it("refuses stale proposals and outdated treatment revisions", async () => {
    const s = stores([proposal()]);
    const base = {
      projectId: "p",
      id: "d1",
      sceneIds: ["a", "b"],
      now: "t2",
    };
    await expect(
      approveFilmDirection(s.directions, s.films, {
        ...base,
        currentInputDigest: "sha256:changed",
        expectedRevision: 2,
      }),
    ).rejects.toThrow(/changed/);
    await expect(
      approveFilmDirection(s.directions, s.films, {
        ...base,
        currentInputDigest: "sha256:current",
        expectedRevision: 1,
      }),
    ).rejects.toThrow(/another editor/);
    expect(s.proposals.get("d1")!.status).toBe("proposed");
  });
});

describe("approving an older proposal after manual edits", () => {
  // The proposal was requested while the Chapter had its default title and no captions.
  const older = () =>
    proposal({
      base: { chapterName: "チャプター 1", captions: { a: null, b: null } },
    });
  const editManually = async (s: ReturnType<typeof stores>) => {
    const film = s.film();
    await s.films.save(
      {
        ...film,
        revision: 3,
        chapters: [{ ...film.chapters[0]!, title: "私の章" }],
        // A deliberately blank caption is a manual choice, not a missing value.
        sceneCaptions: { a: { ja: "", en: "" } },
      },
      2,
    );
  };
  const approve = (
    s: ReturnType<typeof stores>,
    resolutions?: Record<string, "mine" | "draft">,
  ) =>
    approveFilmDirection(s.directions, s.films, {
      projectId: "p",
      id: "d1",
      currentInputDigest: "sha256:current",
      sceneIds: ["a", "b"],
      expectedRevision: 3,
      now: "t3",
      ...(resolutions ? { resolutions } : {}),
    });

  it("refuses to overwrite newer manual values and reports each conflict", async () => {
    const s = stores([older()]);
    await editManually(s);
    await expect(approve(s)).rejects.toMatchObject({
      conflicts: [
        { field: "chapterName", mine: "私の章", draft: "港の朝" },
        {
          field: "caption:a",
          mine: { ja: "", en: "" },
          draft: { ja: "海へ", en: "To the sea" },
        },
      ],
    });
    expect(s.film().chapters[0]!.title).toBe("私の章");
    expect(s.film().sceneCaptions?.a).toEqual({ ja: "", en: "" });
    expect(s.proposals.get("d1")!.status).toBe("proposed");
  });
  it("applies explicit resolutions and untouched draft values", async () => {
    const s = stores([older()]);
    await editManually(s);
    await approve(s, { chapterName: "mine", "caption:a": "mine" });
    expect(s.film().chapters[0]!.title).toBe("私の章");
    expect(s.film().sceneCaptions?.a).toEqual({ ja: "", en: "" });
    // Scene b was not edited manually, so the reviewed draft applies.
    expect(s.film().sceneCaptions?.b).toEqual({ ja: "海へ", en: "To the sea" });
    expect(s.proposals.get("d1")!.status).toBe("approved");
  });
  it("keeps a newer manual value the draft did not change", async () => {
    const s = stores([
      proposal({
        base: { chapterName: "港の朝", captions: { a: null, b: null } },
      }),
    ]);
    await editManually(s);
    await approve(s, { "caption:a": "draft" });
    expect(s.film().chapters[0]!.title).toBe("私の章");
    expect(s.film().sceneCaptions?.a).toEqual({ ja: "海へ", en: "To the sea" });
  });
});
