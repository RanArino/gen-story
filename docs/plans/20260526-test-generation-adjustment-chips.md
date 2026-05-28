# Test-Generation Adjustment Chips

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.


## Purpose / Big Picture

The test-generation workflow already produces 3 variants and lets the user pick one to confirm. However, the original product spec also asks for **adjustment controls** that nudge the look in plain-language directions — "warmer", "more cinematic", "darker", "brighter", "more candid" — without forcing the user to write prompt deltas by hand. Today that whole loop is missing. After picking a variant, the user's only options are "Confirm" or "Generate new tests" (which re-rolls everything from scratch).

After this ExecPlan, the user gains:

1. **Adjustment chips** below each test variant in the test-generation modal: a fixed palette (Warmer, Cooler, More cinematic, Darker, Brighter, More candid).
2. **Clicking a chip queues a new generation for that single slot** that re-uses the same scene, style, and source photo but appends a curated descriptor suffix to the common project prompt for this run.
3. **The chosen chip's effect is internally applied to the storyboard's `commonPrompt`** when the user confirms a variant — so the downstream bulk generation inherits the same tone shift without the user having to edit prompts.

A user can verify it by: starting test generation, seeing 3 variants, clicking "Warmer" under variant 2, watching that one slot re-roll with a warmer palette, repeating with "More cinematic", then clicking "Confirm with this variant" — and observing the storyboard `commonPrompt` now contains the appended suffix (visible in the StoryboardPage common-prompt textarea) so subsequent bulk generations look the same.

This plan closes two `❌` rows in `docs/gap-analysis.md` §6:

- "Adjustment sliders / buttons (warmer, more cinematic, etc.)"
- "Adjustments update common project prompt internally"


## Progress

- [ ] Edit `docs/gap-analysis.md` in the same change as this plan: flip the two §6 `❌` rows to `🟡 In progress` with a notes pointer to this file, and update the summary table (§6 Test generation workflow → `In progress` +2 / `Missing` −2).
- [ ] Milestone 1 — Curated adjustment dictionary in `packages/shared`.
- [ ] Milestone 2 — Domain support: per-variant `appliedAdjustments` list on `TestGenerationVariant`.
- [ ] Milestone 3 — DB migration for the new column.
- [ ] Milestone 4 — Use case + API endpoint to re-roll a single variant slot with one or more adjustments.
- [ ] Milestone 5 — On confirm, append the confirmed variant's adjustment suffixes to `storyboards.commonPrompt`.
- [ ] Milestone 6 — Web UI: chip row under each variant; client wired to the new endpoint.
- [ ] Milestone 7 — End-to-end validation: chip click re-rolls slot, confirm updates commonPrompt.
- [ ] Flip the two rows in `docs/gap-analysis.md` from `🟡` to `✅` when Milestone 7 passes; update summary table accordingly.


## Surprises & Discoveries

- Observation: The test-generation workflow has 4 endpoints today, none of which support re-rolling a single slot.
  Evidence: `apps/api/src/http/routes.ts:1523–1632` — `POST /test-generation` (create batch of 3), `GET /test-generation/current`, `POST /test-generation/confirm`, `POST /test-generation/reset`. A new endpoint is required.

- Observation: `composeImagePrompt()` in `apps/api/src/generation/prompt-composer.ts:106` already concatenates `commonPrompt` into the segment list. Appending a chip suffix to `commonPrompt` per-request is the minimal way to apply chip effects without restructuring the composer.
  Evidence: `if (commonPrompt.trim()) segments.push(commonPrompt.trim());`.

- Observation: The storyboard already has an editable `commonPrompt` field surfaced in the StoryboardPage UI with Save and Regenerate actions.
  Evidence: `gap-analysis.md` §5. Implication: writing the confirmed-variant suffix back to `storyboards.commonPrompt` will be visible to the user, who can edit or remove it.


## Decision Log

- Decision: Use a **fixed, curated** chip palette of six entries rather than free-text adjustments.
  Rationale: REQUIREMENTS_INIT calls for "warmer / cooler / brighter / etc." style controls. A fixed palette keeps the UX simple, makes telemetry easy, and gives us a single place (the dictionary in shared) to tune the descriptor language. Free-text adjustments would overlap with the existing common-prompt editor.
  Date/Author: 2026-05-26 / Claude

