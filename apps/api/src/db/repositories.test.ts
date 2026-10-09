import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { and, eq, isNotNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  repositoryContracts,
  seedBase,
  buildPhotoAsset,
  buildStoryboard,
  buildScene,
  buildChangeProposal,
  seedGenerationFixture,
  buildGeneratedImage,
  now,
  later,
} from "../test-support/repository-contracts";
import type { RepositoryFixture } from "../test-support/repository-contracts";

import {
  createSqliteRepositories,
  migrateDatabase,
  openDatabase,
  type GenStoryDatabase,
  type GenStorySqliteClient,
} from "./index";
import { generatedImages } from "./schema";

repositoryContracts("SQLite repository contracts", withDatabase);

type TestDatabase = RepositoryFixture & {
  client: GenStorySqliteClient;
  db: GenStoryDatabase;
  repositories: ReturnType<typeof createSqliteRepositories>;
};

describe("SQLite persistence", () => {
  it("applies migrations to a blank SQLite database", async () => {
    await withDatabase(async ({ client }) => {
      const table = client.sqlite
        .prepare(
          "select name from sqlite_master where type = 'table' and name = ?",
        )
        .get("projects");

      expect(table).toEqual({ name: "projects" });
    });
  });

  it("upgrades legacy off photo fidelity values to high", async () => {
    await withDatabase(async ({ client, db, repositories }) => {
      await seedBase(repositories);
      await repositories.storyboards.save(buildStoryboard());
      await repositories.scenes.save({
        ...buildScene("scene_legacy", 0),
        photoFidelity: "off",
      });

      client.sqlite
        .prepare("delete from __drizzle_migrations where created_at = ?")
        .run(1790402616000);
      migrateDatabase(db);

      await expect(
        repositories.scenes.findById("scene_legacy"),
      ).resolves.toMatchObject({ photoFidelity: "high" });
    });
  });

  it("keeps a pending change proposal durable across an API restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "gen-story-sqlite-"));
    const databasePath = join(directory, "test.sqlite");

    try {
      const proposal = buildChangeProposal();

      const firstClient = openDatabase(databasePath);
      migrateDatabase(firstClient.db);
      await seedBase(createSqliteRepositories(firstClient.db));
      await createSqliteRepositories(firstClient.db).storyboards.save(
        buildStoryboard(),
      );
      await createSqliteRepositories(firstClient.db).changeProposals.save(
        proposal,
      );
      firstClient.close();

      const restartedClient = openDatabase(databasePath);
      const restartedRepositories = createSqliteRepositories(
        restartedClient.db,
      );
      await expect(
        restartedRepositories.changeProposals.findById(proposal.id),
      ).resolves.toEqual(proposal);
      restartedClient.close();
    } finally {
      rmSync(directory, { force: true, recursive: true });
    }
  });

  it("classifies photo assets from active scene links", async () => {
    await withDatabase(async ({ repositories }) => {
      await seedBase(repositories);
      await repositories.photoAssets.save(buildPhotoAsset("photo_used"));
      await repositories.photoAssets.save(buildPhotoAsset("photo_reference"));
      await repositories.photoAssets.save(buildPhotoAsset("photo_unused"));
      await repositories.storyboards.save(buildStoryboard());
      await repositories.scenes.save(
        buildScene("scene_1", 0, [
          { photoAssetId: "photo_used", role: "primary" },
          { photoAssetId: "photo_reference", role: "reference" },
        ]),
      );

      await expect(
        repositories.photoAssets.classifyPhotoAssetsForProject("project_1"),
      ).resolves.toEqual({
        used: ["photo_used"],
        referenceOnly: ["photo_reference"],
        unused: ["photo_unused"],
      });
    });
  });

  it("hides and restores soft-deleted rows", async () => {
    await withDatabase(async ({ repositories }) => {
      await seedBase(repositories);
      await repositories.photoAssets.save(buildPhotoAsset("photo_1"));
      await repositories.storyboards.save(buildStoryboard());
      await repositories.scenes.save(buildScene("scene_1", 0));

      await repositories.photoAssets.softDelete("photo_1", later);
      await expect(
        repositories.photoAssets.findById("photo_1"),
      ).resolves.toBeNull();

      await repositories.photoAssets.restore("photo_1", later);
      await expect(
        repositories.photoAssets.findById("photo_1"),
      ).resolves.toMatchObject({ id: "photo_1" });

      await repositories.storyboards.softDelete("storyboard_1", later);
      await expect(
        repositories.scenes.findByStoryboardId("storyboard_1"),
      ).resolves.toEqual([]);
      await expect(repositories.scenes.findById("scene_1")).resolves.toBeNull();

      await repositories.storyboards.restore("storyboard_1", later);
      await expect(
        repositories.scenes.findById("scene_1"),
      ).resolves.toMatchObject({ id: "scene_1" });
    });
  });

  it("switches generated image adoption atomically through the adapter helper", async () => {
    await withDatabase(async ({ db, repositories }) => {
      await seedGenerationFixture(repositories);

      await repositories.generatedImages.save(buildGeneratedImage("image_1"));
      await repositories.generatedImages.save(buildGeneratedImage("image_2"));
      await repositories.generatedImages.adoptGeneratedImage(
        "scene_1",
        "image_1",
        now,
      );
      await repositories.generatedImages.adoptGeneratedImage(
        "scene_1",
        "image_2",
        later,
      );

      await expect(
        repositories.scenes.findById("scene_1"),
      ).resolves.toMatchObject({ adoptedGeneratedImageId: "image_2" });
      await expect(
        repositories.generatedImages.findById("image_1"),
      ).resolves.toMatchObject({ adoptedAt: null });
      await expect(
        repositories.generatedImages.findById("image_2"),
      ).resolves.toMatchObject({ adoptedAt: later });

      const adoptedRows = await db
        .select({ id: generatedImages.id })
        .from(generatedImages)
        .where(
          and(
            eq(generatedImages.sceneId, "scene_1"),
            isNotNull(generatedImages.adoptedAt),
          ),
        );

      expect(adoptedRows).toEqual([{ id: "image_2" }]);
    });
  });
});

async function withDatabase(
  test: (database: TestDatabase) => Promise<void>,
): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), "gen-story-sqlite-"));
  const databasePath = join(directory, "test.sqlite");
  let client = openDatabase(databasePath);

  try {
    migrateDatabase(client.db);
    await test({
      client,
      db: client.db,
      repositories: createSqliteRepositories(client.db),
      async reopen() {
        client.close();
        client = openDatabase(databasePath);
        return createSqliteRepositories(client.db);
      },
    });
  } finally {
    client.close();
    rmSync(directory, { force: true, recursive: true });
  }
}
