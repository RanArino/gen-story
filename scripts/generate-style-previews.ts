// Generates the nine style-preview images for the storyboard style gallery.
//
// ONE base image is generated (text-to-image), then restyled into every other
// style via image-to-image editing — so all nine previews show the SAME person
// in the SAME pose and composition, differing only by visual style. This is
// OpenAI's recommended "character anchor" pattern (gpt-image prompting guide).
//
// The base image is cached to data/style-preview-base.png so re-runs do not
// regenerate it. You can also regenerate a single style instead of all nine.
//
// Usage (from the repository root):
//   OPENAI_API_KEY=... pnpm tsx scripts/generate-style-previews.ts
//     -> renders all nine previews (reusing the cached base if present)
//   pnpm tsx scripts/generate-style-previews.ts "Anime Movie" "Film Photo"
//     -> regenerates only the named styles (base reused, no waste)
//   pnpm tsx scripts/generate-style-previews.ts --fresh-base
//     -> forces the base image to be regenerated
//
// OPENAI_API_KEY may also live in a repo-root .env / .env.local file.
//
// Output: apps/web/public/style-previews/<derived-name>.jpg for each preset.

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  generateBaseImage,
  restyleImage,
  toPreviewJpeg,
} from "../apps/api/src/generation/style-preview-renderer.ts";
import { loadEnvFile } from "../apps/api/src/server.ts";
import {
  SYSTEM_STYLE_PRESETS,
  stylePreviewFileName,
  type SystemStylePreset,
} from "./style-presets.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(REPO_ROOT, "apps/web/public/style-previews");

// The preset rendered as the text-to-image base; every other preview is
// restyled from it. Cached so re-runs reuse it instead of paying again.
const BASE_PRESET_ID = "system-cinematic-photoreal";
const BASE_CACHE_PATH = join(REPO_ROOT, "data/style-preview-base.png");

// Load env vars the same way the API server does, so the key can live in a
// repo-root .env / .env.local file. Inline (OPENAI_API_KEY=... pnpm tsx ...)
// still works and takes precedence — loadEnvFile never overwrites a set var.
function loadEnv(): void {
  loadEnvFile(join(REPO_ROOT, ".env.local"));
  loadEnvFile(join(REPO_ROOT, ".env"));
  loadEnvFile(join(REPO_ROOT, "apps/api/.env"));
}

// The seeded "AI Auto" prompt is a meta-instruction, not a visual style. For
// its preview thumbnail, use a concrete descriptive style instead.
const PREVIEW_STYLE_OVERRIDES: Record<string, string> = {
  "system-ai-auto":
    "A cohesive, natural cinematic illustration with gentle color, soft directional light, and clean storytelling — the kind of look an automatic style picker would settle on.",
};

function previewStyleText(preset: SystemStylePreset): string {
  return PREVIEW_STYLE_OVERRIDES[preset.id] ?? preset.prompt;
}

// Base prompt — text-to-image. Structured scene -> subject -> composition ->
// style -> constraints, per the gpt-image prompting guide.
function buildBasePrompt(styleText: string): string {
  return [
    "Create a single photograph of one young adult traveler.",
    "",
    "Scene:",
    "The traveler stands beside a tall train-station window in soft late-afternoon light, holding one small closed notebook. A train and platform are gently visible through and beside the window.",
    "",
    "Subject:",
    "Exactly one person, mid-twenties, wearing a dark coat and a deep-red knitted scarf, with a calm natural expression looking slightly off-camera toward the window light. Natural skin texture and real fabric detail.",
    "",
    "Composition:",
    "Waist-up framing, three-quarter view, subject positioned slightly left of center, soft window light from camera right, eye-level 50mm lens, shallow depth of field.",
    "",
    "Style:",
    styleText,
    "",
    "Constraints:",
    "Output a single image as one continuous frame. No grid, no collage, no contact sheet, no split panels, no multiple variations, no borders. No text, no captions, no watermark, no logo.",
  ].join("\n");
}

