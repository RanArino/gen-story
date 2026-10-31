// The deterministic compiler. Pure functions: callers pass digest-verified registry entries, font
// manifests, and the media lock. Output is one Resolved Render Plan per Chapter plus its timing
// proposal; nothing here touches the filesystem, the clock, or randomness.
import { canonicalJson, sha256Hex } from "../contracts/canonical.js";
import { filmError, FilmFailure, type FilmError } from "../contracts/errors.js";
import type {
  AudioEvent,
  ChapterSettings,
  Curves,
  FilmChapter,
  FilmChapters,
  FilmStyleRecipe,
  FilmTreatment,
  FontAssetManifest,
  LockedCapability,
  LockedFont,
  OutputProfile,
  PainterNode,
  PlanFont,
  PlanLock,
  RegistryRecord,
  ResolvedRenderPlan,
  StoryGraph,
  StoryScene,
  TextNode,
  TimingProposal,
  VersionRef,
} from "../contracts/types.js";
import {
  CAPABILITY_ABI,
  type CapabilityInput,
  type CapabilityOutput,
  type Envelope,
} from "../capability-sdk/abi.js";
import { hasCjk } from "../capability-sdk/helpers.js";
import { glyphChars } from "../fonts/samples.js";
import type { MediaLock } from "../media/lock.js";
import { chapterFingerprint } from "./fingerprint.js";
import {
  resolveRecipe,
  type Catalog,
  type CatalogEntry,
  type ResolvedSlot,
} from "./resolve.js";
import {
  proposalDigest,
  resolveTiming,
  preflight as timingPreflight,
  type TimingInput,
} from "./timing.js";

export const COMPILER_VERSION = "film-compiler@1";
export const SCHEMA_VERSION = "film-schemas@2";

export const PROFILES: Record<string, OutputProfile> = {
  "landscape-1080p30@1": {
    id: "landscape-1080p30@1",
    widthPx: 1920,
    heightPx: 1080,
    fps: 30,
    video: "h264-high-yuv420p",
    audio: "aac-48000-stereo",
  },
};

export interface FontEntry {
  record: RegistryRecord;
  manifest: FontAssetManifest;
}
export interface FontCatalog {
  get(id: string, version: string): FontEntry | undefined;
}

export interface CompileInput {
  storyGraph: StoryGraph;
  chapters: FilmChapters;
  treatment: FilmTreatment;
  recipe: FilmStyleRecipe;
  recipeDigest: string;
  catalog: Catalog;
  fonts: FontCatalog;
  media: MediaLock;
  environmentDigest: string;
  compiler: { version: string; digest: string };
  painter: { abi: string; digest: string };
  options: { forceLevel0: boolean; reducedMotion: boolean };
}

export interface CompiledChapter {
  plan: ResolvedRenderPlan;
  proposal: TimingProposal;
  proposalDigest: string;
}

// ------------------------------------------------------------------------------------------------
// Shared helpers

function seedOf(...parts: string[]): number {
  return Number.parseInt(sha256Hex(parts.join("|")).slice(0, 8), 16);
}

function mediaEntry(input: CompileInput, asset: string, path: string) {
  const entry = input.media.files.find((f) => f.path === asset);
  if (!entry)
    throw new FilmFailure([
      filmError(
        "FS_DIGEST_MISMATCH",
        path,
        `${asset} is not in the media lock`,
      ),
    ]);
  return entry;
}

function scenesOf(
  input: CompileInput,
  chapter: FilmChapter,
  chapterPath: string,
): StoryScene[] {
  return chapter.scenes.map((s, i) => {
    const scene = input.storyGraph.scenes.find((g) => g.id === s.sceneId);
    if (!scene)
      throw new FilmFailure([
        filmError(
          "FS_SEMANTIC_INVALID",
          `${chapterPath}/scenes/${i}/sceneId`,
          `scene ${s.sceneId} is not in the Story Graph`,
        ),
      ]);
    return scene;
  });
}

