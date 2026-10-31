import { expect, test } from "@playwright/test";

// Browser-isolated API fixtures never change a local project or invoke rendering.
test.use({ launchOptions: { executablePath: process.env.CHROME_PATH } });
test("organize photos in batches, edit visually, save and reload", async ({
  page,
}) => {
  let treatment = {
    projectId: "visual-organization",
    revision: 0,
    title: "A day away",
    recipe: "quiet-cinema",
    reducedMotion: false,
    chapters: [] as {
      id: string;
      title: string;
      limitMs: number | null;
      scenes: { sceneId: string; durationMs?: number }[];
    }[],
  };
  const scenes = [
    "Station",
    "Train",
    "Arrival",
    "Street",
    "Park",
    "Evening",
  ].map((title, i) => ({
    id: `scene-${i}`,
    title,
    selectedImageId: null,
    original: { storageKey: `visual-test-${i}.svg` },
    images: [],
  }));
  await page.route("http://localhost:4000/**", async (route) => {
    const request = route.request();
    if (request.url().includes("/files/")) {
      const index = Number(request.url().match(/visual-test-(\d+)/)?.[1] ?? 0);
      await route.fulfill({
        contentType: "image/svg+xml",
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="${["#b0c4b1", "#dedbd2", "#edafb8", "#8e9aaf", "#cbc0d3", "#d6c9ad"][index]}"/><text x="40" y="250" font-size="52">${scenes[index]?.title}</text></svg>`,
      });
      return;
    }
    if (request.method() === "PUT") {
      const body = request.postDataJSON();
      expect(body.expectedRevision).toBe(treatment.revision);
      treatment = { ...body, revision: treatment.revision + 1 };
    }
    await route.fulfill({
      json: {
        treatment,
        scenes,
        preflight: [],
        jobs: [],
        currentAssemblyFingerprint: null,
      },
    });
  });
  await page.goto("/projects/visual-organization/film");
  await expect(
    page.getByRole("button", { name: "Select photo: Station", exact: true }),
  ).toBeVisible();
  await expect(page.locator("article")).toHaveCount(0);
  const select = (name: string) =>
    page
      .getByRole("button", { name: `Select photo: ${name}`, exact: true })
      .click();
  const create = async (title: string) => {
    await page
      .getByRole("button", { name: "New Chapter from selection", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("img").first()).toBeVisible();
    await dialog.getByLabel("Chapter title").fill(title);
    await dialog
      .getByRole("button", { name: "Create Chapter", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
  };
  await select("Station");
  await select("Train");
  await select("Arrival");
  await create("Departure");
  await expect(page.locator("article").first().getByRole("img")).toHaveCount(3);
  await page.getByLabel("Duration (seconds)").first().fill("4.2");
  await page.getByRole("button", { name: "Move scene down" }).first().click();
  await expect(
    page.getByRole("button", { name: /^Select photo:/ }).first(),
  ).toHaveAccessibleName("Select photo: Train");
  await page.getByRole("button", { name: /^Unassigned/ }).click();
  await select("Street");
  await select("Park");
  await create("Walk");
  await page
    .getByRole("button", { name: "Edit Chapter: Departure", exact: true })
    .click();
  await select("Station");
  await select("Arrival");
  await page
    .getByRole("button", { name: "Move to Chapter", exact: true })
    .click();
  const destination = page
    .getByRole("dialog")
    .getByRole("button", { name: /Walk/ });
  await expect(destination.getByRole("img")).toHaveCount(2);
  await destination.click();
  await expect(page.locator("article").last().getByRole("img")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Save and check timing", exact: true })
    .click();
  await expect(page.getByText("Changes saved", { exact: true })).toBeVisible();
  expect(
    treatment.chapters[1]?.scenes.find((s) => s.sceneId === "scene-0")
      ?.durationMs,
  ).toBe(4200);
  await page.reload();
  await expect(page.locator("article").last().getByRole("img")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Edit Chapter: Walk", exact: true })
    .click();
  await select("Station");
  await select("Arrival");
  await page
    .getByRole("button", { name: "Return to unassigned", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save and check timing", exact: true })
    .click();
  await expect(page.getByText("Changes saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Unassigned/ }).click();
  await expect(
    page.getByRole("button", { name: /^Select photo:/ }),
  ).toHaveCount(3);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Select photo: Station", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("button", { name: "Select photo: Station", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Move to Chapter", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