- Decision: Each chip maps to a **single English descriptor suffix** appended to `commonPrompt` for that run. Multiple chips combine by concatenation in click order.
  Rationale: Trivial to implement, deterministic, easy to test. Avoids server-side LLM "rewrite my prompt" calls (cost + nondeterminism). Matches how the existing prompt composer works.
  Date/Author: 2026-05-26 / Claude

- Decision: Re-rolling a chip applies to **only one variant slot** (not all three). The other two variants stay as-is.
  Rationale: Matches the proposal in `docs/ux-enhancement-proposals.md` A6 and avoids burning three OpenAI calls when the user is iterating one slot. Also gives the user a true A/B/C: original variant + warmer variant + cooler variant.
  Date/Author: 2026-05-26 / Claude

- Decision: On confirm, **append** the confirmed variant's `appliedAdjustments` suffixes to `storyboards.commonPrompt` exactly once. If the user re-confirms (rare), de-dup against already-present suffixes by exact string match.
  Rationale: Persisting the chip effect into `commonPrompt` is exactly what the gap-analysis row "Adjustments update common project prompt internally" asks for. Idempotence on re-confirm avoids accumulating duplicates if the user goes back and re-confirms.
  Date/Author: 2026-05-26 / Claude

- Decision: Hard cap of **3 adjustments per variant slot** to bound prompt length and avoid contradictory combinations ("Warmer + Cooler + Darker + Brighter" is incoherent).
  Rationale: Keeps prompts coherent. Surface friendly errors in the UI when exceeded.
  Date/Author: 2026-05-26 / Claude

- Decision: Defer slider-style continuous controls (B5 from `docs/ux-enhancement-proposals.md`). This plan delivers discrete chips only.
  Rationale: Sliders need their own model + persistence + composer changes. The gap-analysis row says "sliders / buttons (warmer, more cinematic, etc.)" — buttons satisfy the row's intent. Sliders are a separate later plan.
  Date/Author: 2026-05-26 / Claude


## Outcomes & Retrospective

To be filled in at completion. Record: (a) whether the curated suffixes produced visually distinct results on real generations, (b) any chips that turned out to be no-ops (e.g., the model ignored "more candid"), (c) telemetry on which chips users actually click, (d) whether the 3-chip cap was a binding limit in practice.


## Context and Orientation

`gen-story` is a pnpm monorepo with clean-architecture layer isolation (see `CLAUDE.md`). Terms used below:

- **TestGenerationBatch** — Domain entity at `packages/domain/src/model.ts:191`. Has `id`, `storyboardId`, `status: "pending" | "completed"`. Each batch has variants (typically 3) tied to generation requests.
- **TestGenerationModal** — Web component at `apps/web/src/components/storyboard/TestGenerationModal.tsx` (327 lines). Polls the batch until variants are ready, then offers "Confirm with this variant" and "Generate new tests".
- **Test-generation routes** — `apps/api/src/http/routes.ts:1523-1632`. Create, fetch current, confirm, reset.
- **Prompt composer** — `apps/api/src/generation/prompt-composer.ts:82-121`. Builds the final image prompt. `commonPrompt` is one of its inputs and is the natural injection point for chip suffixes.
- **Storyboard `commonPrompt`** — Column on `storyboards`; edited via the existing "Save common prompt" button on `StoryboardPage`. Composed into every scene's generation prompt today.


## Plan of Work

Seven milestones in dependency order.


### Milestone 1 — Curated adjustment dictionary

Files: `packages/shared/src/index.ts` (or a new `packages/shared/src/adjustments.ts` imported from `index.ts`).

