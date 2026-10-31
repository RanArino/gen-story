import { digestOf } from "../contracts/canonical.js";
import type {
  FontAssetManifest,
  PlanFont,
  ResolvedRenderPlan,
  TimingProposal,
} from "../contracts/types.js";
import { painterIdentity } from "../authoring/identity.js";
import { readFingerprint } from "../env/fingerprint.js";
import { Registry } from "../registry/registry.js";
import { validateSchema } from "../contracts/schemas.js";
import { FilmFailure } from "../contracts/errors.js";
import { glyphChars } from "../fonts/samples.js";
import type { FilmRuntimePaths } from "../paths.js";
import { cinematicIdentity } from "./sources.js";
import { validateDirection } from "./validate.js";
import type { CinematicDirection } from "./types.js";
import type { PreparedScore } from "./prepare.js";

// Immutable r1 style identity; per-project options remain in the direction snapshot.
const CINEMATIC_PROFILE = {
  schema: "film.cinematic-direction@1",
  options: {
    rays: 9,
    motes: 72,
    leaves: 18,
    leafColors: ["#9bb84f", "#c3cc62", "#e1b64e", "#7ea23e", "#d98f3e"],
    light: [255, 236, 190],
    coolWash: "#5f7b94",
    warmWash: "#ffbf70",
    grain: 0.085,
    transitionGlow: 0.12,
  },
};

