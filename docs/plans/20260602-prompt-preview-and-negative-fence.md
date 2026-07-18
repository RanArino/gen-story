# Composed-Prompt Preview and Negative-Prompt Deviation Fence

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.


## Purpose / Big Picture

Today the image prompt that actually reaches the model is stitched together entirely server-side in `apps/api/src/generation/prompt-composer.ts`. The user never sees it. They edit a scene's `imagePrompt`, pick a camera/lighting/emotion, maybe tweak the project `commonPrompt` and the new adjustment chips — then click generate and pay for an API call before discovering the composed result looked nothing like they intended. There is also no way to say "no text, no watermark, no extra people, don't drift into anime / don't drift into raw photo" — the app has no negative-prompt concept anywhere.

This ExecPlan delivers two tightly-related, low-risk controls that close that gap. Both center on the same composer and the same generation path, so they ship together.

After this ExecPlan the user gains:

1. **Composed-prompt preview (proposal A4).** A collapsible "What we'll send to the model" panel in the StoryboardPage scene editor and in the ReviewPage re-generate modal. It shows the exact positive prompt and the exact negative prompt that the next generation will use, computed from the *current unsaved form values* — for free, with no image call. This closes the loop opened by the adjustment chips (A6): the user nudges "Warmer / More cinematic", then sees the resulting prompt text before spending a credit.

2. **Negative prompt as a "deviation fence" (proposals A5 + H7).** A per-project negative prompt (`storyboards.negativePrompt`) and an optional per-scene negative prompt (`scenes.negativePrompt`), both editable. On top of those, an always-on `BASE_NEGATIVE_PROMPT` floor (text / watermark / logo / signature / deformed hands / extra limbs) is auto-injected into every request. The project field is the user-tunable "fence" that keeps a series inside its intended band — the UI offers a one-click "Insert recommended fence" that pastes a two-sided template (suppress drift toward raw photo *and* toward generic anime/sticker illustration), per H7.

A user can verify it end to end by: opening a scene, expanding "What we'll send to the model", and seeing the positive prompt plus `avoid: text, watermark, logo, …`; typing `no extra people, no balloons` into the project negative prompt and watching the preview's `avoid:` clause update live; clicking "Insert recommended fence" and seeing the two-sided drift terms appear; then generating one image and confirming via `GET /api/debug/generation-requests` that the stored composed prompt for that request contains the same `avoid:` clause the preview showed.

This plan changes two `❌` rows in `docs/gap-analysis.md` §18.A to `🟡 In progress`:

- "A4. Composed-prompt preview before submit"
- "A5. Negative prompt field (scene + project)" (designed as the H7 deviation fence)


## Progress