Add:

    export type TestAdjustmentId =
      | "warmer"
      | "cooler"
      | "more_cinematic"
      | "darker"
      | "brighter"
      | "more_candid";

    export interface TestAdjustment {
      id: TestAdjustmentId;
      label: string;            // EN label; UI may re-translate (see i18n plan)
      promptSuffix: string;     // appended to commonPrompt
    }

    export const TEST_ADJUSTMENTS: Record<TestAdjustmentId, TestAdjustment> = {
      warmer:         { id: "warmer",         label: "Warmer",         promptSuffix: "warmer color temperature, amber and golden tones throughout" },
      cooler:         { id: "cooler",         label: "Cooler",         promptSuffix: "cooler color temperature, blue and teal tones throughout" },
      more_cinematic: { id: "more_cinematic", label: "More cinematic", promptSuffix: "stronger cinematic grade, deeper contrast, anamorphic feel" },
      darker:         { id: "darker",         label: "Darker",         promptSuffix: "lower-key lighting overall, deeper shadows, lifted blacks pulled down" },
      brighter:       { id: "brighter",       label: "Brighter",       promptSuffix: "higher-key lighting overall, brighter midtones, airy exposure" },
      more_candid:    { id: "more_candid",    label: "More candid",    promptSuffix: "candid documentary feel, off-the-cuff framing, natural unposed body language" },
    };

    export const MAX_ADJUSTMENTS_PER_VARIANT = 3;

The shared package is OK to depend on — it is the API contract layer.


### Milestone 2 — Domain support

Files: `packages/domain/src/model.ts`, `packages/domain/src/rules.ts`, `packages/domain/src/index.ts`, plus tests under `packages/domain/src/`.

1. Extend the `TestGenerationVariant` type (or whatever the per-slot record is named today — verify in `model.ts` near line 191) with:

       appliedAdjustments: TestAdjustmentId[]; // default []

   The domain package may not import from `@gen-story/shared`. To keep the layer boundary, redefine the union locally:

       export type TestAdjustmentId =
         | "warmer" | "cooler" | "more_cinematic"
         | "darker" | "brighter" | "more_candid";

   And add a runtime constant `TEST_ADJUSTMENT_IDS: TestAdjustmentId[]` for validation. The shared package then re-exports the same union via `Pick`/`type` matching to keep the wire format aligned (see Decision Log note below if this needs revisiting).

2. Add rule helpers in `rules.ts`:

   - `assertAdjustmentsValid(ids: TestAdjustmentId[])` — throws on duplicates or length > 3.
   - `appendAdjustmentsToCommonPrompt(commonPrompt: string, ids: TestAdjustmentId[], suffixesById: Record<TestAdjustmentId, string>): string` — pure function used by both the per-request prompt build and the on-confirm `commonPrompt` mutation. Skips a suffix if it is already a substring of `commonPrompt` (de-dup).

3. Cover both helpers with unit tests in `rules.test.ts`. Export everything from `index.ts`.

Note on layer boundary: the suffix dictionary itself lives in `@gen-story/shared` because it's API-contract metadata. The domain knows the union and the rule helpers; the suffixes flow in as a parameter at the use-case layer. This preserves `packages/domain` framework-free.


### Milestone 3 — DB migration

Files: `apps/api/src/db/schema.ts`, then a generated migration under `drizzle/migrations/`.

1. Find the `test_generation_variants` table (or wherever variants are persisted — verify schema location from `gap-analysis.md` §6 references and from `db/schema.ts`). Add column:

   - `appliedAdjustmentsJson` text NOT NULL DEFAULT `'[]'` — stores a JSON array of `TestAdjustmentId` values.

2. Generate and apply:

       pnpm --filter @gen-story/api db:generate
       pnpm --filter @gen-story/api db:migrate

3. Update the repository read/write for variants to (de)serialize the column.


### Milestone 4 — Use case + API endpoint for chip re-roll

Files: `packages/application/src/ports.ts`, `packages/application/src/use-cases.ts`, `packages/application/src/index.ts`, `apps/api/src/http/routes.ts`, `apps/api/src/http/dto-mappers.ts`.

