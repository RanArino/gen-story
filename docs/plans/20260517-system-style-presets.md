# Seed the Nine System Style Presets with Prompts and Preview Images

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.


## Purpose / Big Picture

Today a user opening the storyboard page sees a single image style to pick from: "Cinematic". The product requires a gallery of common, copyright-safe styles so the user can choose the look of every generated image for the project. After this change the style gallery shows nine choices — eight concrete looks plus "AI Auto" — each with a real preview image rendered from the *same subject*, so the user can visually compare styles side by side before committing.

Concretely, after this change:

- Running the seed script populates nine `system`-scope rows in the `style_presets` table, each with a human-readable name, description, and a generation `prompt` that produces the intended illustration/texture look.
- The storyboard style gallery (`StoryboardPage`) shows nine selectable tiles, each with a non-stub preview image.
- Selecting a style other than the photorealistic one visibly changes the texture/illustration character of generated images, because `stylePreset.prompt` is already composed into every generation prompt by `apps/api/src/generation/prompt-composer.ts`.

This closes four requirements currently marked `❌` in `docs/gap-analysis.md`, section "4. Image Style Selection":

- System style presets (8 predefined styles + AI auto).
- Style preset `prompt` field defined per style (illustration / texture-axis).
- Style preset preview images for comparison.
- Style preview shows same subject in each style.

Out of scope (remain `❌`): custom style creation from a user-uploaded reference image, per-user custom style reuse, and the model/provider selection UI. These are independent features tracked separately in section 4.


## Progress

- [ ] Define the nine style presets (id, name, description, prompt) as a shared constant.
- [ ] Update the seed script to upsert all nine system presets idempotently.
- [ ] Replace the nine stub files in `apps/web/public/style-previews/` with real preview images whose filenames match the new preset names.
- [ ] Add `scripts/generate-style-previews.ts` to render the previews from one fixed subject through each style prompt.
- [ ] Update `docs/` (gap-analysis status, README/known-limitations if affected).
- [ ] Validate: typecheck, lint, test, and manual gallery check.


## Surprises & Discoveries

- Observation: `previewImageUrl` is derived, not stored. `apps/api/src/http/dto-mappers.ts` builds it as `/style-previews/<preset.name lowercased, spaces→dashes>.jpg`. Therefore the preview filename is fully determined by the preset `name`, and renaming a preset silently breaks its preview link.
  Evidence: `toStylePresetDto` in `apps/api/src/http/dto-mappers.ts` line ~158.
- Observation: The existing nine files in `apps/web/public/style-previews/` are 149-byte stubs named after emotions/colors (`cinematic`, `cool`, `moody`, `neon`, `noir`, `retro`, `soft`, `vibrant`, `warm`), none of which correspond to the required style names. They must be replaced, not reused.
  Evidence: `ls -la apps/web/public/style-previews` shows nine 149-byte `.jpg` files.


## Decision Log

- Decision: Use eight concrete styles plus "AI Auto" for nine total, taken directly from `REQUIREMENTS_INIT.md` lines 60-68.
  Rationale: The requirement enumerates exactly this list. Matching it avoids re-litigating style choices.
  Date/Author: 2026-05-17 / Claude

- Decision: Name styles with generic descriptive English (e.g. "Anime Movie", "Watercolor Illustration") and never reference real studios or artists.
  Rationale: `REQUIREMENTS_INIT.md` line 53 explicitly forbids using existing artist/studio names to avoid copyright concerns.
  Date/Author: 2026-05-17 / Claude

- Decision: "AI Auto" gets a non-empty, neutral `prompt` describing "let composition and tone drive the look; favor a natural cohesive style", rather than an empty string.
  Rationale: `style_presets.prompt` is `NOT NULL` in the schema, and `prompt-composer.ts` composes the value verbatim; an empty prompt would be a silent no-op while a neutral prompt keeps behavior predictable.
  Date/Author: 2026-05-17 / Claude

