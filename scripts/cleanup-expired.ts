import { rm } from "node:fs/promises";
import { join } from "node:path";
import { and, isNotNull, lt } from "drizzle-orm";
import { getDatabasePath, openDatabase } from "../apps/api/src/db/client.ts";
import {
  generatedImages,
  photoAssets,
  projects,
  scenes,
  storyboards,
} from "../apps/api/src/db/schema.ts";

const DRY_RUN = process.argv.includes("--dry-run");

function uploadsRoot(): string {
  const sqlitePath = getDatabasePath();
  // ../data/gen-story.sqlite → ../data/uploads
  return join(sqlitePath, "..", "uploads");
}

async function deleteFile(key: string): Promise<void> {
  const filePath = join(uploadsRoot(), key);
  if (DRY_RUN) {
    console.log(`  [dry-run] would delete: ${filePath}`);
    return;
  }
  await rm(filePath, { force: true });
}

async function main() {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { db, close } = openDatabase();

  if (DRY_RUN) console.log("[cleanup-expired] dry-run — no changes will be made\n");

  try {
    const expiredWhere = (deletedAtCol: Parameters<typeof isNotNull>[0]) =>
      and(isNotNull(deletedAtCol), lt(deletedAtCol, cutoff));

    // generated_images — delete files then rows
    const expiredImages = db
      .select({ id: generatedImages.id, storageKey: generatedImages.storageKey })
      .from(generatedImages)
      .where(expiredWhere(generatedImages.deletedAt))
      .all();

    for (const row of expiredImages) await deleteFile(row.storageKey);
    if (!DRY_RUN && expiredImages.length > 0) {
      db.delete(generatedImages).where(expiredWhere(generatedImages.deletedAt)).run();
    }

    // photo_assets — delete files then rows
    const expiredPhotos = db
      .select({ id: photoAssets.id, storageKey: photoAssets.storageKey })
      .from(photoAssets)
      .where(expiredWhere(photoAssets.deletedAt))
      .all();

    for (const row of expiredPhotos) await deleteFile(row.storageKey);
    if (!DRY_RUN && expiredPhotos.length > 0) {
      db.delete(photoAssets).where(expiredWhere(photoAssets.deletedAt)).run();
    }

    // scenes
    const expiredScenes = db
      .select({ id: scenes.id })
      .from(scenes)
      .where(expiredWhere(scenes.deletedAt))
      .all();

    if (DRY_RUN) expiredScenes.forEach((r) => console.log(`  [dry-run] would delete scene: ${r.id}`));
    else if (expiredScenes.length > 0) db.delete(scenes).where(expiredWhere(scenes.deletedAt)).run();

    // storyboards
    const expiredStoryboards = db
      .select({ id: storyboards.id })
      .from(storyboards)
      .where(expiredWhere(storyboards.deletedAt))
      .all();

    if (DRY_RUN) expiredStoryboards.forEach((r) => console.log(`  [dry-run] would delete storyboard: ${r.id}`));
    else if (expiredStoryboards.length > 0) db.delete(storyboards).where(expiredWhere(storyboards.deletedAt)).run();

    // projects
    const expiredProjects = db
      .select({ id: projects.id })
      .from(projects)
      .where(expiredWhere(projects.deletedAt))
      .all();

    if (DRY_RUN) expiredProjects.forEach((r) => console.log(`  [dry-run] would delete project: ${r.id}`));
    else if (expiredProjects.length > 0) db.delete(projects).where(expiredWhere(projects.deletedAt)).run();

    const total =
      expiredImages.length + expiredPhotos.length + expiredScenes.length +
      expiredStoryboards.length + expiredProjects.length;

    if (total === 0) {
      console.log("No expired records found.");
    } else {
      console.log(
        `Purged ${expiredProjects.length} project(s), ${expiredStoryboards.length} storyboard(s), ` +
        `${expiredScenes.length} scene(s), ${expiredPhotos.length} photo asset(s), ` +
        `${expiredImages.length} generated image(s).`,
      );
    }
  } finally {
    close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
