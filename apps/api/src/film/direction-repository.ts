import type { FilmDirectionRepositoryPort } from "@gen-story/application";
import type { FilmDirectionProposal } from "@gen-story/domain";
import { desc, eq } from "drizzle-orm";
import type { GenStoryDatabase } from "../db/client";
import { filmDirections } from "../db/schema";

export class SqliteFilmDirectionRepository implements FilmDirectionRepositoryPort {
  constructor(private db: GenStoryDatabase) {}
  /** Newest first, so the first match for a Chapter is its latest proposal. */
  async list(projectId: string): Promise<FilmDirectionProposal[]> {
    return this.db
      .select()
      .from(filmDirections)
      .where(eq(filmDirections.projectId, projectId))
      .orderBy(desc(filmDirections.createdAt))
      .all()
      .map((row) => JSON.parse(row.document) as FilmDirectionProposal);
  }
  async save(proposal: FilmDirectionProposal): Promise<void> {
    const document = JSON.stringify(proposal);
    this.db
      .insert(filmDirections)
      .values({
        id: proposal.id,
        projectId: proposal.projectId,
        chapterId: proposal.chapterId,
        status: proposal.status,
        createdAt: proposal.createdAt,
        document,
      })
      .onConflictDoUpdate({
        target: filmDirections.id,
        set: { status: proposal.status, document },
      })
      .run();
  }
  /** A planner interrupted by a restart cannot finish; show it as failed so the user can retry. */
  async failInterrupted(): Promise<void> {
    for (const row of this.db.select().from(filmDirections).all()) {
      const proposal = JSON.parse(row.document) as FilmDirectionProposal;
      if (proposal.status === "generating")
        await this.save({
          ...proposal,
          status: "failed",
          error: "The AI direction was interrupted. Ask the AI again.",
        });
    }
  }
}
