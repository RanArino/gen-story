// Run from the repository root with pnpm tsx apps/api/scripts/generate-template-previews.ts --stills.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { format } from "prettier";
import {
  FILM_ASPECTS,
  createPhotoAsset,
  createProject,
  createScene,
  createStoryboard,
  type FilmAspect,
  type FilmDirectionContent,
  type FilmTemplate,
  type FilmTreatment,
} from "@gen-story/domain";
import {
  compileProjectChapter,
  digestBytes,
  digestOf,
  initializeRuntime,
  loadFilmTemplateCatalog,
  lockCinematicMedia,
  prepareCinematicScore,
} from "@gen-story/infrastructure/film";
import {
  withBrowser,
  openPlan,
} from "../../../packages/infrastructure/src/render/browser.js";
import { startServer } from "../../../packages/infrastructure/src/render/server.js";
import {
  writeJson,
  writeAtomic,
} from "../../../packages/infrastructure/src/paths.js";
import {
  openDatabase,
  migrateDatabase,
  createSqliteRepositories,
} from "../src/db";
import type { FilmDirectionPlannerPort } from "@gen-story/application";
import { resolveAgentRuntimeSelection } from "../src/agent-runtime/runtime-config";
import { runClaudeJsonGeneration } from "../src/agent-runtime/stateless/claude-json-generation";
import { runCodexJsonGeneration } from "../src/agent-runtime/stateless/codex-json-generation";
import {
  AgentFilmDirectionPlanner,
  FILM_DIRECTION_PROMPT_VERSION,
} from "../src/film/direction-planner";
import { seedLocalPrincipal } from "../src/auth/local-auth";
import { SqliteFilmDirectionRepository } from "../src/film/direction-repository";
import { SqliteFilmRepository } from "../src/film/repository";
import { FilmService } from "../src/film/service";
import { createInMemoryApplicationDependencies } from "../src/test-support/in-memory-application";

const workspace = new URL("../../../", import.meta.url);
const bundled = new URL("apps/web/public/film-previews/photos/", workspace);
const evidence = resolve("data/film/template-stills");
const output = resolve("apps/web/public/film-previews/templates");
const directionCache = resolve("data/film/template-preview-directions");
const manifestFile = join(output, "manifest.json");
const publicPath = "/film-previews/templates";
const dimensions = { "16:9": "1280:720", "9:16": "720:1280", "1:1": "720:720" };
const photos = [
  {
    id: "coastal-train",
    title: "Coastal train",
    ja: "海沿いを走る",
    en: "Following the coast",
  },
  {
    id: "harbor-cafe",
    title: "Harbor café",
    ja: "港でひと休み",
    en: "A pause by the harbor",
  },
  {
    id: "sunset-walk",
    title: "Sunset walk",
    ja: "日が沈むまで",
    en: "Until the sun goes down",
  },
];
const story =
  "A short coastal trip, from the train to the harbor to a walk at sunset.";
const createdAt = "2026-11-27T00:00:00.000Z";
const projectId = "coastal-sample";
const chapterId = "917c07fa-b06f-4ef1-8ef1-09eb87b1e66e";

/** Authored once for G1 so both renders start from identical expressive choices. */
const stillDirection: FilmDirectionContent = {
  chapterName: "海辺の一日",
  nameReason: "A day by the coast.",
  music: {
    mood: "Reflective",
    tempoBpm: 76,
    key: "D",
    mode: "major",
    instruments: ["low-swell"],
    melody: "medium",
    arc: "rise",
    fromPrevious: "continue",
  },
  scenes: photos.map(({ id, title, ja, en }, index) => ({
    sceneId: id,
    observation: title,
    camera: {
      move: index === 0 ? "pan-right" : index === 1 ? "push-in" : "pull-out",
      focus: { x: index === 0 ? 0.63 : 0.5, y: 0.5 },
      speed: 0.45,
      reason: "Keep the whole scene in view with subtle motion.",
    },
    effects: { rays: 0.05, motes: 0.15, leaves: 0, warmth: 0.2 },
    footsteps: "none",
    ambience: { wind: 0.2, stream: 0.35 },
    sounds: [],
    captions: { ja, en },
  })),
};

