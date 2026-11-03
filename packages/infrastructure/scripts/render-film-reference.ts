// Development reference only; never used by the production Film service.
// pnpm tsx packages/infrastructure/scripts/render-film-reference.ts [output-directory] [--seconds N]
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { once } from "node:events";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { inspectReferenceFile } from "../src/reference/inspect-file.js";
import { resolveChromePath } from "../src/env/chrome.js";
import { readFingerprint } from "../src/env/fingerprint.js";
import {
  inventoryReference,
  productionReferenceMapping,
} from "../src/reference/inventory.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const source = resolve(repo, "film-making-idea/film-studio");
const specPath = "productions/sando/film.spec.json";
const args = process.argv.slice(2);
const secondsAt = args.indexOf("--seconds");
const requestedSeconds = secondsAt < 0 ? null : Number(args[secondsAt + 1]);
if (
  requestedSeconds !== null &&
  (!Number.isFinite(requestedSeconds) || requestedSeconds <= 0)
)
  throw new Error("--seconds must be positive");
const destination =
  args[0] && !args[0].startsWith("--")
    ? args[0]
    : `data/film/reference/sando-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const output = resolve(repo, destination);
mkdirSync(output, { recursive: true });
// Each run owns a fresh directory, so a failed retry cannot retain an old success manifest.
if (readdirSync(output).length)
  throw new Error(`Reference output must be empty: ${output}`);
const digest = (bytes: Buffer) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const spec = JSON.parse(readFileSync(resolve(source, specPath), "utf8"));
const registry = resolve(repo, "packages/infrastructure/assets/registry");
const font = (id: string) => {
  const record = JSON.parse(
    readFileSync(resolve(registry, `records/font.${id}@1.0.0.json`), "utf8"),
  );
  const hash = record.assetDigests.find(
    (a: { name: string }) => a.name === "face-0",
  ).digest;
  const bytes = readFileSync(
    resolve(registry, `blobs/sha256/${hash.slice(7)}`),
  );
  if (digest(bytes) !== hash)
    throw new Error(`Reference font digest mismatch: ${id}`);
  return { bytes, sha256: hash };
};
const fonts = {
  serif: font("noto-serif-jp"),
  latin: font("cormorant-garamond"),
};
const fontCss = `@font-face{font-family:ReferenceSerif;src:url('/__font/serif')}@font-face{font-family:ReferenceLatin;src:url('/__font/latin')}`;
const types: Record<string, string> = {
  ".js": "text/javascript",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".css": "text/css",
};
const server = createServer((req, res) => {
  try {
    const pathname = decodeURIComponent(
      new URL(req.url ?? "/", "http://localhost").pathname,
    );
    if (pathname === "/__driver.js") {
      res.setHeader("content-type", "text/javascript");
      res.end(
        readFileSync(new URL("./film-reference-browser.js", import.meta.url)),
      );
      return;
    }
    if (pathname === "/__reference") {
      res.setHeader("content-type", "text/html");
      res.end(
        `<html><head><style>${fontCss}html,body{margin:0;background:#050604}#film{position:fixed;inset:0}</style></head><body><div id="film"></div></body></html>`,
      );
      return;
    }
    if (pathname.startsWith("/__font/")) {
      const item = fonts[pathname.slice(8) as keyof typeof fonts];
      if (!item) {
        res.writeHead(404).end();
        return;
      }
      res.setHeader("content-type", "font/ttf");
      res.end(item.bytes);
      return;
    }
    const file = resolve(source, `.${pathname}`);
    if (!file.startsWith(source + sep) || !types[extname(file)]) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader("content-type", types[extname(file)]!);
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise<void>((accept) => server.listen(0, "127.0.0.1", accept));
const address = server.address();
if (!address || typeof address === "string")
  throw new Error("Missing reference server address");
