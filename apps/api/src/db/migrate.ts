import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";

import { openDatabase, type GenStoryDatabase } from "./client";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

export const migrationsFolder = resolve(repoRoot, "drizzle/migrations");

export function migrateDatabase(db: GenStoryDatabase) {
  migrate(db, { migrationsFolder });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const client = openDatabase();

  try {
    migrateDatabase(client.db);
  } finally {
    client.close();
  }
}