async function seedPhotos() {
  const deps = createInMemoryApplicationDependencies();
  await deps.projects.save(
    createProject({
      id: projectId,
      name: stillDirection.chapterName,
      organizationId: "local-org-1",
      ownerUserId: "local-user-1",
      createdAt,
      updatedAt: createdAt,
    }),
  );
  const board = {
    ...createStoryboard({
      id: "coastal-story",
      projectId,
      status: "ready",
      tone: "warm",
      stylePresetId: null,
      createdAt,
      updatedAt: createdAt,
    }),
    story,
  };
  await deps.storyboards.save(board);
  for (const [orderIndex, { id, title }] of photos.entries()) {
    const bytes = readFileSync(new URL(`${id}.jpg`, bundled));
    const { width, height } = await sharp(bytes).metadata();
    const key = `data/uploads/${id}.jpg`;
    await deps.objectStorage.putObject({
      key,
      body: bytes,
      contentType: "image/jpeg",
    });
    await deps.photoAssets.save(
      createPhotoAsset({
        id: `photo-${id}`,
        projectId,
        name: title,
        usage: "candidate",
        storageKey: key,
        mimeType: "image/jpeg",
        size: bytes.length,
        width,
        height,
        checksum: digestBytes(bytes),
        sourceKind: "upload",
        createdAt,
        updatedAt: createdAt,
      }),
    );
    await deps.scenes.save(
      createScene({
        id,
        projectId,
        storyboardId: board.id,
        orderIndex,
        status: "ready",
        title,
        description: "",
        imagePrompt: "",
        emotion: "",
        cameraDirection: "",
        lightingDirection: "",
        notes: "",
        photoAssets: [{ photoAssetId: `photo-${id}`, role: "primary" }],
        createdAt,
        updatedAt: createdAt,
      }),
    );
  }
  return deps;
}

async function waitFor<T>(read: () => Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 4800; attempt++) {
    const result = await read();
    if (result !== undefined) return result;
    await new Promise((done) => setTimeout(done, 250));
  }
  throw new Error("Timed out waiting for the Film job.");
}

async function captureStills(
  paths: ReturnType<typeof initializeRuntime>,
  chapter: Awaited<ReturnType<FilmService["prepare"]>>["compiled"][number],
  name: string,
) {
  const score = await prepareCinematicScore(paths, chapter.direction);
  lockCinematicMedia(paths, chapter.direction, [score.music, score.stem]);
  const plan = compileProjectChapter(
    paths,
    chapter.direction,
    chapter.timingPlan,
    score,
  );
  writeJson(`${paths.out}stills.json`, plan);
  const [first, second] = chapter.direction.scenes;
  const moments = {
    start: first!.t0 + 1.25,
    middle: (second!.t0 + second!.t1) / 2,
    transition: (second!.t0 + first!.t1) / 2,
  };
  const server = await startServer(paths);
  try {
    await withBrowser(async (browser) => {
      const page = await openPlan(browser, server.origin, "stills.json");
      for (const [moment, seconds] of Object.entries(moments))
        writeAtomic(
          join(evidence, `${name}-${moment}.png`),
          await page.frame(seconds * 1000),
        );
      if (page.blocked.length)
        throw new Error("The painter attempted an external request.");
    });
  } finally {
    await server.close();
  }
  return moments;
}

interface ApprovedSnapshot {
  model: string;
  inputDigest: string;
  content: FilmDirectionContent;
}

interface Preview {
  id: string;
  revision: string;
  aspect: FilmAspect;
  durationMs: number;
  mp4: string;
  poster: string;
  snapshot: string;
  directionDigest: string;
  renderFingerprint: string;
}

function readJson<T>(path: string): T | undefined {
  return existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as T)
    : undefined;
}

async function exportChapter(
  service: FilmService,
  treatment: FilmTreatment,
  deps: Awaited<ReturnType<typeof seedPhotos>>,
  directory: string,
) {
  const job = await service.render(projectId, chapterId, treatment.revision);
  const rendered = await waitFor(async () =>
    (await service.repository.jobs(projectId)).find(
      ({ id, status }) =>
        id === job.id && (status === "succeeded" || status === "failed"),
    ),
  );
  if (!rendered.artifactKey || !rendered.runtimeMs)
    throw new Error(rendered.error ?? "Missing Film export.");
  const bytes = await deps.objectStorage.getObject(rendered.artifactKey);
  if (!bytes) throw new Error("Missing Film export bytes.");
  const mp4 = join(directory, "export.mp4");
  writeFileSync(mp4, bytes);
  await deps.objectStorage.deleteObject(rendered.artifactKey);
  return { mp4, durationMs: rendered.runtimeMs };
}

