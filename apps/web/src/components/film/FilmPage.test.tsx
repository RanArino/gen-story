// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilmDetailDto, FilmTreatment } from "@gen-story/shared";
import messages from "../../i18n/messages/en.json";
import { FilmPage } from "./FilmPage";
import {
  getFilm,
  saveFilm,
  renderFilm,
  requestFilmDirection,
  updateFilmDirection,
  approveFilmDirection,
} from "../../lib/api-client";

vi.mock("../AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../lib/api-client", () => ({
  getFilm: vi.fn(),
  saveFilm: vi.fn(),
  renderFilm: vi.fn(),
  adoptOriginalImage: vi.fn(),
  adoptGeneratedImage: vi.fn(),
  filmArtifactUrl: () => "/film.mp4",
  getAiRuntimeInfo: vi.fn(async () => ({ runtime: "claude" })),
  requestFilmDirection: vi.fn(),
  updateFilmDirection: vi.fn(),
  approveFilmDirection: vi.fn(),
}));
let detail: FilmDetailDto;
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  detail = {
    treatment: {
      projectId: "project",
      revision: 0,
      title: "Trip",
      recipe: "quiet-cinema",
      reducedMotion: false,
      chapters: [],
    },
    scenes: ["Station", "Train", "Park"].map((title, i) => ({
      id: `s${i}`,
      title,
      selectedImageId: null,
      original: { storageKey: `${title}.png` },
      images: [],
    })),
    currentAssemblyFingerprint: null,
    jobs: [],
    preflight: [],
    directions: [],
    directionInputDigests: {},
  };
  vi.mocked(getFilm).mockImplementation(async () => structuredClone(detail));
  vi.mocked(saveFilm).mockImplementation(async (treatment: FilmTreatment) => {
    detail = {
      ...detail,
      treatment: {
        ...structuredClone(treatment),
        revision: treatment.revision + 1,
      },
    };
    return structuredClone(detail);
  });
});
afterEach(cleanup);
function mount() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FilmPage projectId="project" />
    </NextIntlClientProvider>,
  );
}
async function create(title: string, photos: string[]) {
  for (const photo of photos)
    fireEvent.click(
      screen.getByRole("button", { name: `Select photo: ${photo}` }),
    );
  fireEvent.click(
    screen.getByRole("button", { name: "New Chapter from selection" }),
  );
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getAllByRole("img").length).toBe(photos.length);
  fireEvent.change(within(dialog).getByLabelText("Chapter title"), {
    target: { value: title },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Create Chapter" }),
  );
}
describe("visual Film organization", () => {
  it("creates Chapters from multiple selected photos, saves and reloads the organization", async () => {
    const view = mount();
    await screen.findByRole("button", { name: "Select photo: Station" });
    expect(screen.getByText("Start with your photos")).toBeTruthy();
    await create("Departure", ["Station", "Train"]);
    const chapter = screen.getByRole("article");
    expect(
      within(chapter)
        .getAllByRole("img")
        .map((img) => img.getAttribute("alt")),
    ).toEqual(["Station", "Train"]);
    fireEvent.click(
      screen.getByRole("button", { name: "Save and check timing" }),
    );
    await screen.findByText("Changes saved");
    expect(detail.treatment.chapters[0]?.scenes.map((s) => s.sceneId)).toEqual([
      "s0",
      "s1",
    ]);
    view.unmount();
    mount();
    await screen.findByRole("button", { name: "Edit Chapter: Departure" });
    expect(within(screen.getByRole("article")).getAllByRole("img").length).toBe(
      2,
    );
    expect(
      screen.getByRole("button", { name: "Select photo: Park" }),
    ).toBeTruthy();
  });
  it("moves selected photos with their exact durations and allows returning them to unassigned", async () => {
    detail.treatment.sceneCaptions = {
      s0: { ja: "Saved words", en: "Second line" },
    };
    detail.treatment.chapters = [
      {
        id: "c1",
        title: "Departure",
        limitMs: null,
        scenes: [{ sceneId: "s0", durationMs: 4200 }, { sceneId: "s1" }],
      },
      { id: "c2", title: "Walk", limitMs: null, scenes: [{ sceneId: "s2" }] },
    ];
    mount();
    await screen.findByRole("button", { name: "Edit Chapter: Departure" });
    fireEvent.click(
      screen.getByRole("button", { name: "Edit Chapter: Departure" }),
    );
    fireEvent.click(screen.getByLabelText("Select all"));
    fireEvent.click(screen.getByRole("button", { name: "Move to Chapter" }));
    const destination = within(screen.getByRole("dialog")).getByRole("button", {
      name: /Walk/,
    });
    expect(within(destination).getByRole("img").getAttribute("alt")).toBe(
      "Park",
    );
    fireEvent.click(destination);
    fireEvent.click(
      screen.getByRole("button", { name: "Save and check timing" }),
    );
    await screen.findByText("Changes saved");
    expect(detail.treatment.sceneCaptions?.s0).toEqual({
      ja: "Saved words",
      en: "Second line",
    });
    expect(detail.treatment.chapters[0]?.scenes).toEqual([]);
    expect(detail.treatment.chapters[1]?.scenes).toEqual([
      { sceneId: "s2" },
      { sceneId: "s0", durationMs: 4200 },
      { sceneId: "s1" },
    ]);
    fireEvent.click(
      screen.getByRole("button", { name: "Select photo: Station" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Select photo: Train" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Return to unassigned" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save and check timing" }),
    );
    await screen.findByText("Changes saved");
    expect(detail.treatment.sceneCaptions?.s0).toEqual({
      ja: "Saved words",
      en: "Second line",
    });
    expect(detail.treatment.chapters[1]?.scenes).toEqual([{ sceneId: "s2" }]);
    fireEvent.click(screen.getByRole("button", { name: /Unassigned/ }));
    expect(
      screen.getByRole("button", { name: "Select photo: Station" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Select photo: Train" }),
    ).toBeTruthy();
  });
});

it("edits captions beside their photos, saves, reloads, hides and resets them", async () => {
  const view = mount();
  await screen.findByRole("button", { name: "Select photo: Station" });
  await create("Departure", ["Station"]);
  const primary = screen.getByRole("textbox", {
    name: "Japanese subtitle for Station",
  });
  expect((primary as HTMLTextAreaElement).value).toBe("Station");
  fireEvent.change(primary, { target: { value: "Our departure" } });
  fireEvent.change(
    screen.getByRole("textbox", { name: "English subtitle for Station" }),
    { target: { value: "A new day" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save and check timing" }),
  );
  await screen.findByText("Changes saved");
  expect(detail.treatment.sceneCaptions?.s0).toEqual({
    ja: "Our departure",
    en: "A new day",
  });
  expect(detail.scenes[0]!.title).toBe("Station");
  view.unmount();
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Edit Chapter: Departure" }),
  );
  expect(
    (
      screen.getByRole("textbox", {
        name: "Japanese subtitle for Station",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("Our departure");
  fireEvent.change(
    screen.getByRole("textbox", { name: "Japanese subtitle for Station" }),
    { target: { value: "" } },
  );
  fireEvent.change(
    screen.getByRole("textbox", { name: "English subtitle for Station" }),
    { target: { value: "" } },
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save and check timing" }),
  );
  await screen.findByText("Changes saved");
  expect(detail.treatment.sceneCaptions?.s0).toEqual({ ja: "", en: "" });
  fireEvent.click(
    screen.getByRole("button", { name: "Use scene title for Station" }),
  );
  expect(
    (
      screen.getByRole("textbox", {
        name: "Japanese subtitle for Station",
      }) as HTMLTextAreaElement
    ).value,
  ).toBe("Station");
});

it("renders a saved complete film without requiring individual Chapter renders", async () => {
  detail.treatment.revision = 1;
  detail.treatment.chapters = [
    {
      id: "c1",
      title: "Departure",
      limitMs: null,
      scenes: [{ sceneId: "s0" }],
    },
  ];
  detail.preflight = [
    {
      chapterId: "c1",
      runtimeMs: 8000,
      fingerprint: "current",
      durations: [{ sceneId: "s0", durationMs: 6000 }],
      error: null,
    },
  ];
  mount();
  const button = await screen.findByRole("button", {
    name: "Render complete film",
  });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(button);
  expect(renderFilm).toHaveBeenCalledWith("project", null, 1, "both");
});

it.each(["invalid", "active"])(
  "keeps complete-film rendering blocked while %s",
  async (state) => {
    detail.treatment.revision = 1;
    detail.treatment.chapters = [
      {
        id: "c1",
        title: "Departure",
        limitMs: null,
        scenes: [{ sceneId: "s0" }],
      },
    ];
    detail.preflight = [
      {
        chapterId: "c1",
        runtimeMs: 8000,
        fingerprint: "current",
        durations: [],
        error: state === "invalid" ? "Choose an image" : null,
      },
    ];
    if (state === "active")
      detail.jobs = [
        {
          id: "job",
          projectId: "project",
          revision: 1,
          chapterId: null,
          fingerprint: "current",
          status: "running",
          error: null,
          artifactKey: null,
          artifactDigest: null,
          runtimeMs: null,
          createdAt: "2026-11-01T00:00:00Z",
        },
      ];
    mount();
    const button = await screen.findByRole("button", {
      name: "Render complete film",
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  },
);

describe("AI direction, size and subtitles", () => {
  const content = () => ({
    chapterName: "Stone steps",
    nameReason: "Stairs lead to a shrine.",
    music: {
      mood: "Quiet",
      tempoBpm: 72,
      key: "D" as const,
      mode: "minor" as const,
      instruments: ["pad" as const],
      melody: "sparse" as const,
      arc: "rise" as const,
      fromPrevious: "continue" as const,
    },
    scenes: [
      {
        sceneId: "s0",
        observation: "A person climbs stone stairs.",
        camera: {
          move: "climb" as const,
          focus: { x: 0.5, y: 0.3 },
          speed: 0.6,
          reason: "Follow the ascent.",
        },
        effects: { rays: 0.3, motes: 0.2, leaves: 0, warmth: 0.2 },
        footsteps: "stair" as const,
        ambience: { wind: 0.3, stream: 0 },
        sounds: [{ sound: "bird-chirp" as const, at: 0.4, gain: 0.5 }],
        captions: { ja: "一段ずつ", en: "Step by step" },
      },
    ],
  });
  function withChapter(
    direction?: Partial<FilmDetailDto["directions"][number]>,
  ) {
    detail.treatment.revision = 1;
    detail.treatment.chapters = [
      {
        id: "c1",
        title: "Chapter 1",
        limitMs: null,
        scenes: [{ sceneId: "s0" }],
      },
    ];
    detail.directionInputDigests = { c1: "sha256:now" };
    detail.preflight = [
      {
        chapterId: "c1",
        runtimeMs: 8000,
        fingerprint: "",
        durations: [],
        error: "Approve the AI direction for this Chapter before rendering.",
      },
    ];
    if (direction)
      detail.directions = [
        {
          id: "d1",
          projectId: "project",
          chapterId: "c1",
          requestId: "r1",
          scope: "chapter",
          status: "proposed",
          inputDigest: "sha256:now",
          model: "claude-cli",
          error: null,
          content: content(),
          createdAt: "t",
          updatedAt: "t",
          ...direction,
        },
      ];
  }

  it("confirms the runtime and time before asking the AI for a new direction", async () => {
    withChapter();
    mount();
    expect(
      await screen.findByText(
        "Approve the AI direction to export this Chapter.",
      ),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Ask the AI to direct the whole film",
      }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Ask the AI for direction?",
    });
    expect(within(dialog).getByText("Claude (subscription)")).toBeTruthy();
    expect(within(dialog).getByText("1 photo")).toBeTruthy();
    expect(requestFilmDirection).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    await vi.waitFor(() =>
      expect(requestFilmDirection).toHaveBeenCalledWith("project", {
        scope: "film",
        chapterId: undefined,
        sceneId: undefined,
        regenerate: false,
      }),
    );
  });

  it("reuses a current direction without a confirmation or Agent call", async () => {
    withChapter({});
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Direct only this Chapter" }),
    );
    expect(
      screen.queryByRole("dialog", { name: "Ask the AI for direction?" }),
    ).toBeNull();
    await vi.waitFor(() =>
      expect(requestFilmDirection).toHaveBeenCalledWith(
        "project",
        expect.objectContaining({ scope: "chapter", chapterId: "c1" }),
      ),
    );
  });

  it("edits a proposal and approves the edited version", async () => {
    withChapter({});
    vi.mocked(approveFilmDirection).mockImplementation(async () => {
      const next = structuredClone(detail);
      next.treatment.revision = 2;
      next.directions[0]!.status = "approved";
      return next;
    });
    mount();
    const review = await screen.findByRole("article", {
      name: "Direction for Chapter 1",
    });
    expect(within(review).getByText("Proposed")).toBeTruthy();
    expect(
      within(review).getByText(/A person climbs stone stairs/),
    ).toBeTruthy();
    fireEvent.change(within(review).getByLabelText("Camera"), {
      target: { value: "pan-left" },
    });
    fireEvent.change(within(review).getByLabelText("English subtitle"), {
      target: { value: "One step at a time" },
    });
    fireEvent.click(
      within(review).getByRole("button", { name: "Remove Birdsong" }),
    );
    fireEvent.click(within(review).getByRole("button", { name: "Approve" }));
    await vi.waitFor(() => expect(approveFilmDirection).toHaveBeenCalled());
    const edited = vi.mocked(updateFilmDirection).mock.calls[0]![2];
    expect(edited.scenes[0]!.camera.move).toBe("pan-left");
    expect(edited.scenes[0]!.captions.en).toBe("One step at a time");
    expect(edited.scenes[0]!.sounds).toEqual([]);
    expect(vi.mocked(approveFilmDirection).mock.calls[0]).toEqual([
      "project",
      "d1",
      1,
    ]);
  });

  it("asks again when the photos or size changed after a direction was made", async () => {
    withChapter({ inputDigest: "sha256:old", status: "approved" });
    mount();
    const review = await screen.findByRole("article", {
      name: "Direction for Chapter 1",
    });
    expect(within(review).getByText("Photos changed")).toBeTruthy();
    expect(
      within(review).queryByRole("button", { name: "Approve" }),
    ).toBeNull();
    fireEvent.click(
      within(review).getAllByRole("button", { name: "Regenerate Chapter" })[0]!,
    );
    expect(
      await screen.findByRole("dialog", { name: "Ask the AI for direction?" }),
    ).toBeTruthy();
  });

  it("saves the video size and shows only the subtitle lines that will be exported", async () => {
    withChapter({ status: "approved" });
    detail.treatment.sceneCaptions = {
      s0: { ja: "一段ずつ", en: "Step by step" },
    };
    detail.preflight[0]!.error = null;
    mount();
    fireEvent.click(
      await screen.findByRole("radio", { name: /9:16 vertical/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save and check timing" }),
    );
    await vi.waitFor(() =>
      expect(vi.mocked(saveFilm).mock.calls[0]![0].outputAspect).toBe("9:16"),
    );
    expect(
      screen.getByRole("textbox", {
        name: "Exported English subtitle for Station",
      }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Japanese only" }));
    await vi.waitFor(() =>
      expect(vi.mocked(getFilm)).toHaveBeenLastCalledWith("project", "ja"),
    );
    expect(
      screen.queryByRole("textbox", {
        name: "Exported English subtitle for Station",
      }),
    ).toBeNull();
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Exported Japanese subtitle for Station",
      }),
      { target: { value: "一歩ずつ" } },
    );
    expect(
      screen.getByRole("button", { name: "Save and check timing" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "None" }));
    expect(
      await screen.findByText("The video will be exported without subtitles."),
    ).toBeTruthy();
  });
});