- [x] (2026-06-02) Edit `docs/gap-analysis.md` in the same change as this plan: flip the §18.A A4 and A5 `❌` rows to `🟡 In progress` with a notes pointer to this file; update the summary-table row "Accepted UX proposals — A (feedback/flow)" (`In progress` 1 → 3, `Missing` 7 → 5); update the §449 "None have ExecPlans yet" note.
- [x] (2026-06-02) Milestone 1 — Negative-prompt vocabulary in `packages/shared` (`BASE_NEGATIVE_PROMPT`, `RECOMMENDED_NEGATIVE_FENCE`, `composeNegativePrompt`), re-exported from `index.ts`, with unit tests. Added `packages/shared/src/negative-prompt.ts` + `negative-prompt.test.ts` (5 tests, all green); re-exported the three symbols from `index.ts`.
- [x] (2026-06-02) Milestone 2 — Domain + DTO + schema: added `negativePrompt: string` to `Storyboard`/`Scene` models (+ create inputs + factories incl. `createTemplateScene`/`createComplementScene`), `StoryboardDto`/`SceneDto` + mappers, and the Zod `UpsertStoryboardSchema`/`SceneInputSchema`. Also threaded through `UpsertStoryboardInput`/`SceneInput` and the PUT storyboard/scenes routes. **Deviation from plan:** rather than defaulting to `""` in the route handler (which would clobber an existing value on a partial save), the use case preserves the existing value when the field is `undefined` (`input.negativePrompt ?? existing ?? ""`), mirroring how `commonPrompt`/`notes` are preserved. Updated one `toEqual` fixture in `model.test.ts`.
- [x] (2026-06-02) Milestone 3 — Added `negative_prompt text NOT NULL DEFAULT ''` to both `storyboards` and `scenes` in `schema.ts`; generated `drizzle/migrations/0009_pink_master_chief.sql` (two `ALTER TABLE … ADD` statements) and applied it; mirrored `commonPrompt` read/write in `repositories.ts` (`mapStoryboard`/`mapScene` + both `save` insert/update sites). `pnpm typecheck` + full `pnpm test` (161 tests) green.
- [x] (2026-06-02) Milestone 4 — `composeImagePrompt` now takes an optional already-merged `negativePrompt` and appends a trailing `, avoid: <…>` segment when non-empty. **Extracted the shared `composeScenePrompt` helper early** (`apps/api/src/generation/compose-scene-prompt.ts`) since both the preprocessor and the M5 preview endpoint need identical gather+compose; `local-image-preprocessing.ts` now delegates to it, merges the negative via `composeNegativePrompt(BASE, project, scene)`, and records `negativePrompt` in the returned `inputJson` alongside `prompt`. Added 2 composer tests (avoid-clause present / absent). Boundary check clean.
- [x] (2026-06-02) Milestone 5 — Added `PreviewScenePromptSchema` (all fields optional) and the read-only `POST /api/scenes/:sceneId/preview-prompt` route (mirrors the ai-fill auth/ownership guard) returning `{ prompt, negativePrompt }` via the shared `composeScenePrompt`. Added 5 route tests (persisted scene returns base avoid clause; imagePrompt override changes output; projectNegativePrompt override merges into avoid clause; 404 unknown scene; 403 cross-org). 99 api tests green; typecheck + lint clean.
- [x] (2026-06-02) Milestone 6 — Web UI complete. `api-client.ts`: added `negativePrompt` to storyboard/scene upsert inputs and a `previewScenePrompt` helper (+ `PreviewScenePromptOverrides`/`ComposedPromptPreview` types). New reusable `apps/web/src/components/common/ComposedPromptPreview.tsx` (collapsible, 400 ms-debounced, inline-styled, calls the preview endpoint, shows Prompt + Avoid + "preview only" note). StoryboardPage: project-level "Negative prompt (deviation fence)" accordion with Save + "Insert recommended fence" (appends `RECOMMENDED_NEGATIVE_FENCE`), a per-scene negative-prompt textarea under the image prompt, and the preview panel mounted in each saved scene card — passing the live scene fields **plus the unsaved project common/negative drafts** so editing the project fence updates the preview live. ReviewPage regen modal: preview mounted with the modal's draft override fields. i18n: added `storyboard.sections.negativePrompt`, `storyboard.negativePrompt.*`, `storyboard.fields.sceneNegativePrompt(+Placeholder)`, and a new top-level `composedPrompt.*` namespace to **both** en.json and ja.json (parity test green). typecheck + lint + all 168 tests green; the only `pnpm format` warnings are 4 pre-existing untouched files.
- [~] (2026-06-02) Milestone 7 — Automated validation **complete**: `pnpm typecheck`, `pnpm lint` (only a pre-existing unrelated warning), full `pnpm test` (168 tests), and `pnpm build` all green. Ran a **free live end-to-end smoke test** against the real running API + SQLite (no OpenAI call): `POST /api/scenes/:id/preview-prompt` returns the positive prompt ending in `avoid: text, …, jpeg artifacts` and `negativePrompt` = base floor; an `imagePrompt` override changes the output; a `projectNegativePrompt` override is appended to both the avoid clause and `negativePrompt`; persisting `storyboards.negativePrompt` via `PUT` round-trips through SQLite **and preserves `commonPrompt`** on a partial save; an unknown scene returns 404. **Still pending (requires the user — paid + browser):** one real OpenAI image generation to confirm the stored `inputJson.prompt` ends with the same `avoid:` clause the preview showed, the in-modal regen preview visual check, and the three screenshots under `docs/plans/artifacts/20260602-prompt-preview-and-negative-fence/`.
- [ ] Flip the two §18.A rows from `🟡` to `✅` — held until the paid real-generation demo + screenshots above are done; the rows stay `🟡 In progress` for now.


