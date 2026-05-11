import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { getDatabasePath, openDatabase } from "../apps/api/src/db/client.ts";
import { generatedImages, photoAssets } from "../apps/api/src/db/schema.ts";

function uploadsRoot(): string {
  const sqlitePath = getDatabasePath();
  return join(sqlitePath, "..", "uploads");
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    try {
      if (statSync(fullPath).isDirectory()) {
        results.push(...walkDir(fullPath));
      } else {
        results.push(fullPath);
      }
    } catch {
      // skip unreadable entries
    }
  }
  return results;
}

async function main() {
  const root = uploadsRoot();
  const { db, close } = openDatabase();

  try {
    const knownKeys = new Set<string>();

    const photoRows = db.select({ storageKey: photoAssets.storageKey }).from(photoAssets).all();
    for (const row of photoRows) knownKeys.add(row.storageKey);

    const imageRows = db.select({ storageKey: generatedImages.storageKey }).from(generatedImages).all();
    for (const row of imageRows) knownKeys.add(row.storageKey);

    const allFiles = walkDir(root);
    const orphans = allFiles.filter((file) => {
      const key = relative(root, file);
      return !knownKeys.has(key);
    });

    if (orphans.length === 0) {
      console.log("No orphan files found.");
    } else {
      console.log(`Found ${orphans.length} orphan file(s):`);
      for (const f of orphans) console.log(`  ${f}`);
    }
  } finally {
    close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