function settingsOf(
  input: CompileInput,
  chapter: FilmChapter,
  index: number,
): ChapterSettings {
  const entry = input.treatment.chapters.find(
    (c) => c.chapterId === chapter.id,
  );
  if (!entry)
    throw new FilmFailure([
      filmError(
        "FS_SEMANTIC_INVALID",
        `/chapters/${index}/id`,
        `the Treatment has no state for Chapter ${chapter.id}`,
      ),
    ]);
  return entry.settings;
}

function resolveFor(input: CompileInput, settings: ChapterSettings) {
  return resolveRecipe(
    input.recipe,
    input.catalog,
    { ...input.options, profile: input.treatment.shared.outputProfile },
    settings,
  );
}

function slot(
  resolution: ReturnType<typeof resolveFor>,
  name: string,
): ResolvedSlot {
  return resolution.slots.find((s) => s.slot === name)!;
}

function timingInput(
  input: CompileInput,
  chapter: FilmChapter,
  index: number,
  scenes: StoryScene[],
  settings: ChapterSettings,
  resolution: ReturnType<typeof resolveFor>,
): TimingInput {
  const transition = slot(resolution, "transition").active.manifest.timing;
  const typography = slot(resolution, "typography").active.manifest.timing;
  const spread = settings.emphasis ?? 0.5;
  const pacing = settings.pacing ?? 1;
  const t = input.recipe.timing;
  return {
    chapter,
    chapterPath: `/chapters/${index}`,
    fps: PROFILES[input.treatment.shared.outputProfile]!.fps,
    titleMs: typography.titleMs ?? 3000,
    overlapMs: transition.overlapMs ?? 0,
    gapMs: transition.gapMs ?? 0,
    cut: {
      preferredSceneMs: Math.round(t.preferredSceneMs / pacing),
      minSceneMs: t.minSceneMs,
      maxSceneMs: t.maxSceneMs,
      minHoldMs: t.minHoldMs,
      beatMs: t.beatQuantized ? input.media.beatMs : null,
    },
    weights: scenes.map((s) => 1 + (s.emphasis - 0.5) * spread),
  };
}

// ------------------------------------------------------------------------------------------------
// Fonts

interface FontChains {
  caption: FontEntry[];
  title: FontEntry[];
}

function fontChain(
  input: CompileInput,
  ref: VersionRef,
  path: string,
): FontEntry[] {
  const keyOf = (r: VersionRef) => `${r.id}@${r.version}`;
  const entries = new Map<string, FontEntry>();
  const visiting = new Set<string>();
  const visit = (r: VersionRef): void => {
    const key = keyOf(r);
    if (visiting.has(key)) {
      throw new FilmFailure([
        filmError(
          "FS_FALLBACK_CYCLE",
          path,
          `font fallback cycle through ${key}`,
        ),
      ]);
    }
    if (entries.has(key)) return;
    const entry = input.fonts.get(r.id, r.version);
    if (!entry)
      throw new FilmFailure([
        filmError("FS_FONT_MISSING", path, `${key} is not a promoted font`),
      ]);
    visiting.add(key);
    entry.manifest.fallback.forEach(visit);
    visiting.delete(key);
    entries.set(key, entry);
  };
  visit(ref);

  // Preserve breadth-first font preference while emitting each shared dependency once.
  const chain: FontEntry[] = [];
  const emitted = new Set<string>();
  const pending = [ref];
  for (let i = 0; i < pending.length; i += 1) {
    const key = keyOf(pending[i]!);
    if (emitted.has(key)) continue;
    emitted.add(key);
    const entry = entries.get(key)!;
    chain.push(entry);
    pending.push(...entry.manifest.fallback);
  }
  return chain;
}

function fontChains(input: CompileInput): FontChains {
  const title =
    input.recipe.fonts.find((f) => f.role === "title")?.ref ??
    input.treatment.shared.typography;
  return {
    caption: fontChain(
      input,
      input.treatment.shared.typography,
      "/shared/typography",
    ),
    title: fontChain(input, title, "/fonts"),
  };
}

function covers(chain: FontEntry[], char: string): boolean {
  const cp = char.codePointAt(0)!;
  return chain.some((f) =>
    (f.manifest.coverage.ranges ?? []).some(([lo, hi]) => cp >= lo && cp <= hi),
  );
}