/** Compile authored data into the existing plan/capture/cache pipeline; no reference engine is loaded. */
export function compileCinematicFilm(
  paths: FilmRuntimePaths,
  input: CinematicDirection,
  score: PreparedScore,
): ResolvedRenderPlan {
  validateDirection(input);
  if (score.scoreDigest !== digestOf(input.score))
    throw new Error("Prepared score does not match this direction");
  if (
    [score.music, score.stem].some(
      (e) => e.durationMs !== Math.round(input.duration * 1000),
    )
  )
    throw new Error("Score duration does not match this direction");
  const direction = structuredClone(input),
    registry = new Registry(paths.state);
  const registered = ["noto-serif-jp", "cormorant-garamond"].map(
    (name) =>
      registry
        .records()
        .find(
          (r) =>
            r.entity === "font" &&
            r.id === `font.${name}` &&
            r.version === "1.0.0",
        )!,
  );
  if (registered.some((r) => !r)) throw new Error("Missing cinematic fonts");
  const manifests = registered.map((r) =>
    registry.manifest<FontAssetManifest>(r),
  );
  const copy = [
    direction.title,
    ...direction.captions.flatMap((c) => [c.text, c.sub]),
    ...direction.slates.flatMap((c) => [c.display, c.text]),
    ...[direction.titleCard, direction.credits].flatMap((c) =>
      c
        ? [
            c.display,
            c.name ?? "",
            c.tagline ?? "",
            c.taglineSub ?? "",
            ...(c.lines ?? []),
            c.footer ?? "",
          ]
        : [],
    ),
  ].join("");
  if (
    glyphChars(copy).some(
      (ch) =>
        !manifests.some((m) =>
          (m.coverage.ranges ?? []).some(
            ([a, b]) => ch.codePointAt(0)! >= a && ch.codePointAt(0)! <= b,
          ),
        ),
    )
  )
    throw new Error("Cinematic copy contains unsupported font glyphs");
  const fonts: PlanFont[] = manifests.map((m) => ({
    alias: `fs-${m.faces[0]!.sha256!.slice(7, 19)}`,
    font: { id: m.id, version: m.version },
    sha256: m.faces[0]!.sha256!,
    weight: 400,
    style: "normal",
    format: m.faces[0]!.format,
  }));
  fonts.forEach((f) => registry.readBlob(f.sha256));
  const runtimeMs = Math.round(direction.duration * 1000),
    first = Math.round(direction.scenes[0]!.t0 * 1000),
    last = Math.round(direction.scenes.at(-1)!.t1 * 1000);
  const proposal: TimingProposal = {
    schema: "film.timing-proposal@1",
    chapterId: direction.chapterId,
    limitMs: null,
    titleMs: first,
    overlapMs: 0,
    gapMs: 0,
    runtimeMs,
    remainingMs: null,
    endingMs: runtimeMs - last,
    authoredWindows: direction.scenes.map((s) => ({
      sceneId: s.id,
      startMs: Math.round(s.t0 * 1000),
      endMs: Math.round(s.t1 * 1000),
    })),
    scenes: direction.scenes.map((s) => ({
      sceneId: s.id,
      source: "user",
      durationMs: Math.round((s.t1 - s.t0) * 1000),
      minMs: 1,
    })),
  };
  const media = [
    ...Object.values(direction.assets).map((a) => ({
      asset: a.asset,
      sha256: a.sha256,
    })),
    ...[score.music, score.stem].map((a) => ({
      asset: a.path,
      sha256: a.sha256,
    })),
  ];
  const plan: ResolvedRenderPlan = {
    schema: "film.resolved-render-plan@1",
    chapter: {
      id: direction.chapterId,
      title: direction.title,
      index: 0,
      sceneIds: direction.scenes.map((s) => s.id),
    },
    profile: {
      id: "landscape-1080p30@1",
      widthPx: 1920,
      heightPx: 1080,
      fps: 30,
      video: "h264-high-yuv420p",
      audio: "aac-48000-stereo",
    },
    frameQuantization: "round-half-up@1",
    options: { forceLevel0: false, reducedMotion: direction.reducedMotion },
    timing: { proposal, proposalDigest: digestOf(proposal) },
    segments: [
      { kind: "title", sceneId: null, startMs: 0, endMs: first },
      ...proposal.authoredWindows!.map((s) => ({
        kind: "scene" as const,
        ...s,
      })),
      { kind: "title", sceneId: null, startMs: last, endMs: runtimeMs },
    ],
    layers: [
      {
        type: "cinematic",
        fonts: { serif: fonts[0]!.alias, latin: fonts[1]!.alias },
        startMs: 0,
        endMs: runtimeMs,
        direction,
      },
    ],
    texts: direction.captions.flatMap((c) => [
      {
        segment: 0,
        role: "caption" as const,
        text: c.text,
        font: [fonts[1]!.alias, fonts[0]!.alias],
        box: { x: 153.6, y: c.mid ? 480 : 820, w: 1612.8, h: 80 },
        startMs: Math.round(c.t0 * 1000),
        endMs: Math.round(c.t1 * 1000),
      },
      {
        segment: 0,
        role: "caption" as const,
        text: c.sub,
        font: [fonts[0]!.alias],
        box: { x: 153.6, y: c.mid ? 550 : 900, w: 1612.8, h: 60 },
        startMs: Math.round(c.t0 * 1000),
        endMs: Math.round(c.t1 * 1000),
      },
    ]),
    audio: {
      bgm: {
        asset: score.music.path,
        sha256: score.music.sha256,
        startMs: 0,
        durationMs: runtimeMs,
        gain: 1,
        loop: false,
        fadeInMs: 0,
        fadeOutMs: 0,
        offsetMs: 0,
      },
      events: [
        {
          asset: score.stem.path,
          sha256: score.stem.sha256,
          startMs: 0,
          durationMs: runtimeMs,
          gain: 1,
          loop: false,
          fadeInMs: 0,
          fadeOutMs: 0,
        },
      ],
    },
    fonts,
    capabilities: [],
    lock: {
      capabilities: [],
      fonts: registered.map((r, i) => ({
        id: r.id,
        version: r.version,
        manifestDigest: r.manifestDigest,
        faces: manifests[i]!.faces.map((f) => f.sha256!),
      })),
      media,
      compiler: cinematicIdentity(),
      painter: painterIdentity(),
      schemaVersion: "film-schemas@3",
      profile: "landscape-1080p30@1",
      environment: digestOf(readFingerprint()),
    },
    provenance: {
      projectId: direction.projectId,
      storyGraph: { id: direction.projectId, revision: direction.revision },
      treatment: { id: direction.projectId, revision: direction.revision },
      recipe: {
        id: "system.cinematic",
        revision: "r1",
        digest: digestOf(CINEMATIC_PROFILE),
      },
      scenes: direction.scenes.map((s) => ({
        sceneId: s.id,
        asset: direction.assets[s.image]!.asset,
        sha256: direction.assets[s.image]!.sha256,
      })),
    },
    shared: {
      worldview: "",
      colorFamily: "warm-film",
      typography: { id: registered[0]!.id, version: "1.0.0" },
    },
    warnings: [],
    fingerprint: "",
  };
  // Revision labels do not change encoded media; all actual direction/source/toolchain inputs do.
  plan.fingerprint = digestOf({
    direction: { ...direction, revision: 0 },
    score,
    lock: plan.lock,
  });
  const errors = validateSchema("urn:film-spike:resolved-render-plan", plan);
  if (errors.length) throw new FilmFailure(errors);
  return plan;
}
