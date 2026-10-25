// A 4x3 grid of a Chapter Plan's twelve sample frames, drawn by the trusted painter.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { digestBytes } from "../contracts/canonical.js";
import { planDigest } from "../compiler/fingerprint.js";
import { openPlan, withBrowser } from "./browser.js";
import { ffmpeg, frameCount } from "./ffmpeg.js";
import { frameTime, loadChapterPlan, outRelative, sampleFrames, type RenderDeps } from "./render-chapter.js";
import { startServer } from "./server.js";

export async function contactSheet(deps: RenderDeps, planFile: string, options: { grayscale: boolean } = { grayscale: false }): Promise<{ file: string; sha256: string; planDigest: string; frames: number[] }> {
  const { paths } = deps;
  const plan = loadChapterPlan(paths, planFile);
  const planPath = outRelative(paths, planFile);
  const name = planPath.split("/").at(-2)!;
  const frames = sampleFrames(frameCount(plan.timing.proposal.runtimeMs, plan.profile.fps));
  const work = mkdtempSync(`${tmpdir()}/film-sheet-`);
  try {
    const server = await startServer(paths);
    try {
      await withBrowser(async (browser) => {
        const page = await openPlan(browser, server.origin, planPath);
        for (const [i, frame] of frames.entries()) writeFileSync(`${work}/frame-${String(i).padStart(2, "0")}.png`, await page.frame(frameTime(frame, plan.profile.fps)));
      });
    } finally {
      await server.close();
    }
    const dir = `${paths.out}contact-sheets/${name}/`;
    mkdirSync(dir, { recursive: true });
    const file = `${plan.chapter.id}${options.grayscale ? ".gray" : ""}.png`;
    const out = `${dir}${file}`;
    const filter = `scale=480:270,${options.grayscale ? "hue=s=0," : ""}tile=4x3`;
    await ffmpeg(["-framerate", "1", "-i", `${work}/frame-%02d.png`, "-vf", filter, "-frames:v", "1", out]);
    return { file: `out/contact-sheets/${name}/${file}`, sha256: digestBytes(readFileSync(out)), planDigest: planDigest(plan), frames };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