- Decision: Generate preview images with a dedicated script (`scripts/generate-style-previews.ts`) that renders one fixed subject through each style's prompt, rather than hand-sourcing nine unrelated images.
  Rationale: `REQUIREMENTS_INIT.md` lines 56-57 require previews we provide ourselves AND the *same subject* shown in every style for comparison. A single-subject render loop satisfies both directly and is reproducible.
  Date/Author: 2026-05-17 / Claude


## Outcomes & Retrospective

To be completed when work finishes. Summarize: whether all nine previews render in the gallery, whether seed is idempotent on re-run, and any style prompts that needed tuning after visual inspection.


## Context and Orientation

`gen-story` is a pnpm monorepo with clean-architecture layer isolation (see `CLAUDE.md`). Terms used below:

- **Style preset**: a row in the `style_presets` table. `scope` is either `system` (built-in, not user-editable) or `user` (custom). Columns: `id`, `scope`, `name`, `description`, `prompt`, `createdAt`, `updatedAt`, `deletedAt`. Defined in `apps/api/src/db/schema.ts` (~line 84) and modeled as `StylePreset` in `packages/domain/src/model.ts` (~line 121).
- **Storyboard**: holds `stylePresetId` (`packages/domain/src/model.ts`). The chosen style applies to the whole project, not per scene.
- **Prompt composer**: `apps/api/src/generation/prompt-composer.ts` already composes `stylePreset.prompt` into every image-generation prompt. No change is needed there — once real prompts exist in the DB, generation already uses them.
- **Preview URL**: `apps/api/src/http/dto-mappers.ts` `toStylePresetDto` derives `previewImageUrl = "/style-previews/" + name.toLowerCase().replace(/\s+/g, "-") + ".jpg"`. The web app (Next.js, port 3000) serves `apps/web/public/` at the site root, so `/style-previews/anime-movie.jpg` resolves to `apps/web/public/style-previews/anime-movie.jpg`.
- **Style gallery**: `apps/web/src/components/storyboard/StoryboardPage.tsx` (~lines 680-714) lists `stylePresets` as clickable tiles, each rendering `<img src={p.previewImageUrl}>`.
- **Seed script**: `scripts/seed.ts` currently (lines 111-126) inserts only the "Cinematic" preset if absent.
- **Style preset API**: `GET /api/style-presets` in `apps/api/src/http/routes.ts` (~line 1037) returns `deps.stylePresets.findAll()` mapped through `toStylePresetDto`.
- **OpenAI image adapter**: `apps/api/src/generation/openai-image-generation.ts` wraps `gpt-image` generation; reused by the preview-generation script.

The nine styles, taken from `REQUIREMENTS_INIT.md` lines 60-68, with their derived preview filenames:

- Cinematic Photoreal — シネマティック実写風 — `cinematic-photoreal.jpg`
- Anime Movie — アニメ映画風 — `anime-movie.jpg`
- Warm Hand-Drawn — 温かい手描き風 — `warm-hand-drawn.jpg`
- Luminous Light — 透明感のある光表現 — `luminous-light.jpg`
- Film Photo — フィルム写真風 — `film-photo.jpg`
- Watercolor Illustration — 水彩イラスト風 — `watercolor-illustration.jpg`
- Monochrome Film — モノクロ映画風 — `monochrome-film.jpg`
- 3D Animation — 立体感のある3Dアニメ風 — `3d-animation.jpg`
- AI Auto — AIにおまかせ — `ai-auto.jpg`

Note: the existing seed inserts a preset literally named "Cinematic". This plan renames it to "Cinematic Photoreal" as one of the nine canonical presets. Any storyboard already referencing the old "Cinematic" row by `id` is unaffected because rows are matched by `id`, not name (see Idempotence section).


## Plan of Work

The work is a data/content change plus one helper script; no domain or application-layer code changes are required because the schema, domain model, DTO mapper, API route, and gallery UI already support arbitrary style presets.