function glyphErrors(
  chain: FontEntry[],
  text: string,
  path: string,
): FilmError[] {
  const missing = glyphChars(text).filter((c) => !covers(chain, c));
  if (!missing.length) return [];
  return [
    filmError(
      "FS_GLYPH_MISSING",
      path,
      `font chain ${chain.map((f) => f.manifest.id).join(" -> ")} lacks ${missing.join("")}`,
      {
        missing,
        fonts: chain.map((f) => `${f.manifest.id}@${f.manifest.version}`),
      },
    ),
  ];
}

function aliasOf(face: { sha256?: string }): string {
  return `fs-${face.sha256!.slice("sha256:".length, "sha256:".length + 12)}`;
}

function planFonts(chains: FontChains): PlanFont[] {
  const seen = new Map<string, PlanFont>();
  for (const entry of [...chains.title, ...chains.caption]) {
    for (const face of entry.manifest.faces) {
      const alias = aliasOf(face);
      if (!seen.has(alias)) {
        seen.set(alias, {
          alias,
          font: { id: entry.manifest.id, version: entry.manifest.version },
          sha256: face.sha256!,
          weight: face.weight,
          style: face.style,
          format: face.format,
        });
      }
    }
  }
  return [...seen.values()];
}

// ------------------------------------------------------------------------------------------------
// Capability invocation and budgets

function countBudget(nodes: PainterNode[]): {
  primitives: number;
  keyframes: number;
} {
  let primitives = 0;
  let keyframes = 0;
  const anim = (a: unknown) => {
    if (a && typeof a === "object" && "keys" in a)
      keyframes += (a as { keys: unknown[] }).keys.length;
  };
  const walk = (node: PainterNode) => {
    primitives += 1;
    for (const value of Object.values(node)) {
      anim(value);
      if (value && typeof value === "object" && !Array.isArray(value))
        Object.values(value).forEach(anim);
    }
    if (node.type === "group") {
      node.clipPolygon?.forEach((p) => {
        anim(p.x);
        anim(p.y);
      });
      node.children.forEach(walk);
    }
  };
  nodes.forEach(walk);
  return { primitives, keyframes };
}

