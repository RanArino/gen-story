import type { FilmRepositoryPort } from "@gen-story/application";
import type { FilmJob, FilmTreatment } from "@gen-story/domain";
import { eq, and, desc } from "drizzle-orm";
import type { GenStoryDatabase } from "../db/client";
import { filmTreatments, filmJobs } from "../db/schema";

export class SqliteFilmRepository implements FilmRepositoryPort {
  constructor(private db: GenStoryDatabase) {}
  async get(projectId: string): Promise<FilmTreatment | null> {
    const row = this.db
      .select()
      .from(filmTreatments)
      .where(eq(filmTreatments.projectId, projectId))
      .get();
    return row ? (JSON.parse(row.document) as FilmTreatment) : null;
  }
  async save(
    treatment: FilmTreatment,
    expectedRevision: number,
  ): Promise<boolean> {
    if (expectedRevision === 0) {
      return (
        this.db
          .insert(filmTreatments)
          .values({
            projectId: treatment.projectId,
            revision: treatment.revision,
            document: JSON.stringify(treatment),
          })
          .onConflictDoNothing()
          .run().changes === 1
      );
    }
    return (
      this.db
        .update(filmTreatments)
        .set({
          revision: treatment.revision,
          document: JSON.stringify(treatment),
        })
        .where(
          and(
            eq(filmTreatments.projectId, treatment.projectId),
            eq(filmTreatments.revision, expectedRevision),
          ),
        )
        .run().changes === 1
    );
  }
  async jobs(projectId: string): Promise<FilmJob[]> {
    return this.db
      .select()
      .from(filmJobs)
      .where(eq(filmJobs.projectId, projectId))
      .orderBy(desc(filmJobs.createdAt))
      .all()
      .map((r) => JSON.parse(r.document) as FilmJob);
  }
  async saveJob(job: FilmJob, snapshot: string): Promise<void> {
    this.db
      .insert(filmJobs)
      .values({
        id: job.id,
        projectId: job.projectId,
        createdAt: job.createdAt,
        document: JSON.stringify(job),
        snapshot,
      })
      .onConflictDoUpdate({
        target: filmJobs.id,
        set: { document: JSON.stringify(job) },
      })
      .run();
  }
  attachSnapshot(id: string, snapshot: string): void {
    this.db.update(filmJobs).set({ snapshot }).where(eq(filmJobs.id, id)).run();
  }
  snapshot(id: string): string | null {
    return (
      this.db.select().from(filmJobs).where(eq(filmJobs.id, id)).get()
        ?.snapshot ?? null
    );
  }
  async failInterrupted(): Promise<void> {
    for (const row of this.db.select().from(filmJobs).all()) {
      const job = JSON.parse(row.document) as FilmJob;
      if (job.status === "running" || job.status === "queued")
        await this.saveJob(
          {
            ...job,
            status: "failed",
            error: "Rendering was interrupted. Render again to retry.",
          },
          row.snapshot,
        );
    }
  }
}
