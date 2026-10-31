// Validate actual production MP4s, cache replay and full unmuted browser playback.
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import {
  initializeRuntime,
  renderFilmChapter,
  digestBytes,
  type ResolvedRenderPlan,
} from "../src/index.js";
import { resolveChromePath } from "../src/env/chrome.js";
import { run } from "../src/render/ffmpeg.js";
import { verifyMp4 } from "../src/render/verify.js";
const directory = resolve(
  process.argv[2] ?? "data/film/q2-cinematic-comparison",
);
const paths = initializeRuntime(directory),
  plan = JSON.parse(
    readFileSync(`${paths.out}plan.json`, "utf8"),
  ) as ResolvedRenderPlan;
const original = `${paths.out}artifacts/cinematic-q2/${plan.chapter.id}.mp4`;
const originalDigest = digestBytes(readFileSync(original));
const replay = await renderFilmChapter(paths, plan, "cinematic-q2");
if (
  replay.cache !== "hit" ||
  originalDigest !== digestBytes(readFileSync(replay.file))
)
  throw new Error("Cinematic cache replay changed encoded bytes");
const problems = await verifyMp4(
  original,
  Math.round((plan.timing.proposal.runtimeMs * plan.profile.fps) / 1000),
  plan.profile,
);
if (problems.length) throw new Error(JSON.stringify(problems));
const measured = await run("ffmpeg", [
  "-hide_banner",
  "-i",
  original,
  "-af",
  "loudnorm=I=-18:TP=-1.5:print_format=json",
  "-f",
  "null",
  "-",
]);
const match = measured.stderr.match(/\{\s*"input_i"[\s\S]*?\}/);
if (measured.code !== 0 || !match)
  throw new Error("Missing production loudness evidence");
const levels = JSON.parse(match[0]);
if (
  !Number.isFinite(Number(levels.input_i)) ||
  Math.abs(Number(levels.input_i) + 18) > 1 ||
  Number(levels.input_tp) > -1
)
  throw new Error(
    `Cinematic audio level/headroom failure: ${JSON.stringify(levels)}`,
  );
const browser = await puppeteer.launch({
  executablePath: resolveChromePath(),
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(original).href);
  await page.waitForSelector("video");
  await page.evaluate(() => document.querySelector("video")!.pause());
  await page.click("video");
  await page.evaluate(async () => {
    const v = document.querySelector("video")!;
    v.currentTime = 0;
    v.muted = false;
    v.volume = 1;
    await v.play();
  });
  console.log(
    `Playing complete production film (${plan.timing.proposal.runtimeMs / 1000}s), cache hit verified`,
  );
  await page.waitForFunction(() => document.querySelector("video")!.ended, {
    timeout: plan.timing.proposal.runtimeMs + 45000,
  });
  const playback = await page.evaluate(() => {
    const v = document.querySelector("video")!;
    return {
      ended: v.ended,
      muted: v.muted,
      error: v.error?.message ?? null,
      currentTime: v.currentTime,
      duration: v.duration,
    };
  });
  if (!playback.ended || playback.muted || playback.error)
    throw new Error(JSON.stringify(playback));
  const report = {
    cache: replay.cache,
    sha256: digestBytes(readFileSync(original)),
    levels,
    playback,
    profile: plan.profile,
    humanCreativeAcceptance: "unreviewed",
  };
  writeFileSync(`${paths.out}acceptance.json`, JSON.stringify(report, null, 2));
  copyFileSync(original, `${directory}/production.mp4`);
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
