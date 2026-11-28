// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilmDetailDto, FilmTreatment } from "@gen-story/shared";
import messages from "../../i18n/messages/en.json";
import { FilmPage } from "./FilmPage";
import {
  ApiError,
  approveFilmDirection,
  getFilm,
  renderFilm,
  requestFilmDirection,
  saveFilm,
  updateFilmDirection,
} from "../../lib/api-client";

vi.mock("../AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("../../lib/api-client", () => {
  class ApiError extends Error {
    constructor(
      readonly status: number,
      readonly code: string,
      message: string,
      readonly details: Record<string, unknown> = {},
    ) {
      super(message);
    }
  }
  return {
    ApiError,
    getFilm: vi.fn(),
    saveFilm: vi.fn(),
    renderFilm: vi.fn(),
    adoptOriginalImage: vi.fn(),
    adoptGeneratedImage: vi.fn(),
    filmArtifactUrl: (_p: string, id: string, download?: boolean) =>
      `/film/${id}.mp4${download ? "?download=1" : ""}`,
    getAiRuntimeInfo: vi.fn(async () => ({ runtime: "claude" })),
    requestFilmDirection: vi.fn(),
    updateFilmDirection: vi.fn(),
    approveFilmDirection: vi.fn(),
  };
});

let detail: FilmDetailDto;
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
function withChapter(direction?: Partial<FilmDetailDto["directions"][number]>) {
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
      fingerprint: direction?.status === "approved" ? "fp" : "",
      durations: [{ sceneId: "s0", durationMs: 5000 }],
      error:
        direction?.status === "approved"
          ? null
          : "Approve the AI direction for this Chapter before rendering.",
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
    templates: [],
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
const header = () => screen.getByRole("banner");
const inspector = () =>
  screen.getByRole("complementary", { name: "Selected item editor" });

describe("organizing photos inside the workspace", () => {
  it("creates a Chapter from selected photos, saves from the header and keeps the selection", async () => {
    const view = mount();
    await screen.findByRole("button", { name: "Select photo: Station" });
    for (const photo of ["Station", "Train"])
      fireEvent.click(
        screen.getByRole("button", { name: `Select photo: ${photo}` }),
      );
    fireEvent.click(
      screen.getByRole("button", { name: "New Chapter from selection" }),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Chapter title"), {
      target: { value: "Departure" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Create Chapter" }),
    );
    // The strip now shows the chapter; select its second scene.
    fireEvent.click(screen.getByRole("button", { name: "Scene 2: Train" }));
    expect(within(header()).getByRole("status").textContent).toBe(
      "Unsaved changes",
    );
    fireEvent.click(
      within(header()).getByRole("button", { name: "Save and check timing" }),
    );
    await waitFor(() =>
      expect(within(header()).getByRole("status").textContent).toBe("Saved"),
    );
    expect(detail.treatment.chapters[0]?.scenes.map((s) => s.sceneId)).toEqual([
      "s0",
      "s1",
    ]);
    // Opening and closing the organizer preserves the selected scene.
    fireEvent.click(
      within(header()).getByRole("button", { name: "Back to editing" }),
    );
    fireEvent.click(
      within(header()).getByRole("button", { name: "Organize photos" }),
    );
    fireEvent.click(
      within(header()).getByRole("button", { name: "Back to editing" }),
    );
    expect(
      screen
        .getByRole("button", { name: "Scene 2: Train" })
        .getAttribute("aria-current"),
    ).toBe("true");
    view.unmount();
  });
});

describe("title, save and AI direction", () => {
  it("saves a title edit before asking the AI, with the request explained first", async () => {
    withChapter();
    mount();
    const title = await screen.findByLabelText("Overall film title");
    fireEvent.change(title, { target: { value: "Shrine walk" } });
    // Save and the AI action stay in the header next to the title.
    expect(
      within(header()).getByRole("button", { name: "Save and check timing" }),
    ).toBeTruthy();
    expect(
      screen.getAllByText(/Subtitles you already entered are kept/).length,
    ).toBeGreaterThan(0);
    vi.mocked(requestFilmDirection).mockResolvedValue([]);
    fireEvent.click(
      within(header()).getByRole("button", { name: "Create AI direction" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Ask the AI for direction?",
    });
    expect(within(dialog).getByText("Whole film")).toBeTruthy();
    expect(within(dialog).getByText("1 photo")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    await waitFor(() => expect(requestFilmDirection).toHaveBeenCalled());
    expect(saveFilm).toHaveBeenCalledBefore(vi.mocked(requestFilmDirection));
    expect(detail.treatment.title).toBe("Shrine walk");
  });
  it("keeps edits and offers retry when saving fails", async () => {
    withChapter();
    vi.mocked(saveFilm).mockRejectedValueOnce(new Error("offline"));
    mount();
    const title = await screen.findByLabelText("Overall film title");
    fireEvent.change(title, { target: { value: "Shrine walk" } });
    fireEvent.click(
      within(header()).getByRole("button", { name: "Save and check timing" }),
    );
    await screen.findByText("Could not save. Your edits are kept.");
    expect((title as HTMLInputElement).value).toBe("Shrine walk");
    fireEvent.click(
      within(header()).getByRole("button", { name: "Retry save" }),
    );
    await waitFor(() =>
      expect(within(header()).getByRole("status").textContent).toBe("Saved"),
    );
  });
  it("reuses a current direction without a confirmation", async () => {
    withChapter({ status: "approved" });
    vi.mocked(requestFilmDirection).mockResolvedValue([]);
    mount();
    fireEvent.click(
      await within(await screen.findByRole("banner")).findByRole("button", {
        name: "Create AI direction",
      }),
    );
    await waitFor(() => expect(requestFilmDirection).toHaveBeenCalled());
    expect(
      screen.queryByRole("dialog", { name: "Ask the AI for direction?" }),
    ).toBeNull();
  });
});

describe("reviewing and applying a draft in place", () => {
  it("edits the draft's subtitle in the scene editor and applies it", async () => {
    withChapter({});
    vi.mocked(updateFilmDirection).mockResolvedValue(
      {} as FilmDetailDto["directions"][number],
    );
    vi.mocked(approveFilmDirection).mockImplementation(async () => {
      detail.treatment.revision = 2;
      detail.directions[0]!.status = "approved";
      return structuredClone(detail);
    });
    mount();
    await screen.findByText("Previewing AI draft");
    const ja = within(inspector()).getByLabelText(
      "Japanese subtitle for Station",
    ) as HTMLTextAreaElement;
    expect(ja.value).toBe("一段ずつ");
    expect(within(inspector()).getByText("Editing AI draft")).toBeTruthy();
    fireEvent.change(ja, { target: { value: "ゆっくり" } });
    fireEvent.click(screen.getByRole("button", { name: "Use this draft" }));
    await waitFor(() => expect(approveFilmDirection).toHaveBeenCalled());
    expect(
      vi.mocked(updateFilmDirection).mock.calls[0]![2].scenes[0]!.captions.ja,
    ).toBe("ゆっくり");
    await screen.findByText(/Current version. Edit any scene directly/);
    expect(screen.queryByRole("button", { name: "Use this draft" })).toBeNull();
  });
  it("shows conflicting manual edits in the editor and applies the chosen side", async () => {
    withChapter({});
    vi.mocked(approveFilmDirection)
      .mockRejectedValueOnce(
        new ApiError(409, "direction_conflict", "conflict", {
          conflicts: [
            { field: "chapterName", mine: "My chapter", draft: "Stone steps" },
          ],
        }),
      )
      .mockImplementationOnce(async () => structuredClone(detail));
    mount();
    fireEvent.click(
      await screen.findByRole("button", { name: "Use this draft" }),
    );
    const panel = await screen.findByRole("region", {
      name: "Both versions changed these values",
    });
    fireEvent.click(within(panel).getByLabelText(/Your edit: My chapter/));
    fireEvent.click(
      within(panel).getByRole("button", { name: "Apply with these choices" }),
    );
    await waitFor(() => expect(approveFilmDirection).toHaveBeenCalledTimes(2));
    expect(vi.mocked(approveFilmDirection).mock.calls[1]![3]).toEqual({
      chapterName: "mine",
    });
  });
  it("revises an applied camera manually without another AI request", async () => {
    withChapter({ status: "approved" });
    vi.mocked(updateFilmDirection).mockResolvedValue(
      {} as FilmDetailDto["directions"][number],
    );
    mount();
    await screen.findByText("Applied", { selector: "[role=status]" });
    fireEvent.change(within(inspector()).getByLabelText("Move"), {
      target: { value: "pan-left" },
    });
    fireEvent.click(
      within(header()).getByRole("button", { name: "Save and check timing" }),
    );
    await waitFor(() => expect(updateFilmDirection).toHaveBeenCalled());
    expect(
      vi.mocked(updateFilmDirection).mock.calls[0]![2].scenes[0]!.camera.move,
    ).toBe("pan-left");
    expect(requestFilmDirection).not.toHaveBeenCalled();
  });
  it("tries camera moves on the example photo and applies the chosen one", async () => {
    withChapter({ status: "approved" });
    mount();
    fireEvent.click(
      await within(await screen.findByRole("complementary")).findByRole(
        "button",
        { name: "Try moves" },
      ),
    );
    const dialog = screen.getByRole("dialog", { name: "Try camera moves" });
    expect(
      within(dialog)
        .getAllByRole("img")
        .every((img) => img.getAttribute("src")?.includes("coastal-train")),
    ).toBe(true);
    fireEvent.click(within(dialog).getByLabelText("Reveal from detail"));
    fireEvent.click(within(dialog).getByLabelText("Start / middle / end"));
    expect(within(dialog).getAllByText("Middle").length).toBe(2);
    fireEvent.click(
      within(dialog).getByRole("button", { name: /Use Reveal from detail/ }),
    );
    expect(
      (within(inspector()).getByLabelText("Move") as HTMLSelectElement).value,
    ).toBe("reveal");
  });
});

describe("export dialog", () => {
  it("offers the four subtitle modes, routes subtitle edits to the scene and plays the exact export", async () => {
    withChapter({ status: "approved" });
    detail.treatment.sceneCaptions = { s0: { ja: "一段ずつ", en: "Step" } };
    detail.jobs = [
      {
        id: "old",
        projectId: "project",
        revision: 1,
        chapterId: null,
        fingerprint: "older",
        status: "succeeded",
        error: null,
        artifactKey: "k",
        artifactDigest: "d",
        runtimeMs: 8000,
        createdAt: "2026-11-01T00:00:00.000Z",
      },
    ];
    vi.mocked(renderFilm).mockImplementation(async () => {
      const job = {
        ...detail.jobs[0]!,
        id: "new",
        revision: 1,
        fingerprint: "now",
        createdAt: "2026-11-25T00:00:00.000Z",
      };
      detail.jobs = [job, ...detail.jobs];
      detail.currentAssemblyFingerprint = "now";
      return job;
    });
    mount();
    fireEvent.click(
      await within(await screen.findByRole("banner")).findByRole("button", {
        name: "Export…",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Export video" });
    for (const mode of ["Both", "Japanese only", "English only", "None"])
      expect(within(dialog).getByLabelText(mode)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Export" }));
    await waitFor(() =>
      expect(renderFilm).toHaveBeenCalledWith("project", null, 1, "both"),
    );
    const [link] = await within(dialog).findAllByRole("link", {
      name: "Download MP4",
    });
    // The first output is exactly the export just requested; the older one stays in history.
    expect(link!.getAttribute("href")).toBe("/film/new.mp4?download=1");
    fireEvent.click(within(dialog).getByText("Earlier exports (1)"));
    expect(within(dialog).getByText(/earlier version/)).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Edit the subtitle for Station",
      }),
    );
    expect(screen.queryByRole("dialog", { name: "Export video" })).toBeNull();
    expect(
      (
        within(inspector()).getByLabelText(
          "Japanese subtitle for Station",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("一段ずつ");
  });
  it("hides the previous mode's output until the chosen subtitle mode has loaded", async () => {
    withChapter({ status: "approved" });
    detail.jobs = [
      {
        id: "both-job",
        projectId: "project",
        revision: 1,
        chapterId: null,
        fingerprint: "both-fp",
        status: "succeeded",
        error: null,
        artifactKey: "k",
        artifactDigest: "d",
        runtimeMs: 8000,
        createdAt: "2026-11-25T00:00:00.000Z",
      },
    ];
    detail.currentAssemblyFingerprint = "both-fp";
    let finish!: () => void;
    vi.mocked(getFilm).mockImplementation(async (_id, mode) => {
      if (mode === "ja")
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      return structuredClone({
        ...detail,
        currentAssemblyFingerprint: mode === "ja" ? "ja-fp" : "both-fp",
      });
    });
    mount();
    fireEvent.click(
      await within(await screen.findByRole("banner")).findByRole("button", {
        name: "Export…",
      }),
    );
    const dialog = screen.getByRole("dialog", { name: "Export video" });
    expect(
      within(dialog).getByRole("link", { name: "Download MP4" }),
    ).toBeTruthy();
    fireEvent.click(within(dialog).getByLabelText("Japanese only"));
    expect(
      within(dialog).queryByRole("link", { name: "Download MP4" }),
    ).toBeNull();
    expect(
      (
        within(dialog).getByRole("button", {
          name: "Export",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    finish();
    await waitFor(() =>
      expect(
        (
          within(dialog).getByRole("button", {
            name: "Export",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    // The both-language MP4 is not presented as the Japanese-only output: it is history only.
    expect(dialog.querySelector("video")).toBeNull();
    expect(within(dialog).getByText(/earlier version/)).toBeTruthy();
  });
});