## Surprises & Discoveries

- Observation: OpenAI's `gpt-image-2` has **no native `negative_prompt` parameter**. The adapter sends a single `prompt` string to `images.generate()` / `images.edit()`.
  Evidence: `apps/api/src/generation/openai-image-generation.ts:68-92` passes only `prompt: String(prompt)`, `model`, `size`, `quality`. Implication: the negative prompt must be folded into the positive prompt as a trailing `avoid: …` clause inside `composeImagePrompt`, not passed as a separate field. This is why the preview shows the merged result rather than a separate API field.

- Observation: `composeImagePrompt` has exactly one production caller, so the composition is easy to keep in one place.
  Evidence: `rg "composeImagePrompt"` shows only `apps/api/src/images/local-image-preprocessing.ts:63` (plus the test file). The new preview endpoint will be the second caller and must use the identical input-gathering so preview == reality.

- Observation: `local-image-preprocessing.ts` already accepts a `commonPromptOverride` and gathers exactly the inputs the composer needs (scene fields, storyboard tone, style preset prompt, common prompt).
  Evidence: `apps/api/src/images/local-image-preprocessing.ts:34-72`. The preview endpoint should gather the same inputs the same way; factoring a small shared helper avoids drift between preview and generation.

- Observation: The adjustment-chips work (current branch `feat/generation-adj-chips`) appends suffixes to `storyboards.commonPrompt` on confirm.
  Evidence: `docs/plans/20260526-test-generation-adjustment-chips.md` Milestone 5. Implication: the A4 preview automatically reflects chip effects because they live in `commonPrompt`, which the composer already includes — no extra wiring needed.

- Observation: `storyboards.commonPrompt` is the precedent for "a `text NOT NULL DEFAULT ''` prompt column threaded through schema → domain → DTO → mapper → repo → composer".
  Evidence: `apps/api/src/db/schema.ts:113`, `packages/domain/src/model.ts:139`, `packages/shared/src/index.ts:98`, `apps/api/src/http/dto-mappers.ts:131`, `apps/api/src/db/repositories.ts` (storyboard mapping). The two new `negativePrompt` columns mirror this precedent exactly.

- Observation (2026-06-02, live verification): A free smoke test against the running API + SQLite confirmed the shared `composeScenePrompt` helper keeps preview == reality. For a seeded scene the preview returned a positive prompt ending in `…, avoid: text, captions, …, jpeg artifacts` with `negativePrompt` equal to `BASE_NEGATIVE_PROMPT`; passing `projectNegativePrompt: "no extra people, no balloons"` appended those phrases after the base floor in both the `avoid:` clause and `negativePrompt`. Persisting `storyboards.negativePrompt` via `PUT` round-tripped through SQLite and left `commonPrompt` untouched (validating the "preserve existing on partial save" decision in Milestone 2).


## Decision Log

- Decision: Implement the negative prompt as a **textual `avoid: …` clause folded into the single composed prompt**, not as a separate API parameter.
  Rationale: `gpt-image-2` has no negative-prompt field (see Surprises). Folding it into the prompt is the only mechanism the current adapter supports, and it keeps the preview honest (the preview shows the literal string the model receives).
  Date/Author: 2026-06-02 / Claude

- Decision: Three-layer negative composition — `BASE_NEGATIVE_PROMPT` (always-on floor) + `storyboards.negativePrompt` (project fence) + `scenes.negativePrompt` (optional per-scene), merged in that order, de-duplicated by exact phrase, joined with `, `.
  Rationale: The base floor guarantees the universally-broken cases (text, watermark, deformed hands) are always suppressed even if the user clears their fence. The project fence is the H7 "deviation fence" the user tunes once per series. The scene field handles one-off exceptions. This mirrors how positive prompt layers (style → common → scene) already stack in the composer.
  Date/Author: 2026-06-02 / Claude

