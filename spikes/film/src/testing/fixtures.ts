// Helpers for reading committed fixtures in tests and acceptance checks.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SemanticContext } from "../contracts/semantic.js";
import type { FilmStyleRecipe, FontAssetManifest } from "../contracts/types.js";

export const FIXTURES = fileURLToPath(new URL("../../fixtures/", import.meta.url));

export function readFixture<T = unknown>(relative: string): T {
  return JSON.parse(readFileSync(`${FIXTURES}${relative}`, "utf8")) as T;
}

export function listFixtures(relativeDir: string): string[] {
  return readdirSync(`${FIXTURES}${relativeDir}`, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => `${relativeDir}/${e.name}`)
    .sort();
}

export interface InvalidFixture {
  expect: { path: string };
  context?: { recipe?: string; fonts?: string[]; storyGraph?: string };
  document: unknown;
}

export function contextFor(spec: InvalidFixture["context"]): SemanticContext {
  if (!spec) return {};
  const fonts = (spec.fonts ?? []).map((f) => readFixture<FontAssetManifest>(f));
  return {
    ...(spec.recipe ? { recipe: readFixture<FilmStyleRecipe>(spec.recipe) } : {}),
    ...(spec.storyGraph ? { storyGraph: readFixture(spec.storyGraph) } : {}),
    font: (ref) => fonts.find((f) => f.id === ref.id && f.version === ref.version),
  };
}
