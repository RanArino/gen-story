// Drives the pinned Chrome through puppeteer-core with deterministic flags. Every request that
// does not go to the local render server is aborted and counted.
import puppeteer, { type Browser, type BrowserContext, type Page } from "puppeteer-core";
import { fail } from "../contracts/errors.js";
import type { DrawOptions, MeasuredText } from "../painter/protocol.js";

// Flags from the Film Studio v2 prototype that gave deterministic frames (tools/_browser.mjs).
const FLAGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--use-gl=angle",
  "--use-angle=swiftshader",
  "--enable-unsafe-swiftshader",
  "--force-device-scale-factor=1",
  "--autoplay-policy=no-user-gesture-required",
];

/** The browser globals the driver touches inside page.evaluate (typed here; this is Node code). */
interface PageGlobals {
  __painter: { digest: string; runtimeMs: number; draw(t: number, o?: DrawOptions): MeasuredText[]; fonts(): string[] };
  document: {
    documentElement: { dataset: Record<string, string | undefined> };
    getElementById(id: string): { toDataURL(type: string): string };
  };
}

export interface PlanPage {
  page: Page;
  /** Non-local URLs the page tried to load; each was aborted. */
  blocked: string[];
  digest: string;
  runtimeMs: number;
  draw(t: number, opts?: DrawOptions): Promise<MeasuredText[]>;
  /** PNG bytes of the frame at t, drawn and then captured. */
  frame(t: number, opts?: DrawOptions): Promise<Buffer>;
  fonts(): Promise<string[]>;
}

export async function launch(): Promise<Browser> {
  const executablePath = process.env.CHROME_PATH;
  if (!executablePath) fail("FS_ENV_MISMATCH", "", "CHROME_PATH is not set; rendering needs the pinned Chrome");
  return puppeteer.launch({ executablePath, headless: "shell", args: FLAGS });
}

export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  const browser = await launch();
  try {
    return await fn(browser);
  } finally {
    await browser.close();
  }
}

/** Opens runtime/<page>.html for a Plan path relative to out/ and waits until the painter is ready. */
export async function openPlan(browser: Browser | BrowserContext, origin: string, planPath: string, kind: "render" | "preview" = "render"): Promise<PlanPage> {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const blocked: string[] = [];
  const errors: string[] = [];
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (req.url().startsWith(`${origin}/`)) void req.continue();
    else {
      blocked.push(req.url());
      void req.abort();
    }
  });
  page.on("pageerror", (error) => errors.push(error instanceof Error ? error.message : String(error)));
  await page.goto(`${origin}/runtime/${kind}.html?plan=${encodeURIComponent(planPath)}`, { waitUntil: "load" });
  await page.waitForFunction(() => {
    const el = (globalThis as unknown as PageGlobals).document.documentElement;
    return el.dataset.ready || el.dataset.error;
  }, { timeout: 120_000 });
  const error = await page.evaluate(() => (globalThis as unknown as PageGlobals).document.documentElement.dataset.error);
  if (error || errors.length) fail("FS_RUNTIME_ERROR", "", `painter failed to load ${planPath}: ${error ?? errors.join("; ")}`);
  const { digest, runtimeMs } = await page.evaluate(() => {
    const p = (globalThis as unknown as PageGlobals).__painter;
    return { digest: p.digest, runtimeMs: p.runtimeMs };
  });
  const draw = (t: number, opts?: DrawOptions) => page.evaluate((time, o) => (globalThis as unknown as PageGlobals).__painter.draw(time, o), t, opts ?? {});
  return {
    page,
    blocked,
    digest,
    runtimeMs,
    draw,
    async frame(t, opts) {
      await draw(t, opts);
      if (errors.length) fail("FS_RUNTIME_ERROR", "", `painter error at ${t} ms: ${errors.join("; ")}`);
      if (kind === "preview") {
        // The preview canvas is scaled by CSS; read its pixels at full resolution instead.
        const data = await page.evaluate(() => (globalThis as unknown as PageGlobals).document.getElementById("frame").toDataURL("image/png"));
        return Buffer.from(data.slice(data.indexOf(",") + 1), "base64");
      }
      return Buffer.from(await page.screenshot({ type: "png", optimizeForSpeed: true }));
    },
    fonts: () => page.evaluate(() => (globalThis as unknown as PageGlobals).__painter.fonts()),
  };
}