- Decision: Do **not** auto-fill `storyboards.negativePrompt` with the drift fence on storyboard creation; keep the DB default `''` and offer a one-click "Insert recommended fence" (`RECOMMENDED_NEGATIVE_FENCE`) in the UI instead.
  Rationale: Respects user control and keeps migrations clean (no data backfill, no surprise text). The recommended fence is one button away, satisfying H7's "fence that keeps the narrow band" without forcing it.
  Date/Author: 2026-06-02 / Claude

- Decision: The preview endpoint is `POST` and accepts **optional override fields** (imagePrompt, emotion, cameraDirection, lightingDirection, motionDirection, sceneNegativePrompt, projectNegativePrompt, commonPrompt) that fall back to the persisted scene/storyboard values when omitted.
  Rationale: The preview must reflect the user's *current unsaved* editor/modal state, not just what's persisted, or it would be misleading mid-edit. POST-with-overrides also lets the ReviewPage regen modal preview the exact prompt for its draft override fields before queuing. It performs no image call, so it is free and safe to call on every keystroke (debounced).
  Date/Author: 2026-06-02 / Claude

- Decision: Keep the negative vocabulary (`BASE_NEGATIVE_PROMPT`, `RECOMMENDED_NEGATIVE_FENCE`, `composeNegativePrompt`) in `packages/shared`, not `packages/domain`.
  Rationale: It is API-contract metadata consumed by both `apps/api` (composer) and `apps/web` (the "insert recommended fence" button shows the same text). This matches the precedent set by `TEST_ADJUSTMENTS` in the adjustment-chips plan, and keeps `packages/domain` free of prompt-string vocabulary.
  Date/Author: 2026-06-02 / Claude

- Decision: Scope this plan to A4 + A5/H7 only. Defer H4 (auto-reinjection of head-count/clothing invariants) and the broader "named dials" H8 redesign to separate plans.
  Rationale: A4 + A5 share one file (`prompt-composer.ts`) and one path (the generation request) and are both S–M effort. H4 needs its own `storyboards.invariants` JSON model and is a distinct change. Keeping scope tight keeps the migration additive and the review small.
  Date/Author: 2026-06-02 / Claude


## Outcomes & Retrospective

To be filled in at completion. Record: (a) whether the folded `avoid:` clause measurably reduced text/watermark artifacts on real generations, (b) whether users actually edited the project fence or relied on the recommended template, (c) whether the live preview was called often enough to warrant caching/debounce tuning, (d) any model-specific quirks where `gpt-image-2` ignored negative terms.


## Context and Orientation

`gen-story` is a pnpm monorepo with clean-architecture layer isolation (see `CLAUDE.md` and `AGENTS.md`). `packages/domain` is framework-free; `packages/application` holds use cases + ports; `packages/shared` holds the API-contract DTOs and constants; `apps/api` is the Node HTTP server and the only place adapters live; `apps/web` is the Next.js frontend. Terms used below:

- **Composer** — `apps/api/src/generation/prompt-composer.ts`. `composeImagePrompt(input)` (line 82) builds the final positive prompt by pushing ordered segments (style preset → common prompt → camera → image prompt → emotion → lighting → motion → depth → tone color) and `join(", ")`-ing them. Pure, no I/O.
- **Preprocessor** — `apps/api/src/images/local-image-preprocessing.ts`. `preprocess()` (line 34) loads the scene, storyboard, and style preset, calls `composeImagePrompt` (line 63), normalizes input photos, and returns `{ ...inputJson, normalizedInputImages, prompt }` (line 122). It already takes a `commonPromptOverride`.
- **OpenAI adapter** — `apps/api/src/generation/openai-image-generation.ts`. Sends a single `prompt` string; **no negative-prompt field exists** (line 68-92).
- **Storyboard / Scene models** — `packages/domain/src/model.ts:111` (`Scene`) and `:133` (`Storyboard`). `Storyboard.commonPrompt` is the closest precedent for a new prompt column.
- **DTOs** — `packages/shared/src/index.ts`: `StoryboardDto` (line 92), `SceneDto` (line 109).
- **Mappers** — `apps/api/src/http/dto-mappers.ts`: `toStoryboardDto` (line 131), `toSceneDto` (line 145).
- **Schemas** — `apps/api/src/http/schemas.ts`: `UpsertStoryboardSchema` (line 20), `SceneInputSchema` (line 28).
- **Routes** — `apps/api/src/http/routes.ts`: `PUT /api/storyboards/:storyboardId` (line 466), `PUT /api/storyboards/:storyboardId/scenes` (line 556), `POST /api/scenes/:sceneId/ai-fill` (line 759) — the closest template for the new preview endpoint.
- **Web** — `apps/web/src/components/storyboard/StoryboardPage.tsx` (1568 lines, scene editor + project common-prompt UI) and `apps/web/src/components/review/ReviewPage.tsx` (823 lines, regen modal around lines 500-640).

