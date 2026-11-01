import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProject,
  createStoryboard,
  createScene,
  createPhotoAsset,
  createGeneratedImage,
  createGenerationRequest,
  createTestGenerationBatch,
  type FilmTreatment,
} from "@gen-story/domain";
import { upsertScenes, markOriginalImageAdopted } from "@gen-story/application";
import * as filmRuntime from "@gen-story/infrastructure/film";
import { digestBytes, digestOf } from "@gen-story/infrastructure/film";
import { createInMemoryApplicationDependencies } from "../test-support/in-memory-application";
import { seedLocalPrincipal } from "../auth/local-auth";
import { openDatabase, migrateDatabase, createSqliteRepositories } from "../db";
import { buildRouter } from "../http/routes";
import { SqliteFilmRepository } from "./repository";
import { FilmService } from "./service";

const now = "2026-10-31T00:00:00.000Z";
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function fixture() {
  const deps = createInMemoryApplicationDependencies();
  await seedLocalPrincipal(deps);
  const project = createProject({
    id: "project",
    name: "Film test",
    organizationId: "local-org-1",
    ownerUserId: "local-user-1",
    createdAt: now,
    updatedAt: now,
  });
  await deps.projects.save(project);
  const board = createStoryboard({
    id: "board",
    projectId: project.id,
    status: "ready",
    tone: "warm",
    stylePresetId: null,
    createdAt: now,
    updatedAt: now,
  });
  await deps.storyboards.save(board);
  const photo = createPhotoAsset({
    id: "photo",
    projectId: project.id,
    name: "Original",
    usage: "candidate",
    storageKey: "data/uploads/original.png",
    mimeType: "image/png",
    size: 1,
    width: 1,
    height: 1,
    checksum: "hash",
    sourceKind: "upload",
    createdAt: now,
    updatedAt: now,
  });
  await deps.photoAssets.save(photo);
  const scene = createScene({
    id: "scene",
    projectId: project.id,
    storyboardId: board.id,
    orderIndex: 0,
    status: "ready",
    title: "Opening",
    description: "",
    imagePrompt: "",
    emotion: "",
    cameraDirection: "",
    lightingDirection: "",
    notes: "",
    photoAssets: [{ photoAssetId: photo.id, role: "primary" }],
    adoptedGeneratedImageId: "image",
    createdAt: now,
    updatedAt: now,
  });
  await deps.scenes.save(scene);
  const image = createGeneratedImage({
    id: "image",
    projectId: project.id,
    storyboardId: board.id,
    sceneId: scene.id,
    generationRequestId: "request",
    storageKey: "data/uploads/generated.png",
    mimeType: "image/png",
    size: 1,
    width: 1,
    height: 1,
    checksum: "imagehash",
    adoptedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  await deps.generatedImages.save(image);
  const db = openDatabase(":memory:");
  migrateDatabase(db.db);
  const repos = createSqliteRepositories(db.db);
  await seedLocalPrincipal(repos);
  await repos.projects.save(project);
  const repository = new SqliteFilmRepository(db.db);
  const directory = mkdtempSync(join(tmpdir(), "film-api-"));
  cleanups.push(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const service = new FilmService(deps, repository, directory);
  return { deps, repository, service, db, project, scene, photo, directory };
}
const treatment = (): FilmTreatment => ({
  projectId: "project",
  revision: 0,
  title: "Film",
  recipe: "quiet-cinema",
  reducedMotion: false,
  chapters: [
    {
      id: "77777777-7777-4777-8777-777777777777",
      title: "Opening",
      limitMs: 60000,
      scenes: [{ sceneId: "scene" }],
    },
  ],
});

describe("Film persistence and image selection", () => {
  it("drops caption overrides for deleted scenes from the editable treatment", async () => {
    const { service, deps } = await fixture();
    const draft = treatment();
    draft.sceneCaptions = { scene: { text: "Saved words", subtext: "" } };
    await service.save(draft, 0);
    await deps.scenes.softDelete("scene", now);
    const loaded = await service.get("project");
    expect(loaded.sceneCaptions).toEqual({});
    loaded.chapters = [];
    await expect(service.save(loaded, loaded.revision)).resolves.toMatchObject({
      revision: 2,
    });
  });

  it("binds saved Film captions to render snapshots without editing Storyboard titles", async () => {
    const { service, deps } = await fixture();
    const bytes = await sharp({
      create: { width: 64, height: 64, channels: 3, background: "#adc5bb" },
    })
      .png()
      .toBuffer();
    await deps.objectStorage.putObject({
      key: "data/uploads/generated.png",
      body: bytes,
      contentType: "image/png",
    });
    const original = await service.prepare({ ...treatment(), revision: 1 });
    const draft = treatment();
    draft.sceneCaptions = {
      scene: { text: "Our departure", subtext: "A new day" },
    };
    const saved = await service.save(draft, 0),
      prepared = await service.prepare(await service.get("project"));
    expect(prepared.compiled[0]).toHaveProperty(
      "direction.schema",
      "film.cinematic-direction@1",
    );
    expect(
      prepared.compiled[0]!.direction.captions.flatMap((t) => [t.text, t.sub]),
    ).toEqual(expect.arrayContaining(["Our departure", "A new day"]));
    expect(prepared.compiled[0]!.fingerprint).not.toBe(
      original.compiled[0]!.fingerprint,
    );
    expect((await deps.scenes.findById("scene"))!.title).toBe("Opening");
    await service.save(
      { ...saved, sceneCaptions: { scene: { text: "", subtext: "" } } },
      1,
    );
    const hidden = await service.prepare(await service.get("project"));
    expect(hidden.compiled[0]!.direction.captions).toEqual([]);
  });
  it("starts with unassigned photos instead of a catch-all Chapter", async () => {
    const { service } = await fixture();
    expect((await service.get("project")).chapters).toEqual([]);
    expect(await service.sceneDetails("project")).toHaveLength(1);
  });
  it("persists unfinished organization without enabling rendering", async () => {
    const { service } = await fixture();
    const draft = treatment();
    draft.chapters[0]!.scenes = [];
    const saved = await service.save(draft, 0);
    expect(saved.chapters[0]!.scenes).toEqual([]);
    expect((await service.get("project")).chapters[0]!.scenes).toEqual([]);
    await expect(service.prepare(saved)).rejects.toThrow("at least one scene");
    const cleared = await service.save({ ...saved, chapters: [] }, 1);
    expect((await service.get("project")).chapters).toEqual([]);
    await expect(service.prepare(cleared)).rejects.toThrow(
      "at least one Chapter",
    );
  });
  it("keeps original selection and clears generated adoption", async () => {
    const { deps } = await fixture();
    const result = await markOriginalImageAdopted(deps, { sceneId: "scene" });
    expect(result.ok).toBe(true);
    expect(
      (await deps.scenes.findById("scene"))?.adoptedGeneratedImageId,
    ).toBeNull();
    expect((await deps.scenes.findById("scene"))?.originalImageSelected).toBe(
      true,
    );
    expect(
      (await deps.generatedImages.findById("image"))?.adoptedAt,
    ).toBeNull();
  });
  it("preserves an explicit original choice when Storyboard fields are saved", async () => {
    const { deps } = await fixture();
    await markOriginalImageAdopted(deps, { sceneId: "scene" });
    const scene = (await deps.scenes.findById("scene"))!;
    const saved = await upsertScenes(deps, {
      projectId: "project",
      storyboardId: "board",
      scenes: [{ ...scene, sceneId: scene.id, title: "Edited title" }],
    });
    expect(saved.ok).toBe(true);
    expect((await deps.scenes.findById("scene"))?.originalImageSelected).toBe(
      true,
    );
  });
  it("exposes only confirmed samples in the Film image picker", async () => {
    const { deps, service } = await fixture();
    await deps.generationRequests.save(
      createGenerationRequest({
        id: "request",
        projectId: "project",
        storyboardId: "board",
        sceneId: "scene",
        status: "succeeded",
        inputJson: {},
        testGenerationBatchId: "batch",
        createdAt: now,
        updatedAt: now,
      }),
    );
    const batch = createTestGenerationBatch({
      id: "batch",
      storyboardId: "board",
      status: "completed",
      createdAt: now,
    });
    await deps.testGenerationBatches.save(batch);
    expect((await service.sceneDetails("project"))[0]?.images).toEqual([]);
    await deps.testGenerationBatches.save({
      ...batch,
      confirmedGenerationRequestId: "request",
    });
    expect(
      (await service.sceneDetails("project"))[0]?.images.map((i) => i.id),
    ).toEqual(["image"]);
  });
  it("retains legacy Motion bytes while persisting original selection and current scene fields", async () => {
    const { db, deps, scene, photo } = await fixture();
    const repos = createSqliteRepositories(db.db);
    await repos.storyboards.save((await deps.storyboards.findById("board"))!);
    await repos.photoAssets.save(photo);
    await repos.scenes.save({
      ...scene,
      originalImageSelected: true,
      adoptedGeneratedImageId: null,
    });
    db.sqlite
      .prepare("UPDATE scenes SET motion_direction = ? WHERE id = ?")
      .run("legacy pan", scene.id);
    const loaded = (await repos.scenes.findById(scene.id))!;
    expect(loaded.originalImageSelected).toBe(true);
    expect(loaded).not.toHaveProperty("motionDirection");
    await repos.scenes.save({ ...loaded, title: "Updated" });
    expect(
      db.sqlite
        .prepare("SELECT motion_direction FROM scenes WHERE id = ?")
        .get(scene.id),
    ).toEqual({ motion_direction: "legacy pan" });
    expect((await repos.scenes.findById(scene.id))?.photoAssets).toEqual(
      scene.photoAssets,
    );
  });
  it("uses revision checks and restores saved state through another repository instance", async () => {
    const { service, db } = await fixture();
    const saved = await service.save(treatment(), 0);
    expect(saved.revision).toBe(1);
    expect(await new SqliteFilmRepository(db.db).get("project")).toEqual(saved);
    await expect(service.save(treatment(), 0)).rejects.toThrow(
      "another editor",
    );
    await expect(
      service.save(
        {
          ...saved,
          chapters: [
            { ...saved.chapters[0]!, scenes: [{ sceneId: "foreign" }] },
          ],
        },
        1,
      ),
    ).rejects.toThrow("unavailable");
  });
  it("fails interrupted queued/running jobs while preserving terminal history", async () => {
    const { repository } = await fixture();
    const job = {
      id: "job",
      projectId: "project",
      revision: 1,
      chapterId: "chapter",
      fingerprint: "hash",
      status: "running" as const,
      error: null,
      artifactKey: null,
      artifactDigest: null,
      runtimeMs: null,
      createdAt: now,
    };
    await repository.saveJob(job, "snapshot");
    await repository.failInterrupted();
    expect((await repository.jobs("project"))[0]?.status).toBe("failed");
    expect(repository.snapshot("job")).toBe("snapshot");
  });
});

describe("Film artifact HTTP boundary", () => {
  async function serverFixture() {
    const f = await fixture();
    const router = buildRouter({ ...f.deps, film: f.service });
    const server: Server = createServer((req, res) => {
      void router.handle(req, res).then((handled) => {
        if (!handled) {
          res.writeHead(404);
          res.end();
        }
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    cleanups.push(
      () =>
        new Promise<void>((resolve, reject) =>
          server.close((e) => (e ? reject(e) : resolve())),
        ),
    );
    const address = server.address() as { port: number };
    return { ...f, base: `http://127.0.0.1:${address.port}` };
  }
  it("round-trips captions through HTTP and rejects stale, foreign and oversized edits", async () => {
    const { base, repository } = await serverFixture();
    const draft = {
      ...treatment(),
      sceneCaptions: {
        scene: { text: "Before we leave", subtext: "A new day" },
      },
    };
    const put = (body: unknown) =>
      fetch(`${base}/api/projects/project/film`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await put({ ...draft, expectedRevision: 0 })).status).toBe(200);
    const detail = (await (
      await fetch(`${base}/api/projects/project/film`)
    ).json()) as { treatment: FilmTreatment };
    expect(detail.treatment.sceneCaptions).toEqual(draft.sceneCaptions);
    expect((await repository.get("project"))?.sceneCaptions).toEqual(
      draft.sceneCaptions,
    );
    expect((await put({ ...draft, expectedRevision: 0 })).status).toBe(409);
    expect(
      (
        await put({
          ...draft,
          expectedRevision: 1,
          sceneCaptions: { foreign: { text: "No", subtext: "" } },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await put({
          ...draft,
          expectedRevision: 1,
          sceneCaptions: { scene: { text: "x".repeat(121), subtext: "" } },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await put({
          ...draft,
          expectedRevision: 1,
          sceneCaptions: { scene: { text: "", subtext: "" } },
        })
      ).status,
    ).toBe(200);
    expect((await repository.get("project"))?.sceneCaptions?.scene?.text).toBe(
      "",
    );
  });
  it("accepts empty organization drafts through HTTP and keeps render validation", async () => {
    const { base } = await serverFixture();
    const draft = treatment();
    draft.chapters[0]!.scenes = [];
    const response = await fetch(`${base}/api/projects/project/film`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, expectedRevision: 0 }),
    });
    expect(response.status).toBe(200);
    const value = (await response.json()) as { treatment: FilmTreatment };
    expect(value.treatment.chapters[0]!.scenes).toEqual([]);
    const cleared = await fetch(`${base}/api/projects/project/film`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...draft, chapters: [], expectedRevision: 1 }),
    });
    expect(cleared.status).toBe(200);
    const render = await fetch(
      `${base}/api/projects/project/film/assembly-renders`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ revision: 2 }),
      },
    );
    expect(render.status).toBe(422);
  });
  it("supports seeking and downloads and rejects corrupt output", async () => {
    const { deps, repository, base } = await serverFixture();
    const data = Buffer.from("verified test bytes");
    await deps.objectStorage.putObject({
      key: "data/uploads/film.mp4",
      body: data,
      contentType: "video/mp4",
    });
    await repository.saveJob(
      {
        id: "job",
        projectId: "project",
        revision: 1,
        chapterId: "chapter",
        fingerprint: "hash",
        status: "succeeded",
        error: null,
        artifactKey: "data/uploads/film.mp4",
        artifactDigest: digestBytes(data),
        runtimeMs: 1000,
        createdAt: now,
      },
      "{}",
    );
    const url = `${base}/api/projects/project/film/artifacts/job`;
    const ranged = await fetch(url, { headers: { Range: "bytes=1-4" } });
    expect(ranged.status).toBe(206);
    expect(await ranged.text()).toBe(data.subarray(1, 5).toString());
    expect(
      (await fetch(`${url}?download=1`)).headers.get("content-disposition"),
    ).toContain("attachment");
    expect(
      (await fetch(url, { headers: { Range: "bytes=999-" } })).status,
    ).toBe(416);
    await deps.objectStorage.putObject({
      key: "data/uploads/film.mp4",
      body: Buffer.from("damaged"),
      contentType: "video/mp4",
    });
    expect((await fetch(url)).status).toBe(422);
  });
  it("rejects foreign projects, jobs, and image changes", async () => {
    const { deps, base } = await serverFixture();
    await deps.projects.save(
      createProject({
        id: "foreign",
        name: "Other",
        organizationId: "other-org",
        ownerUserId: "other-user",
        createdAt: now,
        updatedAt: now,
      }),
    );
    expect((await fetch(`${base}/api/projects/foreign/film`)).status).toBe(403);
    expect(
      (await fetch(`${base}/api/projects/project/film/jobs/unknown`)).status,
    ).toBe(404);
    expect(
      (
        await fetch(
          `${base}/api/projects/project/film/scenes/foreign-scene/original`,
          { method: "POST" },
        )
      ).status,
    ).toBe(404);
  });
});

it("generates missing cinematic Chapters in one complete-film job and reuses unchanged Chapters", async () => {
  const { service, repository, deps, directory } = await fixture();
  const bytes = await sharp({
    create: { width: 60, height: 120, channels: 3, background: "#adc5bb" },
  })
    .png()
    .toBuffer();
  await deps.objectStorage.putObject({
    key: "data/uploads/generated.png",
    body: bytes,
    contentType: "image/png",
  });
  const file = join(directory, "rendered.mp4");
  writeFileSync(file, "encoded fixture");
  vi.spyOn(filmRuntime, "prepareCinematicScore").mockImplementation(
    async (_paths, d) => ({
      music: {
        path: "sounds/music.wav",
        kind: "sound",
        sha256: digestOf("music"),
        durationMs: Math.round(d.duration * 1000),
      },
      stem: {
        path: "sounds/stem.wav",
        kind: "sound",
        sha256: digestOf("stem"),
        durationMs: Math.round(d.duration * 1000),
      },
      gainDb: 0,
      sourceDigest: digestOf("audio"),
      scoreDigest: digestOf(d.score),
    }),
  );
  vi.spyOn(filmRuntime, "lockCinematicMedia").mockImplementation(() => {});
  const capture = vi.spyOn(filmRuntime, "renderFilmChapter").mockImplementation(
    async (_paths, plan) =>
      ({
        file,
        cache: "miss",
        artifact: {
          runtimeMs: plan.timing.proposal.runtimeMs,
          frames: 240,
          verified: true,
          files: {
            mp4: { sha256: digestBytes(readFileSync(file)) },
            stem: { sha256: digestOf("stem") },
          },
        },
      }) as Awaited<ReturnType<typeof filmRuntime.renderFilmChapter>>,
  );
  const assemble = vi
    .spyOn(filmRuntime, "renderFilmAssembly")
    .mockResolvedValue({ file, cache: "miss", runtimeMs: 11000 });
  const saved = await service.save(treatment(), 0);
  const job = await service.render("project", null, saved.revision);
  await vi.waitFor(async () =>
    expect(
      (await repository.jobs("project")).find((j) => j.id === job.id)?.status,
    ).toBe("succeeded"),
  );
  const renderedPlan = capture.mock.calls[0]![1];
  expect(renderedPlan.layers[0]!.type).toBe("cinematic");
  expect(renderedPlan.audio.events.map((e) => e.asset)).toEqual([
    "sounds/music.wav",
    "sounds/stem.wav",
  ]);
  expect(assemble.mock.calls[0]![2][0]!.plan.fingerprint).toBe(
    renderedPlan.fingerprint,
  );
  expect(
    assemble.mock.calls[0]![4]?.capabilities.some(
      (c) => c.slot === "typography",
    ),
  ).toBe(true);
  const renamed = await service.save(
    { ...saved, title: "New overall title" },
    saved.revision,
  );
  const next = await service.render("project", null, renamed.revision);
  await vi.waitFor(async () =>
    expect(
      (await repository.jobs("project")).find((j) => j.id === next.id)?.status,
    ).toBe("succeeded"),
  );
  expect(
    (await repository.jobs("project")).filter((j) => j.chapterId !== null),
  ).toHaveLength(1);
  const changed = await service.save(
    {
      ...renamed,
      sceneCaptions: { scene: { text: "Changed words", subtext: "" } },
    },
    renamed.revision,
  );
  capture.mockRejectedValueOnce(new Error("Capture failed"));
  const failed = await service.render("project", null, changed.revision);
  await vi.waitFor(async () =>
    expect(
      (await repository.jobs("project")).find((j) => j.id === failed.id)
        ?.status,
    ).toBe("failed"),
  );
  expect(
    (await repository.jobs("project")).find((j) => j.id === failed.id)
      ?.artifactKey,
  ).toBeNull();
  expect(
    (await repository.jobs("project")).find((j) => j.id === job.id)?.status,
  ).toBe("succeeded");
});
