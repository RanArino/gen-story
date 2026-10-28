import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { digestBytes } from "../contracts/canonical.js";
import type { FilmChapters, FilmTreatment } from "../contracts/types.js";
import { verifyAudio } from "../render/inputs.js";
import { renderDigest, planDigest } from "./fingerprint.js";
import { findChapterArtifact } from "../render/concat.js";
import { readFixture } from "../testing/fixtures.js";
import { operatorApproves } from "../testing/state.js";
import { createWorld } from "../testing/world.js";
import { writeJson } from "../paths.js";
import {
  preflight,
  proposalDigest,
  resolveTiming,
  type TimingInput,
} from "./timing.js";

const world = createWorld();
const treatment = readFixture<FilmTreatment>(
  "project/treatments/test-baseline.json",
);
const chapters = readFixture<FilmChapters>("project/chapters.json");
const compiled = world.service.compile({ treatment, chapters }).result!;
const artifacts = compiled.map(({ plan }) => ({
  plan,
  artifact: {
    files: {
      mp4: {
        name: "c.mp4",
        sha256: digestBytes(Buffer.from(plan.chapter.id)),
        bytes: 1,
      },
      stem: {
        name: "c.wav",
        sha256: digestBytes(Buffer.from("stem")),
        bytes: 4,
      },
    },
  },
}));

describe("audit regressions", () => {
  it("uses current Chapter membership and order, ignoring removed Plans", () => {
    const selected = { ...chapters, chapters: [chapters.chapters[1]!] };
    const result = world.service.concatPlan({
      treatment,
      chapters: selected,
      artifacts,
    });
    expect(result.errors).toEqual([]);
    expect(result.result!.chapters.map((c) => c.chapterId)).toEqual([
      selected.chapters[0]!.id,
    ]);
  });
  it("rejects a stale selected Chapter", () => {
    const selected = structuredClone(chapters);
    selected.chapters[0]!.title += " changed";
    expect(
      world.service.concatPlan({ treatment, chapters: selected, artifacts }).ok,
    ).toBe(false);
  });
  it("validates an overall-title-only change", () => {
    const result = world.service.concatPlan({
      treatment: { ...treatment, overallTitle: "\u{10ffff}" },
      chapters,
      artifacts,
    });
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "FS_GLYPH_MISSING",
        path: "/overallTitle",
      }),
    );
  });
  it("verifies the cached stem as well as the MP4", () => {
    const root = `${world.paths.state}cache/chapters/tampered/`;
    mkdirSync(root, { recursive: true });
    writeFileSync(`${root}c.mp4`, "video");
    writeFileSync(`${root}c.wav`, "tampered");
    const files = {
      mp4: {
        name: "c.mp4",
        sha256: digestBytes(Buffer.from("video")),
        bytes: 5,
      },
      stem: {
        name: "c.wav",
        sha256: digestBytes(Buffer.from("stem")),
        bytes: 4,
      },
    };
    writeFileSync(
      `${root}artifact.json`,
      JSON.stringify({ verified: true, files }),
    );
    expect(() =>
      findChapterArtifact(world.paths.state, files.mp4.sha256),
    ).toThrow();
  });
  it("does not allow applied service review recording", () => {
    const result = world.service.reviewRecord({
      candidate: "x",
      subjectDigest: digestBytes(Buffer.from("x")),
      subject: "x",
      reviewer: "reviewer",
      verdict: "accept",
      notes: "review",
      dryRun: false,
    });
    expect(result.errors[0]?.code).toBe("FS_OPERATOR_REQUIRED");
  });
  it("rejects 6020 ms rounded to 181 frames with a 6020 ms limit", () => {
    const input: TimingInput = {
      chapter: {
        id: "c",
        title: "t",
        limitMs: 6020,
        scenes: [{ sceneId: "s", durationMs: 6020 }],
      },
      chapterPath: "/chapters/0",
      fps: 30,
      titleMs: 0,
      overlapMs: 0,
      gapMs: 0,
      cut: {
        minSceneMs: 1,
        maxSceneMs: 10000,
        preferredSceneMs: 6020,
        minHoldMs: 0,
        beatMs: null,
      },
      weights: [1],
    };
    expect(preflight(input)[0]?.code).toBe("FS_PREFLIGHT_OVER_LIMIT");
    delete input.chapter.scenes[0]!.durationMs;
    expect(resolveTiming(input).runtimeMs).toBeLessThanOrEqual(6016);
  });
});