1. Create a single source of truth for the nine presets. Add `scripts/style-presets.ts` exporting a `SYSTEM_STYLE_PRESETS` array of `{ id, name, description, prompt }`. Use **fixed, stable string ids** (e.g. `"system-cinematic-photoreal"`), not `crypto.randomUUID()`, so re-seeding is idempotent and preview generation can be matched by id. This file lives under `scripts/` (a plain Node script area, outside the layer-isolated `packages/`), so importing it from other scripts is allowed.

2. Rewrite the style-seeding block in `scripts/seed.ts` (lines 111-126). Replace the single-Cinematic logic with a loop over `SYSTEM_STYLE_PRESETS`: for each, look up an existing row by `id`; if absent, insert it; if present, update `name`/`description`/`prompt`/`updatedAt` so prompt revisions propagate on re-seed. Keep `scope: "system"`. This makes the seed both complete and idempotent.

3. Replace the preview image stubs. Delete the nine emotion-named stub files in `apps/web/public/style-previews/` and add nine real JPEGs named to match the derived filenames listed above. The images are produced by step 4.

4. Add `scripts/generate-style-previews.ts`. It defines one fixed subject description (e.g. "a single young woman standing by a window in soft afternoon light, mid-shot"). For each preset in `SYSTEM_STYLE_PRESETS` it builds a prompt of the form `<subject>, <preset.prompt>`, calls the OpenAI image adapter from `apps/api/src/generation/openai-image-generation.ts`, downscales the result to a small preview (reuse `sharp`, ~480px wide, JPEG) and writes it to `apps/web/public/style-previews/<derived-name>.jpg`. Because every style renders the *same subject*, the gallery satisfies the "same subject in each style" requirement. The script requires `OPENAI_API_KEY`; if it is unset the script must exit with a clear message rather than producing stubs.

5. Update documentation. In `docs/gap-analysis.md` section 4, flip the four targeted rows from `❌` to `✅` once verified (or `🟡` while in progress), update the notes, and adjust the section-4 row of the Summary Table and the Prioritized Next Steps entry. If a new env-var or command is introduced, document it in `.env.example` and `README.md`. Add a note to `docs/known-limitations.md` only if preview images cannot be regenerated without an API key (likely worth recording).

This is the minimal sufficient path: the gap is purely missing seed data and missing assets; the surrounding code already consumes both.


## Concrete Steps

Run all commands from the repository root `/Users/ran/my-app/gen-story`.

