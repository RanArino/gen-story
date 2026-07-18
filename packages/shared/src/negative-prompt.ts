// Negative-prompt vocabulary shared across the API boundary.
//
// `gpt-image` has no native `negative_prompt` parameter, so these phrases are
// merged and folded into the single composed prompt as a trailing `avoid: …`
// clause (see `composeImagePrompt`). The same vocabulary backs the web UI's
// "Insert recommended fence" action, so it lives here in `packages/shared`
// rather than in `apps/api`.

// Always-on floor. Suppresses the universally-broken cases regardless of the
// user's fence. Injected into every generation request.
export const BASE_NEGATIVE_PROMPT =
  "text, captions, letters, numbers, watermark, logo, signature, " +
  "extra limbs, deformed hands, extra fingers, distorted faces, jpeg artifacts";

// One-click template the project-level fence can be seeded with (H7).
// Two-sided: suppress drift toward raw photo AND toward generic illustration.
export const RECOMMENDED_NEGATIVE_FENCE =
  "raw photo, photoreal skin texture, CGI render, " +
  "anime, chibi, sticker art, thick black outlines, children's storybook";

function splitPhrases(value: string): string[] {
  return value
    .split(",")
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length > 0);
}

// Merge base + project + scene negatives, de-duplicate exact phrases (after
// trimming), and join with ", ". Empty inputs are skipped. Ordering is
// base → project → scene. Pure and deterministic.
export function composeNegativePrompt(
  base: string,
  project: string,
  scene: string,
): string {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const phrase of [
    ...splitPhrases(base),
    ...splitPhrases(project),
    ...splitPhrases(scene),
  ]) {
    if (seen.has(phrase)) {
      continue;
    }
    seen.add(phrase);
    merged.push(phrase);
  }

  return merged.join(", ");
}
