import { expect, test, type Page } from "@playwright/test";

// Browser-isolated API fixtures: never changes a local project, calls the AI or renders.
test.use({ launchOptions: { executablePath: process.env.CHROME_PATH } });

type Chapter = {
  id: string;
  title: string;
  limitMs: number | null;
  scenes: { sceneId: string; durationMs?: number }[];
};
const scenes = ["Station", "Train", "Arrival", "Street", "Park", "Evening"].map(
  (title, i) => ({
    id: `scene-${i}`,
    title,
    selectedImageId: null,
    original: { storageKey: `visual-test-${i}.svg` },
    images: [],
  }),
);
const sceneDirection = (sceneId: string) => ({
  sceneId,
  observation: "A quiet platform by the sea.",
  camera: {
    move: "push-in",
    focus: { x: 0.5, y: 0.4 },
    speed: 0.5,
    reason: "Draw closer.",
  },
  effects: { rays: 0.2, motes: 0.1, leaves: 0, warmth: 0.1 },
  footsteps: "none",
  ambience: { wind: 0.2, stream: 0 },
  sounds: [],
  captions: { ja: "朝の駅", en: "Morning station" },
});

/** In-memory Film API for one project; directions are added by the test. */
async function fixture(page: Page) {
  const state = {
    treatment: {
      projectId: "visual-organization",
      revision: 0,
      title: "A day away",
      recipe: "quiet-cinema",
      reducedMotion: false,
      chapters: [] as Chapter[],
      sceneCaptions: {} as Record<string, { ja: string; en: string }>,
    },
    directions: [] as Record<string, unknown>[],
    approvals: 0,
    aiRequests: 0,
  };
  const detail = () => ({
    treatment: state.treatment,
    scenes,
    preflight: [],
    jobs: [],
    currentAssemblyFingerprint: null,
    directions: state.directions,
    directionInputDigests: {},
  });
  await page.route("http://localhost:4000/**", async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.includes("/files/")) {
      const index = Number(url.match(/visual-test-(\d+)/)?.[1] ?? 0);
      await route.fulfill({
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${["#b0c4b1", "#dedbd2", "#edafb8", "#8e9aaf", "#cbc0d3", "#d6c9ad"][index]}"/><text x="40" y="250" font-size="52">${scenes[index]?.title}</text></svg>`,
      });
      return;
    }
    if (url.endsWith("/api/ai-runtime"))
      return route.fulfill({ json: { runtime: "claude" } });
    if (request.method() === "POST" && url.endsWith("/directions")) {
      state.aiRequests++;
      return route.fulfill({ status: 202, json: [] });
    }
    if (request.method() === "POST" && url.endsWith("/approve")) {
      const id = url.split("/").at(-2);
      const direction = state.directions.find((d) => d.id === id)!;
      direction.status = "approved";
      const content = direction.content as {
        chapterName: string;
        scenes: ReturnType<typeof sceneDirection>[];
      };
      state.approvals++;
      state.treatment = {
        ...state.treatment,
        revision: state.treatment.revision + 1,
        chapters: state.treatment.chapters.map((c) =>
          c.id === direction.chapterId
            ? { ...c, title: content.chapterName }
            : c,
        ),
        sceneCaptions: {
          ...state.treatment.sceneCaptions,
          ...Object.fromEntries(
            content.scenes.map((s) => [s.sceneId, s.captions]),
          ),
        },
      };
      return route.fulfill({ json: detail() });
    }
    if (request.method() === "PATCH") {
      const id = url.split("/").at(-1);
      const direction = state.directions.find((d) => d.id === id)!;
      direction.content = request.postDataJSON().content;
      return route.fulfill({ json: direction });
    }
    if (request.method() === "PUT") {
      const body = request.postDataJSON();
      expect(body.expectedRevision).toBe(state.treatment.revision);
      state.treatment = { ...body, revision: state.treatment.revision + 1 };
    }
    await route.fulfill({ json: detail() });
  });
  return state;
}