Line numbers above are accurate as of 2026-06-02 and may drift; treat the symbol names as authoritative.


## Plan of Work

Seven milestones in dependency order. The approach is the minimal sufficient path because both features funnel through the single existing composer; the only new persistence is two additive `text DEFAULT ''` columns, and the only new endpoint is a read-only (free) preview.


### Milestone 1 — Negative-prompt vocabulary in `packages/shared`

Files: a new `packages/shared/src/negative-prompt.ts`, re-exported from `packages/shared/src/index.ts`; tests in `packages/shared/src/negative-prompt.test.ts`.

Add:

    // Always-on floor. Suppresses the universally-broken cases regardless of
    // the user's fence. Injected into every generation request.
    export const BASE_NEGATIVE_PROMPT =
      "text, captions, letters, numbers, watermark, logo, signature, " +
      "extra limbs, deformed hands, extra fingers, distorted faces, jpeg artifacts";

    // One-click template the project-level fence can be seeded with (H7).
    // Two-sided: suppress drift toward raw photo AND toward generic illustration.
    export const RECOMMENDED_NEGATIVE_FENCE =
      "raw photo, photoreal skin texture, CGI render, " +
      "anime, chibi, sticker art, thick black outlines, children's storybook";

    // Merge base + project + scene negatives, de-duplicate exact phrases,
    // join with ", ". Empty inputs are skipped. Pure, deterministic.
    export function composeNegativePrompt(
      base: string,
      project: string,
      scene: string,
    ): string { /* split each on commas, trim, drop empties, de-dup, re-join */ }

Cover `composeNegativePrompt` with tests: empty project+scene returns just the base; duplicate phrase across layers appears once; ordering is base → project → scene.


### Milestone 2 — Domain, DTO, and schema fields

Files: `packages/domain/src/model.ts`, `packages/shared/src/index.ts`, `apps/api/src/http/schemas.ts`.

1. Add `negativePrompt: string;` to `Storyboard` (`model.ts:133`) and to `Scene` (`model.ts:111`). Treat `""` as "no negative" — non-nullable string mirrors `commonPrompt`.
2. Add `negativePrompt: string;` to `StoryboardDto` (`index.ts:92`) and `SceneDto` (`index.ts:109`).
3. Schemas: add `negativePrompt: z.string().optional()` to `UpsertStoryboardSchema` (`schemas.ts:20`) and to `SceneInputSchema` (`schemas.ts:28`). Default to `""` when absent in the route handlers that build the use-case inputs (`routes.ts` PUT storyboard ~line 466 and PUT scenes ~line 599).

This milestone will not compile cleanly until Milestone 3 wires the repo, which is expected; run `pnpm typecheck` after Milestone 3.


### Milestone 3 — DB migration + repository mapping

Files: `apps/api/src/db/schema.ts`, a generated migration under `drizzle/migrations/`, `apps/api/src/db/repositories.ts`.

1. In `schema.ts`, add to the `storyboards` table (after `commonPrompt`, line 113) and the `scenes` table (after `notes`, line 146):

       negativePrompt: text("negative_prompt").notNull().default(""),

