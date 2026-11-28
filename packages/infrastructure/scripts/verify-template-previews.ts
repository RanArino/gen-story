// From the repository root: pnpm tsx packages/infrastructure/scripts/verify-template-previews.ts
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { digestOf, digestBytes } from "../src/contracts/canonical.js";
import { loadFilmTemplateCatalog } from "../src/template-catalog.js";
import { writeJson } from "../src/paths.js";
import { withBrowser } from "../src/render/browser.js";
import { measureFilmFile } from "../src/reference/inspect-file.js";
import { verifyReferenceMedia } from "../src/reference/verify.js";

const publicRoot = resolve("apps/web/public");
const aspects = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 720, height: 720 },
};
type Aspect = keyof typeof aspects;
interface Entry {
  id: string;
  revision: string;
  aspect: Aspect;
  durationMs: number;
  mp4: string;
  poster: string;
  snapshot: string;
  directionDigest: string;
}
const file = (url: string) => resolve(publicRoot, "." + url);
const manifest: Entry[] = JSON.parse(
  readFileSync(file("/film-previews/templates/manifest.json"), "utf8"),
);
const expected = loadFilmTemplateCatalog()
  .list()
  .filter(({ offered }) => offered)
  .flatMap(({ id, revision }) =>
    Object.keys(aspects).map((aspect) => `${id}/${revision}/${aspect}`),
  );
const actual = manifest.map(
  ({ id, revision, aspect }) => `${id}/${revision}/${aspect}`,
);
if (JSON.stringify(expected.sort()) !== JSON.stringify(actual.sort()))
  throw new Error("Sample manifest does not cover the current catalog.");

const evidence = manifest.map((entry) => {
  const snapshot = JSON.parse(readFileSync(file(entry.snapshot), "utf8"));
  if (digestOf(snapshot) !== entry.directionDigest)
    throw new Error(`Incorrect approved direction digest for ${entry.mp4}`);
  if (!readFileSync(file(entry.poster)).length)
    throw new Error(`Empty poster for ${entry.mp4}`);
  const { evidence: media } = measureFilmFile(
    file(entry.mp4),
    entry.durationMs / 1000,
  );
  verifyReferenceMedia(media, aspects[entry.aspect]);
  console.log(entry.id, entry.aspect, JSON.stringify(media));
  return {
    ...entry,
    media,
    sha256: digestBytes(readFileSync(file(entry.mp4))),
  };
});

const servedVideos = new Map(
  manifest.map(({ mp4 }) => [mp4, readFileSync(file(mp4))]),
);
const server = createServer((request, response) => {
  const mp4 = servedVideos.get(request.url ?? "");
  if (mp4) {
    response.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": mp4.length,
    });
    response.end(mp4);
  } else if (request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<!doctype html><title>Film sample playback check</title>");
  } else {
    response.writeHead(404).end();
  }
});
await new Promise<void>((listen) => server.listen(0, "127.0.0.1", listen));
const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
try {
  const verified = await withBrowser(async (browser) => {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const url = request.url();
      if (
        url === origin + "/" ||
        (url.startsWith(origin + "/") &&
          servedVideos.has(url.slice(origin.length)))
      )
        void request.continue();
      else void request.abort();
    });
    const results = [];
    for (const entry of evidence) {
      await page.goto(origin, { waitUntil: "domcontentloaded" });
      await page.setContent(`<button type="button" onclick="document.querySelector('video').play()">Play sample</button>
        <video controls preload="none" src="${entry.mp4}"></video>`);
      await page.click("button");
      await page.waitForFunction(() => document.querySelector("video")?.ended, {
        timeout: entry.durationMs + 30_000,
      });
      const playback = await page.evaluate(() => {
        const video = document.querySelector("video")!;
        return {
          ended: video.ended,
          muted: video.muted,
          volume: video.volume,
          duration: video.duration,
          error: video.error?.message ?? null,
          width: video.videoWidth,
          height: video.videoHeight,
        };
      });
      if (
        !playback.ended ||
        playback.muted ||
        playback.volume === 0 ||
        playback.error ||
        playback.width !== entry.media.video.width ||
        playback.height !== entry.media.video.height
      )
        throw new Error(`Browser playback did not match ${entry.mp4}`);
      console.log(
        `Played ${entry.id} ${entry.aspect} to the end with sound enabled.`,
      );
      results.push({ ...entry, playback });
    }
    return results;
  });
  writeJson(resolve("data/film/template-preview-verification.json"), verified);
} finally {
  await new Promise<void>((close, reject) =>
    server.close((error) => (error ? reject(error) : close())),
  );
}