1. Use case `applyAdjustmentToTestVariant`:

   - Input: `{ storyboardId, variantId, adjustmentIds: TestAdjustmentId[] }`.
   - Validate via `assertAdjustmentsValid`.
   - Load the variant; compute the effective `commonPrompt` for this re-roll by passing the chip suffixes into `appendAdjustmentsToCommonPrompt` over the storyboard's current `commonPrompt`.
   - Persist `appliedAdjustments = adjustmentIds` on the variant row (replacing previous chip selections for this slot).
   - Queue a new generation request for that slot, supplying the per-request effective `commonPrompt`. The existing image-worker / OpenAI adapter does not need to change — the prompt composer already accepts `commonPrompt` as an input field; we pass the augmented value at request time without mutating the storyboard.
   - Mark the previous variant image (if any) as superseded for that slot. Reuse whatever "supersede" or "delete-on-retry" pattern the existing retry path uses.

2. Route:

       POST /api/storyboards/:storyboardId/test-generation/variants/:variantId/adjustments

   Body: `{ adjustmentIds: TestAdjustmentId[] }`. Returns the updated variant DTO.

3. Extend `TestGenerationVariantDto` with `appliedAdjustments`. Map in `dto-mappers.ts`. Export from `@gen-story/shared`.

4. Add route tests covering: happy path, empty array (no-op restoring original commonPrompt), > 3 ids (400), unknown id (400), variant not found (404).


### Milestone 5 — Confirm appends adjustments to `commonPrompt`

Files: `packages/application/src/use-cases.ts` (the existing `confirmTestGenerationBatch` use case — name may differ; verify from `apps/api/src/http/routes.ts:1587` route handler), `packages/application/src/use-cases.test.ts`.

1. In the confirm use case, after marking the variant as confirmed, mutate the storyboard:

       storyboard.commonPrompt = appendAdjustmentsToCommonPrompt(
         storyboard.commonPrompt,
         confirmedVariant.appliedAdjustments,
         SUFFIXES_BY_ID,
       );

   `SUFFIXES_BY_ID` is injected from the API layer (which imports the dictionary from `@gen-story/shared`).

2. Persist via the existing storyboard repository update path.

3. If the variant has no adjustments, this is a no-op — the existing behavior is preserved.

4. Add a use-case test asserting: confirming a variant with `["warmer", "more_cinematic"]` updates `storyboards.commonPrompt` exactly once with both suffixes; confirming a variant with `[]` leaves `commonPrompt` unchanged.


### Milestone 6 — Web UI

Files: `apps/web/src/components/storyboard/TestGenerationModal.tsx`, `apps/web/src/lib/api-client.ts`, plus a small `apps/web/src/components/storyboard/AdjustmentChips.tsx`.

1. New client helper:

       export async function applyAdjustment(
         storyboardId: string,
         variantId: string,
         adjustmentIds: TestAdjustmentId[],
       ): Promise<TestGenerationVariantDto> { ... }

2. New presentational component `AdjustmentChips` rendering six toggle buttons. Props: `selected: TestAdjustmentId[]`, `disabled: boolean`, `onChange(next: TestAdjustmentId[]): void`. Visual style: pill chips, selected state highlighted, disabled when > 3 selected (or when the slot is currently re-rolling). Use existing CSS modules for consistency.

3. In `TestGenerationModal`, render `<AdjustmentChips>` under each variant. Add an "Apply adjustments" button that calls `applyAdjustment` and starts polling that slot until the new generation completes. Other slots remain idle.

4. Surface a small "Effects on confirm" hint near the chips: "These adjustments will be saved to the project prompt when you confirm this variant."

5. While a re-roll is in flight, disable the chips and the confirm button for that slot only. The other two variants stay interactive.


### Milestone 7 — End-to-end validation

1. Fresh dev:

       pnpm dev

2. Open a project that has at least one scene with a primary photo. Open test generation.

3. Wait for 3 variants. Note the current `commonPrompt` in StoryboardPage.

4. Under variant 1, click "Warmer". Variant 1 re-rolls; variants 2 and 3 untouched.

5. Under variant 1, also click "More cinematic", then "Apply adjustments". Variant 1 re-rolls again with both suffixes.

6. Click "Confirm with this variant" on variant 1. The modal closes.

7. Verify on StoryboardPage that the "Common prompt" textarea now contains the original text plus the two appended suffixes ("warmer color temperature, ..." and "stronger cinematic grade, ...").