function previewVideo(source: string, target: string, aspect: FilmAspect) {
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-i",
    source,
    "-vf",
    `scale=${dimensions[aspect]}`,
    "-c:v",
    "libx264",
    "-crf",
    "24",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    "-movflags",
    "+faststart",
    target,
  ]);
}

async function prepareSample(
  template: FilmTemplate,
  aspect: FilmAspect,
  planner: FilmDirectionPlannerPort,
  deps: Awaited<ReturnType<typeof seedPhotos>>,
  usePrepared: (
    service: FilmService,
    treatment: FilmTreatment,
    prepared: Awaited<ReturnType<FilmService["prepare"]>>,
    snapshot: ApprovedSnapshot,
    directory: string,
  ) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "gen-story-template-"));
  const database = openDatabase(":memory:");
  try {
    migrateDatabase(database.db);
    const repos = createSqliteRepositories(database.db);
    await seedLocalPrincipal(repos);
    await repos.projects.save((await deps.projects.findById(projectId))!);
    const repository = new SqliteFilmRepository(database.db);
    const directions = new SqliteFilmDirectionRepository(database.db);
    const service = new FilmService(deps, repository, directory, {
      repository: directions,
      planner,
    });
    const draft = await service.defaultTreatment(projectId);
    const saved = await service.save(
      {
        ...draft,
        recipe: template.id,
        outputAspect: aspect,
        chapters: [
          {
            id: chapterId,
            title: stillDirection.chapterName,
            limitMs: null,
            scenes: photos.map(({ id }) => ({ sceneId: id })),
          },
        ],
      },
      0,
    );
    const [proposal] = await service.requestDirection(projectId, {
      scope: "chapter",
      chapterId,
      regenerate: false,
    });
    const finished = await waitFor(async () =>
      (await directions.list(projectId)).find(
        ({ id, status }) => id === proposal!.id && status !== "generating",
      ),
    );
    if (finished.status !== "proposed")
      throw new Error(finished.error ?? finished.status);
    const { treatment, proposal: approved } = await service.approveDirection(
      projectId,
      finished.id,
      saved.revision,
    );
    const snapshot = {
      model: approved.model!,
      inputDigest: approved.inputDigest,
      content: approved.content!,
    };
    await usePrepared(
      service,
      treatment,
      await service.prepare(treatment),
      snapshot,
      directory,
    );
  } finally {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

const plannerFromSnapshot = (snapshot: {
  model: string;
  content: FilmDirectionContent;
}): FilmDirectionPlannerPort => ({
  plan: async () => ({
    model: snapshot.model,
    chapters: [{ chapterId, content: snapshot.content }],
  }),
});

async function main() {
  const args = process.argv.slice(2);
  const stills = args.includes("--stills");
  const templates = loadFilmTemplateCatalog()
    .list()
    .filter(({ offered }) => offered);
  if (stills) {
    const deps = await seedPhotos();
    const planner = plannerFromSnapshot({
      model: "authored-g1",
      content: stillDirection,
    });
    for (const template of templates) {
      for (const aspect of ["16:9", "9:16"] as const) {
        const name = `${template.id}-${aspect.replace(":", "x")}`;
        await prepareSample(
          template,
          aspect,
          planner,
          deps,
          async (service, treatment, prepared, _snapshot, directory) => {
            const paths = initializeRuntime(
              join(directory, digestOf(projectId).slice(7)),
            );
            const moments = await captureStills(
              paths,
              prepared.compiled[0]!,
              name,
            );
            console.log(name, JSON.stringify(moments));
            if (args.includes("--comparison") && aspect === "16:9") {
              const { mp4 } = await exportChapter(
                service,
                treatment,
                deps,
                directory,
              );
              previewVideo(mp4, join(evidence, `${name}.mp4`), aspect);
            }
          },
        );
      }
    }
    return;
  }

  const runtime = resolveAgentRuntimeSelection({
    ...process.env,
    GEN_STORY_AGENT_RUNTIME: process.env.GEN_STORY_AGENT_RUNTIME ?? "claude",
  });
  if (runtime === "api")
    throw new Error(
      "Template generation requires the local Claude or Codex runtime.",
    );
  const sourcePhotos = photos.map(({ id, title }) => ({
    id,
    title,
    digest: digestBytes(readFileSync(new URL(`${id}.jpg`, bundled))),
  }));
  const tasks = templates.flatMap((template) =>
    FILM_ASPECTS.map((aspect) => {
      // The AI never sees the frame layout, so layout defaults do not invalidate directions.
      const directed = Object.fromEntries(
        Object.entries(template).filter(([field]) => field !== "frame"),
      );
      const key = digestOf({
        template: directed,
        aspect,
        sourcePhotos,
        story,
        runtime,
        title: stillDirection.chapterName,
        promptVersion: FILM_DIRECTION_PROMPT_VERSION,
      });
      const cacheFile = join(directionCache, `${key.slice(7)}.json`);
      return {
        template,
        aspect,
        cacheFile,
        cached: readJson<ApprovedSnapshot>(cacheFile),
      };
    }),
  );
  const calls = tasks.filter(({ cached }) => !cached).length;
  console.log(
    `Planned local ${runtime} direction calls: ${calls}. ${tasks.length - calls} cached.`,
  );
  if (args.includes("--plan")) return;
  if (calls && !args.includes("--confirm-ai"))
    throw new Error(
      "Owner confirmation is required before calling the local runtime. After approval, pass --confirm-ai.",
    );

  const deps = await seedPhotos();
  const agent = new AgentFilmDirectionPlanner(
    deps.objectStorage,
    () => runtime,
    (input, parse) => runClaudeJsonGeneration(input, parse, 1),
    (input, parse) => runCodexJsonGeneration(input, parse, 1),
  );
  const previous = readJson<Preview[]>(manifestFile) ?? [];
  const manifest: Preview[] = [];
  let callCount = 0;
  for (const { template, aspect, cacheFile, cached } of tasks) {
    const planner = cached
      ? plannerFromSnapshot(cached)
      : {
          plan: (request: Parameters<FilmDirectionPlannerPort["plan"]>[0]) => {
            callCount++;
            console.log(
              `Generating ${template.id} ${aspect} (${callCount}/${calls})`,
            );
            return agent.plan(request);
          },
        };
    await prepareSample(
      template,
      aspect,
      planner,
      deps,
      async (service, treatment, prepared, snapshot, directory) => {
        const directionDigest = digestOf(snapshot);
        if (cached && digestOf(cached) !== directionDigest)
          throw new Error(
            "Cached direction no longer matches the approved snapshot.",
          );
        if (!cached) writeJson(cacheFile, snapshot);
        const chapter = prepared.compiled[0]!;
        const cachedVideo = previous.find(
          (entry) =>
            entry.id === template.id &&
            entry.revision === template.revision &&
            entry.aspect === aspect &&
            entry.directionDigest === directionDigest &&
            entry.renderFingerprint === chapter.fingerprint &&
            [entry.mp4, entry.poster, entry.snapshot].every((file) =>
              existsSync(join(output, file.split("/").at(-1)!)),
            ),
        );
        if (cachedVideo) {
          manifest.push(cachedVideo);
          console.log(`Reused ${template.id} ${aspect}`);
          return;
        }

        const name = `${template.id}-${template.revision}-${aspect.replace(":", "x")}-${chapter.fingerprint.slice(7, 19)}`;
        const result = await exportChapter(service, treatment, deps, directory);
        const mp4 = join(directory, "preview.mp4");
        const poster = join(directory, "poster.jpg");
        previewVideo(result.mp4, mp4, aspect);
        execFileSync("ffmpeg", [
          "-y",
          "-loglevel",
          "error",
          "-ss",
          String(chapter.direction.scenes[0]!.t0 + 1.25),
          "-i",
          mp4,
          "-frames:v",
          "1",
          "-q:v",
          "3",
          poster,
        ]);
        writeAtomic(join(output, `${name}.mp4`), readFileSync(mp4));
        writeAtomic(join(output, `${name}.jpg`), readFileSync(poster));
        writeAtomic(
          join(output, `${name}.json`),
          await format(JSON.stringify(snapshot), { parser: "json" }),
        );
        manifest.push({
          id: template.id,
          revision: template.revision,
          aspect,
          durationMs: result.durationMs,
          mp4: `${publicPath}/${name}.mp4`,
          poster: `${publicPath}/${name}.jpg`,
          snapshot: `${publicPath}/${name}.json`,
          directionDigest,
          renderFingerprint: chapter.fingerprint,
        });
        console.log(`Rendered ${template.id} ${aspect}`);
      },
    );
  }
  writeJson(manifestFile, manifest);
  console.log(
    `Completed ${manifest.length} previews with ${callCount} local direction calls.`,
  );
}

await main();