2. Generate and apply (from repo root — the `db:generate` cwd bug noted in gap-analysis §17 is already fixed):

       pnpm --filter @gen-story/api db:generate
       pnpm --filter @gen-story/api db:migrate

   Expect a new `drizzle/migrations/0009_*.sql` adding both columns, registered in `drizzle/migrations/meta/_journal.json`.

3. In `repositories.ts`, mirror the existing `commonPrompt` read/write for both new columns in the storyboard repo and the scene repo (insert, update, and row→domain mapping). Search the file for `commonPrompt` and `notes` to find every site to mirror.


### Milestone 4 — Composer + preprocessing thread the negative

Files: `apps/api/src/generation/prompt-composer.ts`, `apps/api/src/images/local-image-preprocessing.ts`, `apps/api/src/generation/prompt-composer.test.ts`.

1. Extend `composeImagePrompt`'s input with `negativePrompt: string` (already-merged). After building `segments`, if `negativePrompt.trim()` is non-empty, append a final segment `"avoid: " + negativePrompt.trim()`. The function still returns one string.
2. In `preprocess()` (`local-image-preprocessing.ts:63`), compute the merged negative with the shared helper and pass it in:

       import { BASE_NEGATIVE_PROMPT, composeNegativePrompt } from "@gen-story/shared";
       // …
       const negativePrompt = composeNegativePrompt(
         BASE_NEGATIVE_PROMPT,
         storyboard.negativePrompt ?? "",
         scene.negativePrompt ?? "",
       );
       const composedPrompt = composeImagePrompt({ /* …existing… */, negativePrompt });

   Also include `negativePrompt` in the returned `inputJson` (alongside `prompt`) so it is auditable via `GET /api/debug/generation-requests` even though the adapter only sends the single composed `prompt`.
3. Extend `prompt-composer.test.ts`: a case with a non-empty negative asserts the output ends with `, avoid: <…>`; a case with an empty negative asserts no `avoid:` segment is present.


### Milestone 5 — Preview endpoint (A4)

Files: `apps/api/src/http/schemas.ts`, `apps/api/src/http/routes.ts`, optionally a tiny `apps/api/src/generation/compose-scene-prompt.ts` helper; route tests under `apps/api/src/http/`.

1. To keep preview == reality, factor the "gather scene + storyboard + style preset + merged negative, then `composeImagePrompt`" logic used in `local-image-preprocessing.ts` into a small pure-ish helper (e.g. `composeScenePrompt(deps, { sceneId, overrides }) → { prompt, negativePrompt }`) and call it from **both** the preprocessor and the new endpoint. If extraction proves invasive, the fallback is for the endpoint to replicate the same gather+compose inline — but extraction is preferred so the two cannot drift.
2. Add `PreviewScenePromptSchema` to `schemas.ts`: every field optional — `imagePrompt`, `emotion`, `cameraDirection`, `lightingDirection`, `motionDirection`, `sceneNegativePrompt`, `projectNegativePrompt`, `commonPrompt`, all `z.string().optional()`. Omitted fields fall back to the persisted scene/storyboard values.
3. Add route `POST /api/scenes/:sceneId/preview-prompt`, mirroring the auth/ownership guard pattern of `POST /api/scenes/:sceneId/ai-fill` (`routes.ts:759`): `requirePrincipal`, load scene, load storyboard, verify `project.organizationId === principal.organization.id`, else 403/404. Parse the body with `PreviewScenePromptSchema`. Call the helper with overrides. Respond `200 { prompt, negativePrompt }`. It performs **no** generation and writes nothing.
4. Route tests: returns the composed prompt for a persisted scene; an override field changes the output; a non-empty `projectNegativePrompt` appears inside the returned `negativePrompt` and as an `avoid:` clause in `prompt`; 404 for unknown scene; 403 for a scene in another org's project.


### Milestone 6 — Web UI

Files: `apps/web/src/lib/api-client.ts`, `apps/web/src/components/storyboard/StoryboardPage.tsx`, `apps/web/src/components/review/ReviewPage.tsx`, a small reusable `apps/web/src/components/common/ComposedPromptPreview.tsx`, plus the i18n bundles used by these components.