8. Start bulk generation. Inspect one queued request via `GET /api/debug/generation-requests` and confirm the composed prompt for the first scene contains both suffix phrases.

9. Repeat in reverse: hit "Reset" on test generation, this time confirm a variant with **no** chips applied. Verify `commonPrompt` is unchanged.

10. Screenshot the modal with chips visible and the post-confirm StoryboardPage commonPrompt; save under `docs/plans/artifacts/20260526-adjustment-chips/`.


## Concrete Steps

Run all commands from `/Users/ran/my-app/gen-story`.

After each milestone:

    pnpm typecheck
    pnpm lint
    pnpm test

After Milestone 3:

    pnpm --filter @gen-story/api db:generate
    pnpm --filter @gen-story/api db:migrate

Before committing:

    pnpm format
    pnpm build


## Validation and Acceptance

| Milestone | Observable success |
|---|---|
| 1 | `TEST_ADJUSTMENTS` and `MAX_ADJUSTMENTS_PER_VARIANT` exported from `@gen-story/shared`. `pnpm typecheck` passes. |
| 2 | New rule helpers covered by unit tests including duplicate-rejection and substring-de-dup cases. |
| 3 | Fresh DB migration applies cleanly; existing test-generation routes still work with the new column defaulting to `[]`. |
| 4 | `curl -X POST .../test-generation/variants/<vid>/adjustments -d '{"adjustmentIds":["warmer"]}'` returns 200 with the updated variant and queues exactly one new generation request for that slot (verifiable via `GET /api/debug/generation-requests`). |
| 5 | Use-case test verifies confirm updates `commonPrompt` exactly once with the expected suffix string; re-confirming the same variant is a no-op. |
| 6 | Chips render under each variant; selecting > 3 disables the rest; "Apply adjustments" re-rolls only that slot; the other slots remain unchanged on screen. |
| 7 | Manual end-to-end demo shows the appended suffix in StoryboardPage `commonPrompt` and in the composed prompt of a downstream bulk-generation request. Screenshots saved. |


## Idempotence and Recovery

- Schema change is additive (one nullable-default column). Re-running migrations is safe.
- The `appendAdjustmentsToCommonPrompt` helper de-duplicates by substring match, so re-confirming the same variant does not double-append.
- The chip re-roll endpoint can be called repeatedly; each call replaces the variant's `appliedAdjustments` list and supersedes the previous image for that slot. No accumulating state.
- If a re-roll fails, the previous image remains accessible (the existing retry path applies). The chip selections persist on the variant row so the user can re-click "Apply adjustments" without re-selecting chips.
- To recover from a botched local DB: `rm data/gen-story.sqlite && pnpm --filter @gen-story/api db:migrate && pnpm --filter @gen-story/api db:seed`.


## Artifacts and Notes

- The suffix dictionary is intentionally short, terse, and English. If the multi-language ExecPlan (`20260526-multi-language-japanese-english.md`) lands first, the chip *labels* should pull from the i18n bundle but the *suffixes* sent to the image model should remain English (the image model is English-trained). Update this plan with a note when that decision is reconciled.
- Cost note: each chip click triggers one OpenAI image call. Surface this in the UI ("Each adjustment uses one generation credit") and consider a confirm step if multiple chips are pre-selected before "Apply adjustments" is clicked.


## Interfaces and Dependencies

- New shared exports: `TestAdjustmentId`, `TestAdjustment`, `TEST_ADJUSTMENTS`, `MAX_ADJUSTMENTS_PER_VARIANT`.
- New domain types: `TestAdjustmentId` mirrored locally; rule helpers `assertAdjustmentsValid`, `appendAdjustmentsToCommonPrompt`.
- New use case: `applyAdjustmentToTestVariant`.
- Modified use case: existing `confirmTestGenerationBatch` (verify exact name from `packages/application/src/use-cases.ts`) gains the commonPrompt-append step.
- New API endpoint: `POST /api/storyboards/:storyboardId/test-generation/variants/:variantId/adjustments`.
- Modified DTO: `TestGenerationVariantDto` gains `appliedAdjustments`.
- DB: one new column `test_generation_variants.applied_adjustments_json`.
- No new third-party dependencies.
