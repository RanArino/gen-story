import {
  validateFilm,
  type FilmJob,
  type FilmTreatment,
} from "@gen-story/domain";

export interface FilmRepositoryPort {
  get(projectId: string): Promise<FilmTreatment | null>;
  save(treatment: FilmTreatment, expectedRevision: number): Promise<boolean>;
  jobs(projectId: string): Promise<FilmJob[]>;
  saveJob(job: FilmJob, snapshot: string): Promise<void>;
}
export interface FilmRendererPort {
  prepare(
    treatment: FilmTreatment,
    chapterId: string | null,
  ): Promise<{
    fingerprint: string;
    snapshot: string;
    runtimeMs: number | null;
  }>;
}

/** Job inputs are prepared once and bound to a saved revision before execution. */
export async function requestFilmJob(
  repository: FilmRepositoryPort,
  renderer: FilmRendererPort,
  input: {
    id: string;
    projectId: string;
    revision: number;
    chapterId: string | null;
    createdAt: string;
  },
): Promise<{ job: FilmJob; created: boolean }> {
  const treatment = await repository.get(input.projectId);
  if (!treatment || treatment.revision !== input.revision)
    throw new Error("Save the current Film revision before rendering.");
  if (
    input.chapterId !== null &&
    !treatment.chapters.some((c) => c.id === input.chapterId)
  )
    throw new Error("Chapter not found.");
  const prepared = await renderer.prepare(treatment, input.chapterId);
  const duplicate = (await repository.jobs(input.projectId)).find(
    (j) =>
      j.chapterId === input.chapterId &&
      j.fingerprint === prepared.fingerprint &&
      (j.status === "queued" || j.status === "running"),
  );
  if (duplicate) return { job: duplicate, created: false };
  const job: FilmJob = {
    ...input,
    fingerprint: prepared.fingerprint,
    runtimeMs: prepared.runtimeMs,
    status: "queued",
    error: null,
    artifactKey: null,
    artifactDigest: null,
  };
  await repository.saveJob(job, prepared.snapshot);
  return { job, created: true };
}
/** A stale editor must never overwrite a newer saved Treatment. */
export async function saveFilmTreatment(
  repository: FilmRepositoryPort,
  treatment: FilmTreatment,
  sceneIds: string[],
  expectedRevision: number,
): Promise<FilmTreatment> {
  validateFilm(treatment, sceneIds, "draft");
  const updated = { ...treatment, revision: expectedRevision + 1 };
  if (!(await repository.save(updated, expectedRevision)))
    throw new Error("Film changed in another editor. Reload before saving.");
  return updated;
}
