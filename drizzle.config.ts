import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "drizzle-kit";

const repoRoot = dirname(fileURLToPath(import.meta.url));
const databasePath = resolve(
  repoRoot,
  process.env.GEN_STORY_SQLITE_PATH ?? "data/gen-story.sqlite",
);

export default defineConfig({
  schema: "apps/api/src/db/schema.ts",
  out: "drizzle/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: databasePath,
  },
});
