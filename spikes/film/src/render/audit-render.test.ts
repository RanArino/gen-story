import {
  cpSync,
  existsSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type {
  ChapterArtifact,
  ConcatPlan,
  FilmChapters,
  FilmTreatment,
  StoryGraph,
} from "../contracts/types.js";
import { operatorApproves } from "../testing/state.js";
import { readFixture } from "../testing/fixtures.js";
import { createWorld, type World } from "../testing/world.js";
import { writeJson } from "../paths.js";
import { planDigest } from "../compiler/fingerprint.js";
import { chapterCacheDir } from "./cache.js";
import { frameMd5s } from "../testing/media.js";
import { withBrowser } from "./browser.js";
import { probe } from "./ffmpeg.js";
import { verifyMp4 } from "./verify.js";
import type { ConcatArtifact } from "./concat.js";

const chrome = !!process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH);
interface Rendered {
  artifact: ChapterArtifact;
  cache: string;
}
const treatment = readFixture<FilmTreatment>(
  "project/treatments/test-baseline.json",
);
const chapters = readFixture<FilmChapters>("project/chapters.json");
chapters.chapters = chapters.chapters.map((c, i) => ({
  ...c,
  scenes: [{ sceneId: i ? "s7" : "s1", durationMs: 3020 }],
  limitMs: 6020,
}));

