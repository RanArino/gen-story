// The three system Cuts in a temporary test world. The committed system Recipes pin the real Noto
// fonts, which only the operator's local registry holds, so tests fork each one with `recipe fork`,
// replacing only the font references with the matching fixture fonts.
import type { RecipeForkInput } from "../authoring/service.js";
import type { FilmStyleRecipe, FilmTreatment, VersionRef } from "../contracts/types.js";
import { readFixture } from "./fixtures.js";
import type { World } from "./world.js";

export const CUTS = ["quiet-cinema", "memory-board", "pulse-cut"] as const;
export type CutName = (typeof CUTS)[number];

const FIXTURE_FONTS: Record<string, string> = {
  "font.noto-sans-jp": "font.fixture-sans-jp",
  "font.noto-serif-jp": "font.fixture-serif-jp",
};

export function systemRecipe(name: CutName): FilmStyleRecipe {
  return readFixture<FilmStyleRecipe>(`recipes/system/${name}.r1.json`);
}

export function systemTreatment(name: CutName): FilmTreatment {
  return readFixture<FilmTreatment>(`project/treatments/${name}.json`);
}

/**
 * Forks a system Recipe into the world with fixture fonts (plus any further replacements) and
 * returns the fork with the Cut's Treatment rebound to it.
 */
export function forkCut(world: World, name: CutName, id: string, changes: Omit<RecipeForkInput, "source" | "id" | "dryRun"> = {}) {
  const system = systemRecipe(name);
  const fixtureFont = (role: "caption" | "title"): VersionRef => {
    const ref = system.fonts.find((f) => f.role === role)!.ref;
    return { id: FIXTURE_FONTS[ref.id] ?? ref.id, version: ref.version };
  };
  const fonts = { caption: fixtureFont("caption"), title: fixtureFont("title"), ...changes.fonts };
  const env = world.service.recipeFork({ ...changes, source: { id: system.id, revision: system.revision }, id, fonts, dryRun: false });
  if (!env.ok) throw new Error(JSON.stringify(env.errors));
  const recipe = env.result!.recipe;
  const treatment = systemTreatment(name);
  return {
    recipe,
    treatment: {
      ...treatment,
      recipe: { id: recipe.id, revision: recipe.revision, digest: env.result!.digest },
      shared: { ...treatment.shared, typography: recipe.fonts.find((f) => f.role === "caption")!.ref },
    } satisfies FilmTreatment,
  };
}