1. Create `scripts/style-presets.ts` with the `SYSTEM_STYLE_PRESETS` constant using exactly these nine entries. The `prompt` value is defined here and should be copied as-is unless visual inspection later proves a specific preset needs revision.

       {
         id: "system-cinematic-photoreal",
         name: "Cinematic Photoreal",
         description: "Realistic live-action film look with natural lighting and grounded detail.",
         prompt: "A cinematic photoreal image with natural skin texture, realistic materials, and grounded production design. Use a film-still composition with motivated lighting, controlled depth of field, subtle color grading, and believable shadows. Preserve consistent character identity, wardrobe, and environment details across scenes."
       }

       {
         id: "system-anime-movie",
         name: "Anime Movie",
         description: "Original animated film look with expressive linework and painted backgrounds.",
         prompt: "An original animated feature-film still with clean expressive linework, hand-painted background detail, and soft cel shading. Use dynamic but readable composition, luminous skies or practical light sources, and a vibrant harmonious palette. Keep faces, costumes, and key props consistent across scenes."
       }

       {
         id: "system-warm-hand-drawn",
         name: "Warm Hand-Drawn",
         description: "Gentle hand-drawn storybook look with pencil texture and warm color.",
         prompt: "A warm hand-drawn storybook illustration with visible pencil texture, gentle ink outlines, and softly layered color. Use cozy directional light, rounded shapes, human imperfections, and an intimate mid-shot composition. Keep character proportions and recurring design details stable."
       }

       {
         id: "system-luminous-light",
         name: "Luminous Light",
         description: "Airy digital illustration style focused on transparent light and soft glow.",
         prompt: "A luminous digital illustration centered on transparent light, airy atmosphere, and delicate highlights. Use soft bloom, clean silhouettes, pale reflected color, and a calm composition with generous negative space. Keep the scene readable and avoid washing out faces or important objects."
       }

       {
         id: "system-film-photo",
         name: "Film Photo",
         description: "Analog film photograph look with realistic grain, exposure, and lens feel.",
         prompt: "A natural film photograph with realistic lens rendering, fine grain, and slightly imperfect exposure. Use documentary-style framing, available light, gentle contrast, and authentic color response from analog film. Preserve believable anatomy, materials, and location continuity."
       }

       {
         id: "system-watercolor-illustration",
         name: "Watercolor Illustration",
         description: "Transparent watercolor illustration with paper texture and soft pigment edges.",
         prompt: "A watercolor illustration on textured paper with transparent pigment washes, soft edge bleeding, and restrained pencil underdrawing. Use light tonal contrast, layered color, and uncluttered composition so the subject remains clear. Keep recurring characters recognizable despite the loose medium."
       }

       {
         id: "system-monochrome-film",
         name: "Monochrome Film",
         description: "Black-and-white film still look with rich grayscale and expressive shadows.",
         prompt: "A black-and-white cinematic film still with rich grayscale tonality, controlled contrast, and expressive shadow design. Use classic lens framing, practical light sources, visible film grain, and strong silhouettes. Preserve facial readability and avoid losing important objects in the shadows."
       }

       {
         id: "system-3d-animation",
         name: "3D Animation",
         description: "Stylized 3D animated film look with soft lighting and tactile materials.",
         prompt: "A stylized 3D animated film still with appealing shapes, soft global illumination, tactile materials, and clear depth. Use cinematic camera placement, readable posing, gentle subsurface skin lighting, and polished but not plastic surfaces. Keep character models, costumes, and props consistent across scenes."
       }

       {
         id: "system-ai-auto",
         name: "AI Auto",
         description: "Automatically chooses a cohesive original look that fits the scene.",
         prompt: "Choose the most fitting cohesive visual style for the scene's emotion, setting, and composition while keeping it original and copyright-safe. Prioritize clear storytelling, consistent character identity, stable color logic, readable faces, and continuity with earlier scenes. Do not imitate any named artist, studio, brand, franchise, or copyrighted character."
       }

2. Edit `scripts/seed.ts`: replace lines 111-126 with the upsert-by-id loop over `SYSTEM_STYLE_PRESETS`.

3. Run the seed against a local DB and confirm nine system presets:

       pnpm --filter @gen-story/api db:migrate
       pnpm tsx scripts/seed.ts

   Expected: console output ends with "Seed complete" and no error. Querying the DB shows nine `scope = 'system'` rows.

4. Create `scripts/generate-style-previews.ts`. The script should build a full image prompt from four explicit parts:

   - A fixed subject and setting used for every preset, for example: "A young adult traveler with a red scarf standing beside a train-station window at late afternoon, holding a small notebook."
   - Fixed composition constraints used for every preset: "waist-up shot, three-quarter view, subject centered slightly left, window light from camera right, no text, no logo."
   - The selected `preset.prompt`.
   - A short continuity sentence: "Render the same person, clothing, pose, prop, and environment layout across all style previews; only the visual style changes."

   This makes the previews compare style only, instead of accidentally comparing different subjects, moods, or compositions.

5. Run the preview script with a valid `OPENAI_API_KEY` in the environment:

       OPENAI_API_KEY=... pnpm tsx scripts/generate-style-previews.ts

   Expected: nine JPEG files written under `apps/web/public/style-previews/`, each named per the derived filename, each a real image (not 149 bytes).