function invoke(
  entry: CatalogEntry,
  capInput: CapabilityInput,
  path: string,
): CapabilityOutput {
  let output: CapabilityOutput;
  try {
    output = entry.run(capInput);
    canonicalJson(output); // rejects non-finite numbers
  } catch (error) {
    throw new FilmFailure([
      filmError(
        "FS_RUNTIME_ERROR",
        path,
        `${entry.manifest.id}@${entry.manifest.version} failed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ]);
  }
  const budget = entry.manifest.budgets;
  const used = countBudget(output.layers);
  if (
    used.primitives > budget.maxPrimitives ||
    used.keyframes > budget.maxKeyframes ||
    output.audio.length > budget.maxAudioEvents
  ) {
    throw new FilmFailure([
      filmError(
        "FS_RESOURCE_CEILING",
        path,
        `${entry.manifest.id}@${entry.manifest.version} exceeded its declared budget`,
        { used: { ...used, audioEvents: output.audio.length }, budget },
      ),
    ]);
  }
  return output;
}

function blendCurves(scene: Curves | undefined, recipe: Curves): Curves {
  if (!scene) return recipe;
  const mix = (k: keyof Curves) =>
    Math.round(((scene[k] + recipe[k]) / 2) * 1000) / 1000;
  return {
    energy: mix("energy"),
    intimacy: mix("intimacy"),
    openness: mix("openness"),
    warmth: mix("warmth"),
    stillness: mix("stillness"),
  };
}

function applyEnvelope(
  content: Extract<PainterNode, { type: "group" }>,
  envelope: Envelope | undefined,
): Extract<PainterNode, { type: "group" }> {
  if (!envelope) return content;
  // Nest independent envelopes so an outgoing transition cannot overwrite the incoming one.
  const group: Extract<PainterNode, { type: "group" }> = {
    type: "group",
    startMs: content.startMs,
    endMs: content.endMs,
    children: [content],
  };
  if (envelope.opacity !== undefined) group.opacity = envelope.opacity;
  if (envelope.translateX !== undefined) group.translateX = envelope.translateX;
  if (envelope.clipPolygon !== undefined)
    group.clipPolygon = envelope.clipPolygon;
  if (envelope.brightness !== undefined || envelope.blur !== undefined) {
    group.filter = {
      ...group.filter,
      ...(envelope.brightness !== undefined
        ? { brightness: envelope.brightness }
        : {}),
      ...(envelope.blur !== undefined ? { blur: envelope.blur } : {}),
    };
  }
  return group;
}

// ------------------------------------------------------------------------------------------------
// Text boxes (estimates used by title-safe and contrast checks; the painter wraps the same way)

function measure(text: string, size: number, spacing: number): number {
  let width = 0;
  for (const ch of text) width += hasCjk(ch) ? size : size * 0.55;
  return width + spacing * Math.max(0, [...text].length - 1);
}

export function textBox(node: TextNode): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const width = measure(node.text, node.sizePx, node.letterSpacingPx);
  const lines = Math.max(1, Math.ceil(width / node.maxWidthPx));
  const w = Math.min(width, node.maxWidthPx);
  const x =
    node.align === "center"
      ? node.x - w / 2
      : node.align === "right"
        ? node.x - w
        : node.x;
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    x: round(x),
    y: round(node.y),
    w: round(w),
    h: round(lines * node.sizePx * node.lineHeight),
  };
}

function collectTexts(
  nodes: PainterNode[],
  segment: number,
  out: ResolvedRenderPlan["texts"],
): void {
  for (const node of nodes) {
    if (node.type === "text")
      out.push({
        segment,
        role: node.role,
        text: node.text,
        font: node.font,
        box: textBox(node),
        startMs: node.startMs,
        endMs: node.endMs,
      });
    if (node.type === "group") collectTexts(node.children, segment, out);
  }
}

// ------------------------------------------------------------------------------------------------
// Preflight and compile

/** Checks everything that can be known before resolution: compatibility, fonts, glyphs, timing. */
export function preflightChapters(input: CompileInput): FilmError[] {
  const errors: FilmError[] = [];
  const collect = (fn: () => void) => {
    try {
      fn();
    } catch (error) {
      if (error instanceof FilmFailure) errors.push(...error.errors);
      else throw error;
    }
  };
  let chains: FontChains | undefined;
  collect(() => {
    chains = fontChains(input);
  });
  input.chapters.chapters.forEach((chapter, index) => {
    collect(() => {
      const scenes = scenesOf(input, chapter, `/chapters/${index}`);
      const settings = settingsOf(input, chapter, index);
      const resolution = resolveFor(input, settings);
      errors.push(
        ...timingPreflight(
          timingInput(input, chapter, index, scenes, settings, resolution),
        ),
      );
      if (chains) {
        errors.push(
          ...glyphErrors(
            chains.title,
            chapter.title,
            `/chapters/${index}/title`,
          ),
        );
        for (const scene of scenes) {
          const at = input.storyGraph.scenes.indexOf(scene);
          errors.push(
            ...glyphErrors(
              chains.caption,
              scene.caption.ja,
              `/scenes/${at}/caption/ja`,
            ),
          );
          errors.push(
            ...glyphErrors(
              chains.caption,
              scene.caption.en,
              `/scenes/${at}/caption/en`,
            ),
          );
        }
      }
    });
  });
  if (chains)
    errors.push(
      ...glyphErrors(
        chains.title,
        input.treatment.overallTitle,
        "/overallTitle",
      ),
    );
  return dedupe(errors);
}

function dedupe(errors: FilmError[]): FilmError[] {
  const seen = new Set<string>();
  return errors.filter((e) => {
    const k = `${e.code}|${e.path}|${e.message}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function lockCapability(
  slotName: string,
  entry: CatalogEntry,
): LockedCapability {
  return {
    slot: slotName,
    id: entry.manifest.id,
    version: entry.manifest.version,
    manifestDigest: entry.record.manifestDigest,
    implementationDigest: entry.record.implementationDigest,
    assetDigests: entry.record.assetDigests,
  };
}

export function lockFonts(entries: FontEntry[]): LockedFont[] {
  const seen = new Map<string, LockedFont>();
  for (const e of entries) {
    seen.set(`${e.manifest.id}@${e.manifest.version}`, {
      id: e.manifest.id,
      version: e.manifest.version,
      manifestDigest: e.record.manifestDigest,
      faces: e.manifest.faces.map((f) => f.sha256!),
    });
  }
  return [...seen.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

export function compileChapters(input: CompileInput): CompiledChapter[] {
  const errors = preflightChapters(input);
  if (errors.length) throw new FilmFailure(errors);
  const profile = PROFILES[input.treatment.shared.outputProfile]!;
  const chains = fontChains(input);
  const fonts = planFonts(chains);
  const theme = {
    palette: input.recipe.palette,
    fonts: {
      caption: chains.caption.flatMap((f) => f.manifest.faces.map(aliasOf)),
      title: chains.title.flatMap((f) => f.manifest.faces.map(aliasOf)),
    },
    overallTitle: input.treatment.overallTitle,
  };
  const bgm = mediaEntry(
    input,
    input.treatment.shared.bgm.asset,
    "/shared/bgm/asset",
  );
  if (bgm.sha256 !== input.treatment.shared.bgm.sha256) {
    throw new FilmFailure([
      filmError(
        "FS_DIGEST_MISMATCH",
        "/shared/bgm/sha256",
        `BGM is ${bgm.sha256} in the media lock`,
      ),
    ]);
  }
  const beat = {
    bpm: Math.round((60000 / input.media.beatMs) * 1000) / 1000,
    offsetMs: 0,
  };

  return input.chapters.chapters.map((chapter, index) => {
    const chapterPath = `/chapters/${index}`;
    const scenes = scenesOf(input, chapter, chapterPath);
    const settings = settingsOf(input, chapter, index);
    const resolution = resolveFor(input, settings);
    const proposal = resolveTiming(
      timingInput(input, chapter, index, scenes, settings, resolution),
    );
    const digest = proposalDigest(proposal);

    // Segment windows: title, then each scene starting `overlap` before the previous end (or `gap` after it).
    const segments: ResolvedRenderPlan["segments"] = [
      { kind: "title", sceneId: null, startMs: 0, endMs: proposal.titleMs },
    ];
    for (const s of proposal.scenes) {
      const startMs =
        segments.at(-1)!.endMs - proposal.overlapMs + proposal.gapMs;
      segments.push({
        kind: "scene",
        sceneId: s.sceneId,
        startMs,
        endMs: startMs + s.durationMs,
      });
    }
    if (segments.at(-1)!.endMs !== proposal.runtimeMs)
      throw new Error(
        "internal: segment windows disagree with the runtime formula",
      );

    const usedMedia = new Map<string, string>();
    const assetsFor = (entry: CatalogEntry) =>
      Object.fromEntries(
        entry.manifest.assets.map((a) => {
          const locked = mediaEntry(
            input,
            a.media,
            `/capabilities/${entry.manifest.id}`,
          );
          usedMedia.set(locked.path, locked.sha256);
          return [a.name, { asset: locked.path, sha256: locked.sha256 }];
        }),
      );

    const base = (
      seg: number,
      sceneIndex: number,
      kind: CapabilityInput["segment"],
      entry: CatalogEntry,
      params: ResolvedSlot["params"],
      scene?: StoryScene,
    ): CapabilityInput => {
      const window = segments[seg]!;
      const sceneMedia = scene
        ? mediaEntry(input, scene.media.asset, `/scenes/${scene.id}/media`)
        : undefined;
      return {
        abi: CAPABILITY_ABI,
        kind: entry.manifest.kind,
        segment: kind,
        profile: {
          id: profile.id,
          widthPx: profile.widthPx,
          heightPx: profile.heightPx,
          fps: profile.fps,
        },
        window: {
          startMs: window.startMs,
          endMs: window.endMs,
          inOverlapMs: seg === 0 ? 0 : proposal.overlapMs,
          outOverlapMs: seg === segments.length - 1 ? 0 : proposal.overlapMs,
        },
        ...(scene && sceneMedia
          ? {
              scene: {
                id: scene.id,
                media: [
                  {
                    asset: sceneMedia.path,
                    sha256: sceneMedia.sha256,
                    widthPx: sceneMedia.widthPx!,
                    heightPx: sceneMedia.heightPx!,
                  },
                ],
                analysis: scene.analysis,
                caption: { ja: scene.caption.ja, en: scene.caption.en },
              },
            }
          : {}),
        chapter: {
          id: chapter.id,
          title: chapter.title,
          index,
          sceneIndex,
          sceneCount: scenes.length,
        },
        curves: blendCurves(scene?.emotion, input.recipe.curves),
        params,
        options: {
          reducedMotion: input.options.reducedMotion,
          seed: seedOf(chapter.id, scene?.id ?? "title", entry.manifest.id),
        },
        beat,
        theme,
        assets: assetsFor(entry),
      };
    };

    const layout = slot(resolution, "layout");
    const motion = slot(resolution, "motion");
    const transition = slot(resolution, "transition");
    const typography = slot(resolution, "typography");
    const sound = slot(resolution, "sound");
    const surface = slot(resolution, "surface");
    const layerOf = (s: ResolvedSlot) => s.active.manifest.layer;

    const groups: Extract<PainterNode, { type: "group" }>[] = [];
    const audio: AudioEvent[] = [];
    const call = (s: ResolvedSlot, capInput: CapabilityInput, at: string) =>
      invoke(s.active, capInput, at);

    segments.forEach((seg, i) => {
      const at = `${chapterPath}/segments/${i}`;
      const children: { layer: number; nodes: PainterNode[] }[] = [];
      if (seg.kind === "title") {
        children.push({
          layer: layerOf(typography),
          nodes: call(
            typography,
            base(i, -1, "title", typography.active, typography.params),
            at,
          ).layers,
        });
      } else {
        const scene = scenes[i - 1]!;
        usedMedia.set(
          scene.media.asset,
          mediaEntry(input, scene.media.asset, at).sha256,
        );
        const laid = call(
          layout,
          base(i, i - 1, "scene", layout.active, layout.params, scene),
          at,
        ).layers;
        const moved = call(
          motion,
          {
            ...base(i, i - 1, "scene", motion.active, motion.params, scene),
            upstream: laid,
          },
          at,
        ).layers;
        children.push({ layer: layerOf(layout), nodes: moved });
        children.push({
          layer: layerOf(surface),
          nodes: call(
            surface,
            base(i, i - 1, "scene", surface.active, surface.params, scene),
            at,
          ).layers,
        });
        for (const effect of resolution.effects) {
          children.push({
            layer: effect.active.manifest.layer,
            nodes: call(
              effect,
              base(i, i - 1, "scene", effect.active, effect.params, scene),
              at,
            ).layers,
          });
        }
        children.push({
          layer: layerOf(typography),
          nodes: call(
            typography,
            base(
              i,
              i - 1,
              "scene",
              typography.active,
              typography.params,
              scene,
            ),
            at,
          ).layers,
        });
        audio.push(
          ...call(
            sound,
            base(i, i - 1, "scene", sound.active, sound.params, scene),
            at,
          ).audio,
        );
      }
      const ordered = children
        .map((c, k) => ({ ...c, k }))
        .sort((a, b) => a.layer - b.layer || a.k - b.k);
      groups.push({
        type: "group",
        startMs: seg.startMs,
        endMs: seg.endMs,
        children: ordered.flatMap((c) => c.nodes),
      });
    });

    // Transitions: one call per adjacent pair, envelopes applied to the two segment groups.
    const under: PainterNode[] = [];
    for (let i = 1; i < segments.length; i += 1) {
      const prev = segments[i - 1]!;
      const next = segments[i]!;
      const window =
        proposal.overlapMs > 0
          ? { startMs: next.startMs, endMs: prev.endMs }
          : { startMs: prev.endMs, endMs: next.startMs };
      const capInput: CapabilityInput = {
        ...base(i, i - 1, "transition", transition.active, transition.params),
        window: {
          ...window,
          inOverlapMs: proposal.overlapMs,
          outOverlapMs: proposal.overlapMs,
        },
      };
      const out = call(
        transition,
        capInput,
        `${chapterPath}/transitions/${i - 1}`,
      );
      groups[i - 1] = applyEnvelope(groups[i - 1]!, out.envelopes?.outgoing);
      groups[i] = applyEnvelope(groups[i]!, out.envelopes?.incoming);
      under.push(...out.layers);
    }

    const background: PainterNode = {
      type: "rect",
      startMs: 0,
      endMs: proposal.runtimeMs,
      x: 0,
      y: 0,
      w: profile.widthPx,
      h: profile.heightPx,
      color: "#000000",
    };
    const layers: PainterNode[] = [background, ...under, ...groups];
    const texts: ResolvedRenderPlan["texts"] = [];
    groups.forEach((g, i) => collectTexts(g.children, i, texts));
    usedMedia.set(bgm.path, bgm.sha256);

    const chainEntries = [...resolution.slots, ...resolution.effects].flatMap(
      (s) => s.chain.map((entry) => ({ slot: s.slot, entry })),
    );
    const lock: PlanLock = {
      capabilities: chainEntries.map(({ slot: name, entry }) =>
        lockCapability(name, entry),
      ),
      fonts: lockFonts([...chains.title, ...chains.caption]),
      media: [...usedMedia.entries()]
        .map(([asset, sha256]) => ({ asset, sha256 }))
        .sort((a, b) => (a.asset < b.asset ? -1 : 1)),
      compiler: input.compiler,
      painter: input.painter,
      schemaVersion: SCHEMA_VERSION,
      profile: profile.id,
      environment: input.environmentDigest,
    };
    const sceneProvenance = scenes.map((s) => ({
      sceneId: s.id,
      asset: s.media.asset,
      sha256: mediaEntry(input, s.media.asset, chapterPath).sha256,
    }));
    const recipeRef = {
      id: input.recipe.id,
      revision: input.recipe.revision,
      digest: input.recipeDigest,
    };
    const fingerprint = chapterFingerprint({
      chapter,
      scenes: scenes.map((scene, i) => ({
        scene,
        sha256: sceneProvenance[i]!.sha256,
      })),
      proposal,
      settings,
      recipe: recipeRef,
      lock,
      shared: input.treatment.shared,
      options: input.options,
    });

    const plan: ResolvedRenderPlan = {
      schema: "film.resolved-render-plan@1",
      chapter: {
        id: chapter.id,
        title: chapter.title,
        index,
        sceneIds: scenes.map((s) => s.id),
      },
      profile,
      frameQuantization: "round-half-up@1",
      options: input.options,
      timing: { proposal, proposalDigest: digest },
      segments,
      layers,
      texts,
      audio: {
        bgm: {
          asset: bgm.path,
          sha256: bgm.sha256,
          startMs: 0,
          durationMs: proposal.runtimeMs,
          gain: input.treatment.shared.bgm.gain,
          loop: false,
          fadeInMs: 1000,
          fadeOutMs: 1500,
          offsetMs: 0,
        },
        events: audio,
      },
      fonts,
      capabilities: [...resolution.slots, ...resolution.effects].map((s) => ({
        slot: s.slot,
        requested: {
          id: s.requested.manifest.id,
          version: s.requested.manifest.version,
        },
        active: {
          id: s.active.manifest.id,
          version: s.active.manifest.version,
        },
        chain: s.chain.map((c) => `${c.manifest.id}@${c.manifest.version}`),
        params: s.params,
      })),
      lock,
      provenance: {
        projectId: input.treatment.projectId,
        storyGraph: {
          id: input.storyGraph.id,
          revision: input.storyGraph.revision,
        },
        treatment: {
          id: input.treatment.id,
          revision: input.treatment.revision,
        },
        recipe: recipeRef,
        scenes: sceneProvenance,
      },
      shared: {
        worldview: input.treatment.shared.worldview,
        colorFamily: input.treatment.shared.colorFamily,
        typography: {
          id: input.treatment.shared.typography.id,
          version: input.treatment.shared.typography.version,
        },
      },
      warnings: resolution.omitted.map((id) => ({
        code: "FS_EFFECT_OMITTED",
        path: "/effects",
        message: `${id} omitted under forceLevel0`,
        disposition: null,
      })),
      fingerprint,
    };
    return { plan, proposal, proposalDigest: digest };
  });
}
