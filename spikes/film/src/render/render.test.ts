// Render acceptance (M4). Launches the pinned Chrome and ffmpeg, so it runs only when CHROME_PATH
// names an installed Chrome; otherwise every case is skipped and the matrix rows stay pending.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import type { ResultEnvelope } from "../contracts/envelope.js";
import { validateSchema } from "../contracts/schemas.js";
import type { ChapterArtifact, ConcatPlan, FilmChapters, FilmTreatment, ResolvedRenderPlan } from "../contracts/types.js";
import { planDigest } from "../compiler/fingerprint.js";
import { readFixture } from "../testing/fixtures.js";
import { contrast, frameMd5s, hexLuminance, luminances, mean, mp4Rgb, ncc, pcm, percentile, pngRgb, psnr } from "../testing/media.js";
import { operatorApproves } from "../testing/state.js";
import { createWorld, type World } from "../testing/world.js";
import { openPlan, withBrowser } from "./browser.js";
import type { ConcatArtifact } from "./concat.js";
import { frameCount, probe } from "./ffmpeg.js";
import { frameTime, sampleFrames, type FrameSample } from "./render-chapter.js";
import { startServer } from "./server.js";
import { verifyMp4 } from "./verify.js";

const CHROME = !!process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH);
const MINUTE = 60_000;

interface ChapterResult {
  artifact: ChapterArtifact;
  cache: "hit" | "miss";
  samples: FrameSample[];
  blocked: string[];
  fonts: string[];
  servedFonts: string[];
}
interface ConcatResult {
  artifact: ConcatArtifact;
  cache: "hit" | "miss";
  blocked: string[];
}

function ok<T>(env: ResultEnvelope<T>): T {
  expect(env.errors).toEqual([]);
  return env.result!;
}

