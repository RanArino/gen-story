import {
  applyApprovedDirection,
  clampDirectionToTemplate,
  validateDirectionTemplateBounds,
  type FilmTemplate,
  type FilmTemplateBounds,
  directionContentProblems,
  enforceDirectionLocks,
  isDirectionStale,
  transitionDirection,
  validateDirectionContent,
  type FilmAspect,
  type FilmDirectionContent,
  type FilmDirectionField,
  type FilmDirectionResolution,
  type FilmDirectionLocks,
  type FilmDirectionProposal,
  type FilmSceneDirection,
  type FilmTreatment,
} from "@gen-story/domain";
import type { FilmRepositoryPort } from "./film";

export interface FilmTemplateCatalogPort {
  list(): readonly FilmTemplate[];
  get(id: string): FilmTemplate | undefined;
}

export interface FilmDirectionRepositoryPort {
  list(projectId: string): Promise<FilmDirectionProposal[]>;
  save(proposal: FilmDirectionProposal): Promise<void>;
}

export interface FilmDirectionPlanChapter {
  chapterId: string;
  title: string;
  locks: FilmDirectionLocks;
  scenes: {
    sceneId: string;
    storyboardTitle: string;
    /** Object storage key of the exact image that will be rendered. */
    imageKey: string;
    /** When set, the Agent must return this scene unchanged (single-photo regeneration). */
    keep: FilmSceneDirection | null;
  }[];
}
export interface FilmDirectionPlanRequest {
  scope: "film" | "chapter";
  filmTitle: string;
  template?: Pick<FilmTemplate, "name" | "bounds" | "fixed">;
  story: string;
  outputAspect: FilmAspect;
  chapters: FilmDirectionPlanChapter[];
  /** Approved or proposed neighbors, so music and pacing connect across Chapters. */
  neighbors: {
    position: "previous" | "next";
    title: string;
    music: FilmDirectionContent["music"] | null;
  }[];
}
export interface FilmDirectionPlannerPort {
  plan(request: FilmDirectionPlanRequest): Promise<{
    model: string;
    chapters: { chapterId: string; content: unknown }[];
  }>;
}

/**
 * Validates and lock-enforces raw planner output for each requested Chapter. A Chapter the
 * planner omitted or got wrong becomes a visible failure, never a silently generic direction.
 */
export function settlePlannedChapters(
  request: FilmDirectionPlanRequest,
  result: Awaited<ReturnType<FilmDirectionPlannerPort["plan"]>>,
): Map<string, { content: FilmDirectionContent } | { error: string }> {
  const settled = new Map<
    string,
    { content: FilmDirectionContent } | { error: string }
  >();
  for (const chapter of request.chapters) {
    const raw = result.chapters.find((c) => c.chapterId === chapter.chapterId);
    const sceneIds = chapter.scenes.map((s) => s.sceneId);
    if (!raw) {
      settled.set(chapter.chapterId, {
        error: "The AI did not return a direction for this Chapter.",
      });
      continue;
    }
    const problems = directionContentProblems(raw.content, sceneIds);
    if (problems.length) {
      settled.set(chapter.chapterId, {
        error: `The AI direction was invalid: ${problems.join(" ")}`,
      });
      continue;
    }
    const content = enforceDirectionLocks(
      raw.content as FilmDirectionContent,
      chapter.locks,
    );
    const withKeptScenes = {
      ...content,
      scenes: content.scenes.map(
        (scene, i) => chapter.scenes[i]!.keep ?? scene,
      ),
    };
    settled.set(chapter.chapterId, {
      content: request.template
        ? clampDirectionToTemplate(withKeptScenes, request.template.bounds)
        : withKeptScenes,
    });
  }
  return settled;
}

/** Applies a user's edits to a proposal under review, or a manual revision of an applied one. */
export async function updateFilmDirection(
  repository: FilmDirectionRepositoryPort,
  input: {
    projectId: string;
    id: string;
    content: unknown;
    bounds?: FilmTemplateBounds;
    sceneIds: string[];
    now: string;
  },
): Promise<FilmDirectionProposal> {
  const proposal = (await repository.list(input.projectId)).find(
    (p) => p.id === input.id,
  );
  if (!proposal) throw new Error("AI direction not found.");
  if (proposal.status !== "proposed" && proposal.status !== "approved")
    throw new Error("Only a proposed or applied AI direction can be edited.");
  validateDirectionContent(input.content, input.sceneIds);
  if (input.bounds)
    validateDirectionTemplateBounds(input.content, input.bounds);
  // After approval the saved treatment owns the Chapter name and captions, so a manual revision
  // of an applied direction changes only camera, light and sound and keeps the reviewed text.
  const content: FilmDirectionContent =
    proposal.status === "approved" && proposal.content
      ? {
          ...input.content,
          chapterName: proposal.content.chapterName,
          scenes: input.content.scenes.map((scene, i) => ({
            ...scene,
            captions: proposal.content!.scenes[i]!.captions,
          })),
        }
      : input.content;
  const updated = {
    ...proposal,
    content,
    updatedAt: input.now,
  };
  await repository.save(updated);
  return updated;
}

/**
 * Approves a current proposal, supersedes the Chapter's previous approval and writes the reviewed
 * Chapter name and captions into the saved treatment under its revision check.
 */
export async function approveFilmDirection(
  repository: FilmDirectionRepositoryPort,
  films: FilmRepositoryPort,
  input: {
    projectId: string;
    id: string;
    currentInputDigest: string;
    sceneIds: string[];
    expectedRevision: number;
    now: string;
    /** Choices for values that both the draft and a newer manual edit changed. */
    resolutions?: Partial<Record<FilmDirectionField, FilmDirectionResolution>>;
  },
): Promise<{ proposal: FilmDirectionProposal; treatment: FilmTreatment }> {
  const all = await repository.list(input.projectId);
  const proposal = all.find((p) => p.id === input.id);
  if (!proposal) throw new Error("AI direction not found.");
  if (isDirectionStale(proposal, input.currentInputDigest))
    throw new Error(
      "The Chapter's photos, order or video size changed after this direction was made. Ask the AI again.",
    );
  validateDirectionContent(proposal.content, input.sceneIds);
  const treatment = await films.get(input.projectId);
  if (!treatment || treatment.revision !== input.expectedRevision)
    throw new Error("Film changed in another editor. Reload before approving.");
  const approved = transitionDirection(proposal, "approved", input.now);
  const updated = {
    ...applyApprovedDirection(treatment, approved, input.resolutions),
    revision: treatment.revision + 1,
  };
  if (!(await films.save(updated, treatment.revision)))
    throw new Error("Film changed in another editor. Reload before approving.");
  for (const previous of all)
    if (
      previous.id !== proposal.id &&
      previous.chapterId === proposal.chapterId &&
      previous.status === "approved"
    )
      await repository.save(
        transitionDirection(previous, "superseded", input.now),
      );
  await repository.save(approved);
  return { proposal: approved, treatment: updated };
}

/** The approved direction a new render must use, or null when the Chapter needs approval. */
export function currentApprovedDirection(
  proposals: readonly FilmDirectionProposal[],
  chapterId: string,
  currentInputDigest: string,
): FilmDirectionProposal | null {
  const approved = proposals.find(
    (p) => p.chapterId === chapterId && p.status === "approved",
  );
  return approved && !isDirectionStale(approved, currentInputDigest)
    ? approved
    : null;
}
