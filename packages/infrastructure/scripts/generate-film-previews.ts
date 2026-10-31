// Run from the repository root: pnpm tsx packages/infrastructure/scripts/generate-film-previews.ts
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  compileFilm,
  digestBytes,
  initializeRuntime,
  recipeNames,
  renderFilmChapter,
} from "../src/index.js";

const output = fileURLToPath(
  new URL("../../../apps/web/public/film-previews/", import.meta.url),
);
const directory = mkdtempSync(`${tmpdir()}/gen-story-template-previews-`);
const photos = [
  { id: "coastal-train", caption: "海辺へ、小さな旅" },
  { id: "harbor-cafe", caption: "港のカフェでひと休み" },
  { id: "sunset-walk", caption: "夕暮れまで、ゆっくりと" },
];
try {
  const paths = initializeRuntime(directory);
  mkdirSync(`${paths.media}images`, { recursive: true });
  const media = photos.map(({ id }) => {
    const source = `${output}photos/${id}.jpg`;
    const dimensions = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "stream=width,height",
          "-of",
          "json",
          source,
        ],
        { encoding: "utf8" },
      ),
    ).streams[0];
    const path = `images/${id}.jpg`;
    copyFileSync(source, `${paths.media}${path}`);
    return {
      path,
      kind: "image" as const,
      sha256: digestBytes(readFileSync(source)),
      widthPx: dimensions.width as number,
      heightPx: dimensions.height as number,
    };
  });
  const evidence = [];
  for (const recipe of recipeNames) {
    const { compiled } = compileFilm(paths, {
      projectId: "system-template-preview",
      revision: 1,
      title: "海辺の一日",
      worldview: "A quiet coastal day",
      recipe,
      reducedMotion: false,
      chapters: [
        {
          id: "coastal-day",
          title: "海辺の一日",
          limitMs: null,
          scenes: photos.map(({ id }) => ({ sceneId: id })),
        },
      ],
      scenes: photos.map(({ id, caption }) => ({
        id,
        caption,
        asset: `images/${id}.jpg`,
        source: "Original AI-generated system demo photo",
      })),
      media,
    });
    const plan = compiled[0]!.plan;
    console.log(`Rendering ${recipe} (${plan.timing.proposal.runtimeMs} ms)`);
    const result = await renderFilmChapter(paths, plan, recipe);
    // Downsize the actual default output for gallery delivery, preserving timing and sound.
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-i",
      result.file,
      "-vf",
      "scale=1280:720",
      "-c:v",
      "libx264",
      "-crf",
      "24",
      "-preset",
      "medium",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      `${output}${recipe}.mp4`,
    ]);
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-ss",
      String(
        (plan.segments.find((s) => s.kind === "scene")!.startMs + 1800) / 1000,
      ),
      "-i",
      result.file,
      "-vf",
      "scale=1280:720",
      "-frames:v",
      "1",
      "-q:v",
      "3",
      `${output}${recipe}.jpg`,
    ]);
    evidence.push({
      recipe,
      fingerprint: plan.fingerprint,
      artifact: result.artifact,
      photos: media,
      preview: {
        sha256: digestBytes(readFileSync(`${output}${recipe}.mp4`)),
        width: 1280,
        height: 720,
      },
    });
    console.log(`Saved ${recipe}.mp4`);
  }
  writeFileSync(
    `${output}manifest.json`,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
} finally {
  rmSync(directory, { recursive: true, force: true });
}