const origin = `http://127.0.0.1:${address.port}`;
let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
let encoder: ReturnType<typeof spawn> | undefined;
try {
  browser = await puppeteer.launch({
    executablePath: resolveChromePath(),
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--force-device-scale-factor=1",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  const errors: string[] = [],
    blocked: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (
      request.url().startsWith(`${origin}/`) ||
      request.url().startsWith("data:")
    )
      void request.continue();
    else {
      blocked.push(request.url());
      void request.abort();
    }
  });
  await page.goto(`${origin}/__reference`);
  await page.addScriptTag({ type: "module", url: `${origin}/__driver.js` });
  await page.waitForFunction("Boolean(globalThis.referenceCapture)");
  type Timeline = {
    duration: number;
    segments: { id: string; kind: string; t0: number; t1: number }[];
    audioEvents: unknown[];
    beds: unknown[];
    camera: unknown[];
  };
  interface Capture {
    load(origin: string, path: string): Promise<Timeline>;
    audio(): Promise<void>;
    draw(t: number): void;
  }
  const timeline = await page.evaluate(
    ({ origin, specPath }) =>
      (
        globalThis as unknown as { referenceCapture: Capture }
      ).referenceCapture.load(origin, specPath),
    { origin, specPath },
  );
  const duration = Math.min(
    requestedSeconds ?? timeline.duration,
    timeline.duration,
  );
  console.log(
    `Reference ${timeline.duration}s; capturing ${duration}s, audio events ${timeline.audioEvents.length}`,
  );
  await page.exposeFunction("saveReferenceAudio", (encoded: string) =>
    writeFileSync(`${output}/reference.wav`, Buffer.from(encoded, "base64")),
  );
  await page.evaluate(() =>
    (
      globalThis as unknown as { referenceCapture: Capture }
    ).referenceCapture.audio(),
  );
  console.log(
    "Original procedural score, ambience and effects rendered with native OfflineAudioContext",
  );
  encoder = spawn(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "image2pipe",
      "-framerate",
      "30",
      "-c:v",
      "mjpeg",
      "-i",
      "-",
      "-i",
      `${output}/reference.wav`,
      "-t",
      String(duration),
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-af",
      "loudnorm=I=-18:TP=-1.5:LRA=11",
      "-movflags",
      "+faststart",
      `${output}/reference.mp4`,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  let encoderError = "";
  encoder.stderr!.on("data", (part) => {
    encoderError += String(part);
  });
  const completed = once(encoder, "close");
  // Handle errors immediately even if the encoder fails while frames are still being captured.
  encoder.stdin!.on("error", () => {});
  const frames = Math.round(duration * 30);
  const draw = async (time: number) =>
    page.evaluate(
      (t) =>
        (
          globalThis as unknown as {
            referenceCapture: Capture;
          }
        ).referenceCapture.draw(t),
      time,
    );
  for (let i = 0; i < frames; i++) {
    await draw(i / 30);
    const frame = await page.screenshot({ type: "jpeg", quality: 95 });
    if (encoder.exitCode !== null || encoder.stdin!.destroyed)
      throw new Error(`Reference encoder stopped: ${encoderError}`);
    if (!encoder.stdin!.write(frame)) await once(encoder.stdin!, "drain");
    if (i % 300 === 0) console.log(`Frame ${i}/${frames}`);
  }
  encoder.stdin!.end();
  const [exitCode] = await completed;
  if (exitCode !== 0)
    throw new Error(`Reference encoding failed: ${encoderError}`);
  const sampleTimes = [
    ...new Set<number>(
      [
        ...timeline.segments.flatMap((s: { t0: number; t1: number }) => [
          s.t0 + (s.t1 - s.t0) * 0.3,
          s.t0 + (s.t1 - s.t0) * 0.85,
        ]),
        ...timeline.segments.slice(1).map((s: { t0: number }) => s.t0),
        duration - 0.5,
      ]
        .filter((t) => t >= 0 && t < duration)
        .map((t) => Math.round(t * 1000) / 1000),
    ),
  ].sort((a, b) => a - b);
  mkdirSync(`${output}/frames`, { recursive: true });
  const images = [];
  for (const time of sampleTimes) {
    await draw(time);
    const bytes = Buffer.from(
      await page.screenshot({ type: "jpeg", quality: 90 }),
    );
    writeFileSync(`${output}/frames/${time.toFixed(3)}.jpg`, bytes);
    images.push({
      time,
      url: `data:image/jpeg;base64,${bytes.toString("base64")}`,
    });
  }
  const sheet = await browser.newPage();
  await sheet.setViewport({
    width: 1600,
    height: Math.ceil(images.length / 4) * 250,
  });
  await sheet.setContent(
    `<body style="margin:0;background:#111;color:white"><div id="grid" style="display:grid;grid-template-columns:repeat(4,400px)"></div></body>`,
  );
  await sheet.evaluate(async (images) => {
    for (const { time, url } of images) {
      const cell = document.createElement("div"),
        img = new Image();
      img.src = url;
      await img.decode();
      img.style.width = "400px";
      cell.append(img, document.createTextNode(`${time.toFixed(3)} s`));
      document.getElementById("grid")!.append(cell);
    }
  }, images);
  await sheet.screenshot({
    path: `${output}/contact-sheet.jpg`,
    fullPage: true,
  });
  if (errors.length || blocked.length)
    throw new Error(
      `Reference had browser errors or remote requests: ${JSON.stringify({ errors, blocked })}`,
    );
  const {
    probe,
    evidence: mediaEvidence,
    loudnessLog,
  } = inspectReferenceFile(`${output}/reference.mp4`, duration);
  writeFileSync(`${output}/loudness.log`, loudnessLog);
  const sourceFiles: Record<string, string> = {};
  function hashTree(directory: string) {
    for (const entry of readdirSync(resolve(source, directory), {
      withFileTypes: true,
    })) {
      const name = `${directory}/${entry.name}`;
      if (entry.isDirectory()) hashTree(name);
      else sourceFiles[name] = digest(readFileSync(resolve(source, name)));
    }
  }
  for (const directory of ["core", "styles", "sounds", "productions/sando"])
    hashTree(directory);
  writeFileSync(
    `${output}/manifest.json`,
    JSON.stringify(
      {
        complete: requestedSeconds === null,
        humanCreativeAcceptance: "unreviewed",
        source:
          "supplied Film Studio v2 reference; not the production renderer",
        referenceDurationSeconds: timeline.duration,
        capturedDurationSeconds: duration,
        frames,
        profile: "1280x720@30",
        environment: readFingerprint(),
        fonts: {
          serif: fonts.serif.sha256,
          latin: fonts.latin.sha256,
          substitution:
            "Bundled Noto Serif JP replaces original Shippori Mincho; bundled Cormorant replaces remote Cormorant. No remote fonts or pixel-parity claim.",
        },
        sourceFiles,
        inventory: inventoryReference(spec),
        productionMapping: productionReferenceMapping,
        timeline,
        sampleTimes,
        probe,
        mediaEvidence,
        artifacts: Object.fromEntries(
          ["reference.wav", "reference.mp4", "contact-sheet.jpg"].map((f) => [
            f,
            digest(readFileSync(`${output}/${f}`)),
          ]),
        ),
      },
      null,
      2,
    ),
  );
  console.log(`Reference evidence ready: ${output}`);
} finally {
  if (encoder && encoder.exitCode === null) encoder.kill("SIGTERM");
  await browser?.close();
  await new Promise<void>((accept) => server.close(() => accept()));
}
