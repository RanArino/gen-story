// Content fingerprints over canonical JSON (sorted keys, no whitespace, no timestamps).
// Field lists follow the accepted Discussion's Chapter and concatenation fingerprint rules.
import { digestOf } from "../contracts/canonical.js";
import type {
  ChapterSettings,
  FilmChapter,
  FilmTreatment,
  PlanLock,
  StoryScene,
  TimingProposal,
  VersionRef,
} from "../contracts/types.js";

export function planDigest(plan: unknown): string {
  return digestOf(plan);
}

export interface ChapterFingerprintInput {
  chapter: Pick<FilmChapter, "id" | "title">;
  scenes: { scene: StoryScene; sha256: string }[];
  proposal: TimingProposal;
  settings: ChapterSettings;
  recipe: { id: string; revision: string; digest: string };
  lock: PlanLock;
  shared: FilmTreatment["shared"];
  options: { forceLevel0: boolean; reducedMotion: boolean };
}

export function chapterFingerprint(input: ChapterFingerprintInput): string {
  return digestOf({
    kind: "film.chapter-fingerprint@1",
    chapter: { id: input.chapter.id, title: input.chapter.title },
    scenes: input.scenes.map(({ scene, sha256 }) => ({
      id: scene.id,
      sha256,
      caption: scene.caption,
      analysis: scene.analysis,
      emphasis: scene.emphasis,
      emotion: scene.emotion,
    })),
    durations: input.proposal.scenes.map((s) => ({ sceneId: s.sceneId, source: s.source, durationMs: s.durationMs })),
    limitMs: input.proposal.limitMs,
    settings: input.settings,
    recipe: input.recipe,
    lock: input.lock,
    shared: input.shared,
    options: input.options,
  });
}

export interface ConcatFingerprintInput {
  artifactSha256: string[];
  overallTitle: string;
  connection: VersionRef & { manifestDigest: string; implementationDigest: string | null };
  lock: PlanLock;
}

export function concatFingerprint(input: ConcatFingerprintInput): string {
  return digestOf({ kind: "film.concat-fingerprint@1", ...input });
}
