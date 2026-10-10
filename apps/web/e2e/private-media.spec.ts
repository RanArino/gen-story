import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";
import { createMediaBrowserHarness } from "../../api/src/test-support/media-browser-harness";

// This explicitly invokes extracted processing; it is not a hosted Cloud Tasks test.
test("private upload reaches the storyboard, survives reload, refreshes expired media, and isolates principals", async ({
  page,
  context,
}) => {
  const harness = await createMediaBrowserHarness();
  try {
    await context.addCookies([
      { name: "fixture-principal", value: "a", url: harness.origin },
    ]);
    await page.clock.install();
    await page.goto(`${harness.origin}/projects/project-a/photos`);
    await page.locator('input[type="file"]').setInputFiles({
      name: "test-photo.jpg",
      mimeType: "image/jpeg",
      buffer: await readFile(
        new URL(
          "../../api/src/test-support/fixtures/valid.jpg",
          import.meta.url,
        ),
      ),
    });
    await expect(page.getByText("Processing photo…")).toBeVisible();
    await expect.poll(async () => (await harness.pending()).length).toBe(1);
    const pending = await harness.pending();
    expect(
      harness.requests.some(
        (request) => request.method === "PUT" && !request.credentialsPresent,
      ),
    ).toBe(true);
    expect((await harness.complete(pending[0]!)).status).toBe("completed");
    const photo = page.getByRole("img", { name: "test-photo.jpg" });
    await expect(photo).toBeVisible();
    await expect
      .poll(() =>
        photo.evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.reload();
    await page.getByRole("button", { name: /Manage/ }).click();
    await expect
      .poll(() =>
        page
          .getByRole("img", { name: "test-photo.jpg" })
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    const oldUrl = await page
      .getByRole("img", { name: "test-photo.jpg" })
      .getAttribute("src");
    // Returned expiry, rather than an R2 error body, drives proactive refresh.
    harness.expireReads();
    await page.clock.fastForward(271_000);
    await expect
      .poll(() =>
        page.getByRole("img", { name: "test-photo.jpg" }).getAttribute("src"),
      )
      .not.toBe(oldUrl);
    await page.getByRole("link", { name: /Continue to storyboard/i }).click();
    await expect(
      page.getByRole("heading", { name: "Storyboard", exact: true }),
    ).toBeVisible();
    const scene = (await harness.db.collection("scenes").get()).docs[0]!.data();
    expect(scene.photoAssets).toHaveLength(1);
    // Continue through the real setup controls to edit the newly created scene.
    await page
      .getByRole("button", { name: "Warm Heartfelt and nostalgic" })
      .click();
    await page
      .getByRole("button", { name: "Fixture style Fixture style", exact: true })
      .click();
    await page
      .getByPlaceholder("Story and worldview shared by all scenes")
      .fill("A warm day with friends.");
    await page.getByRole("button", { name: "Save story", exact: true }).click();
    await page
      .getByPlaceholder("Common prompt applied to every scene")
      .fill("Warm natural colors.");
    await page
      .getByRole("button", { name: "Save common prompt", exact: true })
      .click();
    await expect(
      page.locator(`img[alt="test-photo.jpg"]`).first(),
    ).toBeVisible();
    await page
      .getByLabel("Title", { exact: true })
      .first()
      .fill("A private memory");
    await page
      .getByRole("button", { name: "Save scenes", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await harness.db.collection("scenes").doc(scene.id).get()).data()
            ?.title,
      )
      .toBe("A private memory");
    // Recovery must enable the user's next scene save, not only flip deletedAt.
    expect(
      (
        await page.request.delete(`${harness.origin}/api/projects/project-a`)
      ).status(),
    ).toBe(204);
    expect(
      (
        await page.request.get(`${harness.origin}/api/projects/project-a`)
      ).status(),
    ).toBe(404);
    expect(
      (
        await page.request.post(
          `${harness.origin}/api/projects/project-a/restore`,
        )
      ).status(),
    ).toBe(200);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Storyboard", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Title", { exact: true })
      .first()
      .fill("A restored private memory");
    await page
      .getByRole("button", { name: "Save scenes", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await harness.db.collection("scenes").doc(scene.id).get()).data()
            ?.title,
      )
      .toBe("A restored private memory");
    const photoId = scene.photoAssets[0].photoAssetId as string;
    await context.addCookies([
      { name: "fixture-principal", value: "b", url: harness.origin },
    ]);
    await page.evaluate(() => {
      (
        window as unknown as { mediaFixture: { account: (id: string) => void } }
      ).mediaFixture.account("b");
    });
    expect(
      (
        await page.request.get(
          `${harness.origin}/api/photo-assets/${photoId}/media-url?variant=preview`,
        )
      ).status(),
    ).toBe(404);
    await page.goto(`${harness.origin}/projects/project-b/photos`);
    await page.locator('input[type="file"]').setInputFiles({
      name: "test-photo.jpg",
      mimeType: "image/jpeg",
      buffer: await readFile(
        new URL(
          "../../api/src/test-support/fixtures/valid.jpg",
          import.meta.url,
        ),
      ),
    });
    await expect(page.getByText("Processing photo…")).toBeVisible();
    await expect.poll(async () => (await harness.pending()).length).toBe(1);
    expect((await harness.complete((await harness.pending())[0]!)).status).toBe(
      "completed",
    );
    await expect(
      page.getByRole("img", { name: "test-photo.jpg" }),
    ).toBeVisible();
    await context.clearCookies();
    await page.evaluate(() => {
      (
        window as unknown as { mediaFixture: { clear: () => void } }
      ).mediaFixture.clear();
    });
    expect(
      (
        await page.request.get(
          `${harness.origin}/api/photo-assets/${photoId}/media-url?variant=preview`,
        )
      ).status(),
    ).toBe(401);
    await expect(
      page.getByRole("img", { name: "test-photo.jpg" }),
    ).not.toHaveAttribute("src", /X-Amz/);
    expect(
      await page.evaluate(() =>
        Object.values(localStorage).some((value) =>
          String(value).includes("X-Amz-"),
        ),
      ),
    ).toBe(false);
  } finally {
    await harness.close();
  }
});