describe.skipIf(!CHROME)("rendering", () => {
  let world: World;
  let treatment: FilmTreatment;
  let chapters: FilmChapters;
  const plans: Record<string, ResolvedRenderPlan> = {};
  const approvals: Record<string, string> = {};
  const rendered: Record<string, ChapterResult> = {};
  let concatPlan: ConcatPlan;
  let concat: ConcatResult;
  const planFile = (name: string, chapterId: string) => `${world.paths.out}plans/${name}/${chapterId}.plan.json`;
  const artifactFile = (name: string, file: string) => `${world.paths.out}artifacts/${name}/${file}`;

  beforeAll(async () => {
    world = createWorld({ liveEnvironment: true });
    treatment = readFixture<FilmTreatment>("project/treatments/test-baseline.json");
    chapters = readFixture<FilmChapters>("project/chapters.json");
    for (const c of ok(world.service.compile({ treatment, chapters, write: true, outName: "baseline" }))) {
      plans[c.plan.chapter.id] = c.plan;
      approvals[c.plan.chapter.id] = operatorApproves(world.paths, "timing", c.proposalDigest);
      rendered[c.plan.chapter.id] = ok(await world.service.renderChapter({ planFile: planFile("baseline", c.plan.chapter.id), approvalId: approvals[c.plan.chapter.id]! })) as ChapterResult;
    }
    const built = world.service.compileConcat({ treatment, chapters, plansDir: `${world.paths.out}plans/baseline/`, write: true });
    concatPlan = ok(built);
    concat = ok(
      await world.service.renderConcat({ planFile: `${world.paths.out}plans/baseline/concat.plan.json`, approvalId: operatorApproves(world.paths, "concat", built.hashes.plan!) }),
    ) as ConcatResult;
  }, 20 * MINUTE);

  it("[A07] refuses to render without a timing approval bound to the proposal digest", async () => {
    const missing = await world.service.renderChapter({ planFile: planFile("baseline", "c1") });
    expect(missing.errors.map((e) => e.code)).toEqual(["FS_APPROVAL_REQUIRED"]);
    const otherChapter = await world.service.renderChapter({ planFile: planFile("baseline", "c1"), approvalId: approvals.c2! });
    expect(otherChapter.errors.map((e) => e.code)).toEqual(["FS_APPROVAL_MISMATCH"]);
    const wrongKind = operatorApproves(world.paths, "concat", plans.c1!.timing.proposalDigest);
    expect((await world.service.renderChapter({ planFile: planFile("baseline", "c1"), approvalId: wrongKind })).errors.map((e) => e.code)).toEqual(["FS_APPROVAL_MISMATCH"]);
    const concatMissing = await world.service.renderConcat({ planFile: `${world.paths.out}plans/baseline/concat.plan.json` });
    expect(concatMissing.errors.map((e) => e.code)).toEqual(["FS_APPROVAL_REQUIRED"]);
  }, 5 * MINUTE);

  it("[A08] every Chapter MP4 has the exact frame count, 1920x1080, 30 fps, and AAC 48 kHz, and opens on its title", async () => {
    for (const id of ["c1", "c2"]) {
      const plan = plans[id]!;
      const file = artifactFile("baseline", `${id}.mp4`);
      const frames = frameCount(plan.timing.proposal.runtimeMs, 30);
      expect(await verifyMp4(file, frames, plan.profile, plan.timing.proposal.limitMs)).toEqual([]);
      expect(await probe(file)).toMatchObject({ video: { codec: "h264", width: 1920, height: 1080, rate: "30/1", frames }, audio: { codec: "aac", sampleRate: 48000, channels: 2 } });
      expect(rendered[id]!.artifact).toMatchObject({ frames, verified: true });
      expect(plan.segments[0]).toMatchObject({ kind: "title", startMs: 0 });
    }
    const server = await startServer(world.paths);
    try {
      await withBrowser(async (browser) => {
        for (const id of ["c1", "c2"]) {
          const page = await openPlan(browser, server.origin, `plans/baseline/${id}.plan.json`);
          const drawn = await page.draw(plans[id]!.segments[0]!.endMs / 2);
          expect(drawn.map((t) => [t.role, t.text])).toEqual([["title", plans[id]!.chapter.title]]);
        }
      });
    } finally {
      await server.close();
    }
  }, 5 * MINUTE);

  it("[A09] the concatenation has the formula runtime, darkens at each join, and reuses Chapter frames exactly", async () => {
    const { artifact } = concat;
    const titleFrames = frameCount(concatPlan.overallTitle.titleMs, 30);
    const holdFrames = frameCount(concatPlan.connection.darkenMs, 30);
    expect(concatPlan.connection.darkenMs).toBe(800);
    expect(concatPlan.runtimeMs).toBe(concatPlan.overallTitle.titleMs + plans.c1!.timing.proposal.runtimeMs + plans.c2!.timing.proposal.runtimeMs + 800);
    const expected = titleFrames + rendered.c1!.artifact.frames + holdFrames + rendered.c2!.artifact.frames;
    expect(artifact.frames).toBe(expected);
    expect(await verifyMp4(artifactFile("baseline", "concat.mp4"), expected, concatPlan.profile)).toEqual([]);

    const joined = await frameMd5s(artifactFile("baseline", "concat.mp4"));
    for (const part of artifact.parts.filter((p) => p.kind === "chapter")) {
      const own = await frameMd5s(artifactFile("baseline", `${part.chapterId}.mp4`));
      const titleOnly = frameCount(plans[part.chapterId!]!.segments[0]!.endMs, 30);
      expect(joined.slice(part.startFrame, part.startFrame + titleOnly)).toEqual(own.slice(0, titleOnly));
      expect(joined.slice(part.startFrame, part.startFrame + part.frames)).toEqual(own);
    }
    for (const join of artifact.parts.filter((p) => p.kind === "join")) {
      const before = rendered[join.chapterId!]!.artifact;
      const last = mean(luminances(await mp4Rgb(artifactFile("baseline", `${join.chapterId}.mp4`), before.frames - 1)));
      const held: number[] = [];
      for (const f of [0.25, 0.5, 0.75, 1]) held.push(mean(luminances(await mp4Rgb(artifactFile("baseline", "concat.mp4"), join.startFrame + Math.round(f * (join.frames - 1))))));
      for (const l of held) expect(l).toBeLessThan(last);
      expect(held).toEqual([...held].sort((a, b) => b - a));
    }
  }, 5 * MINUTE);

  it("[A10] the concatenated BGM follows one continuous track across each join instead of restarting", async () => {
    const bgm = `${world.paths.media}${concatPlan.audio.bgm.asset}`;
    const film = artifactFile("baseline", "concat.mp4");
    const observations = [];
    for (const chapter of concatPlan.chapters.slice(1)) {
      for (const after of [1000, 5000, 10000]) {
        const at = chapter.offsetMs + after;
        const window = await pcm(film, at, 500);
        const continuous = ncc(window, await pcm(bgm, at, 500));
        const restarted = ncc(window, await pcm(bgm, after, 500));
        observations.push({ at, continuous, restarted });
        expect(continuous).toBeGreaterThanOrEqual(0.99);
        expect(restarted).toBeLessThanOrEqual(0.95);
      }
    }
    console.info("[A10] BGM correlation", JSON.stringify(observations));
  }, 5 * MINUTE);

  it("[A11] changing one scene rebuilds only its Chapter and the concatenation", async () => {
    const edited: FilmChapters = structuredClone(chapters);
    edited.chapters[1]!.scenes.find((s) => s.sceneId === "s7")!.durationMs = 6500;
    const recompiled = ok(world.service.compile({ treatment, chapters: edited, write: true, outName: "baseline-s7" }));
    const c1 = recompiled.find((c) => c.plan.chapter.id === "c1")!;
    const c2 = recompiled.find((c) => c.plan.chapter.id === "c2")!;
    expect(c1.plan.fingerprint).toBe(plans.c1!.fingerprint);
    expect(c2.plan.fingerprint).not.toBe(plans.c2!.fingerprint);

    const again1 = ok(await world.service.renderChapter({ planFile: planFile("baseline-s7", "c1"), approvalId: approvals.c1! })) as ChapterResult;
    expect(again1.cache).toBe("hit");
    expect(again1.artifact.files.mp4.sha256).toBe(rendered.c1!.artifact.files.mp4.sha256);
    const again2 = ok(await world.service.renderChapter({ planFile: planFile("baseline-s7", "c2"), approvalId: operatorApproves(world.paths, "timing", c2.proposalDigest) })) as ChapterResult;
    expect(again2.cache).toBe("miss");

    const built = world.service.compileConcat({ treatment, chapters: edited, plansDir: `${world.paths.out}plans/baseline-s7/`, write: true });
    const plan = ok(built);
    expect(plan.fingerprint).not.toBe(concatPlan.fingerprint);
    expect(plan.chapters[0]!.artifactSha256).toBe(concatPlan.chapters[0]!.artifactSha256);
    const rebuilt = ok(
      await world.service.renderConcat({ planFile: `${world.paths.out}plans/baseline-s7/concat.plan.json`, approvalId: operatorApproves(world.paths, "concat", built.hashes.plan!) }),
    ) as ConcatResult;
    expect(rebuilt.cache).toBe("miss");
    expect(rebuilt.artifact.runtimeMs).toBe(concat.artifact.runtimeMs + 500);
  }, 10 * MINUTE);

  it("[A12] each Chapter's metadata lists what the artifact was built from", () => {
    for (const id of ["c1", "c2"]) {
      const plan = plans[id]!;
      const meta = JSON.parse(readFileSync(artifactFile("baseline", `${id}.json`), "utf8")) as ChapterArtifact;
      expect(validateSchema("urn:film-spike:chapter-artifact", meta)).toEqual([]);
      expect(meta).toMatchObject({
        chapterId: id,
        order: plan.chapter.index,
        title: plan.chapter.title,
        recipe: plan.provenance.recipe,
        capabilityLock: plan.lock.capabilities,
        fonts: plan.lock.fonts,
        bgm: { asset: plan.audio.bgm.asset, sha256: plan.audio.bgm.sha256 },
        planDigest: planDigest(plan),
        fingerprint: plan.fingerprint,
        environment: plan.lock.environment,
        runtimeMs: plan.timing.proposal.runtimeMs,
        verified: true,
      });
      expect(meta.scenes.map((s) => s.sceneId)).toEqual(plan.chapter.sceneIds);
      expect(meta.scenes).toEqual(plan.provenance.scenes);
      expect(meta.fonts.flatMap((f) => f.faces).length).toBeGreaterThan(0);
      const lockedMedia = new Map(plan.lock.media.map((m) => [m.asset, m.sha256]));
      for (const s of meta.scenes) expect(lockedMedia.get(s.asset)).toBe(s.sha256);
    }
  }, 5 * MINUTE);

  it("[A14] every caption meets 4.5:1 against its sampled backing and sits inside the 90% title-safe area", async () => {
    const safe = { x0: 1920 * 0.05, y0: 1080 * 0.05, x1: 1920 * 0.95, y1: 1080 * 0.95 };
    const results: { chapter: string; text: string; mean: number; p95: number }[] = [];
    const server = await startServer(world.paths);
    try {
      await withBrowser(async (browser) => {
        for (const id of ["c1", "c2"]) {
          const page = await openPlan(browser, server.origin, `plans/baseline/${id}.plan.json`);
          const windows = plans[id]!.texts.filter((t) => t.role === "caption");
          for (const w of windows) {
            const t = (w.startMs + w.endMs) / 2;
            const caption = (await page.draw(t)).find((m) => m.role === "caption" && m.text === w.text)!;
            expect(caption, w.text).toBeDefined();
            const b = caption.box;
            expect(b.x).toBeGreaterThanOrEqual(safe.x0);
            expect(b.y).toBeGreaterThanOrEqual(safe.y0);
            expect(b.x + b.w).toBeLessThanOrEqual(safe.x1);
            expect(b.y + b.h).toBeLessThanOrEqual(safe.y1);
            const backing = luminances(await pngRgb(await page.frame(t, { omitRoles: ["caption"] }), b));
            const text = hexLuminance(caption.color);
            const worst = text > mean(backing) ? percentile(backing, 95) : percentile(backing, 5);
            results.push({ chapter: id, text: w.text, mean: contrast(text, mean(backing)), p95: contrast(text, worst) });
          }
        }
      });
    } finally {
      await server.close();
    }
    console.info("[A14] caption contrast", JSON.stringify(results.map((r) => ({ ...r, mean: Number(r.mean.toFixed(2)), p95: Number(r.p95.toFixed(2)) }))));
    // The backing is the caption box with captions omitted (scrim kept); the worst case is the
    // 95th-percentile pixel luminance on the text's opposite side.
    expect(results.filter((r) => r.p95 < 4.5).map((r) => `${r.chapter} ${r.text}: ${r.p95.toFixed(2)}:1`)).toEqual([]);
  }, 5 * MINUTE);

  it("[A16] capture is offline, loads exactly the pinned fonts, and preview and render use the same font bytes", async () => {
    for (const id of ["c1", "c2"]) {
      const plan = plans[id]!;
      const r = rendered[id]!;
      expect(r.blocked).toEqual([]);
      expect(r.fonts).toEqual([...new Set(plan.fonts.map((f) => f.alias))].sort());
      const pinned = [...new Set(plan.fonts.map((f) => f.sha256))].sort();
      expect([...new Set(r.servedFonts)].sort()).toEqual(pinned);
      const server = await startServer(world.paths);
      try {
        await withBrowser(async (browser) => {
          const preview = await openPlan(browser, server.origin, `plans/baseline/${id}.plan.json`, "preview");
          expect(preview.blocked).toEqual([]);
          expect(await preview.fonts()).toEqual(r.fonts);
        });
        expect([...new Set(server.log.fonts)].sort()).toEqual(pinned);
      } finally {
        await server.close();
      }
    }
    expect(concat.blocked).toEqual([]);
  }, 5 * MINUTE);

  it("[A19] rendering the same Plan again with the cache bypassed reproduces the sampled frames", async () => {
    const first = rendered.c2!;
    const again = ok(await world.service.renderChapter({ planFile: planFile("baseline", "c2"), approvalId: approvals.c2!, bypassCache: true })) as ChapterResult;
    expect(again.cache).toBe("miss");
    expect(again.samples.map((s) => s.frame)).toEqual(sampleFrames(first.artifact.frames));
    expect(again.samples).toEqual(first.samples);
    console.info("[A19] MP4 bytes reproduced:", again.artifact.files.mp4.sha256 === first.artifact.files.mp4.sha256, "stem:", again.artifact.files.stem.sha256 === first.artifact.files.stem.sha256);

    const tampered = structuredClone(plans.c2!);
    tampered.lock.environment = `sha256:${"0".repeat(64)}`;
    mkdirSync(`${world.paths.out}plans/tampered/`, { recursive: true });
    writeFileSync(planFile("tampered", "c2"), JSON.stringify(tampered));
    const mismatch = await world.service.renderChapter({ planFile: planFile("tampered", "c2"), approvalId: approvals.c2! });
    expect(mismatch.errors.map((e) => e.code)).toEqual(["FS_ENV_MISMATCH"]);
  }, 5 * MINUTE);

  it("[A20] the preview loads the same Plan digest and matches the final frames", async () => {
    const plan = plans.c1!;
    const file = artifactFile("baseline", "c1.mp4");
    const values: number[] = [];
    const server = await startServer(world.paths);
    try {
      await withBrowser(async (browser) => {
        const preview = await openPlan(browser, server.origin, "plans/baseline/c1.plan.json", "preview");
        expect(preview.digest).toBe(planDigest(plan));
        expect(preview.digest).toBe(rendered.c1!.artifact.planDigest);
        for (const frame of sampleFrames(rendered.c1!.artifact.frames)) {
          const value = await psnr(await preview.frame(frameTime(frame, 30)), file, frame);
          values.push(value);
          expect(value, `frame ${frame}`).toBeGreaterThanOrEqual(35);
        }
      });
    } finally {
      await server.close();
    }
    console.info("[A20] preview PSNR dB", values.map((v) => v.toFixed(1)).join(" "));
  }, 5 * MINUTE);
});