test("organize photos inside the workspace, review an AI draft in place and open export", async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto("/projects/visual-organization/film");
  // A first visit opens the organizer; Save, AI and Export sit in the top bar.
  await expect(
    page.getByRole("button", { name: "Select photo: Station", exact: true }),
  ).toBeVisible();
  const select = (name: string) =>
    page
      .getByRole("button", { name: `Select photo: ${name}`, exact: true })
      .click();
  const create = async (title: string) => {
    await page
      .getByRole("button", { name: "New Chapter from selection", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "New Chapter from selection",
    });
    await dialog.getByLabel("Chapter title").fill(title);
    await dialog
      .getByRole("button", { name: "Create Chapter", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
  };
  for (const name of ["Station", "Train", "Arrival"]) await select(name);
  await create("Departure");
  // The new Chapter is filtered; reorder its first photo.
  await page.getByRole("button", { name: "Move scene down" }).first().click();
  await expect(
    page.getByRole("button", { name: /^Select photo:/ }).first(),
  ).toHaveAccessibleName("Select photo: Train");
  await page.getByRole("button", { name: /^Unassigned \d/ }).click();
  for (const name of ["Street", "Park", "Evening"]) await select(name);
  await create("Walk");
  await page
    .getByRole("button", { name: "View photos in Departure", exact: true })
    .first()
    .click();
  await select("Station");
  await page
    .getByRole("button", { name: "Move to Chapter", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Move to Chapter" })
    .getByRole("button", { name: /Walk/ })
    .click();

  // Back in the editor: the strip shows both Chapters and selection survives the organizer.
  await page
    .getByRole("button", { name: "Back to editing", exact: true })
    .click();
  const strip = page.getByRole("navigation", { name: "Chapters and scenes" });
  await strip.getByRole("button", { name: "Scene 2: Arrival" }).click();
  await page.getByLabel("Overall film title").fill("Seaside day");
  const save = page.getByRole("button", {
    name: "Save and check timing",
    exact: true,
  });
  await expect(save).toBeInViewport();
  await page
    .getByRole("button", { name: "Organize photos", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Back to editing", exact: true })
    .click();
  await expect(
    strip.getByRole("button", { name: "Scene 2: Arrival" }),
  ).toHaveAttribute("aria-current", "true");
  await save.click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(state.treatment.title).toBe("Seaside day");
  expect(
    state.treatment.chapters.map((c) => c.scenes.map((s) => s.sceneId)),
  ).toEqual([
    ["scene-1", "scene-2"],
    ["scene-3", "scene-4", "scene-5", "scene-0"],
  ]);

  // A ready draft for Departure and a failed request for Walk (fixture, no AI call).
  const [departure, walk] = state.treatment.chapters;
  state.directions = [
    {
      id: "draft-1",
      projectId: "visual-organization",
      chapterId: departure!.id,
      requestId: "r1",
      scope: "chapter",
      status: "proposed",
      inputDigest: "d",
      model: "fixture",
      error: null,
      content: {
        chapterName: "Morning departure",
        nameReason: "Trains at dawn.",
        music: {
          mood: "Calm",
          tempoBpm: 70,
          key: "C",
          mode: "major",
          instruments: ["pad"],
          melody: "sparse",
          arc: "steady",
          fromPrevious: "continue",
        },
        scenes: departure!.scenes.map((s) => sceneDirection(s.sceneId)),
      },
      createdAt: "t",
      updatedAt: "t",
    },
    {
      id: "failed-1",
      projectId: "visual-organization",
      chapterId: walk!.id,
      requestId: "r2",
      scope: "chapter",
      status: "failed",
      inputDigest: "d",
      model: null,
      error: "The AI direction failed: planner unavailable (fixture).",
      content: null,
      createdAt: "t",
      updatedAt: "t",
    },
  ];
  await page.reload();
  await strip.getByRole("button", { name: /Walk/ }).click();
  await expect(
    page.getByText("The AI direction failed: planner unavailable (fixture)."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ask again", exact: true }).click();
  const confirm = page.getByRole("dialog", {
    name: "Ask the AI for direction?",
  });
  await expect(confirm).toContainText("This chapter");
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(state.aiRequests).toBe(0);

  await strip.getByRole("button", { name: "Scene 1: Train" }).click();
  await expect(page.getByText("Previewing AI draft")).toBeVisible();
  const editor = page.getByRole("complementary", {
    name: "Selected item editor",
  });
  await editor.getByLabel("Japanese subtitle for Train").fill("いちばん電車");
  await page
    .getByRole("button", { name: "Use this draft", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Use this draft", exact: true }),
  ).toHaveCount(0);
  await expect(strip.getByText("Applied")).toBeVisible();
  expect(state.approvals).toBe(1);
  expect(state.treatment.sceneCaptions["scene-1"]?.ja).toBe("いちばん電車");

  // Export is a compact dialog with the four subtitle modes; Escape closes it.
  await page.getByRole("button", { name: "Export…", exact: true }).click();
  const exportDialog = page.getByRole("dialog", { name: "Export video" });
  for (const mode of ["Both", "Japanese only", "English only", "None"])
    await expect(exportDialog.getByLabel(mode, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(exportDialog).not.toBeVisible();

  // 390px: no horizontal overflow, the editor opens as a sheet.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(save).toBeInViewport();
  await page
    .getByRole("button", { name: "Edit this scene", exact: true })
    .click();
  await expect(
    editor.getByLabel("Japanese subtitle for Train"),
  ).toBeInViewport();
  await editor
    .getByRole("button", { name: "Close editor", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
});
