import { expect, test } from "@playwright/test";

// Static examples must play even when the API and render environment are unavailable.
test.use({ launchOptions: { executablePath: process.env.CHROME_PATH } });
for (const recipe of ["quiet-cinema", "memory-board", "pulse-cut"]) {
  test(`${recipe} example plays without the API`, async ({ page }) => {
    await page.route("http://localhost:4000/**", (route) => route.abort());
    await page.goto(`/film-previews/${recipe}.mp4`);
    const video = page.locator("video");
    await expect(video).toBeVisible();
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.muted = true;
      await element.play();
    });
    await expect
      .poll(() =>
        video.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeGreaterThan(1);
    expect(
      await video.evaluate((element: HTMLVideoElement) => element.videoWidth),
    ).toBe(1280);
    await video.evaluate((element: HTMLVideoElement) => {
      element.currentTime = element.duration - 1;
    });
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.ended))
      .toBe(true);
  });
}
