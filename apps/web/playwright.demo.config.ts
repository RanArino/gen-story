import { defineConfig, devices } from "@playwright/test";

// Dedicated config for recording the product walkthrough demo video.
// Run with: pnpm --filter @gen-story/web exec playwright test --config playwright.demo.config.ts
// Requires both dev servers running (API on 4000 with OPENAI/GEMINI keys, web on 3000).
export default defineConfig({
  testDir: "./e2e",
  testMatch: /demo-recording\.spec\.ts/,
  timeout: 240_000,
  expect: { timeout: 25_000 },
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  outputDir: "./e2e/demo-output",
  use: {
    baseURL: "http://localhost:3000",
    launchOptions: { slowMo: 300 },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        video: { mode: "on", size: { width: 1280, height: 800 } },
      },
    },
  ],
});
