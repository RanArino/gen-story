import path from "node:path";
import { expect, test } from "@playwright/test";

// This test requires both dev servers to be running:
//   Terminal 1: pnpm dev:api   (port 4000, with mock image generation)
//   Terminal 2: pnpm dev:web   (port 3000)
//
// The mock image generation adapter is used automatically when
// OPENAI_API_KEY is not set in the API environment.

test("complete Phase 1 product flow", async ({ page }) => {
  // 1. Root redirects to /projects
  await page.goto("/");
  await expect(page).toHaveURL(/\/projects/);
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();

  // 2. Create a new project
  await page
    .getByRole("link", { name: /New project/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/projects\/new/);

  await page.getByLabel("Project name").fill("E2E Test Project");
  await page.getByRole("button", { name: /Create project/i }).click();

  // 3. Lands on photos page
  await expect(page).toHaveURL(/\/photos$/);
  await expect(page.getByRole("heading", { name: "Photos" })).toBeVisible();

  // 4. Upload a photo
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator(".dropzone, [class*='dropzone']").click(),
  ]);
  await fileChooser.setFiles(
    path.join(import.meta.dirname, "fixtures/test-photo.jpg"),
  );

  // Wait for upload to complete (manage tab becomes enabled)
  await expect(page.getByRole("button", { name: /Manage \(1\)/i })).toBeEnabled(
    { timeout: 15_000 },
  );

  // 5. Switch to manage tab and set usage to candidate
  await page.getByRole("button", { name: /Manage/i }).click();
  await expect(
    page.getByRole("button", { name: "candidate" }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "candidate" }).first().click();

  // 6. Navigate to storyboard
  await page.getByRole("link", { name: /Continue to Storyboard/i }).click();
  await expect(page).toHaveURL(/\/storyboard$/);

  // 7. Initialize storyboard if needed
  const initBtn = page.getByRole("button", { name: /Initialize storyboard/i });
  if (await initBtn.isVisible()) {
    await initBtn.click();
  }

  await expect(page.getByRole("heading", { name: "Storyboard" })).toBeVisible();

  // 8. Select a tone
  await page.getByRole("button", { name: /Cinematic/i }).click();

  // 9. Add a scene
  await page.getByRole("button", { name: /\+ Add scene/i }).click();

  // Fill in scene title
  await page.locator("input[id*='title']").first().fill("Opening shot");
  await page
    .locator("textarea[id*='desc']")
    .first()
    .fill("A wide establishing shot.");
  await page
    .locator("textarea[id*='prompt']")
    .first()
    .fill("Cinematic wide shot, golden hour.");

  // 10. Save scenes
  await page.getByRole("button", { name: /Save scenes/i }).click();
  await expect(page.getByText("Saved")).toBeVisible({ timeout: 10_000 });

  // 11. Navigate to generate
  await page.getByRole("link", { name: /Continue to Generate/i }).click();
  await expect(page).toHaveURL(/\/generate$/);

  // 12. Start generation
  await page.getByRole("button", { name: /Start generation/i }).click();

  // 13. Wait for at least one scene to complete (mock adapter is fast)
  await expect(
    page.locator("[class*='badge_succeeded'], [class*='badge_failed']").first(),
  ).toBeVisible({ timeout: 30_000 });

  // 14. Navigate to review
  const reviewLink = page.getByRole("link", { name: /Review images/i });
  if (await reviewLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await reviewLink.click();
  } else {
    // Navigate directly
    const url = page.url();
    await page.goto(url.replace("/generate", "/review"));
  }

  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();

  // 15. Adopt the first available image (if generation succeeded)
  const adoptBtn = page.getByRole("button", { name: "Adopt" }).first();
  if (await adoptBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await adoptBtn.click();
    // Wait for adopted badge to appear
    await expect(page.getByText("✓ Adopted").first()).toBeVisible({
      timeout: 10_000,
    });
  }
});

test("state is restored after browser reload", async ({ page }) => {
  // Create a project to get a valid projectId
  await page.goto("/projects/new");
  await page.getByLabel("Project name").fill("Reload Test Project");
  await page.getByRole("button", { name: /Create project/i }).click();
  await expect(page).toHaveURL(/\/photos$/);

  // Reload the photos page — should still show the project
  await page.reload();
  await expect(page.getByRole("heading", { name: "Photos" })).toBeVisible();
  await expect(page).toHaveURL(/\/photos$/);
});
