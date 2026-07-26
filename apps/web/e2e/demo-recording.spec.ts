import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Records a single continuous walkthrough of the Gen Story product flow.
// Playwright saves the whole test as one .webm under e2e/demo-output.
// Captions and title cards are injected into the page so they are baked
// into the recording; ffmpeg only trims/converts afterwards.

const CAPTION_STYLE_ID = "demo-caption-style";

async function ensureStyles(page: Page): Promise<void> {
  await page.evaluate((styleId) => {
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      #demo-caption {
        position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%);
        z-index: 2147483000; padding: 14px 26px; border-radius: 999px;
        background: rgba(15,18,28,0.86); color: #fff; font-weight: 700;
        font-size: 22px; letter-spacing: 0.2px; box-shadow: 0 8px 30px rgba(0,0,0,0.35);
        font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
        display: flex; align-items: center; gap: 12px; white-space: nowrap;
        opacity: 0; transition: opacity 240ms ease;
      }
      #demo-caption .step { background: #6c8cff; color: #fff; border-radius: 8px;
        padding: 2px 10px; font-size: 16px; }
      #demo-card {
        position: fixed; inset: 0; z-index: 2147483600; display: flex;
        flex-direction: column; align-items: center; justify-content: center;
        background: radial-gradient(120% 120% at 50% 0%, #1b2340 0%, #0a0d18 70%);
        color: #fff; text-align: center; gap: 14px; opacity: 0;
        transition: opacity 320ms ease;
        font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
      }
      #demo-card h1 { font-size: 60px; margin: 0; font-weight: 800; letter-spacing: -1px; }
      #demo-card p { font-size: 24px; margin: 0; color: #b9c2e6; font-weight: 500; }
    `;
    document.head.appendChild(style);
  }, CAPTION_STYLE_ID);
}

async function caption(
  page: Page,
  text: string,
  step?: string,
): Promise<void> {
  await ensureStyles(page);
  await page.evaluate(
    ({ text, step }) => {
      let el = document.getElementById("demo-caption");
      if (!el) {
        el = document.createElement("div");
        el.id = "demo-caption";
        document.body.appendChild(el);
      }
      el.innerHTML = step
        ? `<span class="step">${step}</span><span>${text}</span>`
        : `<span>${text}</span>`;
      requestAnimationFrame(() => {
        (el as HTMLElement).style.opacity = "1";
      });
    },
    { text, step },
  );
}

async function card(
  page: Page,
  title: string,
  subtitle: string,
  holdMs: number,
): Promise<void> {
  await ensureStyles(page);
  await page.evaluate(
    ({ title, subtitle }) => {
      let el = document.getElementById("demo-card");
      if (!el) {
        el = document.createElement("div");
        el.id = "demo-card";
        document.body.appendChild(el);
      }
      el.innerHTML = `<h1>${title}</h1><p>${subtitle}</p>`;
      requestAnimationFrame(() => {
        (el as HTMLElement).style.opacity = "1";
      });
    },
    { title, subtitle },
  );
  await page.waitForTimeout(holdMs);
  await page.evaluate(() => {
    const el = document.getElementById("demo-card");
    if (el) el.style.opacity = "0";
  });
  await page.waitForTimeout(320);
  await page.evaluate(() => document.getElementById("demo-card")?.remove());
}

test("Gen Story product walkthrough", async ({ page }) => {
  test.setTimeout(240_000);
  const t0 = Date.now();
  const marks: Record<string, number> = {};

  // --- Intro title card ---
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  await card(
    page,
    "Gen Story",
    "Turn your photos into an AI story — a local demo",
    2600,
  );
  await page.waitForTimeout(500);

  // --- 1. Create a project ---
  await caption(page, "Start from your projects", "1");
  await page.waitForTimeout(1200);
  await page
    .getByRole("link", { name: /New project/i })
    .first()
    .click();
  await expect(page).toHaveURL(/\/projects\/new/);
  await caption(page, "Create a project", "1");
  await page.getByLabel("Project name").fill("Summer Trip 2026");
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: /Create project/i }).click();

  // --- 2. Upload photos ---
  await expect(page).toHaveURL(/\/photos$/);
  await expect(page.getByRole("heading", { name: "Photos" })).toBeVisible();
  await caption(page, "Upload your photos", "2");
  await page.waitForTimeout(700);
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("[class*='dropzone']").first().click(),
  ]);
  await fileChooser.setFiles(
    path.join(import.meta.dirname, "fixtures/demo-photo.jpg"),
  );
  await expect(page.getByRole("button", { name: /Manage \(1\)/i })).toBeEnabled({
    timeout: 20_000,
  });
  await page.waitForTimeout(900);

  // Mark the photo as a candidate to use
  await caption(page, "Mark the shots you want to use", "2");
  await page.getByRole("button", { name: /Manage/i }).click();
  const candidateBtn = page.getByRole("button", { name: "candidate" }).first();
  if (await candidateBtn.isVisible().catch(() => false)) {
    await candidateBtn.click();
  }
  await page.waitForTimeout(1000);

  // --- 3. Storyboard ---
  await page.getByRole("link", { name: /Continue to Storyboard/i }).click();
  await expect(page).toHaveURL(/\/storyboard$/);
  const initBtn = page.getByRole("button", { name: /Initialize storyboard/i });
  if (await initBtn.isVisible().catch(() => false)) {
    await initBtn.click();
  }
  await expect(page.getByRole("heading", { name: "Storyboard" })).toBeVisible();
  await caption(page, "Build the storyboard", "3");
  await page.waitForTimeout(900);

  // Pick a tone
  const toneBtn = page.getByRole("button", { name: /Cinematic/i }).first();
  if (await toneBtn.isVisible().catch(() => false)) {
    await toneBtn.click();
    await caption(page, "Pick a cinematic tone", "3");
    await page.waitForTimeout(900);
  }

  // Add and describe a scene
  await caption(page, "Describe each scene", "3");
  await page.getByRole("button", { name: /\+ Add scene/i }).click();
  await page.waitForTimeout(500);
  await page
    .locator("input[id*='title']")
    .first()
    .fill("Golden hour on the coast");
  await page.waitForTimeout(300);
  await page
    .locator("textarea[id*='desc']")
    .first()
    .fill("A wide establishing shot of the shoreline at sunset.");
  await page.waitForTimeout(300);
  const promptField = page.locator("textarea[id*='prompt']").first();
  await promptField.fill(
    "Cinematic wide shot of a coastline at golden hour, warm color grade, soft light.",
  );
  await page.waitForTimeout(800);

  await page.getByRole("button", { name: /Save scenes/i }).click();
  await page
    .getByText("Saved", { exact: true })
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(900);

  // --- 4. Generate ---
  // Navigate via URL (robust against footer link state).
  await page.goto(page.url().replace(/\/storyboard$/, "/generate"));
  await expect(page).toHaveURL(/\/generate$/);
  await expect(page.getByRole("heading", { name: "Generate" })).toBeVisible();
  await caption(page, "Generate AI images", "4");
  await page.waitForTimeout(900);
  marks.genStart = Date.now() - t0;
  await page.getByRole("button", { name: /Start generation/i }).click();
  await caption(page, "AI renders the scene…", "4");

  // Wait for completion: the "Review images" link appears when done.
  const reviewLink = page.getByRole("link", { name: /Review images/i });
  await reviewLink.waitFor({ state: "visible", timeout: 180_000 });
  marks.genEnd = Date.now() - t0;
  await page.waitForTimeout(1200);

  // --- 5. Review ---
  await reviewLink.click();
  await expect(page).toHaveURL(/\/review$/);
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
  await caption(page, "Review & adopt the result", "5");
  await page.waitForTimeout(1000);

  // Expand the generation history and adopt the generated image so it fills
  // the main "Generated image" slot.
  const historyToggle = page
    .getByRole("button", { name: /Generation history/i })
    .first();
  if (await historyToggle.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await historyToggle.scrollIntoViewIfNeeded().catch(() => {});
    await historyToggle.click();
    await page.waitForTimeout(700);
  }
  const adoptBtn = page.getByRole("button", { name: "Adopt" }).first();
  if (await adoptBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await adoptBtn.scrollIntoViewIfNeeded().catch(() => {});
    await adoptBtn.click();
    await page.waitForTimeout(700);
  }
  // Bring the adopted (real AI) image into view.
  await page
    .locator("img[src*='/files/'], img[alt='Generated']")
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await caption(page, "Your photo, reimagined by AI", "5");
  await page.waitForTimeout(2000);

  // --- Outro card ---
  await card(
    page,
    "Gen Story",
    "A local demo — the base for the next concept",
    2600,
  );

  marks.total = Date.now() - t0;
  fs.writeFileSync(
    path.join(import.meta.dirname, "demo-marks.json"),
    JSON.stringify(marks, null, 2),
  );
});
