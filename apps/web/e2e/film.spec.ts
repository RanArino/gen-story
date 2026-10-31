import { expect, test } from "@playwright/test";

// Run against an isolated database containing real uploaded and generated images.
// FILM_ACCEPTANCE_PROJECT_ID=<id> pnpm --filter @gen-story/web test:e2e film.spec.ts
const projectId = process.env.FILM_ACCEPTANCE_PROJECT_ID;
test.skip(
  !projectId,
  "Provide a real project in an isolated acceptance database.",
);
test.use({ launchOptions: { executablePath: process.env.CHROME_PATH } });

test("select images, edit Chapters, render, play and download a film", async ({
  page,
  request,
}) => {
  test.setTimeout(600_000);
  page.setDefaultTimeout(30_000);
  const apiUrl = process.env.FILM_ACCEPTANCE_API_URL ?? "http://localhost:4000";
  if (apiUrl !== "http://localhost:4000") {
    await page.route("http://localhost:4000/**", async (route) => {
      const response = await route.fetch({
        url: route.request().url().replace("http://localhost:4000", apiUrl),
      });
      await route.fulfill({ response });
    });
  }
  const base = `${apiUrl}/api/projects/${projectId}/film`;
  const initial = await (await request.get(base)).json();
  const sourceScenes = initial.scenes.filter(
    (s: { original: unknown; images: unknown[] }) =>
      s.original && s.images.length,
  );
  expect(sourceScenes.length).toBeGreaterThanOrEqual(2);
  const selected = sourceScenes.slice(0, 2);
  const chapters = selected.map((s: { id: string }, i: number) => ({
    id: crypto.randomUUID(),
    title: `Chapter ${i + 1}`,
    limitMs: 60000,
    scenes: [{ sceneId: s.id, durationMs: 4200 }],
  }));
  const setup = await request.put(base, {
    data: {
      ...initial.treatment,
      expectedRevision: initial.treatment.revision,
      title: "Acceptance Film",
      chapters,
    },
  });
  expect(setup.ok()).toBeTruthy();

  expect(
    (
      await request.post(
        `${apiUrl}/api/scenes/${selected[0].id}/generated-images/${selected[0].images[0].id}/adopt`,
      )
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/projects/${projectId}/review`);
  await page
    .getByRole("button", { name: "Use original", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "Use original", exact: true }).first(),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Make a film", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Film", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^All photos/ }).click();
  const showImageSource = async (title: string) => {
    await page
      .getByRole("button", { name: `Select photo: ${title}`, exact: true })
      .locator("..")
      .locator("summary")
      .click();
  };
  await showImageSource(selected[0].title);
  const picker = page.getByRole("combobox", {
    name: `Image for ${selected[0].title}`,
    exact: true,
  });
  await picker.selectOption("original");
  await expect(picker).toHaveValue("original");
  await page.reload();
  await page.getByRole("button", { name: /^All photos/ }).click();
  await showImageSource(selected[0].title);
  await expect(
    page.getByRole("combobox", {
      name: `Image for ${selected[0].title}`,
      exact: true,
    }),
  ).toHaveValue("original");

  await showImageSource(selected[1].title);
  const secondPicker = page.getByRole("combobox", {
    name: `Image for ${selected[1].title}`,
    exact: true,
  });
  await secondPicker.selectOption("original");
  await expect(secondPicker).toHaveValue("original");
  await secondPicker.selectOption(selected[1].images[0].id);
  await expect(secondPicker).toHaveValue(selected[1].images[0].id);

  const articles = page.locator("article");
  await articles
    .first()
    .getByRole("button", { name: "Edit Chapter: Chapter 1", exact: true })
    .click();
  await articles
    .first()
    .getByLabel("Limit (seconds; blank for unlimited)")
    .fill("1");
  await page.getByRole("button", { name: "Save and check timing" }).click();
  await expect(
    articles.first().getByRole("button", { name: "Render Chapter" }),
  ).toBeDisabled();
  await expect(articles.first()).toContainText("FS_PREFLIGHT_OVER_LIMIT");
  await articles
    .first()
    .getByLabel("Limit (seconds; blank for unlimited)")
    .fill("60");
  await page.getByRole("button", { name: "Save and check timing" }).click();
  await expect(page.getByLabel("Duration (seconds)")).toHaveValue("4.2");

  for (const recipe of ["quiet-cinema", "memory-board", "pulse-cut"]) {
    await page.getByLabel("Template", { exact: true }).selectOption(recipe);
    await page.getByRole("button", { name: "Save and check timing" }).click();
    await expect(
      articles.first().getByRole("button", { name: "Render Chapter" }),
    ).toBeEnabled();
    const [renderResponse] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith("/renders") && r.request().method() === "POST",
      ),
      articles.first().getByRole("button", { name: "Render Chapter" }).click(),
    ]);
    expect(renderResponse.status()).toBe(202);
    const submitted = await renderResponse.json();
    for (let attempt = 0; attempt < 180; attempt++) {
      const job = await (
        await request.get(`${base}/jobs/${submitted.id}`)
      ).json();
      if (job.status === "failed") throw new Error(job.error);
      if (job.status === "succeeded") break;
      await page.waitForTimeout(1000);
    }

    await page.reload();
    await expect(articles.first().locator("video")).toBeVisible({
      timeout: 180_000,
    });
    await expect(articles.first()).toContainText("Ready");
    const video = articles.first().locator("video");
    await video.evaluate(async (element: HTMLVideoElement) => {
      await element.play();
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      if (element.currentTime <= 0) throw new Error("Video did not advance");
      element.pause();
    });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      articles.first().getByRole("link", { name: "Download MP4" }).click(),
    ]);
    expect(await download.failure()).toBeNull();
    await download.saveAs(`/tmp/gen-story-film-${recipe}.mp4`);
    console.log(`Verified ${recipe}: playback and MP4 download`);
  }

  await articles.nth(1).getByRole("button", { name: "Render Chapter" }).click();
  await expect(articles.nth(1).locator("video")).toBeVisible({
    timeout: 180_000,
  });
  await expect(
    page.getByRole("button", { name: "Render complete film" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Render complete film" }).click();
  const joined = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Complete film", exact: true }),
  });
  await expect(joined.locator("video")).toBeVisible({ timeout: 180_000 });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    joined.getByRole("link", { name: "Download MP4" }).click(),
  ]);
  await download.saveAs("/tmp/gen-story-film-joined.mp4");
  expect(await download.failure()).toBeNull();

  const before = await (await request.get(base)).json();
  const unaffected = before.preflight[1].fingerprint;
  await articles
    .first()
    .getByRole("button", { name: "Edit Chapter: Chapter 1", exact: true })
    .click();
  await page.getByLabel("Duration (seconds)").fill("4.5");
  await page.getByRole("button", { name: "Save and check timing" }).click();
  await expect(articles.first()).toContainText("Previous version");
  const after = await (await request.get(base)).json();
  expect(after.preflight[1].fingerprint).toBe(unaffected);
  await expect(
    page.getByRole("button", { name: "Render complete film" }),
  ).toBeDisabled();
  const retained = before.jobs.find(
    (j: { chapterId: string; status: string }) =>
      j.chapterId === chapters[1].id && j.status === "succeeded",
  );
  const [rerenderResponse] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith("/renders") && r.request().method() === "POST",
    ),
    articles.first().getByRole("button", { name: "Render Chapter" }).click(),
  ]);
  expect(rerenderResponse.status()).toBe(202);
  const rerendered = await rerenderResponse.json();
  for (let attempt = 0; attempt < 180; attempt++) {
    const job = await (
      await request.get(`${base}/jobs/${rerendered.id}`)
    ).json();
    if (job.status === "failed") throw new Error(job.error);
    if (job.status === "succeeded") break;
    await page.waitForTimeout(1000);
  }
  const final = await (await request.get(base)).json();
  expect(
    final.jobs.find((j: { id: string }) => j.id === retained.id).artifactDigest,
  ).toBe(retained.artifactDigest);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Render complete film" }),
  ).toBeEnabled();
  await page.screenshot({ path: "/tmp/gen-story-film-ui.png", fullPage: true });
});