1. API client helpers: `previewScenePrompt(sceneId, overrides) → { prompt, negativePrompt }`; ensure the storyboard-save and scene-save helpers carry the new `negativePrompt` fields.
2. Negative-prompt fields:
   - StoryboardPage: a project-level "Negative prompt (deviation fence)" textarea next to the existing "Common prompt" textarea, with a Save action (reuse the storyboard PUT) and an "Insert recommended fence" button that appends `RECOMMENDED_NEGATIVE_FENCE`.
   - Scene editor card: an optional "Scene negative prompt" textarea under "Image prompt".
3. `ComposedPromptPreview` component: a collapsible "What we'll send to the model" panel. Props: the current draft field values. On expand (and debounced on change) it calls `previewScenePrompt` and renders the returned `prompt` and, separately, the `negativePrompt` (labeled "Avoid"). Show a one-line note: "Preview only — no image is generated."
4. Mount the panel in the StoryboardPage scene editor (using the scene form's live values as overrides) and in the ReviewPage regen modal (using the modal's draft override fields, around `ReviewPage.tsx:500-640`), so the user sees the exact prompt before clicking "Queue generation".
5. Add EN + JA i18n strings for: "Negative prompt (deviation fence)", "Scene negative prompt", "Insert recommended fence", "What we'll send to the model", "Avoid", "Preview only — no image is generated." Follow the i18n pattern established by `docs/plans/20260526-multi-language-japanese-english.md`; keep the *prompt content* (base/recommended negatives) English since the image model is English-trained, translating only the UI chrome.


### Milestone 7 — End-to-end validation

1. `pnpm dev`. Open a project with at least one scene that has a primary photo.
2. In the scene editor, expand "What we'll send to the model". Confirm the positive prompt matches the scene's composed look and the "Avoid" line shows the base floor (`text, …, deformed hands, …`).
3. In the project "Negative prompt" field type `no extra people, no balloons`, and watch the preview's "Avoid" line update (debounced). Click "Insert recommended fence" and confirm the two-sided drift terms append.
4. Save the storyboard. Generate one image for that scene.
5. `GET /api/debug/generation-requests` (or the generation-history page) and confirm the stored `inputJson.prompt` ends with the same `avoid: …` clause the preview showed, including the project and base terms.
6. Open the ReviewPage regen modal for a generated scene, change `imagePrompt` in the modal, and confirm the preview panel inside the modal updates to reflect the unsaved override before queuing.
7. Save screenshots of the scene-editor preview panel, the project negative-prompt field with the recommended fence inserted, and the debug request showing the `avoid:` clause, under `docs/plans/artifacts/20260602-prompt-preview-and-negative-fence/`.


## Concrete Steps

Run all commands from `/Users/ran/my-app/gen-story`.

After each milestone:

    pnpm typecheck
    pnpm lint
    pnpm test

After Milestone 3:

    pnpm --filter @gen-story/api db:generate
    pnpm --filter @gen-story/api db:migrate

Run a single relevant test file, e.g.:

    pnpm --filter @gen-story/api test -- src/generation/prompt-composer.test.ts

Architecture boundary check (must stay clean — `packages/shared` is allowed in `apps/api`, but `packages/domain` must not gain prompt vocabulary imports):

    rg "from ['\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\.\./\.\./apps)" packages/domain packages/application

Before committing:

    pnpm format
    pnpm build


## Validation and Acceptance