// Restyle prompt — image-to-image edit. States the preserve list explicitly
// and repeats it, per the guide's edit guidance ("change only X").
function buildRestylePrompt(styleText: string): string {
  return [
    "Restyle this photograph into a new visual style.",
    "",
    "Keep unchanged (do not redesign the character):",
    "The exact same person — same face, facial features, hairstyle, expression, age, and body. The same dark coat and deep-red knitted scarf. The same small closed notebook. The same pose, three-quarter view, waist-up framing, camera angle, and background layout.",
    "",
    "Change only:",
    "The rendering style, applied evenly across the whole image.",
    "",
    "Target style:",
    styleText,
    "",
    "Constraints:",
    "Output a single image as one continuous frame. No grid, no collage, no contact sheet, no split panels, no multiple variations, no borders. No text, no watermark, no logo.",
  ].join("\n");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

// Resolves CLI selectors to presets. A selector matches a preset id, its name,
// or its derived file slug — all case-insensitively.
function selectPresets(selectors: string[]): SystemStylePreset[] {
  if (selectors.length === 0) {
    return SYSTEM_STYLE_PRESETS;
  }
  const selected: SystemStylePreset[] = [];
  for (const raw of selectors) {
    const needle = raw.toLowerCase();
    const match = SYSTEM_STYLE_PRESETS.find(
      (p) =>
        p.id.toLowerCase() === needle ||
        p.name.toLowerCase() === needle ||
        stylePreviewFileName(p.name).replace(/\.jpg$/, "") === needle,
    );
    if (!match) {
      const names = SYSTEM_STYLE_PRESETS.map((p) => `"${p.name}"`).join(", ");
      throw new Error(`Unknown style "${raw}". Valid styles: ${names}.`);
    }
    if (!selected.includes(match)) {
      selected.push(match);
    }
  }
  return selected;
}

async function main(): Promise<void> {
  loadEnv();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error(
      "OPENAI_API_KEY is not set. Set it in .env / .env.local at the repo " +
        "root, or pass it inline: OPENAI_API_KEY=... pnpm tsx " +
        "scripts/generate-style-previews.ts",
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const freshBase = args.includes("--fresh-base");
  const targets = selectPresets(args.filter((a) => !a.startsWith("--")));

  await mkdir(OUT_DIR, { recursive: true });

  const basePreset = SYSTEM_STYLE_PRESETS.find((p) => p.id === BASE_PRESET_ID);
  if (!basePreset) {
    throw new Error(`Base preset ${BASE_PRESET_ID} not found.`);
  }

  // 1. Obtain the shared base image: reuse the cache unless --fresh-base or no
  //    cache exists. The base is required even when only restyles are targeted.
  let baseImage: Buffer;
  if (!freshBase && (await fileExists(BASE_CACHE_PATH))) {
    baseImage = await readFile(BASE_CACHE_PATH);
    console.log(`Reusing cached base image: ${BASE_CACHE_PATH}`);
  } else {
    console.log(`Generating base image (${basePreset.name}) ...`);
    baseImage = await generateBaseImage({
      apiKey,
      prompt: buildBasePrompt(previewStyleText(basePreset)),
    });
    await mkdir(dirname(BASE_CACHE_PATH), { recursive: true });
    await writeFile(BASE_CACHE_PATH, baseImage);
    console.log(`Saved base image to ${BASE_CACHE_PATH}`);
  }

  // 2. Render each targeted preset: the base preset uses the base image
  //    directly; every other preset restyles that same base image.
  for (const preset of targets) {
    const fileName = stylePreviewFileName(preset.name);
    process.stdout.write(`Rendering ${preset.name} -> ${fileName} ... `);

    const fullImage =
      preset.id === BASE_PRESET_ID
        ? baseImage
        : await restyleImage({
            apiKey,
            baseImage,
            prompt: buildRestylePrompt(previewStyleText(preset)),
          });

    const bytes = await toPreviewJpeg(fullImage);
    await writeFile(join(OUT_DIR, fileName), bytes);
    console.log(`done (${bytes.byteLength} bytes)`);
  }

  console.log(`\nWrote ${targets.length} preview(s) to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
