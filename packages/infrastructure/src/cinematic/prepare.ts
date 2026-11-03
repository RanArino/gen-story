import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { digestBytes, digestOf } from "../contracts/canonical.js";
import { readMediaLock, type MediaLockEntry } from "../media/lock.js";
import type { FilmRuntimePaths } from "../paths.js";
import { writeJson } from "../paths.js";
import { withBrowser } from "../render/browser.js";
import { ffmpeg, run } from "../render/ffmpeg.js";
import { startServer } from "../render/server.js";
import { cinematicRoot, CINEMATIC_BROWSER_FILES } from "./sources.js";
import { validateDirection } from "./validate.js";
import type { CinematicDirection } from "./types.js";

export interface PreparedScore {
  music: MediaLockEntry;
  stem: MediaLockEntry;
  gainDb: number;
  sourceDigest: string;
  scoreDigest: string;
}
export async function prepareCinematicScore(
  paths: FilmRuntimePaths,
  direction: CinematicDirection,
): Promise<PreparedScore> {
  validateDirection(direction);
  const sourceDigest = digestOf(
    CINEMATIC_BROWSER_FILES.filter((f) => f !== "visual.js").map((f) => [
      f,
      digestBytes(readFileSync(`${cinematicRoot}${f}`)),
    ]),
  );
  const key = digestOf({ score: direction.score, sourceDigest }).slice(7);
  const directory = `${paths.media}scores/${key}/`;
  const record = `${directory}score.json`;
  if (existsSync(record)) {
    const cached = JSON.parse(readFileSync(record, "utf8")) as PreparedScore;
    if (
      cached.scoreDigest === digestOf(direction.score) &&
      [cached.music, cached.stem].every(
        (e) =>
          existsSync(`${paths.media}${e.path}`) &&
          digestBytes(readFileSync(`${paths.media}${e.path}`)) === e.sha256,
      )
    )
      return cached;
  }
  mkdirSync(directory, { recursive: true });
  const server = await startServer(paths);
  try {
    const encoded = await withBrowser(async (browser) => {
      const page = await browser.newPage();
      await page.setRequestInterception(true);
      page.on("request", (r) => {
        if (r.url().startsWith(`${server.origin}/`)) void r.continue();
        else void r.abort();
      });
      await page.goto(`${server.origin}/runtime/preview.html`);
      // The module is fixed trusted source; only the validated score crosses the browser boundary.
      return page.evaluate(
        async ({ score, origin }) => {
          const module = await import(`${origin}/cinematic/audio-browser.js`);
          return module.synthesize(score) as Promise<{
            music: string;
            stem: string;
          }>;
        },
        { score: direction.score, origin: server.origin },
      );
    });
    for (const name of ["music", "stem"] as const)
      writeFileSync(
        `${directory}${name}.raw.wav`,
        Buffer.from(encoded[name], "base64"),
      );
    const measured = await run("ffmpeg", [
      "-hide_banner",
      "-i",
      `${directory}music.raw.wav`,
      "-i",
      `${directory}stem.raw.wav`,
      "-filter_complex",
      `[0:a][1:a]amix=inputs=2:normalize=0,atrim=0:${direction.duration},loudnorm=I=-18:TP=-1.5:print_format=json`,
      "-f",
      "null",
      "-",
    ]);
    if (measured.code !== 0) throw new Error(measured.stderr);
    const match = measured.stderr.match(/\{\s*"input_i"[\s\S]*?\}/);
    if (!match) throw new Error("Missing score loudness measurement");
    const levels = JSON.parse(match[0]);
    const gainDb = Math.min(
      -18 - Number(levels.input_i),
      -1.5 - Number(levels.input_tp),
    );
    if (!Number.isFinite(gainDb))
      throw new Error("Cinematic score is silent or unmeasurable");
    const entries = [];
    for (const name of ["music", "stem"] as const) {
      const file = `${paths.media}sounds/${key}-${name}.wav`;
      await ffmpeg([
        "-i",
        `${directory}${name}.raw.wav`,
        "-af",
        `volume=${gainDb}dB,atrim=0:${direction.duration}`,
        "-ar",
        "48000",
        "-ac",
        "2",
        "-c:a",
        "pcm_s16le",
        file,
      ]);
      const bytes = readFileSync(file),
        sha256 = digestBytes(bytes),
        path = `sounds/${key}-${name}.wav`;
      entries.push({
        path,
        kind: "sound" as const,
        sha256,
        durationMs: direction.duration * 1000,
      });
      rmSync(`${directory}${name}.raw.wav`);
    }
    const result = {
      music: entries[0]!,
      stem: entries[1]!,
      gainDb,
      sourceDigest,
      scoreDigest: digestOf(direction.score),
    };
    writeJson(record, result);
    return result;
  } finally {
    await server.close();
  }
}
export function lockCinematicMedia(
  paths: FilmRuntimePaths,
  direction: CinematicDirection,
  extra: MediaLockEntry[] = [],
) {
  validateDirection(direction);
  const lock = readMediaLock(paths.media);
  const images = Object.values(direction.assets).map((a) => ({
    path: a.asset,
    kind: "image" as const,
    sha256: a.sha256,
    widthPx: a.widthPx,
    heightPx: a.heightPx,
  }));
  for (const asset of [...images, ...extra]) {
    const file = `${paths.media}${asset.path}`;
    if (digestBytes(readFileSync(file)) !== asset.sha256)
      throw new Error(`Changed cinematic media: ${asset.path}`);
    mkdirSync(dirname(file), { recursive: true });
    lock.files = lock.files.filter((f) => f.path !== asset.path);
    lock.files.push(asset);
  }
  writeJson(`${paths.media}media-lock.json`, lock);
}