describe("audit boundary coverage", () => {
  it("reorders selected Plans, and rejects missing or duplicate selected Plans", () => {
    const reordered = {
      ...chapters,
      chapters: [...chapters.chapters].reverse(),
    };
    expect(
      world.service
        .concatPlan({ treatment, chapters: reordered, artifacts })
        .result!.chapters.map((c) => c.chapterId),
    ).toEqual(["c2", "c1"]);
    expect(
      world.service.concatPlan({
        treatment,
        chapters,
        artifacts: artifacts.slice(1),
      }).ok,
    ).toBe(false);
    expect(
      world.service.concatPlan({
        treatment,
        chapters,
        artifacts: [...artifacts, artifacts[0]!],
      }).ok,
    ).toBe(false);
  });
  it("excludes only parent revision bindings and Chapter index from render identity", () => {
    const original = compiled[0]!.plan;
    const changed = structuredClone(original);
    changed.provenance.treatment.revision++;
    changed.provenance.storyGraph.revision++;
    changed.chapter.index++;
    changed.fingerprint = digestBytes(Buffer.from("new fingerprint"));
    expect(renderDigest(changed)).toBe(renderDigest(original));
    expect(planDigest(changed)).not.toBe(planDigest(original));
    changed.provenance.scenes[0]!.sha256 = digestBytes(
      Buffer.from("changed source"),
    );
    expect(renderDigest(changed)).not.toBe(renderDigest(original));
  });
  it.each(["bgm", "event"])(
    "rejects changed %s bytes and stages approved copies",
    (kind) => {
      const dir = `${world.paths.out}audio-${kind}/`;
      mkdirSync(dir, { recursive: true });
      const asset = "source.wav";
      writeFileSync(`${dir}${asset}`, "approved");
      const input = { asset, sha256: digestBytes(Buffer.from("approved")) };
      verifyAudio(dir, [input], `${dir}stage/`);
      writeFileSync(`${dir}${asset}`, "changed");
      expect(() => verifyAudio(dir, [input])).toThrow();
    },
  );
  it("refuses an earlier-approved Plan that rounds past its limit before capturing", async () => {
    const live = createWorld({ liveEnvironment: true });
    const plan = structuredClone(
      live.service.compile({ treatment, chapters }).result![0]!.plan,
    );
    Object.assign(plan.timing.proposal, {
      limitMs: 6020,
      runtimeMs: 6020,
      remainingMs: 0,
    });
    plan.timing.proposalDigest = proposalDigest(plan.timing.proposal);
    const planFile = `${live.paths.out}plans/legacy-limit/${plan.chapter.id}.plan.json`;
    writeJson(planFile, plan);
    const result = await live.service.renderChapter({
      planFile,
      approvalId: operatorApproves(
        live.paths,
        "timing",
        plan.timing.proposalDigest,
      ),
    });
    expect(result.errors[0]).toMatchObject({
      code: "FS_PREFLIGHT_OVER_LIMIT",
      path: "/timing/proposal/runtimeMs",
    });
  });
});

it("resolves the approved video/stem pair without inspecting an unrelated audio revision", () => {
  const video = Buffer.from("pair-video");
  const wantedStem = Buffer.from("current-stem");
  for (const [name, stem, approved] of [
    ["a-pair-old", Buffer.from("damaged old stem"), Buffer.from("old stem")],
    ["b-pair-current", wantedStem, wantedStem],
  ] as const) {
    const dir = `${world.paths.state}cache/chapter-media-v2/${name}/`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}c.mp4`, video);
    writeFileSync(`${dir}c.wav`, stem);
    writeFileSync(
      `${dir}artifact.json`,
      JSON.stringify({
        verified: true,
        files: {
          mp4: {
            name: "c.mp4",
            sha256: digestBytes(video),
            bytes: video.length,
          },
          stem: {
            name: "c.wav",
            sha256: digestBytes(approved),
            bytes: approved.length,
          },
        },
      }),
    );
  }
  expect(
    findChapterArtifact(
      world.paths.state,
      digestBytes(video),
      digestBytes(wantedStem),
    ).dir,
  ).toContain("b-pair-current");
});
