import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";

import * as schema from "./schema";

export type GenStoryDatabase = BetterSQLite3Database<typeof schema>;

export type GenStorySqliteClient = {
  sqlite: Database.Database;
  db: GenStoryDatabase;
  close: () => void;
};

export function getDatabasePath() {
  const configuredPath =
    process.env.GEN_STORY_SQLITE_PATH ?? "data/gen-story.sqlite";

  if (configuredPath === ":memory:" || isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../..",
    configuredPath,
  );
}

export function openDatabase(
  databasePath = getDatabasePath(),
): GenStorySqliteClient {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const sqlite = new Database(databasePath);

  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite, { schema });

  return {
    sqlite,
    db,
    close: () => sqlite.close(),
  };
}
