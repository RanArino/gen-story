# Guard the paid photo-analysis AI call against wasteful repeat runs


This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.


This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md` (gen-story has no child `PLANS.md`).


Note: this plan was authored immediately after the implementation landed, at the user's request, to satisfy the repository rule that changes of this size require an ExecPlan. The work itself is already complete and validated; `Progress` and `Outcomes & Retrospective` reflect that.


## Purpose / Big Picture


During local testing the storyboard screen shows an AI photo-analysis card with an "Analyze photos / Re-analyze (再分析)" button. When `GEMINI_API_KEY` is set (it is, in `.env.local`), each click sends every analyzable photo (~15 during testing) to Gemini 2.5 Flash and is billed. The old behavior re-ran a full paid analysis on every click with no caching, no confirmation, and no way to tell whether real AI ran — so repeated clicks silently burned tokens for an identical result.


After this change a user gains three things they can observe:


1. Clicking "Re-analyze" when the photos are unchanged does not call the AI at all. The server returns the stored analysis and the UI shows "Photos are unchanged — reused the existing analysis (no AI call)." (`写真に変更がないため、既存の分析を再利用しました(AI呼び出しなし)。`)
2. When an analysis already exists, the button asks for confirmation before spending tokens, and when the photo set is already up to date the button is disabled and labeled "✓ Up to date" with the hint "Change photos to enable re-analysis."
3. The analysis panel shows which model produced the result (a `gemini-2.5-flash` badge, or a `Local (no AI)` badge when the deterministic fallback ran) and the analysis timestamp, so a tester can immediately see whether real AI ran and how fresh it is.


The authoritative cost guard is server-side: the result is keyed by a fingerprint of the inputs, so even a caller bypassing the UI cannot trigger a redundant paid call.


## Progress


- [x] (2026-06-16 21:00Z) Added `inputsHash` to the domain `ProjectPhotoAnalysis` model and `createProjectPhotoAnalysis` factory (optional input, defaults to empty string for legacy rows).
- [x] (2026-06-16 21:01Z) Added `inputs_hash` column to the `project_photo_analyses` table in `apps/api/src/db/schema.ts`, generated migration `drizzle/migrations/0010_thankful_prima.sql`, and applied it to the local SQLite DB.
- [x] (2026-06-16 21:01Z) Mapped `inputsHash` on read and write in `SqliteProjectPhotoAnalysisRepository`.
- [x] (2026-06-16 21:02Z) Added the input-fingerprint cache guard and a `cached` flag to `analyzeProjectPhotos` in `packages/application/src/use-cases.ts`; exported the new `AnalyzeProjectPhotosResult` type.
- [x] (2026-06-16 21:02Z) Plumbed the `cached` flag through `POST /api/projects/:projectId/photo-analysis` and the web `analyzeProjectPhotos` client.
- [x] (2026-06-16 21:03Z) Updated `StoryboardPage.tsx`: cost confirmation before re-analysis, disabled "up to date" state, cached-vs-fresh toast, and model + timestamp display; added supporting CSS and en/ja i18n strings.
- [x] (2026-06-16 21:03Z) Updated and added unit tests; ran typecheck, lint, format (changed file), and the full test suite — all green.
- [x] (2026-06-16 21:04Z) Updated the implementation note in `docs/gap-analysis.md` for the photo-analysis row.
- [ ] Manual in-app verification of the cached path in the browser is deliberately deferred to avoid spending Gemini tokens just to confirm; the cache logic is covered by unit tests. See `Validation and Acceptance`.


## Surprises & Discoveries


- Observation: Real AI was already running locally, so the cost concern was concrete, not hypothetical.
  Evidence: `.env.local` contains `GEMINI_API_KEY=AQ.A****`, and `apps/api/src/app/create-api-context.ts` selects `GeminiPhotoAnalysisGenerationAdapter` whenever that key is present (deterministic `LocalPhotoAnalysisGenerationAdapter` only when unset).

- Observation: The existing analysis lookup happened after the paid generation call, so a cache short-circuit was a small reordering rather than new plumbing.
  Evidence: In the original `analyzeProjectPhotos`, `deps.projectPhotoAnalyses.findLatestByProjectId(...)` was called only to reuse `id`/`createdAt` after `photoAnalysisGeneration.analyzeProjectPhotos(...)` had already run.

- Observation: Storyboard `tone` is part of the Gemini prompt, but including it in the cache key would make selecting a suggested tone immediately invalidate the cache and re-enable re-analysis — the opposite of the intended UX.
  Evidence: `buildPrompt` in `apps/api/src/photo-analysis/gemini-photo-analysis-generation.ts` emits `Current storyboard tone: ...`; the analysis outputs (candidates, insights, summary) are fundamentally about the photos, not the selected tone.


## Decision Log


- Decision: Fingerprint only the analyzable photo set (per photo: `id`, `checksum`, `usage`, `name`, `notes`) plus the response `language`; exclude `storyboard.tone`.
  Rationale: These are the dominant and expensive inputs. `checksum` detects real image-content changes; `usage`/`name`/`notes` feed the prompt; `language` legitimately changes the text. Excluding `tone` keeps the "up to date" state stable after the user applies a suggested tone.
  Date/Author: 2026-06-16 / Claude (Opus 4.8)

- Decision: Make `inputsHash` optional in the domain factory and default the DB column to `''`.
  Rationale: Legacy rows created before the migration have no hash; defaulting to `''` makes them always-stale (never matches a freshly computed non-empty hash), so the first re-analysis after upgrade runs once and stores a real hash. Required-non-empty validation would have broken mapping of those legacy rows.
  Date/Author: 2026-06-16 / Claude (Opus 4.8)

- Decision: Server-side hash compare is authoritative; the client staleness check (photo-id set difference + photo `updatedAt` newer than analysis `updatedAt`) is advisory only.
  Rationale: Avoids duplicating the hash algorithm on the client. If the client heuristic is wrong, the server still skips the paid call and returns `cached: true`, so correctness and cost safety do not depend on the UI.
  Date/Author: 2026-06-16 / Claude (Opus 4.8)

- Decision: Do not hard-block re-analysis purely server-side beyond the cache; keep the UI guard as confirm + disable rather than adding rate limiting.
  Rationale: This is a local testing tool; per repo guidance, prefer the minimal sufficient guard. Caching removes the cost; confirm + disable removes accidental clicks. Server rate limiting would be speculative complexity.
  Date/Author: 2026-06-16 / Claude (Opus 4.8)

- Decision: Author this ExecPlan retroactively rather than reverting and re-doing the work plan-first.
  Rationale: The user explicitly asked to create the plan after the fact to satisfy the rule, keeping the validated change intact.
  Date/Author: 2026-06-16 / Claude (Opus 4.8)


## Outcomes & Retrospective


Outcome: All three guard layers are implemented and verified by automated checks. The full suite passes (domain, shared, application 35 tests including two new cache tests, api 99 tests, web), with `pnpm typecheck` and `pnpm lint` clean (one pre-existing unrelated warning in `packages/domain/src/rules.ts`) and Prettier clean on the changed file.


Gaps: One manual browser confirmation of the cached toast/disabled button is intentionally not performed to avoid an unnecessary paid Gemini call; the behavior is covered by unit tests and can be observed for free by re-analyzing with unchanged photos.


Lessons: The expensive lookup already existed in the use case, so the cost fix was mostly a reordering plus a fingerprint; the larger surface was the schema/DTO/UI plumbing. Keeping the client check advisory let the UI stay simple while the server remained the source of truth for spend.


## Context and Orientation


gen-story is a pnpm monorepo with clean-architecture layering. Relevant pieces for this work:


- `packages/domain/src/model.ts` — pure domain types and factories. `ProjectPhotoAnalysis` is the stored result of analyzing a project's photos (emotion candidates, per-photo insights, a story summary, and the model name). `createProjectPhotoAnalysis(...)` validates and constructs it.
- `packages/application/src/use-cases.ts` — use cases orchestrating ports. `analyzeProjectPhotos(deps, input)` loads the project's analyzable photos (usage `candidate` or `reference`, not soft-deleted), calls the `photoAnalysisGeneration` port, and persists a `ProjectPhotoAnalysis`. `now()` returns an ISO timestamp; `randomUUID()`/`createHash` come from `node:crypto`.
- `packages/application/src/ports.ts` — `PhotoAnalysisGenerationPort` and `Language`.
- `apps/api/src/app/create-api-context.ts` — dependency injection. Chooses `GeminiPhotoAnalysisGenerationAdapter` when `GEMINI_API_KEY` is set, else `LocalPhotoAnalysisGenerationAdapter` (model name `local-deterministic`).
- `apps/api/src/db/schema.ts` and `apps/api/src/db/repositories.ts` — Drizzle SQLite schema and `SqliteProjectPhotoAnalysisRepository` (`findLatestByProjectId`, `save`). The `project_photo_analyses` table has a unique index on `project_id`, so `save` upserts one row per project.
- `apps/api/src/http/routes.ts` — `GET`/`POST /api/projects/:projectId/photo-analysis`.
- `packages/shared/src/index.ts` — `ProjectPhotoAnalysisDto` (the API boundary shape).
- `apps/web/src/lib/api-client.ts` — `analyzeProjectPhotos(projectId)` and `getProjectPhotoAnalysis(projectId)`.
- `apps/web/src/components/storyboard/StoryboardPage.tsx` + `StoryboardPage.module.css` — the AI assist card and analysis panel. `apps/web/src/i18n/messages/{en,ja}.json` hold the `storyboard.ai.*` strings.


Term: "analyzable photo" — a photo whose `usage` is `candidate` or `reference` and `deletedAt` is null; only these are sent to the analyzer.


## Plan of Work


The minimal sufficient path is to add an input fingerprint to the stored analysis and short-circuit on a match, then expose enough signal for the UI to confirm/disable and to show provenance.


1. Domain: add `inputsHash: string` to `ProjectPhotoAnalysis` and an optional `inputsHash?: string` to `CreateProjectPhotoAnalysisInput`; in `createProjectPhotoAnalysis` set `inputsHash: input.inputsHash ?? ""` (no non-empty validation, to keep legacy rows mappable).
2. Persistence: add `inputs_hash text not null default ''` to `projectPhotoAnalyses`; generate and apply a migration; map the field in `mapProjectPhotoAnalysis` and in `save` (both insert values and the `onConflictDoUpdate` set).
3. Use case: add `computeAnalysisInputsHash(photos, language)` (sha256 over a sorted-by-id list of `{id, checksum, usage, name, notes}` plus `language`). In `analyzeProjectPhotos`, compute the hash, fetch the existing analysis first, and if `existing.inputsHash === inputsHash` return `{ analysis: existing, cached: true }` without calling the port. Otherwise generate, persist with the computed hash, publish the progress event, and return `{ analysis, cached: false }`. Change the return type to `UseCaseResult<AnalyzeProjectPhotosResult>` and export the type.
4. API + client: in the POST handler return `{ photoAnalysis: toProjectPhotoAnalysisDto(result.value.analysis), cached: result.value.cached }`; update the web client to return `{ photoAnalysis, cached }`. The DTO is intentionally left unchanged (the internal hash is not exposed across the boundary).
5. Web UI: derive `analyzablePhotos`, `analyzablePhotoCount`, and an advisory `analysisStale`. Gate the button: no analysis → "Analyze photos" (no confirm); stale → "Re-analyze" with a cost confirm; up to date → disabled "✓ Up to date" plus a hint. Show a cached-vs-fresh toast. Add a meta row with a model badge (`Local (no AI)` when `model === "local-deterministic"`) and the analyzed timestamp. Add CSS and en/ja strings.
6. Tests + docs: update the assertion that read `result.value.model` to `result.value.analysis.model`; add a cache-hit test and a re-run-after-change test. Update the `docs/gap-analysis.md` note for the photo-analysis row.


## Concrete Steps


Run all commands from the repository root `/Users/ran/my-app/gen-story`.


Generate and apply the migration after editing the schema:


    pnpm --filter @gen-story/api db:generate
    pnpm --filter @gen-story/api db:migrate


Expected: db:generate prints a new file under `drizzle/migrations/` (here `0010_thankful_prima.sql`) containing


    ALTER TABLE `project_photo_analyses` ADD `inputs_hash` text DEFAULT '' NOT NULL;


and db:migrate completes without error.


## Validation and Acceptance


Commands and observed results (all from the repository root):


    pnpm typecheck      # all 5 projects "Done", no errors
    pnpm lint           # clean except one pre-existing warning in packages/domain/src/rules.ts
    pnpm exec prettier --check apps/web/src/components/storyboard/StoryboardPage.tsx   # "All matched files use Prettier code style!"
    pnpm test           # domain, shared, application (35), api (99), web all pass


Automated acceptance (in `packages/application/src/use-cases.test.ts`):


- "reuses the stored analysis when inputs are unchanged": after a first `analyzeProjectPhotos`, a second call with identical photos leaves `photoAnalysisGeneration.calls` at length 1 and returns `cached: true` with the same analysis id.
- "re-runs analysis after a photo changes": adding a new candidate photo makes the next call run the generator again (`calls` length 2) and return `cached: false`.


Manual acceptance (observable, free of AI cost):


- In the storyboard screen with at least one candidate/reference photo and an existing analysis, click "Re-analyze" without changing photos. Expected: a confirm dialog warning about AI cost; if confirmed, the toast reads "Photos are unchanged — reused the existing analysis (no AI call)." and no Gemini request is made.
- With the photo set unchanged, the button shows "✓ Up to date", is disabled, and shows "Change photos to enable re-analysis".
- The analysis panel shows a model badge (`gemini-2.5-flash`, or `Local (no AI)` when `GEMINI_API_KEY` is unset) and the analysis timestamp.


Paid manual check (only if explicitly desired): change a photo's usage/notes or add a candidate photo, then re-analyze; expect a fresh Gemini call and the "Photo analysis complete!" toast. This spends tokens, so it is not part of routine validation.


## Idempotence and Recovery


The migration is additive and safe to re-run via Drizzle's journal (already-applied migrations are skipped). The application-level guard is idempotent by design: repeated `analyzeProjectPhotos` calls with unchanged inputs return the same cached analysis and never duplicate rows (the `project_id` unique index plus upsert keep one row per project). If the cache ever needs to be forced to refresh, change any analyzable photo (content, usage, name, or notes) or switch the response language; that changes the fingerprint and triggers a real analysis on the next request.


Recovery: if the migration was not applied, re-run `pnpm --filter @gen-story/api db:migrate`. If a legacy row has an empty `inputs_hash`, the first re-analysis after upgrade simply runs once and stores the real hash — no manual data fix is required.


## Artifacts and Notes


Files changed:


- `packages/domain/src/model.ts`
- `apps/api/src/db/schema.ts`, `apps/api/src/db/repositories.ts`
- `drizzle/migrations/0010_thankful_prima.sql` (+ `meta/0010_snapshot.json`, `meta/_journal.json`)
- `packages/application/src/use-cases.ts`, `packages/application/src/index.ts`, `packages/application/src/use-cases.test.ts`
- `apps/api/src/http/routes.ts`
- `packages/shared/src/index.ts` (unchanged shape — verified DTO intentionally omits the hash)
- `apps/web/src/lib/api-client.ts`
- `apps/web/src/components/storyboard/StoryboardPage.tsx`, `apps/web/src/components/storyboard/StoryboardPage.module.css`
- `apps/web/src/i18n/messages/en.json`, `apps/web/src/i18n/messages/ja.json`
- `docs/gap-analysis.md` (note updated for the photo-analysis row)


Migration SQL:


    ALTER TABLE `project_photo_analyses` ADD `inputs_hash` text DEFAULT '' NOT NULL;


## Interfaces and Dependencies


- `node:crypto` `createHash` (in `packages/application`) — computes the sha256 input fingerprint. `randomUUID` from the same module was already in use; no new dependency is added.
- `@google/genai` (`GeminiPhotoAnalysisGenerationAdapter`) — unchanged; it is the paid call the cache protects.
- Drizzle ORM + drizzle-kit — schema definition and migration generation/application.
- next-intl (`useTranslations`) — renders the new `storyboard.ai.*` strings (`upToDate`, `upToDateHint`, `cachedMsg`, `confirmReanalyze`, `localModelBadge`, `analyzedAt`).
- `window.confirm` — the cost confirmation dialog before re-analysis; appropriate for this local testing tool.


## Revision Notes


2026-06-16: Initial version, written immediately after implementation at the user's request to comply with the ExecPlan requirement for changes of this size. All sections reflect the completed, validated state of the work rather than a forward-looking plan.
