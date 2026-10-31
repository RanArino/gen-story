import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type { ApplicationDependencies } from "@gen-story/application";
import { requestFilmJob, saveFilmTreatment } from "@gen-story/application";
import {
  isVisibleInSceneHistory,
  validateFilm,
  type FilmJob,
  type FilmTreatment,
  type Scene,
} from "@gen-story/domain";
import type { FilmDetailDto, FilmSceneDto } from "@gen-story/shared";
import {
  compileFilm,
  digestBytes,
  digestOf,
  initializeRuntime,
  renderFilmChapter,
  renderFilmAssembly,
  type ChapterArtifact,
  type ResolvedRenderPlan,
  type MediaLockEntry,
} from "@gen-story/infrastructure/film";
import { SqliteFilmRepository } from "./repository";

type Prepared = ReturnType<typeof compileFilm>;
type Snapshot = { plan: ResolvedRenderPlan; artifact?: ChapterArtifact };
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

export class FilmService {
  private pending: (() => Promise<void>)[] = [];
  private running = false;
  private submissions = Promise.resolve();
  constructor(
    private deps: Pick<
      ApplicationDependencies,
      | "projects"
      | "storyboards"
      | "scenes"
      | "photoAssets"
      | "generatedImages"
      | "generationRequests"
      | "testGenerationBatches"
      | "objectStorage"
    >,
    readonly repository: SqliteFilmRepository,
    private root = resolve(repositoryRoot, "data/film"),
  ) {}
  private runtime(projectId: string) {
    // Project IDs are validated at the HTTP boundary; hash them again for filesystem isolation.
    const paths = initializeRuntime(
      `${this.root}/${digestOf(projectId).slice(7)}`,
    );
    return paths;
  }
  async scenes(projectId: string): Promise<Scene[]> {
    const boards = await this.deps.storyboards.findByProjectId(projectId);
    return boards.length
      ? (await this.deps.scenes.findByStoryboardId(boards[0]!.id)).sort(
          (a, b) => a.orderIndex - b.orderIndex,
        )
      : [];
  }
  async defaultTreatment(projectId: string): Promise<FilmTreatment> {
    const project = await this.deps.projects.findById(projectId);
    return {
      projectId,
      revision: 0,
      title: project?.name ?? "Film",
      recipe: "quiet-cinema",
      reducedMotion: false,
      chapters: [],
    };
  }
  async get(projectId: string): Promise<FilmTreatment> {
    return (
      (await this.repository.get(projectId)) ?? this.defaultTreatment(projectId)
    );
  }
  async save(treatment: FilmTreatment, expectedRevision: number) {
    return saveFilmTreatment(
      this.repository,
      treatment,
      (await this.scenes(treatment.projectId)).map((s) => s.id),
      expectedRevision,
    );
  }
  async sceneDetails(projectId: string): Promise<FilmSceneDto[]> {
    return Promise.all(
      (await this.scenes(projectId)).map(async (scene) => {
        const primary = scene.photoAssets.find((p) => p.role === "primary");
        const photo = primary
          ? await this.deps.photoAssets.findById(primary.photoAssetId)
          : null;
        const batches =
          await this.deps.testGenerationBatches.listByStoryboardId(
            scene.storyboardId,
          );
        const confirmed = new Set(
          batches.flatMap((b) =>
            b.confirmedGenerationRequestId
              ? [b.confirmedGenerationRequestId]
              : [],
          ),
        );
        const requests = await this.deps.generationRequests.findBySceneId(
          scene.id,
        );
        const hidden = new Set(
          requests
            .filter((r) => !isVisibleInSceneHistory(r, confirmed))
            .map((r) => r.id),
        );
        const images = (
          await this.deps.generatedImages.findBySceneId(scene.id)
        ).filter((image) => !hidden.has(image.generationRequestId));
        return {
          id: scene.id,
          title: scene.title,
          selectedImageId: scene.adoptedGeneratedImageId,
          original:
            photo && photo.deletedAt === null && photo.projectId === projectId
              ? { storageKey: photo.storageKey }
              : null,
          images: images.map((i) => ({ id: i.id, storageKey: i.storageKey })),
        };
      }),
    );
  }
  async prepare(treatment: FilmTreatment): Promise<Prepared> {
    const scenes = await this.scenes(treatment.projectId);
    validateFilm(
      treatment,
      scenes.map((s) => s.id),
    );
    const paths = this.runtime(treatment.projectId);
    const media: MediaLockEntry[] = [];
    const story = [];
    const used = new Set(
      treatment.chapters.flatMap((c) => c.scenes.map((s) => s.sceneId)),
    );
    for (const scene of scenes.filter((s) => used.has(s.id))) {
      let key: string | undefined;
      if (scene.adoptedGeneratedImageId) {
        const image = await this.deps.generatedImages.findById(
          scene.adoptedGeneratedImageId,
        );
        if (image && image.sceneId === scene.id) key = image.storageKey;
      } else {
        const primary = scene.photoAssets.find((p) => p.role === "primary");
        const photo = primary
          ? await this.deps.photoAssets.findById(primary.photoAssetId)
          : null;
        if (
          photo &&
          photo.projectId === treatment.projectId &&
          photo.deletedAt === null
        )
          key = photo.storageKey;
      }
      if (!key)
        throw new Error(`Choose an available image for “${scene.title}”.`);
      const bytes = await this.deps.objectStorage.getObject(key);
      if (!bytes)
        throw new Error(
          `The image for “${scene.title}” is missing. Choose another image.`,
        );
      // Normalize orientation and format before locking immutable rendering inputs.
      const { data, info } = await sharp(bytes)
        .rotate()
        .png()
        .toBuffer({ resolveWithObject: true });
      const hash = digestBytes(data);
      const asset = `images/${hash.slice(7)}.png`;
      mkdirSync(`${paths.media}images`, { recursive: true });
      writeFileSync(`${paths.media}${asset}`, data);
      media.push({
        path: asset,
        kind: "image",
        sha256: hash,
        widthPx: info.width,
        heightPx: info.height,
      });
      story.push({ id: scene.id, asset, caption: scene.title, source: key });
    }
    const boards = await this.deps.storyboards.findByProjectId(
      treatment.projectId,
    );
    return compileFilm(paths, {
      ...treatment,
      worldview: boards[0]?.story ?? "",
      media,
      scenes: story,
    });
  }
  async detail(projectId: string): Promise<FilmDetailDto> {
    const treatment = await this.get(projectId);
    const jobs = await this.repository.jobs(projectId);
    let currentAssemblyFingerprint: string | null = null;
    let preflight: FilmDetailDto["preflight"];
    try {
      const prepared = await this.prepare(treatment);
      const artifacts = prepared.compiled.map(
        (c) =>
          jobs.find(
            (j) =>
              j.chapterId === c.plan.chapter.id &&
              j.fingerprint === c.plan.fingerprint &&
              j.status === "succeeded",
          )?.artifactDigest,
      );
      if (artifacts.length && artifacts.every(Boolean))
        currentAssemblyFingerprint = digestOf({
          chapters: artifacts,
          title: treatment.title,
          recipe: treatment.recipe,
          environment: prepared.input.environmentDigest,
        });
      preflight = prepared.compiled.map((c) => ({
        chapterId: c.plan.chapter.id,
        runtimeMs: c.proposal.runtimeMs,
        fingerprint: c.plan.fingerprint,
        durations: c.proposal.scenes.map((s) => ({
          sceneId: s.sceneId,
          durationMs: s.durationMs,
        })),
        error: null,
      }));
    } catch (e) {
      preflight = treatment.chapters.map((c) => ({
        chapterId: c.id,
        runtimeMs: 0,
        fingerprint: "",
        durations: [],
        error: e instanceof Error ? e.message : String(e),
      }));
    }
    return {
      treatment,
      scenes: await this.sceneDetails(projectId),
      jobs,
      currentAssemblyFingerprint,
      preflight,
    };
  }
  async render(
    projectId: string,
    chapterId: string | null,
    revision: number,
  ): Promise<FilmJob> {
    const previous = this.submissions;
    let release!: () => void;
    this.submissions = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.createRender(projectId, chapterId, revision);
    } finally {
      release();
    }
  }
  private async createRender(
    projectId: string,
    chapterId: string | null,
    revision: number,
  ): Promise<FilmJob> {
    const treatment = await this.get(projectId);
    if (treatment.revision !== revision || revision === 0)
      throw new Error("Save the current Film revision before rendering.");
    const prepared = await this.prepare(treatment);
    const chapter = chapterId
      ? prepared.compiled.find((c) => c.plan.chapter.id === chapterId)
      : null;
    if (chapterId && !chapter) throw new Error("Chapter not found.");
    const jobs = await this.repository.jobs(projectId);
    const currentChapters: Snapshot[] = [];
    if (!chapterId) {
      for (const c of prepared.compiled) {
        const job = jobs.find(
          (j) =>
            j.chapterId === c.plan.chapter.id &&
            j.fingerprint === c.plan.fingerprint &&
            j.status === "succeeded",
        );
        if (!job)
          throw new Error(
            "Render every current Chapter before joining the film.",
          );
        const snap = JSON.parse(this.repository.snapshot(job.id)!) as Snapshot;
        if (!snap.artifact)
          throw new Error("Chapter output is unavailable. Render it again.");
        currentChapters.push({ plan: c.plan, artifact: snap.artifact });
      }
    }
    const fingerprint =
      chapter?.plan.fingerprint ??
      digestOf({
        chapters: currentChapters.map((c) => c.artifact!.files.mp4.sha256),
        title: treatment.title,
        recipe: treatment.recipe,
        environment: prepared.input.environmentDigest,
      });
    const snapshot = chapter
      ? { plan: chapter.plan }
      : { treatment, chapters: currentChapters };
    const requested = await requestFilmJob(
      this.repository,
      {
        prepare: async () => ({
          fingerprint,
          snapshot: JSON.stringify(snapshot),
          runtimeMs: chapter?.proposal.runtimeMs ?? null,
        }),
      },
      {
        id: randomUUID(),
        projectId,
        revision,
        chapterId,
        createdAt: new Date().toISOString(),
      },
    );
    if (!requested.created) return requested.job;
    const job = requested.job;
    const paths = this.runtime(projectId);
    this.pending.push(async () => {
      await this.repository.saveJob(
        { ...job, status: "running" },
        JSON.stringify(snapshot),
      );
      try {
        let file: string;
        let runtimeMs: number;
        if (chapter) {
          const output = await renderFilmChapter(paths, chapter.plan, job.id);
          file = output.file;
          runtimeMs = output.artifact.runtimeMs;
          await this.repository.saveJob(
            job,
            JSON.stringify({ plan: chapter.plan, artifact: output.artifact }),
          );
          // The immutable snapshot update is stored explicitly; upserts preserve it below.
          this.repository.attachSnapshot(
            job.id,
            JSON.stringify({ plan: chapter.plan, artifact: output.artifact }),
          );
        } else {
          const output = await renderFilmAssembly(
            paths,
            prepared.input,
            currentChapters.map((c) => ({
              plan: c.plan,
              artifact: c.artifact!,
            })),
            job.id,
          );
          file = output.file;
          runtimeMs = output.runtimeMs;
        }
        const data = readFileSync(file);
        const artifactKey = `data/uploads/films/${projectId}/${job.id}.mp4`;
        await this.deps.objectStorage.putObject({
          key: artifactKey,
          body: data,
          contentType: "video/mp4",
        });
        await this.repository.saveJob(
          {
            ...job,
            status: "succeeded",
            runtimeMs,
            artifactKey,
            artifactDigest: digestBytes(data),
          },
          JSON.stringify(snapshot),
        );
      } catch (e) {
        await this.repository.saveJob(
          {
            ...job,
            status: "failed",
            error: e instanceof Error ? e.message : String(e),
          },
          JSON.stringify(snapshot),
        );
      }
    });
    void this.drain();
    return job;
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.length) await this.pending.shift()!();
    } finally {
      this.running = false;
    }
  }
}
