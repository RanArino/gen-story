import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import quiet from "../../../packages/infrastructure/assets/templates/quiet-cinema.json" with { type: "json" };
import memory from "../../../packages/infrastructure/assets/templates/memory-board.json" with { type: "json" };
import pulse from "../../../packages/infrastructure/assets/templates/pulse-cut.json" with { type: "json" };
import manifest from "../public/film-previews/templates/manifest.json" with { type: "json" };

// Browser-isolated Film API fixture with the committed sample media: no AI call, render or
// local project write. The sample videos are served by the web app itself.
test.use({ launchOptions: { executablePath: process.env.CHROME_PATH } });

const photos = ["coastal-train", "harbor-cafe", "sunset-walk"];
const photoBytes = photos.map((p) =>
  readFileSync(
    new URL(`../public/film-previews/photos/${p}.jpg`, import.meta.url),
  ),
);
const asDto = (t: typeof quiet | typeof memory | typeof pulse) => ({
  ...t,
  layout: t.fixed?.layout ?? "full-frame",
  hasFixedStyle: !!t.fixed,
});

async function fixture(page: Page) {
  const state = {
    treatment: {
      projectId: "template-preview",
      revision: 1,
      title: "Coastal day",
      recipe: "quiet-cinema",
      reducedMotion: false,
      outputAspect: "16:9",
      chapters: [
        {
          id: "c1",
          title: "By the sea",
          limitMs: null,
          scenes: photos.map((_, i) => ({ sceneId: `scene-${i}` })),
        },
      ],
      sceneCaptions: {},
    } as Record<string, unknown>,
    saved: [] as Record<string, unknown>[],
  };
  const direction = {
    id: "applied-1",
    projectId: "template-preview",
    chapterId: "c1",
    requestId: "r1",
    scope: "chapter",
    status: "approved",
    inputDigest: "sha256:now",
    model: "fixture",
    error: null,
    content: {
      chapterName: "By the sea",
      nameReason: "Coast.",
      music: {
        mood: "Calm",
        tempoBpm: 90,
        key: "C",
        mode: "major",
        instruments: ["koto-pluck"],
        melody: "sparse",
        arc: "steady",
        fromPrevious: "continue",
      },
      scenes: photos.map((_, i) => ({
        sceneId: `scene-${i}`,
        observation: "A coastal view.",
        camera: {
          move: "push-in",
          focus: { x: 0.55, y: 0.45 },
          speed: 0.5,
          reason: "Draw closer.",
        },
        effects: { rays: 0.1, motes: 0.1, leaves: 0, warmth: 0.1 },
        footsteps: "none",
        ambience: { wind: 0.1, stream: 0 },
        sounds: [],
        captions: { ja: "海辺の朝", en: "Morning by the sea" },
      })),
    },
    createdAt: "t",
    updatedAt: "t",
  };
  const detail = () => ({
    treatment: state.treatment,
    scenes: photos.map((title, i) => ({
      id: `scene-${i}`,
      title,
      selectedImageId: null,
      original: { storageKey: `photo-${i}.jpg` },
      images: [],
    })),
    preflight: [],
    jobs: [],
    currentAssemblyFingerprint: null,
    directions: [direction],
    directionInputDigests: { c1: "sha256:now" },
    templates: [asDto(quiet), asDto(memory), asDto(pulse)],
  });
  await page.route("http://localhost:4000/**", async (route) => {
    const request = route.request();
    const url = request.url();
    if (url.includes("/files/")) {
      const index = Number(url.match(/photo-(\d+)/)?.[1] ?? 0);
      return route.fulfill({
        contentType: "image/jpeg",
        body: photoBytes[index]!,
      });
    }
    if (url.endsWith("/api/ai-runtime"))
      return route.fulfill({ json: { runtime: "claude" } });
    if (request.method() === "PUT") {
      const body = request.postDataJSON();
      state.saved.push(body);
      state.treatment = {
        ...body,
        revision: (state.treatment.revision as number) + 1,
      };
    }
    await route.fulfill({ json: detail() });
  });
  return state;
}

const shot = (name: string) =>
  `${process.env.FILM_TEMPLATE_SHOTS ?? "test-results"}/${name}.png`;

test("compares templates on sample exports and applies the chosen one", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await fixture(page);
  await page.goto("/projects/template-preview/film");
  await page.getByText("Video settings", { exact: true }).click();
  const opener = page.getByRole("button", { name: "Watch samples / change" });
  await expect(opener).toBeVisible();
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Choose a template" });
  await expect(dialog).toBeVisible();
  // Retired Pulse Cut is never offered; both offered templates show a poster.
  await expect(
    dialog.getByRole("radiogroup", { name: "Template" }).getByRole("radio"),
  ).toHaveCount(2);
  await expect(dialog.getByText("Pulse Cut")).toHaveCount(0);

  await dialog.getByText("Memory Board", { exact: true }).click();
  const expected = manifest.find(
    (m) => m.id === "memory-board" && m.aspect === "16:9",
  )!;
  const video = dialog.locator("video");
  await expect(video).toHaveAttribute("src", expected.mp4);
  await expect(video).toHaveAttribute("preload", "none");
  await page.screenshot({ path: shot("picker-desktop") });

  // The sample really plays with sound on (user-gesture playback).
  await video.evaluate(async (v: HTMLVideoElement) => {
    v.muted = false;
    await v.play();
  });
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(1);
  expect(
    await video.evaluate((v: HTMLVideoElement) => ({
      muted: v.muted,
      error: v.error,
      width: v.videoWidth,
    })),
  ).toEqual({ muted: false, error: null, width: 1280 });

  // A preview-only size switch: the project stays 16:9.
  await dialog.getByText("9:16 vertical", { exact: true }).click();
  await expect(video).toHaveAttribute(
    "src",
    manifest.find((m) => m.id === "memory-board" && m.aspect === "9:16")!.mp4,
  );

  await dialog.getByRole("button", { name: "Use this template" }).click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  const banner = page.locator("header", { hasText: "Video settings" });
  await expect(banner.getByText("Memory Board", { exact: true })).toBeVisible();
  await banner.getByRole("button", { name: "Save and check timing" }).click();
  await expect.poll(() => state.saved.length).toBe(1);
  expect(state.saved[0]).toMatchObject({
    recipe: "memory-board",
    outputAspect: "16:9",
  });

  // The workspace player now previews the export's paper card layout.
  await expect(page.locator('[class*="paperCard"]')).toBeVisible();
  await page.screenshot({ path: shot("workspace-memory-board") });

  // Escape closes the picker without changing the template.
  await opener.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test("opens the picker as a full-screen sheet on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto("/projects/template-preview/film");
  await page.getByText("Video settings", { exact: true }).click();
  await page.getByRole("button", { name: "Watch samples / change" }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a template" });
  const box = (await dialog.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(389);
  const video = (await dialog.locator("video").boundingBox())!;
  const firstCard = (await dialog
    .locator("label:has(input[type=radio])")
    .first()
    .boundingBox())!;
  // The sample sits above the cards so it stays in reach.
  expect(video.y).toBeLessThan(firstCard.y);
  expect(video.x + video.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: shot("picker-mobile") });
});
