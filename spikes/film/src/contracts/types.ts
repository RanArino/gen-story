// TypeScript mirrors of the canonical JSON Schemas in spikes/film/schemas/. The schemas are
// the source of truth; schemas.test.ts validates every fixture so the two cannot drift silently.
import type { Warning } from "./envelope.js";

export const CAPABILITY_KINDS = ["layout", "motion", "transition", "typography", "sound", "surface", "effect", "connection"] as const;
export type CapabilityKind = (typeof CAPABILITY_KINDS)[number];
export const REQUIRED_SLOTS = ["layout", "motion", "transition", "typography", "sound", "surface"] as const;
export type RequiredSlot = (typeof REQUIRED_SLOTS)[number];
export const CHAPTER_FIELDS = ["pacing", "motionAmount", "emphasis", "sfxLevel", "visualIntensity"] as const;
export type ChapterField = (typeof CHAPTER_FIELDS)[number];

export const DEFAULT_CHAPTER_LIMIT_MS = 60_000;

/** Exact registry reference. `digest` is the Manifest digest recorded in the Registry Record. */
export interface ExactRef {
  id: string;
  version: string;
  digest: string;
}
export interface VersionRef {
  id: string;
  version: string;
}
export interface RevisionRef {
  id: string;
  revision: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Curves {
  energy: number;
  intimacy: number;
  openness: number;
  warmth: number;
  stillness: number;
}
export type ParamValue = number | boolean | string;

// Story Graph ---------------------------------------------------------------------------

export interface StoryScene {
  id: string;
  media: { asset: string };
  caption: { ja: string; en: string; claim?: { factId: string } };
  analysis: { subject: Rect }; // normalized 0..1 of the source image
  emphasis: number; // 0..1
  emotion: Curves;
  lineage: { source: "fixture-copy" | "fixture-synthetic"; note: string };
}
export interface StoryGraph {
  schema: "film.story-graph@1";
  id: string;
  revision: number;
  title: string;
  scenes: StoryScene[];
  facts: { id: string; text: string; confirmed: boolean }[];
}

// Chapters ------------------------------------------------------------------------------

export interface FilmChapter {
  id: string;
  title: string;
  /** Absent: the 60,000 ms default. null: the user removed the limit. */
  limitMs?: number | null;
  scenes: { sceneId: string; durationMs?: number }[];
}
export interface FilmChapters {
  schema: "film.chapters@1";
  storyGraph: RevisionRef;
  chapters: FilmChapter[];
}

// Capability Request and Manifest -------------------------------------------------------

export interface CapabilityRequest {
  schema: "film.capability-request@1";
  id: string;
  title: string;
  problem: string;
  kind: CapabilityKind;
  proposed: VersionRef;
  catalogSearch: { queries: string[]; whyNotRecipe: string };
  requester: { kind: "user" | "agent"; name: string };
  acceptance: string[];
}

export interface ParamSpec {
  type: "number" | "integer" | "boolean" | "enum";
  default: ParamValue;
  min?: number;
  max?: number;
  values?: string[];
  unit?: string;
  scope: "project" | "chapter" | "scene";
  authority: "user-exposable" | "agent-settable" | "compiler-only";
  description: string;
}

export interface CapabilityManifest {
  schema: "film.capability-manifest@1";
  id: string;
  version: string;
  kind: CapabilityKind;
  level: 0 | 1;
  title: string;
  description: string;
  tags: string[];
  rendererApi: "film-capability@1";
  layer: number;
  media: { types: "image"[]; min: number; max: number };
  profiles: string[];
  aspectRatios: string[];
  analysis: "subjectBounds"[];
  params: Record<string, ParamSpec>;
  requires: string[];
  incompatibleWith: string[];
  determinism: { seeded: boolean };
  motionLevel: "none" | "subtle" | "moderate" | "high";
  budgets: { maxPrimitives: number; maxKeyframes: number; maxAudioEvents: number };
  reducedMotion: "same" | "reduce" | "fallback";
  fallback: VersionRef | null;
  timing: { overlapMs?: number; gapMs?: number; titleMs?: number };
  assets: { name: string; media: string }[];
  fixtures: { name: string; sourceAspect: string; caption: "ja" | "en" | "empty" }[];
  permissions: string[];
  provenance: { author: string; source: string; license: string };
}

// Film Style Recipe, Treatment, Cut -----------------------------------------------------

export interface FilmStyleRecipe {
  schema: "film.film-style-recipe@1";
  id: string;
  revision: string; // r1, r2, ...
  title: string;
  description: string;
  scope: "system" | "organization";
  owner: string;
  lineage: { forkedFrom: { id: string; revision: string; digest: string } } | null;
  capabilities: { slot: RequiredSlot; ref: ExactRef }[];
  effects: ExactRef[];
  params: Record<string, Record<string, ParamValue>>;
  fonts: { role: "caption" | "title"; ref: ExactRef }[];
  palette: { family: string; background: string; text: string; accent: string; scrim: string };
  curves: Curves;
  timing: { preferredSceneMs: number; minSceneMs: number; maxSceneMs: number; minHoldMs: number; beatQuantized: boolean };
  chapterAllowlist: { field: ChapterField; min: number; max: number }[];
  output: { profile: string };
}

export type ChapterSettings = Partial<Record<ChapterField, number>>;

export interface FilmTreatment {
  schema: "film.film-treatment@1";
  id: string;
  revision: number;
  projectId: string;
  recipe: { id: string; revision: string; digest: string };
  storyGraph: RevisionRef;
  shared: {
    worldview: string;
    bgm: { asset: string; sha256: string; gain: number };
    typography: ExactRef;
    colorFamily: string;
    outputProfile: string;
  };
  overallTitle: string;
  projectFonts: ExactRef[];
  chapters: { chapterId: string; settings: ChapterSettings }[];
}

export interface Cut {
  schema: "film.cut@1";
  id: string;
  name: string;
  description: string;
  treatment: RevisionRef;
  chapterId: string;
  settings: ChapterSettings;
}

// Fonts -------------------------------------------------------------------------------

export interface FontFaceSpec {
  file: string;
  weight: number;
  style: "normal" | "italic";
  stretch: "normal";
  format: "truetype" | "opentype" | "woff2";
  sha256?: string;
}
export interface FontAssetManifest {
  schema: "film.font-asset-manifest@1";
  id: string;
  version: string;
  family: string;
  faces: FontFaceSpec[];
  coverage: { scripts: ("Latn" | "Jpan")[]; ranges?: [number, number][] };
  fallback: ExactRef[];
  source: { origin: string; commit?: string; attribution: string };
  license: { id: string; file: string; sha256?: string };
  rights: { redistribution?: boolean; videoEmbedding?: boolean };
  scope: { kind: "organization" } | { kind: "project"; projectId: string };
}

// Registry, approvals, reports ----------------------------------------------------------

export interface RegistryRecord {
  schema: "film.registry-record@1";
  entity: "capability" | "font";
  id: string;
  version: string;
  kind: CapabilityKind | "font";
  trust: "system" | "promoted";
  manifestDigest: string;
  implementationDigest: string | null;
  assetDigests: { name: string; digest: string }[];
  validationReportDigests: string[];
  approvalIds: string[];
  reviewId: string | null;
  createdAt: string;
}

export const APPROVAL_KINDS = ["request", "execution", "promotion", "timing", "concat"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export interface ApprovalRecord {
  schema: "film.approval-record@1";
  id: string;
  kind: ApprovalKind;
  targetDigest: string;
  subject: string;
  operator: string;
  confirmation: string;
  createdAt: string;
}

export interface LegacyReviewRecord {
  schema: "film.review-record@1";
  id: string;
  subjectDigest: string;
  subject: string;
  reviewer: string;
  verdict: "accept" | "reject";
  notes: string;
  createdAt: string;
}

export interface ReviewRecordV2 extends Omit<LegacyReviewRecord, "schema"> {
  schema: "film.review-record@2";
  candidate: string;
  author: string;
  requester: string;
  operator: string;
  confirmation: { kind: "interactive-tty"; value: string; confirmedAt: string };
}
export type ReviewRecord = LegacyReviewRecord | ReviewRecordV2;

export interface ValidationCheck {
  name: string;
  ok: boolean;
  code?: string;
  path?: string;
  message?: string;
}
export interface ValidationReport {
  schema: "film.validation-report@1";
  subject: { entity: "capability" | "font"; id: string; version: string; digest: string };
  gate: "static" | "runtime" | "font-inspection";
  ok: boolean;
  checks: ValidationCheck[];
  data?: Record<string, unknown>;
  toolchain: { node: string };
  createdAt: string;
}

// Plans -------------------------------------------------------------------------------

export type Ease = "linear" | "ease-in-out" | "step";
export type Anim = number | { keys: { t: number; v: number; ease: Ease }[] };
export type Blend = "source-over" | "multiply" | "screen" | "soft-light";

interface NodeBase {
  startMs: number;
  endMs: number;
  opacity?: Anim;
}
export interface ImageNode extends NodeBase {
  type: "image";
  asset: string;
  sha256: string;
  src: { x: Anim; y: Anim; w: Anim; h: Anim };
  dst: { x: Anim; y: Anim; w: Anim; h: Anim };
  rotateDeg?: Anim;
}
export interface RectNode extends NodeBase {
  type: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}
export interface GradientNode extends NodeBase {
  type: "linearGradient";
  x: number;
  y: number;
  w: number;
  h: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  stops: { at: number; color: string }[];
}
export interface TextNode extends NodeBase {
  type: "text";
  role: "caption" | "title";
  text: string;
  font: string[];
  sizePx: number;
  weight: number;
  color: string;
  letterSpacingPx: number;
  align: "left" | "center" | "right";
  x: number;
  y: number;
  maxWidthPx: number;
  lineHeight: number;
  translateY?: Anim;
  scrim?: { color: string; opacity: number; padPx: number };
}
export interface GroupNode extends NodeBase {
  type: "group";
  children: PainterNode[];
  clipRect?: Rect;
  clipPolygon?: { x: Anim; y: Anim }[];
  blend?: Blend;
  filter?: { blur?: Anim; brightness?: Anim };
  translateX?: Anim;
  translateY?: Anim;
}
export type PainterNode = ImageNode | RectNode | GradientNode | TextNode | GroupNode;

export interface AudioEvent {
  asset: string;
  sha256: string;
  startMs: number;
  durationMs: number | null;
  gain: number;
  loop: boolean;
  fadeInMs: number;
  fadeOutMs: number;
}

export interface OutputProfile {
  id: string;
  widthPx: number;
  heightPx: number;
  fps: number;
  video: string;
  audio: string;
}

export interface TimingScene {
  sceneId: string;
  source: "user" | "resolved";
  durationMs: number;
  minMs: number;
}
export interface TimingProposal {
  schema: "film.timing-proposal@1";
  chapterId: string;
  limitMs: number | null;
  titleMs: number;
  overlapMs: number;
  gapMs: number;
  runtimeMs: number;
  remainingMs: number | null;
  scenes: TimingScene[];
}

export interface LockedCapability {
  slot: string;
  id: string;
  version: string;
  manifestDigest: string;
  implementationDigest: string | null;
  assetDigests: { name: string; digest: string }[];
}
export interface LockedFont {
  id: string;
  version: string;
  manifestDigest: string;
  faces: string[];
}
export interface PlanLock {
  capabilities: LockedCapability[];
  fonts: LockedFont[];
  media: { asset: string; sha256: string }[];
  compiler: { version: string; digest: string };
  painter: { abi: string; digest: string };
  schemaVersion: string;
  profile: string;
  environment: string;
}

export interface PlanFont {
  alias: string;
  font: VersionRef;
  sha256: string;
  weight: number;
  style: "normal" | "italic";
  format: FontFaceSpec["format"];
}

export interface ResolvedRenderPlan {
  schema: "film.resolved-render-plan@1";
  chapter: { id: string; title: string; index: number; sceneIds: string[] };
  profile: OutputProfile;
  frameQuantization: "round-half-up@1";
  options: { forceLevel0: boolean; reducedMotion: boolean };
  timing: { proposal: TimingProposal; proposalDigest: string };
  segments: { kind: "title" | "scene"; sceneId: string | null; startMs: number; endMs: number }[];
  layers: PainterNode[];
  texts: { segment: number; role: "caption" | "title"; text: string; font: string[]; box: Rect; startMs: number; endMs: number }[];
  audio: { bgm: AudioEvent & { offsetMs: number }; events: AudioEvent[] };
  fonts: PlanFont[];
  capabilities: {
    slot: string;
    requested: VersionRef;
    active: VersionRef;
    chain: string[];
    params: Record<string, ParamValue>;
  }[];
  lock: PlanLock;
  provenance: {
    projectId?: string; // Absent only in legacy Plans, which must be recompiled before concatenation.
    storyGraph: RevisionRef;
    treatment: RevisionRef;
    recipe: { id: string; revision: string; digest: string };
    scenes: { sceneId: string; asset: string; sha256: string }[];
  };
  shared: { worldview: string; colorFamily: string; typography: VersionRef };
  warnings: Warning[];
  fingerprint: string;
}

export interface LegacyConcatPlan {
  schema: "film.concat-plan@1";
  chapters: { chapterId: string; planDigest: string; artifactSha256: string; runtimeMs: number; offsetMs: number }[];
  profile: OutputProfile;
  frameQuantization: "round-half-up@1";
  overallTitle: { text: string; titleMs: number; layers: PainterNode[] };
  connection: { ref: VersionRef; darkenMs: number; brightnessTo: number };
  audio: { bgm: AudioEvent & { offsetMs: number } };
  fonts: PlanFont[];
  runtimeMs: number;
  lock: PlanLock;
  fingerprint: string;
}

export interface ConcatPlanV2 extends Omit<LegacyConcatPlan, "schema" | "chapters"> {
  schema: "film.concat-plan@2";
  chapters: (LegacyConcatPlan["chapters"][number] & { stemSha256: string; frames: number })[];
}
export type ConcatPlan = LegacyConcatPlan | ConcatPlanV2;

export interface ChapterArtifact {
  schema: "film.chapter-artifact@1";
  chapterId: string;
  order: number;
  title: string;
  scenes: { sceneId: string; asset: string; sha256: string }[];
  recipe: { id: string; revision: string; digest: string };
  capabilityLock: LockedCapability[];
  fonts: LockedFont[];
  bgm: { asset: string; sha256: string };
  planDigest: string;
  fingerprint: string;
  environment: string;
  runtimeMs: number;
  frames: number;
  files: { mp4: { name: string; sha256: string; bytes: number }; stem: { name: string; sha256: string; bytes: number } };
  verified: boolean;
}