6. Visually inspect the generated previews before accepting them. Check that all nine share the same subject, pose, prop, and rough composition; that each preset changes only the intended visual style; and that no preview contains broken anatomy, unreadable faces, accidental text, logos, or obvious imitation of a named studio/artist/franchise. Regenerate or revise only the failing preset prompt, keeping the fixed subject unchanged.

7. Remove the old stub files if their names differ from the new derived names:

       ls -la apps/web/public/style-previews

   Expected: exactly the nine new files; no leftover `cool.jpg`, `moody.jpg`, etc.

8. Validate (see next section).

9. Update `docs/gap-analysis.md` and any other affected docs.


## Validation and Acceptance

Run from the repository root:

- Typecheck: `pnpm typecheck` — passes with no errors.
- Lint: `pnpm lint` — passes.
- Tests: `pnpm test` — Vitest suite stays green. If a routes/dto test asserts on style presets, update it to expect nine.
- Build: `pnpm build` — succeeds.

Manual acceptance:

1. Start the app: `pnpm dev`.
2. Open a project's storyboard page at `http://localhost:3000/projects/<id>/storyboard`.
3. Observe the "Style preset" section: nine tiles are shown, each with a visible preview image (not a broken-image icon), and every preview depicts the same subject in a different visual style.
4. Select a non-photoreal style (e.g. "Watercolor Illustration"); the selection persists after reload (storyboard `stylePresetId` saved).
5. Confirm `GET http://localhost:4000/api/style-presets` returns nine objects, each with a non-null `previewImageUrl` and a non-empty `prompt`.

Acceptance is met when all four targeted `docs/gap-analysis.md` rows are demonstrably true: nine presets exist, each has a real per-style prompt, each has a real preview image, and all previews share one subject.


## Idempotence and Recovery

- Re-running `scripts/seed.ts` is safe: presets are matched by fixed `id`; existing rows are updated in place and missing rows inserted. No duplicate rows are created.
- Because the previously seeded "Cinematic" row used a random UUID, an older local DB may contain a stale "Cinematic" row that the new fixed-id loop will not match. Recovery: either soft-delete the stale row (`deletedAt`) or, for a clean local DB, delete `data/gen-story.sqlite` and re-run `db:migrate` + `seed.ts`. Document whichever is chosen in the Decision Log. Storyboards referencing the stale row keep working; they simply point at a non-canonical preset until re-assigned.
- Re-running `scripts/generate-style-previews.ts` overwrites the nine JPEGs deterministically (same subject, same prompts) — safe to repeat, though the model output will differ run to run.
- If `OPENAI_API_KEY` is unavailable, the preview script must abort with a clear message and write nothing, leaving any existing previews intact.


## Artifacts and Notes

- Required schema: `style_presets` table already exists; no migration is needed. Confirmed in `apps/api/src/db/schema.ts` line 84.
- The four `docs/gap-analysis.md` rows targeted are in section "4. Image Style Selection". On creating this plan they move from `❌` to `🟡 In progress` per `CLAUDE.md`; on completion they move to `✅`, and the section-4 Summary Table row updates accordingly.


## Interfaces and Dependencies

- `scripts/style-presets.ts` (new) — single source of truth for the nine presets; imported by both `seed.ts` and `generate-style-previews.ts`.
- `scripts/seed.ts` (modified) — seeds presets into SQLite via the existing `repos.stylePresets` repository.
- `scripts/generate-style-previews.ts` (new) — depends on the OpenAI image adapter (`apps/api/src/generation/openai-image-generation.ts`), `sharp` for downscaling, and `OPENAI_API_KEY`.
- `apps/web/public/style-previews/*.jpg` (replaced) — static assets served by Next.js.
- No changes to `packages/domain`, `packages/application`, `packages/shared`, the DTO mapper, the API route, or the gallery component — they already support arbitrary presets.
