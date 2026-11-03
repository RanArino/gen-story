// Private supplied reference is used only to author this comparison input, never by production code.
// pnpm tsx packages/infrastructure/scripts/render-cinematic-comparison.ts [output-directory] [--frames-only]
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  initializeRuntime,
  runtimeRoot,
  digestBytes,
  compileCinematicFilm,
  prepareCinematicScore,
  lockCinematicMedia,
  renderFilmChapter,
  type CinematicDirection,
} from "../src/index.js";
import { startServer } from "../src/render/server.js";
import { withBrowser, openPlan } from "../src/render/browser.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const source = resolve(repo, "film-making-idea/film-studio");
const destination =
  process.argv[2] && !process.argv[2]!.startsWith("--")
    ? process.argv[2]!
    : "data/film/q2-cinematic-comparison";
const paths = initializeRuntime(resolve(repo, destination));
const { loadFilm } = await import(pathToFileURL(`${source}/core/load.js`).href);
const original = JSON.parse(
  readFileSync(`${source}/productions/sando/film.spec.json`, "utf8"),
);
const { timeline: tl } = await loadFilm(original);
mkdirSync(`${paths.media}images`, { recursive: true });
const assets: CinematicDirection["assets"] = {};
for (const [id, value] of Object.entries(tl.assets) as [
  string,
  { src: string },
][]) {
  const file = `${source}/productions/sando/${value.src}`,
    bytes = readFileSync(file),
    asset = `images/${id}.jpg`;
  const { streams } = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=width,height",
        "-of",
        "json",
        file,
      ],
      { encoding: "utf8" },
    ),
  );
  copyFileSync(file, `${paths.media}${asset}`);
  assets[id] = {
    asset,
    sha256: digestBytes(bytes),
    widthPx: streams[0].width,
    heightPx: streams[0].height,
  };
}
const cleanCard = (card: Record<string, unknown> | null) => {
  if (!card) return null;
  const result = { ...card };
  delete result.button;
  return result;
};
const d = {
  schema: "film.cinematic-direction@1",
  projectId: "cinematic-comparison",
  chapterId: "sando-full",
  revision: 1,
  title: "参道",
  seed: tl.seed,
  duration: tl.duration,
  reducedMotion: false,
  assets,
  scenes: tl.scenes.map((s: Record<string, unknown>) => {
    const result = { ...s };
    delete result.subject;
    return result;
  }),
  params: tl.params,
  options: tl.style.options,
  steps: tl.steps,
  captions: tl.captions.map((c: Record<string, unknown>) => ({
    t0: c.t0,
    t1: c.t1,
    text: c.text,
    sub: c.sub ?? "",
    mid: c.mid ?? false,
  })),
  titleCard: cleanCard(tl.title),
  credits: cleanCard(tl.credits),
  slates: tl.slates.map((s: Record<string, unknown>) => ({
    display: s.display,
    text: s.text,
    show: s.show,
  })),
  score: {
    seed: tl.seed,
    duration: tl.duration,
    events: tl.events,
    beds: tl.beds,
    master: tl.master,
    mix: { buses: tl.mix.buses, reverb: tl.mix.reverb },
  },
} as CinematicDirection;
if (!existsSync(`${paths.media}media-lock.json`))
  copyFileSync(
    `${runtimeRoot}assets/media-lock.json`,
    `${paths.media}media-lock.json`,
  );
lockCinematicMedia(paths, d);
writeFileSync(`${paths.out}direction.json`, JSON.stringify(d, null, 2));
console.log("Synthesizing production music and sound stems");
const score = await prepareCinematicScore(paths, d);
lockCinematicMedia(paths, d, [score.music, score.stem]);
const plan = compileCinematicFilm(paths, d, score);
writeFileSync(`${paths.out}plan.json`, JSON.stringify(plan, null, 2));
const times = [
  3, 8.5, 15.4, 25.3, 26.75, 31.2, 41.65, 43.25, 48, 59, 60.75, 68.95, 78,
  86.275, 94.6, 101.2,
];
const server = await startServer(paths);
try {
  await withBrowser(async (browser) => {
    const p = await openPlan(browser, server.origin, "plan.json");
    mkdirSync(`${paths.out}frames`, { recursive: true });
    const snapshots = [];
    for (const t of times) {
      const bytes = await p.frame(t * 1000);
      writeFileSync(`${paths.out}frames/${t}.png`, bytes);
      snapshots.push({
        t,
        sha: digestBytes(bytes),
        url: `data:image/png;base64,${bytes.toString("base64")}`,
      });
    }
    // Seeking backwards must reproduce every source/effect/grain frame exactly.
    for (const entry of [...snapshots].reverse())
      if (digestBytes(await p.frame(entry.t * 1000)) !== entry.sha)
        throw new Error(`Nondeterministic cinematic frame at ${entry.t}`);
    if (p.blocked.length)
      throw new Error(`Unexpected remote requests: ${p.blocked.join(",")}`);
    const reduced = structuredClone(d);
    reduced.reducedMotion = true;
    reduced.scenes = [
      {
        ...reduced.scenes[1]!,
        t0: 0,
        t1: reduced.duration,
        fadeIn: 0.2,
        fadeOut: 0.2,
        bob: 2,
      },
    ];
    reduced.captions = [];
    reduced.slates = [];
    reduced.titleCard = null;
    reduced.credits = null;
    for (const name of Object.keys(
      reduced.params,
    ) as (keyof typeof reduced.params)[])
      reduced.params[name] = [[0, name === "speed" ? 1 : 0.3]];
    const reducedPlan = compileCinematicFilm(paths, reduced, score);
    writeFileSync(`${paths.out}reduced.plan.json`, JSON.stringify(reducedPlan));
    const reducedPage = await openPlan(
      browser,
      server.origin,
      "reduced.plan.json",
    );
    if (
      digestBytes(await reducedPage.frame(5000)) !==
      digestBytes(await reducedPage.frame(8000))
    )
      throw new Error("Reduced motion did not hold camera/effect positions");
    await reducedPage.page.close();
    const sheet = await browser.newPage();
    await sheet.setViewport({ width: 1600, height: 1000 });
    await sheet.setContent(
      '<body style="margin:0;background:#111;color:white"><div id="grid" style="display:grid;grid-template-columns:repeat(4,400px)"></div></body>',
    );
    await sheet.evaluate(async (entries) => {
      for (const { t, url } of entries) {
        const cell = document.createElement("div"),
          img = new Image();
        img.src = url;
        await img.decode();
        img.style.width = "400px";
        cell.append(img, document.createTextNode(`${t}s`));
        document.getElementById("grid")!.append(cell);
      }
    }, snapshots);
    await sheet.screenshot({
      path: `${paths.out}contact-sheet.png`,
      fullPage: true,
    });
    writeFileSync(
      `${paths.out}frame-evidence.json`,
      JSON.stringify(
        {
          snapshots: snapshots.map(({ t, sha }) => ({ t, sha })),
          backwardsReplay: true,
          reducedMotionStable: true,
          blocked: p.blocked,
        },
        null,
        2,
      ),
    );
  });
} finally {
  await server.close();
}
console.log(`Production contact sheet: ${paths.out}contact-sheet.png`);
if (!process.argv.includes("--frames-only")) {
  const result = await renderFilmChapter(paths, plan, "cinematic-q2");
  console.log(`Production film: ${result.file}`);
  writeFileSync(
    `${paths.out}render-result.json`,
    JSON.stringify(result, null, 2),
  );
}
