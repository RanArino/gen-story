// Full browser playback and encoded-media integrity check for a generated reference directory.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";
import { digestBytes } from "../src/contracts/canonical.js";
import { resolveChromePath } from "../src/env/chrome.js";
import { inspectReferenceFile } from "../src/reference/inspect-file.js";

if (!process.argv[2]) throw new Error("Provide a reference output directory");
const directory = resolve(process.argv[2]);
const manifest = JSON.parse(readFileSync(`${directory}/manifest.json`, "utf8"));
const file = `${directory}/reference.mp4`;
if (digestBytes(readFileSync(file)) !== manifest.artifacts["reference.mp4"])
  throw new Error("Reference MP4 does not match its recorded digest");
const { evidence: mediaEvidence } = inspectReferenceFile(
  file,
  manifest.capturedDurationSeconds,
);
const browser = await puppeteer.launch({
  executablePath: resolveChromePath(),
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(file).href);
  await page.waitForSelector("video");
  await page.evaluate(() => document.querySelector("video")!.pause());
  await page.click("video");
  await page.evaluate(async () => {
    const element = document.querySelector("video")!;
    element.currentTime = 0;
    element.muted = false;
    element.volume = 1;
    await element.play();
  });
  console.log(
    `Playing all ${manifest.capturedDurationSeconds}s with sound enabled after a click`,
  );
  await page.waitForFunction(() => document.querySelector("video")!.ended, {
    timeout: (manifest.capturedDurationSeconds + 45) * 1000,
  });
  const playback = await page.evaluate(() => {
    const element = document.querySelector("video")!;
    return {
      ended: element.ended,
      muted: element.muted,
      volume: element.volume,
      duration: element.duration,
      error: element.error?.message ?? null,
      currentTime: element.currentTime,
    };
  });
  if (!playback.ended || playback.muted || playback.error)
    throw new Error(`Reference playback failed: ${JSON.stringify(playback)}`);
  writeFileSync(
    `${directory}/playback.json`,
    JSON.stringify(
      {
        completeReference: manifest.complete,
        mediaEvidence,
        playback,
        humanCreativeAcceptance: "unreviewed",
        note: "Unmuted full browser playback and integrity verified; no human listening verdict is implied.",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ directory, mediaEvidence, playback }));
} finally {
  await browser.close();
}
