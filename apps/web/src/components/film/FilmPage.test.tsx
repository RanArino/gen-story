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
import { getFilm, saveFilm } from "../../lib/api-client";

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