describe.skipIf(!chrome)("render audit", () => {
  let world: World;
  let initial: ReturnType<World["service"]["compile"]>["result"];
  const rendered: Rendered[] = [];
  const planFile = (name: string, id: string) =>
    `${world.paths.out}plans/${name}/${id}.plan.json`;
  const compile = (name: string, t = treatment, c = chapters) => {
    const result = world.service.compile({
      treatment: t,
      chapters: c,
      write: true,
      outName: name,
    });
    expect(result.errors).toEqual([]);
    return result.result!;
  };
  const render = (name: string, index: number, compiled = initial!) =>
    world.service.renderChapter({
      planFile: planFile(name, compiled[index]!.plan.chapter.id),
      approvalId: operatorApproves(
        world.paths,
        "timing",
        compiled[index]!.proposalDigest,
      ),
    });

  beforeAll(async () => {
    world = createWorld({ liveEnvironment: true });
    const { paths } = world;
    cpSync(paths.media, `${paths.state}test-media/`, { recursive: true });
    paths.media = `${paths.state}test-media/`;
    cpSync(paths.fixtures, `${paths.state}test-fixtures/`, { recursive: true });
    paths.fixtures = `${paths.state}test-fixtures/`;
    initial = compile("audit");
    for (let i = 0; i < initial.length; i++) {
      const result = await render("audit", i);
      expect(result.errors).toEqual([]);
      rendered.push(result.result as Rendered);
    }
  }, 180000);

  it.each(["bgm", "event"])(
    "rejects altered %s bytes before publishing, including cache hits",
    async (kind) => {
      const audio = initial![0]!.plan.audio;
      const asset = kind === "bgm" ? audio.bgm : audio.events[0]!;
      expect(asset).toBeDefined();
      const source = `${world.paths.media}${asset.asset}`;
      const bytes = readFileSync(source);
      try {
        writeFileSync(source, Buffer.concat([bytes, Buffer.from("tamper")]));
        expect((await render("audit", 0)).errors[0]?.code).toBe(
          "FS_DIGEST_MISMATCH",
        );
      } finally {
        writeFileSync(source, bytes);
      }
    },
  );

  it("refuses damaged cache entries, and replaces damaged or incomplete ones only by a verified render", async () => {
    const plan = initial![0]!.plan;
    const dir = chapterCacheDir(world.paths.state, plan);
    const stem = `${dir}${rendered[0]!.artifact.files.stem.name}`;
    const bytes = readFileSync(stem);
    writeFileSync(stem, "damaged");
    expect((await render("audit", 0)).errors[0]).toMatchObject({
      code: "FS_ARTIFACT_VERIFY_FAILED",
      message: expect.stringContaining("--no-cache"),
    });
    const bypassed = await world.service.renderChapter({
      planFile: planFile("audit", plan.chapter.id),
      approvalId: operatorApproves(
        world.paths,
        "timing",
        initial![0]!.proposalDigest,
      ),
      bypassCache: true,
    });
    expect(bypassed.errors).toEqual([]);
    expect(bypassed.warnings.map((w) => w.code)).toContain("FS_CACHE_CORRUPT");
    expect(readFileSync(stem)).toEqual(bytes);
    rmSync(`${dir}artifact.json`);
    const incomplete = await render("audit", 0);
    expect(incomplete.errors).toEqual([]);
    expect((incomplete.result as Rendered).cache).toBe("miss");
    expect(incomplete.warnings.map((w) => w.code)).toContain(
      "FS_CACHE_CORRUPT",
    );
    expect(((await render("audit", 0)).result as Rendered).cache).toBe("hit");
  }, 180000);

  it("reuses unaffected media after Treatment and Story Graph revisions, binding current metadata", async () => {
    const t = structuredClone(treatment);
    const c = structuredClone(chapters);
    c.chapters[1]!.scenes[0]!.durationMs = 3520;
    t.revision++;
    const revised = compile("revision", t, c);
    const reused = await render("revision", 0, revised);
    expect(reused.errors).toEqual([]);
    const binding = reused.result as Rendered;
    expect(binding.cache).toBe("hit");
    expect(binding.artifact.files).toEqual(rendered[0]!.artifact.files);
    expect(binding.artifact.planDigest).toBe(planDigest(revised[0]!.plan));
    expect(binding.artifact.planDigest).not.toBe(
      rendered[0]!.artifact.planDigest,
    );
    const originFile = `${chapterCacheDir(world.paths.state, revised[0]!.plan)}artifact.json`;
    expect(JSON.parse(readFileSync(originFile, "utf8")).planDigest).toBe(
      rendered[0]!.artifact.planDigest,
    );
    const graph = readFixture<StoryGraph>("project/story-graph.json");
    graph.revision++;
    graph.scenes.find((s) => s.id === "s7")!.caption.en += " Revised.";
    writeJson(`${world.paths.fixtures}project/story-graph-r2.json`, graph);
    t.storyGraph.revision = graph.revision;
    c.storyGraph.revision = graph.revision;
    const graphRevision = compile("graph-revision", t, c);
    const reusedAgain = await render("graph-revision", 0, graphRevision);
    expect(reusedAgain.errors).toEqual([]);
    expect((reusedAgain.result as Rendered).cache).toBe("hit");
    expect((reusedAgain.result as Rendered).artifact.files).toEqual(
      rendered[0]!.artifact.files,
    );
    expect((reusedAgain.result as Rendered).artifact.planDigest).toBe(
      planDigest(graphRevision[0]!.plan),
    );
    const changed = await render("graph-revision", 1, graphRevision);
    expect(changed.errors).toEqual([]);
    expect((changed.result as Rendered).cache).toBe("miss");
  }, 180000);

  it("removes a Chapter in the same Plan directory and validates title-only changes at both entrypoints", () => {
    const selected = { ...chapters, chapters: [chapters.chapters[1]!] };
    compile("audit", treatment, selected);
    const request = {
      treatment,
      chapters: selected,
      plansDir: `${world.paths.out}plans/audit/`,
    };
    const result = world.service.compileConcat(request);
    expect(result.errors).toEqual([]);
    expect(result.result!.chapters.map((c) => c.chapterId)).toEqual(["c2"]);
    const artifacts = initial!.map((p, i) => ({
      plan: p.plan,
      artifact: rendered[i]!.artifact,
    }));
    const unsupported = { ...treatment, overallTitle: "\u{10ffff}" };
    for (const result of [
      world.service.compileConcat({ ...request, treatment: unsupported }),
      world.service.concatPlan({
        treatment: unsupported,
        chapters: selected,
        artifacts,
      }),
    ]) {
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "FS_GLYPH_MISSING",
          path: "/overallTitle",
        }),
      );
    }
    const supported = world.service.compileConcat({
      ...request,
      treatment: { ...treatment, overallTitle: "Replacement" },
    });
    expect(supported.errors).toEqual([]);
    expect(supported.result!.chapters[0]!.artifactSha256).toBe(
      rendered[1]!.artifact.files.mp4.sha256,
    );
  });

  it.each(["mp4", "stem"] as const)(
    "rejects damaged cached %s during planning and rendering",
    async (kind) => {
      const original = initial![1]!.plan;
      const artifact = rendered[1]!.artifact;
      const request = {
        treatment,
        chapters: { ...chapters, chapters: [chapters.chapters[1]!] },
        plansDir: `${world.paths.out}plans/audit/`,
        write: true,
      };
      const built = world.service.compileConcat(request);
      expect(built.errors).toEqual([]);
      const file = `${chapterCacheDir(world.paths.state, original)}${artifact.files[kind].name}`;
      const bytes = readFileSync(file);
      try {
        writeFileSync(file, "damaged");
        expect(world.service.compileConcat(request).errors[0]?.code).toBe(
          "FS_ARTIFACT_VERIFY_FAILED",
        );
        const result = await world.service.renderConcat({
          planFile: `${request.plansDir}concat.plan.json`,
          approvalId: operatorApproves(
            world.paths,
            "concat",
            built.hashes.plan!,
          ),
        });
        expect(result.errors[0]?.code).toBe("FS_ARTIFACT_VERIFY_FAILED");
        expect(existsSync(`${world.paths.out}artifacts/audit/concat.mp4`)).toBe(
          false,
        );
      } finally {
        writeFileSync(file, bytes);
      }
    },
  );

  it("concatenates reordered Chapters at frame/sample offsets and plays and seeks the downloaded film", async () => {
    const c = { ...chapters, chapters: [...chapters.chapters].reverse() };
    compile("joined", treatment, c);
    const built = world.service.compileConcat({
      treatment,
      chapters: c,
      plansDir: `${world.paths.out}plans/joined/`,
      write: true,
    });
    expect(built.errors).toEqual([]);
    const plan = built.result as ConcatPlan;
    expect(plan.schema).toBe("film.concat-plan@2");
    expect(plan.chapters.map((c) => c.chapterId)).toEqual(["c2", "c1"]);
    const result = await world.service.renderConcat({
      planFile: `${world.paths.out}plans/joined/concat.plan.json`,
      approvalId: operatorApproves(world.paths, "concat", built.hashes.plan!),
    });
    expect(result.errors).toEqual([]);
    const artifact = (result.result as { artifact: ConcatArtifact }).artifact;
    const file = `${world.paths.out}artifacts/joined/concat.mp4`;
    expect(await verifyMp4(file, artifact.frames, plan.profile)).toEqual([]);
    const durations = await probe(file);
    const [num, den] = durations.video!.timeBase.split("/").map(Number);
    expect(durations.video!.durationTicks * num! * 30).toBe(
      artifact.frames * den!,
    );
    expect(durations.audio!.timeBase).toBe("1/48000");
    expect(durations.audio!.durationTicks).toBe(artifact.frames * 1600);
    const frames = await frameMd5s(file);
    for (const part of artifact.parts.filter((p) => p.kind === "chapter")) {
      const own = rendered[part.chapterId === "c1" ? 0 : 1]!.artifact;
      const ownFile = `${chapterCacheDir(world.paths.state, initial![part.chapterId === "c1" ? 0 : 1]!.plan)}${own.files.mp4.name}`;
      expect(
        frames.slice(part.startFrame, part.startFrame + part.frames),
      ).toEqual(await frameMd5s(ownFile));
      expect(
        plan.chapters.find((c) => c.chapterId === part.chapterId)!.offsetMs,
      ).toBe((part.startFrame * 1000) / 30);
    }
    await withBrowser(async (browser) => {
      const page = await browser.newPage();
      await page.goto(`file://${file}`);
      await page.waitForFunction(() => {
        const doc = (
          globalThis as unknown as {
            document: {
              querySelector(s: string): { readyState: number } | null;
            };
          }
        ).document;
        return (doc.querySelector("video")?.readyState ?? 0) >= 2;
      });
      const playback = await page.evaluate(async () => {
        const video = (
          globalThis as unknown as {
            document: {
              querySelector(s: string): {
                duration: number;
                currentTime: number;
                play(): Promise<void>;
              };
            };
          }
        ).document.querySelector("video");
        video.currentTime = video.duration / 2;
        await video.play();
        return { duration: video.duration, seek: video.currentTime };
      });
      expect(playback.duration).toBeCloseTo(artifact.frames / 30, 2);
      expect(playback.seek).toBeGreaterThan(0);
      await page.close();
    });
    console.info(
      "audit rendered evidence",
      JSON.stringify({
        directory: world.paths.out,
        frames: artifact.frames,
        durationMs: plan.runtimeMs,
        chapters: plan.chapters,
      }),
    );
  }, 180000);
});