| Milestone | Observable success |
|---|---|
| 1 | `BASE_NEGATIVE_PROMPT`, `RECOMMENDED_NEGATIVE_FENCE`, `composeNegativePrompt` exported from `@gen-story/shared`; tests cover empty/dup/ordering; `pnpm typecheck` passes. |
| 2 | `negativePrompt` present on `Storyboard`/`Scene` models, `StoryboardDto`/`SceneDto`, and both Zod schemas. |
| 3 | `pnpm --filter @gen-story/api db:migrate` applies `0009_*` cleanly on a fresh DB; existing storyboard/scene reads/writes round-trip `negativePrompt` defaulting to `""`. |
| 4 | `prompt-composer.test.ts` proves a non-empty negative produces a trailing `, avoid: …` and an empty one does not; a real preprocess includes `negativePrompt` in `inputJson`. |
| 5 | `curl -X POST .../scenes/<id>/preview-prompt -d '{"projectNegativePrompt":"no balloons"}'` returns `200 { prompt, negativePrompt }` where `prompt` ends with an `avoid:` clause containing `no balloons` and the base terms; 404 unknown scene; 403 cross-org. No new generation request is created. |
| 6 | Scene editor and regen modal show a collapsible composed-prompt preview that updates live with form edits; project/scene negative-prompt fields persist; "Insert recommended fence" appends the template. |
| 7 | Manual demo: preview's `avoid:` clause matches the stored `inputJson.prompt` of a real generation; screenshots saved. |


## Idempotence and Recovery

- The schema change is additive (two `text NOT NULL DEFAULT ''` columns). Re-running `db:migrate` is safe; existing rows backfill to `""`.
- The preview endpoint is read-only and side-effect-free; it can be called arbitrarily often (it is debounced client-side only to reduce chatter, not for correctness).
- `composeNegativePrompt` de-duplicates exact phrases, so inserting the recommended fence twice does not double the terms in the merged result (the textarea may still hold duplicate text — the merge cleans it at compose time).
- To recover a botched local DB: `rm data/gen-story.sqlite && pnpm --filter @gen-story/api db:migrate && pnpm --filter @gen-story/api db:seed`.
- If extraction of the shared `composeScenePrompt` helper (Milestone 5) destabilizes the existing generation path, revert to the inline-replication fallback noted in that milestone; the user-visible behavior is identical.


## Artifacts and Notes

- Why fold the negative into the prompt rather than add an adapter field: `gpt-image-2` exposes no `negative_prompt`. If a future provider/model with a real negative field is added (gap-analysis §4, model picker), the merged `negativePrompt` is already computed and stored in `inputJson`, so that adapter can pass it natively with no composer change.
- Cost note: the preview endpoint makes **no** image call and costs nothing — it is the cheap counterpart to the adjustment chips, which each cost one credit. This is consistent with the memory note "image calls cost money, avoid wasteful regeneration": preview lets users get the prompt right before spending.
- Interaction with adjustment chips (current branch): chip suffixes live in `commonPrompt`, which the composer already includes, so the preview reflects them with zero extra work. If both plans are in flight, land the chips plan's `commonPrompt` changes first to avoid merge churn in the composer's input object.
- i18n: translate UI chrome only; keep `BASE_NEGATIVE_PROMPT` / `RECOMMENDED_NEGATIVE_FENCE` English because the image model is English-trained (same rule the chips plan adopted for suffixes).


## Interfaces and Dependencies

- New shared exports: `BASE_NEGATIVE_PROMPT`, `RECOMMENDED_NEGATIVE_FENCE`, `composeNegativePrompt`.
- Modified domain types: `Storyboard` and `Scene` each gain `negativePrompt: string`.
- Modified DTOs: `StoryboardDto`, `SceneDto` each gain `negativePrompt: string`; `toStoryboardDto`/`toSceneDto` map them.
- Modified schemas: `UpsertStoryboardSchema`, `SceneInputSchema` gain optional `negativePrompt`; new `PreviewScenePromptSchema`.
- Modified composer: `composeImagePrompt` input gains `negativePrompt: string`; appends an `avoid:` segment.
- Modified preprocessing: `local-image-preprocessing.ts` merges and threads the negative, and records it in `inputJson`.
- New endpoint: `POST /api/scenes/:sceneId/preview-prompt` → `{ prompt, negativePrompt }` (no side effects).
- New/optional helper: `composeScenePrompt` shared by the preprocessor and the preview endpoint.
- DB: two new columns — `storyboards.negative_prompt`, `scenes.negative_prompt`.
- New web component: `ComposedPromptPreview`; new API-client helper `previewScenePrompt`.
- No new third-party dependencies. No change to the OpenAI adapter.
