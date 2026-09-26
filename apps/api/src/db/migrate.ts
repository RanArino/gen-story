import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { sql } from "drizzle-orm";

import { openDatabase, type GenStoryDatabase } from "./client";

const repoRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

export const migrationsFolder = resolve(repoRoot, "drizzle/migrations");

export function migrateDatabase(db: GenStoryDatabase) {
  // Drizzle runs every migration in a transaction. SQLite cannot change this
  // pragma from inside that transaction, but table-rebuild migrations need it
  // disabled while replacing a referenced table.
  db.run(sql.raw("PRAGMA foreign_keys = OFF"));

  try {
    migrate(db, { migrationsFolder });
  } finally {
    db.run(sql.raw("PRAGMA foreign_keys = ON"));
  }
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
