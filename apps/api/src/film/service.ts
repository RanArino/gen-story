import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import type {
  ApplicationDependencies,
  FilmDirectionPlannerPort,
  FilmDirectionPlanRequest,
  FilmDirectionRepositoryPort,
} from "@gen-story/application";
import {
  approveFilmDirection,
  currentApprovedDirection,
  requestFilmJob,
  saveFilmTreatment,
  settlePlannedChapters,
  updateFilmDirection,
} from "@gen-story/application";
import {
  directionLocks,
  isVisibleInSceneHistory,
  transitionDirection,
  type FilmDirectionProposal,
  normalizeSceneCaptions,
  subtitleLines,
  validateFilm,
  type FilmJob,
  type FilmSubtitleMode,
  type FilmTreatment,
  type Scene,
} from "@gen-story/domain";
import type { FilmDetailDto, FilmSceneDto } from "@gen-story/shared";
import {
  ASPECT_PROFILES,
  compileFilm,
  directApprovedChapter,
  compileProjectChapter,
  prepareCinematicScore,
  lockCinematicMedia,
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

type PreparedChapter = ReturnType<typeof directApprovedChapter> & {
  timingPlan: ResolvedRenderPlan;
  proposal: ResolvedRenderPlan["timing"]["proposal"];
};
type Prepared = {
  input: ReturnType<typeof compileFilm>["input"];
  /** Chapters with a current approved AI direction, ready to render. */
  compiled: PreparedChapter[];
  /** Every Chapter's timing, including Chapters still waiting for approval. */
  timing: {
    chapterId: string;
    proposal: ResolvedRenderPlan["timing"]["proposal"];
    blocked: string | null;
  }[];
  inputDigests: Record<string, string>;
};
type ResolvedImage = {
  sceneId: string;
  title: string;
  key: string;
  asset: string;
  sha256: string;
};
const APPROVAL_REQUIRED =
  "Approve the AI direction for this Chapter before rendering.";
/** Used when no planner is wired (tests that never request direction). */
class MemoryFilmDirectionRepository implements FilmDirectionRepositoryPort {
  private rows = new Map<string, FilmDirectionProposal>();
  async list(projectId: string) {
    return [...this.rows.values()]
      .filter((p) => p.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async save(proposal: FilmDirectionProposal) {
    this.rows.set(proposal.id, proposal);
  }
  async failInterrupted() {}
}
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
    readonly direction: {
      repository: FilmDirectionRepositoryPort & {
        failInterrupted(): Promise<void>;
      };
      planner: FilmDirectionPlannerPort;
    } = {
      repository: new MemoryFilmDirectionRepository(),
      planner: {
        plan: async () => {
          throw new Error("AI film direction is not configured.");
        },
      },
    },
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
    const stored = await this.repository.get(projectId);
    if (!stored) return this.defaultTreatment(projectId);
    if (!stored.sceneCaptions) return stored;
    const treatment = {
      ...stored,
      sceneCaptions: normalizeSceneCaptions(stored.sceneCaptions) ?? {},
    };
    const sceneIds = new Set(
      (await this.scenes(projectId)).map((scene) => scene.id),
    );
    return {
      ...treatment,
      sceneCaptions: Object.fromEntries(
        Object.entries(treatment.sceneCaptions).filter(([sceneId]) =>
          sceneIds.has(sceneId),
        ),
      ),
    };
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
  /** Resolves, normalizes and locks every assigned scene's rendered image. */
  private async resolveImages(
    treatment: FilmTreatment,
    scenes: Scene[],
  ): Promise<{ images: ResolvedImage[]; media: MediaLockEntry[] }> {
    const paths = this.runtime(treatment.projectId);
    const media: MediaLockEntry[] = [];
    const images: ResolvedImage[] = [];
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
      images.push({
        sceneId: scene.id,
        title: scene.title,
        key,
        asset,
        sha256: hash,
      });
    }
    return { images, media };
  }
  /** What an AI direction was made for: exact images, their order, and the output size. */
  private directionInputDigest(
    treatment: FilmTreatment,
    chapterId: string,
    images: ResolvedImage[],
  ): string {
    const chapter = treatment.chapters.find((c) => c.id === chapterId)!;
    return digestOf({
      version: "film-direction-input@1",
      aspect: treatment.outputAspect ?? "16:9",
      scenes: chapter.scenes.map(({ sceneId }) => [
        sceneId,
        images.find((i) => i.sceneId === sceneId)?.sha256 ?? null,
      ]),
    });
  }
  async prepare(
    treatment: FilmTreatment,
    subtitles: FilmSubtitleMode = "both",
  ): Promise<Prepared> {
    const scenes = await this.scenes(treatment.projectId);
    validateFilm(
      treatment,
      scenes.map((s) => s.id),
    );
    const paths = this.runtime(treatment.projectId);
    const { images, media } = await this.resolveImages(treatment, scenes);
    const story = images.map((image) => {
      // A missing entry means the Storyboard title as the Japanese line.
      const lines = subtitleLines(
        treatment.sceneCaptions?.[image.sceneId] ?? { ja: image.title, en: "" },
        subtitles,
      );
      return {
        id: image.sceneId,
        asset: image.asset,
        caption: lines.text,
        subtitle: lines.sub,
        source: image.key,
      };
    });
    const boards = await this.deps.storyboards.findByProjectId(
      treatment.projectId,
    );
    const input = {
      ...treatment,
      worldview: boards[0]?.story ?? "",
      outputProfile: ASPECT_PROFILES[treatment.outputAspect ?? "16:9"],
      media,
      scenes: story,
    };
    const timing = compileFilm(paths, input);
    const proposals = await this.direction.repository.list(treatment.projectId);
    const compiled: PreparedChapter[] = [];
    const chapters = timing.compiled.map((c, i) => {
      const chapter = treatment.chapters[i]!;
      const approved = currentApprovedDirection(
        proposals,
        chapter.id,
        this.directionInputDigest(treatment, chapter.id, images),
      );
      if (approved)
        compiled.push({
          timingPlan: c.plan,
          proposal: c.proposal,
          ...directApprovedChapter(input, chapter, c.plan, approved.content!),
        });
      return {
        chapterId: chapter.id,
        proposal: c.proposal,
        blocked: approved ? null : APPROVAL_REQUIRED,
      };
    });
    return {
      input: timing.input,
      compiled,
      timing: chapters,
      inputDigests: Object.fromEntries(
        treatment.chapters.map((c) => [
          c.id,
          this.directionInputDigest(treatment, c.id, images),
        ]),
      ),
    };
  }

  /** Non-superseded directions plus the digests that decide whether each is still current. */
  private async directionState(
    treatment: FilmTreatment,
    inputDigests?: Record<string, string>,
  ): Promise<Pick<FilmDetailDto, "directions" | "directionInputDigests">> {
    let digests = inputDigests;
    if (!digests) {
      try {
        const { images } = await this.resolveImages(
          treatment,
          await this.scenes(treatment.projectId),
        );
        digests = Object.fromEntries(
          treatment.chapters.map((c) => [
            c.id,
            this.directionInputDigest(treatment, c.id, images),
          ]),
        );
      } catch {
        digests = {};
      }
    }
    return {
      directions: (
        await this.direction.repository.list(treatment.projectId)
      ).filter((p) => p.status !== "superseded"),
      directionInputDigests: digests,
    };
  }

  /**
   * Starts AI direction for one Chapter or the whole film. Unless `regenerate` is set, a direction
   * already made for the same photos/order/size is returned instead of calling the Agent again.
   * Returns immediately; planning runs in the background and its status is persisted.
   */
  async requestDirection(
    projectId: string,
    options: {
      scope: "film" | "chapter";
      chapterId?: string;
      regenerate: boolean;
      /** Regenerate only this photo of the Chapter's latest proposal. */
      sceneId?: string;
    },
  ): Promise<FilmDirectionProposal[]> {
    const treatment = await this.get(projectId);
    if (treatment.revision === 0)
      throw new Error("Save the Film before asking the AI for direction.");
    const targets =
      options.scope === "film"
        ? treatment.chapters.filter((c) => c.scenes.length)
        : treatment.chapters.filter((c) => c.id === options.chapterId);
    if (!targets.length)
      throw new Error(
        options.scope === "film"
          ? "Add photos to a Chapter before asking the AI for direction."
          : "Chapter not found.",
      );
    if (targets.some((c) => !c.scenes.length))
      throw new Error(
        "Add photos to this Chapter before asking the AI for direction.",
      );
    const scenes = await this.scenes(projectId);
    const { images } = await this.resolveImages(treatment, scenes);
    const digests = new Map(
      targets.map((c) => [
        c.id,
        this.directionInputDigest(treatment, c.id, images),
      ]),
    );
    const existing = await this.direction.repository.list(projectId);
    const latest = (chapterId: string) =>
      existing.find(
        (p) =>
          p.chapterId === chapterId &&
          ["generating", "proposed", "approved"].includes(p.status),
      );
    if (!options.regenerate) {
      const cached = targets.map((c) => latest(c.id));
      if (
        cached.every(
          (p, i) => p && p.inputDigest === digests.get(targets[i]!.id),
        )
      )
        return cached as FilmDirectionProposal[];
    }
    if (targets.some((c) => latest(c.id)?.status === "generating"))
      throw new Error("The AI is already working on this direction.");
    const base = options.sceneId
      ? existing.find(
          (p) =>
            p.chapterId === options.chapterId &&
            (p.status === "proposed" || p.status === "approved") &&
            p.content,
        )
      : undefined;
    if (options.sceneId && (!base || options.scope !== "chapter"))
      throw new Error("Ask the AI for this Chapter's direction first.");
    const now = new Date().toISOString();
    const requestId = randomUUID();
    const proposals: FilmDirectionProposal[] = targets.map((c) => ({
      id: randomUUID(),
      projectId,
      chapterId: c.id,
      requestId,
      scope: options.scope,
      status: "generating",
      inputDigest: digests.get(c.id)!,
      model: null,
      error: null,
      content: null,
      createdAt: now,
      updatedAt: now,
    }));
    for (const proposal of proposals)
      await this.direction.repository.save(proposal);
    const index = (id: string) =>
      treatment.chapters.findIndex((c) => c.id === id);
    const music = (chapterId: string | undefined) =>
      chapterId ? (latest(chapterId)?.content?.music ?? null) : null;
    const first = index(targets[0]!.id),
      last = index(targets.at(-1)!.id);
    const boards = await this.deps.storyboards.findByProjectId(projectId);
    const request: FilmDirectionPlanRequest = {
      scope: options.scope,
      filmTitle: treatment.title,
      story: boards[0]?.story ?? "",
      outputAspect: treatment.outputAspect ?? "16:9",
      neighbors:
        options.scope === "film"
          ? []
          : [
              ...(first > 0
                ? [
                    {
                      position: "previous" as const,
                      title: treatment.chapters[first - 1]!.title,
                      music: music(treatment.chapters[first - 1]!.id),
                    },
                  ]
                : []),
              ...(last < treatment.chapters.length - 1
                ? [
                    {
                      position: "next" as const,
                      title: treatment.chapters[last + 1]!.title,
                      music: music(treatment.chapters[last + 1]!.id),
                    },
                  ]
                : []),
            ],
      chapters: targets.map((c) => ({
        chapterId: c.id,
        title: c.title,
        locks: directionLocks(treatment, c.id, existing),
        scenes: c.scenes.map(({ sceneId }) => {
          const image = images.find((i) => i.sceneId === sceneId)!;
          return {
            sceneId,
            storyboardTitle: image.title,
            imageKey: image.key,
            keep:
              base && sceneId !== options.sceneId
                ? (base.content!.scenes.find((s) => s.sceneId === sceneId) ??
                  null)
                : null,
          };
        }),
      })),
    };
    void this.runDirection(request, proposals);
    return proposals;
  }
  private async runDirection(
    request: FilmDirectionPlanRequest,
    proposals: FilmDirectionProposal[],
  ) {
    const finish = async (
      proposal: FilmDirectionProposal,
      result:
        | { content: FilmDirectionProposal["content"]; model: string }
        | { error: string },
    ) => {
      const now = new Date().toISOString();
      if ("error" in result) {
        await this.direction.repository.save({
          ...transitionDirection(proposal, "failed", now),
          error: result.error,
        });
        return;
      }
      // Only one open proposal per Chapter: older unapproved ones are replaced.
      for (const older of await this.direction.repository.list(
        proposal.projectId,
      ))
        if (
          older.chapterId === proposal.chapterId &&
          older.status === "proposed" &&
          older.id !== proposal.id
        )
          await this.direction.repository.save(
            transitionDirection(older, "superseded", now),
          );
      await this.direction.repository.save({
        ...transitionDirection(proposal, "proposed", now),
        content: result.content,
        model: result.model,
      });
    };
    try {
      const result = await this.direction.planner.plan(request);
      const settled = settlePlannedChapters(request, result);
      for (const proposal of proposals) {
        const outcome = settled.get(proposal.chapterId)!;
        await finish(
          proposal,
          "content" in outcome
            ? { content: outcome.content, model: result.model }
            : outcome,
        );
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      for (const proposal of proposals)
        await finish(proposal, {
          error: `The AI direction failed: ${message}`,
        });
    }
  }
  async updateDirection(projectId: string, id: string, content: unknown) {
    const treatment = await this.get(projectId);
    const proposal = (await this.direction.repository.list(projectId)).find(
      (p) => p.id === id,
    );
    const chapter = treatment.chapters.find(
      (c) => c.id === proposal?.chapterId,
    );
    if (!proposal || !chapter) throw new Error("AI direction not found.");
    return updateFilmDirection(this.direction.repository, {
      projectId,
      id,
      content,
      sceneIds: chapter.scenes.map((s) => s.sceneId),
      now: new Date().toISOString(),
    });
  }
  async approveDirection(
    projectId: string,
    id: string,
    expectedRevision: number,
  ) {
    const treatment = await this.get(projectId);
    const proposal = (await this.direction.repository.list(projectId)).find(
      (p) => p.id === id,
    );
    const chapter = treatment.chapters.find(
      (c) => c.id === proposal?.chapterId,
    );
    if (!proposal || !chapter) throw new Error("AI direction not found.");
    const { images } = await this.resolveImages(
      treatment,
      await this.scenes(projectId),
    );
    return approveFilmDirection(this.direction.repository, this.repository, {
      projectId,
      id,
      currentInputDigest: this.directionInputDigest(
        treatment,
        chapter.id,
        images,
      ),
      sceneIds: chapter.scenes.map((s) => s.sceneId),
      expectedRevision,
      now: new Date().toISOString(),
    });
  }
  async detail(
    projectId: string,
    subtitles: FilmSubtitleMode = "both",
  ): Promise<FilmDetailDto> {
    const treatment = await this.get(projectId);
    const jobs = await this.repository.jobs(projectId);
    let currentAssemblyFingerprint: string | null = null;
    let preflight: FilmDetailDto["preflight"];
    let inputDigests: Record<string, string> | undefined;
    try {
      const prepared = await this.prepare(treatment, subtitles);
      inputDigests = prepared.inputDigests;
      currentAssemblyFingerprint = prepared.timing.some((c) => c.blocked)
        ? null
        : this.assemblyFingerprint(treatment, prepared);
      preflight = prepared.timing.map((c) => ({
        chapterId: c.chapterId,
        runtimeMs: c.proposal.runtimeMs,
        fingerprint:
          prepared.compiled.find((r) => r.direction.chapterId === c.chapterId)
            ?.fingerprint ?? "",
        durations: c.proposal.scenes.map((s) => ({
          sceneId: s.sceneId,
          durationMs: s.durationMs,
        })),
        error: c.blocked,
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
      ...(await this.directionState(treatment, inputDigests)),
    };
  }
  async render(
    projectId: string,
    chapterId: string | null,
    revision: number,
    subtitles: FilmSubtitleMode = "both",
  ): Promise<FilmJob> {
    const previous = this.submissions;
    let release!: () => void;
    this.submissions = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.createRender(projectId, chapterId, revision, subtitles);
    } finally {
      release();
    }
  }
  private async createRender(
    projectId: string,
    chapterId: string | null,
    revision: number,
    subtitles: FilmSubtitleMode,
  ): Promise<FilmJob> {
    const treatment = await this.get(projectId);
    if (treatment.revision !== revision || revision === 0)
      throw new Error("Save the current Film revision before rendering.");
    const prepared = await this.prepare(treatment, subtitles);
    const blocked = prepared.timing.find(
      (c) => c.blocked && (chapterId === null || c.chapterId === chapterId),
    );
    if (blocked)
      throw new Error(
        chapterId
          ? blocked.blocked!
          : "Approve the AI direction for every Chapter before rendering the whole film.",
      );
    const chapter = chapterId
      ? prepared.compiled.find((c) => c.direction.chapterId === chapterId)
      : null;
    if (chapterId && !chapter) throw new Error("Chapter not found.");
    const snapshot = chapter
      ? { chapter }
      : { treatment, chapters: prepared.compiled };
    const requested = await requestFilmJob(
      this.repository,
      {
        prepare: async () => ({
          fingerprint:
            chapter?.fingerprint ??
            this.assemblyFingerprint(treatment, prepared),
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
          await this.renderChapter(paths, chapter, job);
          return;
        } else {
          const chapters: {
            plan: ResolvedRenderPlan;
            artifact: ChapterArtifact;
          }[] = [];
          for (const c of prepared.compiled) {
            const reuse = (await this.repository.jobs(projectId)).find(
              (j) =>
                j.chapterId === c.direction.chapterId &&
                j.fingerprint === c.fingerprint &&
                j.status === "succeeded",
            );
            const stored = reuse ? this.repository.snapshot(reuse.id) : null;
            const cached = stored ? (JSON.parse(stored) as Snapshot) : null;
            if (cached?.artifact) {
              // Revalidate cached media before reuse; the runtime repairs corrupt cache entries.
              const checked = await renderFilmChapter(
                paths,
                cached.plan,
                reuse!.id,
              );
              chapters.push({ plan: cached.plan, artifact: checked.artifact });
              continue;
            }
            const child: FilmJob = {
              ...job,
              id: randomUUID(),
              chapterId: c.direction.chapterId,
              fingerprint: c.fingerprint,
              runtimeMs: c.proposal.runtimeMs,
              status: "queued",
              createdAt: new Date().toISOString(),
            };
            await this.repository.saveJob(
              child,
              JSON.stringify({ chapter: c }),
            );
            try {
              const rendered = await this.renderChapter(paths, c, child);
              chapters.push({
                plan: rendered.plan,
                artifact: rendered.artifact,
              });
            } catch (e) {
              await this.repository.saveJob(
                {
                  ...child,
                  status: "failed",
                  error: e instanceof Error ? e.message : String(e),
                },
                JSON.stringify({ chapter: c }),
              );
              throw e;
            }
          }
          const output = await renderFilmAssembly(
            paths,
            prepared.input,
            chapters,
            job.id,
            prepared.compiled[0]!.timingPlan,
          );
          file = output.file;
          runtimeMs = output.runtimeMs;
          this.repository.attachSnapshot(
            job.id,
            JSON.stringify({ ...snapshot, outputs: chapters }),
          );
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
  private assemblyFingerprint(treatment: FilmTreatment, prepared: Prepared) {
    return digestOf({
      version: "cinematic-assembly@1",
      chapters: prepared.compiled.map((c) => c.fingerprint),
      title: treatment.title,
      recipe: treatment.recipe,
      environment: prepared.input.environmentDigest,
    });
  }
  private async renderChapter(
    paths: ReturnType<typeof initializeRuntime>,
    chapter: PreparedChapter,
    job: FilmJob,
  ) {
    await this.repository.saveJob(
      { ...job, status: "running" },
      JSON.stringify({ chapter }),
    );
    const score = await prepareCinematicScore(paths, chapter.direction);
    lockCinematicMedia(paths, chapter.direction, [score.music, score.stem]);
    const plan = compileProjectChapter(
      paths,
      chapter.direction,
      chapter.timingPlan,
      score,
    );
    const output = await renderFilmChapter(paths, plan, job.id);
    const data = readFileSync(output.file);
    const artifactKey = `data/uploads/films/${job.projectId}/${job.id}.mp4`;
    await this.deps.objectStorage.putObject({
      key: artifactKey,
      body: data,
      contentType: "video/mp4",
    });
    this.repository.attachSnapshot(
      job.id,
      JSON.stringify({ chapter, plan, artifact: output.artifact }),
    );
    await this.repository.saveJob(
      {
        ...job,
        status: "succeeded",
        runtimeMs: output.artifact.runtimeMs,
        artifactKey,
        artifactDigest: digestBytes(data),
      },
      JSON.stringify({ chapter }),
    );
    return { ...output, plan };
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
