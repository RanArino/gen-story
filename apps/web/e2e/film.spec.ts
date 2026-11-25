import { expect, test } from "@playwright/test";

// Run against an isolated database whose project already has applied AI direction for every
// Chapter, so this spec makes no AI call. It renders real MP4s.
// FILM_ACCEPTANCE_PROJECT_ID=<id> FILM_ACCEPTANCE_API_URL=http://localhost:4100 \
//   pnpm --filter @gen-story/web test:e2e film.spec.ts
const projectId = process.env.FILM_ACCEPTANCE_PROJECT_ID;
test.skip(
  !projectId,
  "Provide a project with applied AI direction in an isolated acceptance database.",
);
test.use({ launchOptions: { executablePath: process.env.CHROME_PATH } });

test("edit the title, revise an applied camera without AI, export, play and download", async ({
  page,
  request,
  browser,
}) => {
  test.setTimeout(900_000);
  page.setDefaultTimeout(30_000);
  const apiUrl = process.env.FILM_ACCEPTANCE_API_URL ?? "http://localhost:4000";
  const directionRequests: string[] = [];
  await page.route("http://localhost:4000/**", async (route) => {
    const url = route.request().url().replace("http://localhost:4000", apiUrl);
    if (route.request().method() === "POST" && url.endsWith("/directions"))
      directionRequests.push(url);
    // route.fulfill cannot stream MP4 byte ranges; playback is checked without routing below.
    if (url.includes("/film/artifacts/")) return route.abort();
    const response = await route.fetch({ url });
    await route.fulfill({ response });
  });
  const base = `${apiUrl}/api/projects/${projectId}/film`;
  const initial = await (await request.get(base)).json();
  const chapters = initial.treatment.chapters.filter(
    (c: { scenes: unknown[] }) => c.scenes.length,
  );
  expect(chapters.length).toBeGreaterThanOrEqual(1);
  for (const chapter of chapters)
    expect(
      initial.directions.some(
        (d: { chapterId: string; status: string; inputDigest: string }) =>
          d.chapterId === chapter.id &&
          d.status === "approved" &&
          d.inputDigest === initial.directionInputDigests[chapter.id],
      ),
      "every Chapter needs a current applied direction",
    ).toBe(true);

  await page.goto(`/projects/${projectId}/film`);
  const title = page.getByLabel("Overall film title");
  await title.fill(`Acceptance ${Date.now()}`);
  const save = page.getByRole("button", {
    name: "Save and check timing",
    exact: true,
  });
  await expect(save).toBeInViewport();
  await expect(
    page.getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();

  // Current direction is reused: no confirmation, and the pending title is saved first.
  await page
    .getByRole("button", { name: "Create AI direction", exact: true })
    .first()
    .click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Ask the AI for direction?" }),
  ).not.toBeVisible();

  // Manual revision of an applied camera and subtitle.
  const strip = page.getByRole("navigation", { name: "Chapters and scenes" });
  await strip
    .getByRole("button", { name: /^Scene 1:/ })
    .first()
    .click();
  await expect(strip.getByText("Applied").first()).toBeVisible();
  const editor = page.getByRole("complementary", {
    name: "Selected item editor",
  });
  const move = editor.getByRole("combobox", { name: "Move", exact: true });
  const nextMove =
    (await move.inputValue()) === "pan-left" ? "pan-right" : "pan-left";
  await move.selectOption(nextMove);
  await editor
    .getByLabel(/^English subtitle for /)
    .fill("Edited in the workspace");
  await save.click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const revised = await (await request.get(base)).json();
  const sceneId = chapters[0].scenes[0].sceneId;
  expect(revised.treatment.sceneCaptions[sceneId].en).toBe(
    "Edited in the workspace",
  );
  expect(
    revised.directions
      .find(
        (d: { chapterId: string; status: string }) =>
          d.chapterId === chapters[0].id && d.status === "approved",
      )
      .content.scenes.find((s: { sceneId: string }) => s.sceneId === sceneId)
      .camera.move,
  ).toBe(nextMove);

  // Export the first Chapter in Japanese and English.
  await page.getByRole("button", { name: "Export…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Export video" });
  await dialog.getByLabel(/^Chapter 01:/).check();
  await dialog.getByLabel("Both", { exact: true }).check();
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/renders") && r.request().method() === "POST",
    ),
    dialog.getByRole("button", { name: "Export", exact: true }).click(),
  ]);
  const job = await response.json();
  for (let attempt = 0; attempt < 600; attempt++) {
    const current = await (await request.get(`${base}/jobs/${job.id}`)).json();
    if (current.status === "failed") throw new Error(current.error);
    if (current.status === "succeeded") break;
    await page.waitForTimeout(1000);
  }
  // The current-output player and its download are exactly the requested job; older
  // exports stay in the collapsed history list.
  const video = dialog.locator("video");
  await expect(video).toHaveAttribute("src", new RegExp(job.id), {
    timeout: 30_000,
  });
  await expect(video.locator("xpath=following-sibling::a")).toHaveAttribute(
    "href",
    new RegExp(`${job.id}\\?download=1$`),
  );

  const artifact = `${base}/artifacts/${job.id}`;
  const player = await browser.newPage();
  await player.setContent(`<video muted src="${artifact}"></video>`);
  const advanced = await player.locator("video").evaluate(
    (video: HTMLVideoElement) =>
      new Promise<number>((resolve, reject) => {
        const start = async () => {
          await video.play();
          setTimeout(() => resolve(video.currentTime), 800);
        };
        video.onerror = () => reject(new Error("video error"));
        if (video.readyState >= 1) void start();
        else video.onloadedmetadata = () => void start();
      }),
  );
  expect(advanced).toBeGreaterThan(0);
  await player.close();
  const file = await request.get(`${artifact}?download=1`);
  expect(file.status()).toBe(200);
  expect(file.headers()["content-disposition"]).toContain("attachment");
  expect((await file.body()).length).toBeGreaterThan(100_000);
  expect(directionRequests.length).toBe(1);
});
