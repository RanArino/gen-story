# Add AI photo analysis and emotion candidates

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.


## Purpose / Big Picture

After this change, a user can ask the app to analyze the uploaded project photos and receive a small set of emotion or tone candidates grounded in the actual photo set. The user can then choose one of those candidates as the storyboard tone instead of manually guessing the mood from the fixed tone buttons.

This closes the first high-priority Phase 1 gap in `docs/gap-analysis.md`: "AI photo analysis -> emotion candidates." It also creates reusable, persisted photo insights for later work on real photo-aware scene descriptions, image prompts, optional AI ordering, and storyboard composition. The plan does not implement full automatic storyboard composition, complement scenes, test image generation, language settings, provider/model picker UI, or production cloud deployment.

The visible behavior is on the Storyboard page. A user with uploaded candidate or reference photos can click an analysis action, wait for a result, see 3 to 5 suggested tones with short reasons, and apply one suggestion to the existing storyboard `tone` field. The result survives reload because the latest project photo analysis is persisted.


## Progress

- [x] (2026-05-14 11:35Z) Read `AGENTS.md`, `/Users/ran/my-app/PLANS.md`, `docs/gap-analysis.md`, and the recently completed `docs/plans/20260514-per-scene-ai-fill.md`.
- [x] (2026-05-14 11:35Z) Inspected current application ports, use cases, API routes, storage keys, photo ingestion, Storyboard UI, shared DTOs, and SQLite schema.
- [x] (2026-05-14 11:35Z) Verified current Gemini API documentation at `https://ai.google.dev/gemini-api/docs/models` and `https://ai.google.dev/gemini-api/docs/image-understanding`; as of this plan, official docs show multimodal image understanding support and recommend `gemini-2.5-flash` as the replacement for older `gemini-2.0-flash` models.
- [x] (2026-05-15 00:48Z) Added a persisted project photo analysis model, repository port, SQLite table, DTO, and mapper.
- [x] (2026-05-15 00:48Z) Added application use cases that validate the project, select candidate/reference photos, invoke the generation port, persist the latest result, and fetch it.
- [x] (2026-05-15 00:48Z) Added a deterministic local fallback adapter and Gemini-backed adapter behind the application port.
- [x] (2026-05-15 00:48Z) Added authenticated REST endpoints for running and fetching project photo analysis.
- [x] (2026-05-15 00:48Z) Added Storyboard page UI for running analysis, viewing emotion candidates, and applying a candidate to the storyboard tone.
- [x] (2026-05-15 00:48Z) Ran focused and workspace verification; `pnpm format` still fails on unrelated pre-existing files outside this feature.
- [x] (2026-05-15 00:48Z) Updated `docs/gap-analysis.md` to mark completed analysis requirements.


## Surprises & Discoveries

- Observation: The previous per-scene AI fill feature intentionally uses deterministic metadata-based text, not real vision analysis.
  Evidence: `apps/api/src/scene-fill/local-scene-fill-generation.ts` builds suggestions from photo name, notes, storyboard tone, project name, and style preset.

- Observation: The app already stores an AI-input storage key convention, but AI-input images are currently generated lazily during image generation preprocessing.
  Evidence: `apps/api/src/storage/storage-keys.ts` defines `buildPhotoAiInputStorageKey`, and `apps/api/src/images/local-image-preprocessing.ts` writes normalized `ai-input` images while preparing generation requests.

- Observation: Uploaded HEIC or HEIF files are converted to JPEG before storage, while the stored content type for the original write still uses the detected source MIME type.
  Evidence: `apps/api/src/photos/photo-asset-ingestion.ts` converts HEIC/HEIF to JPEG in `workingBody`, writes `workingBody`, and passes `imageType.mimeType` to `putObject`.

- Observation: The current architecture has `SceneFillGenerationPort` for text suggestions and `ImageGenerationPort` for generated images, but no project-level photo analysis port or persistence.
  Evidence: `packages/application/src/ports.ts` has no `PhotoAnalysisGenerationPort` or `PhotoAnalysisRepositoryPort`.

- Observation: The current Storyboard page already owns the tone picker and style selector, making it the lowest-friction place to expose emotion candidates without creating a new settings page.
  Evidence: `apps/web/src/components/storyboard/StoryboardPage.tsx` renders `TONES` and calls `upsertStoryboard` from `handleToneChange`.

- Observation: `drizzle-kit generate` failed while `drizzle.config.ts` used absolute `schema` and `out` paths; the tool re-prefixed the absolute migration path.
  Evidence: The generator attempted to open `.//Users/ran/my-app/gen-story/drizzle/migrations/meta/0000_snapshot.json`. Changing `schema` and `out` to repository-relative paths allowed generation to proceed.

- Observation: Route tests require local socket binding, which the default sandbox denied.
  Evidence: Non-escalated route tests failed with `listen EPERM: operation not permitted 127.0.0.1`; rerunning `pnpm --filter @gen-story/api test` and `pnpm test` with approved local bind permissions passed.


## Decision Log

- Decision: Plan project-level photo analysis before full scene composition.
  Rationale: Emotion candidates are the highest-priority remaining Phase 1 gap and are a dependency for higher-quality scene fill, AI ordering, and storyboard composition. Implementing them first gives the user immediate value without changing the scene model or generation workflow.
  Date/Author: 2026-05-14 / Codex

- Decision: Persist one latest analysis result per project rather than only returning transient API output.
  Rationale: The user should not lose candidate emotions after a page reload. A project-scoped result is sufficient for Phase 1 and avoids adding a run history or versioning system before it is needed.
  Date/Author: 2026-05-14 / Codex

- Decision: Add a provider-neutral `PhotoAnalysisGenerationPort` in `packages/application` and keep Gemini/OpenAI SDK code in `apps/api`.
  Rationale: `AGENTS.md` requires `packages/application` to remain independent from provider SDKs. A port follows the existing dependency inversion style used by image generation and scene fill.
  Date/Author: 2026-05-14 / Codex

- Decision: Use the project photos' existing normalized preview or original bytes for analysis, not generated images.
  Rationale: The requirement is to read uploaded photos before storyboard/generation. The adapter can normalize images internally for provider constraints while the persisted domain result remains provider-neutral.
  Date/Author: 2026-05-14 / Codex

- Decision: Use `gemini-2.5-flash` as the planned default Gemini model name if `GEMINI_API_KEY` is configured, while keeping a deterministic fallback for tests and local demos.
  Rationale: Official Google AI docs currently show Gemini models support image understanding and list Gemini 2.0 Flash deprecation with `gemini-2.5-flash` as the replacement. The fallback avoids making local development depend on network credentials.
  Date/Author: 2026-05-14 / Codex

- Decision: Keep the result schema intentionally small: emotion candidates, per-photo observations, and an overall story summary.
  Rationale: This covers the requirement dimensions without overbuilding a full ontology. Later scene generation can consume these fields if needed.
  Date/Author: 2026-05-14 / Codex

- Decision: Implement the Gemini adapter in this slice, with local deterministic fallback when `GEMINI_API_KEY` is absent.
  Rationale: The user explicitly chose real Gemini-backed analysis for this implementation, while local fallback keeps tests and local demos credential-free.
  Date/Author: 2026-05-15 / Codex


## Outcomes & Retrospective

Implementation is complete. The app now persists one latest project photo analysis per project, exposes run/fetch REST endpoints, uses Gemini when `GEMINI_API_KEY` is configured, falls back to deterministic local analysis without credentials, and lets users apply generated emotion candidates from the Storyboard page. Verification passed for typecheck, lint, application tests, API tests, full workspace tests, and the architecture boundary check. `pnpm format` still reports unrelated pre-existing formatting issues in files not touched by this feature.


## Context and Orientation

This repository is a pnpm monorepo. `apps/web` is the Next.js UI, `apps/api` is the local TypeScript API server, `packages/domain` contains pure domain models and invariants, `packages/application` contains use cases and ports, and `packages/shared` contains REST DTO types.

Photos are uploaded through `PhotoAssetIngestionService` in `apps/api/src/photos/photo-asset-ingestion.ts`. The application stores original uploads under storage keys built by `apps/api/src/storage/storage-keys.ts`, stores a 640 px preview image, and keeps metadata in `photo_assets`. A photo has a `usage` value of `candidate`, `excluded`, or `reference`. Candidate photos may become scenes; reference photos should inform context but not become scenes directly. Excluded photos should not be sent to analysis.

Storyboard editing lives in `apps/web/src/components/storyboard/StoryboardPage.tsx`. It loads the first storyboard for a project, lists photos, lets users create template scenes from selected photos, and exposes a fixed set of tone buttons. The storyboard tone is persisted by `upsertStoryboard` and later contributes to image prompt composition.

The current AI fill path is per-scene and metadata-based. `packages/application/src/use-cases.ts` exposes `fillSceneWithAi`, which calls `deps.sceneFillGeneration.generateSceneFill`. `apps/api/src/scene-fill/local-scene-fill-generation.ts` provides deterministic text from photo name and notes. This plan adds project-level vision analysis that can eventually make that fill path photo-aware, but this plan's acceptance only requires emotion candidates to be generated, persisted, displayed, and selectable.

The new term "project photo analysis" means one persisted analysis result for the active project photo set. It contains:

- `emotionCandidates`: 3 to 5 candidates, each with a stable `value`, display `label`, short `description`, and `reason`.
- `photoInsights`: one concise observation per analyzed photo, including visible people or relationship clues, expression, location/season/era/event clues, and atmosphere when available.
- `storySummary`: a short overall description of the photo set and likely narrative arc.
- `model`: the adapter/model identifier used, such as `local-deterministic` or `gemini-2.5-flash`.


## Plan of Work

First, add domain and shared types. In `packages/domain/src/model.ts`, define a `ProjectPhotoAnalysis` type and a factory such as `createProjectPhotoAnalysis`. Keep the factory validation limited to required IDs, project ID, non-empty JSON-derived arrays, timestamps, and soft-delete shape. Export it from `packages/domain/src/index.ts`. In `packages/shared/src/index.ts`, add `ProjectPhotoAnalysisDto`, `EmotionCandidateDto`, and `PhotoInsightDto`.

Second, add persistence. In `apps/api/src/db/schema.ts`, add a `project_photo_analyses` table with `id`, unique `project_id`, `emotion_candidates_json`, `photo_insights_json`, `story_summary`, `model`, `created_at`, `updated_at`, and `deleted_at`. Generate a Drizzle migration with `pnpm --filter @gen-story/api db:generate`. In `apps/api/src/db/repositories.ts`, add a repository that maps JSON text to the domain model and exposes `findLatestByProjectId` and `save`. Because this is one latest result per project, `save` should upsert by `project_id` or replace the previous row deterministically.

Third, add application ports and use cases. In `packages/application/src/ports.ts`, add `ProjectPhotoAnalysisRepositoryPort` and `PhotoAnalysisGenerationPort`. The generation port should accept a project, included photos, optional existing storyboard, and image inputs prepared by the adapter boundary. It should return structured candidates, insights, summary, and model. Add both ports to `ApplicationDependencies`.

Fourth, implement `analyzeProjectPhotos` and `getProjectPhotoAnalysis` in `packages/application/src/use-cases.ts`. The analyze use case should load the project, ensure there is at least one non-deleted photo with `usage` of `candidate` or `reference`, exclude `excluded` photos, load the first storyboard if one exists, call `deps.photoAnalysisGeneration.analyzeProjectPhotos`, persist the result, publish a progress event such as `project_photo_analysis.completed`, and return the saved result. The get use case returns the latest result or `null`.

Fifth, implement adapters in `apps/api/src/photo-analysis`. Add `LocalPhotoAnalysisGenerationAdapter` for deterministic local output from photo names, notes, usage, dimensions, and project/storyboard context. Add `GeminiPhotoAnalysisGenerationAdapter` only if dependency installation and environment support are available. Prefer the official `@google/genai` SDK if added; otherwise use a small fetch-based adapter only if it keeps code clear and testable. The Gemini adapter should read photo bytes through `ObjectStoragePort`, normalize oversized inputs with existing image helpers if needed, prompt for strict JSON, validate the JSON with Zod inside `apps/api`, and map provider output to the application port result. If `GEMINI_API_KEY` is absent, `createApiContext` should wire the local adapter.

Sixth, expose REST endpoints. In `apps/api/src/http/schemas.ts`, add a strict empty schema for analysis requests unless options are truly needed. In `apps/api/src/http/routes.ts`, add `POST /api/projects/:projectId/photo-analysis` to run analysis and `GET /api/projects/:projectId/photo-analysis` to fetch the latest result. Both routes must authenticate, verify the project belongs to the current organization, call the use case, and return `ProjectPhotoAnalysisDto` or `{ photoAnalysis: null }` for the GET case.

Seventh, update the web client. In `apps/web/src/lib/api-client.ts`, add `analyzeProjectPhotos(projectId)` and `getProjectPhotoAnalysis(projectId)`. Use the existing request helper and shared DTO types.

Eighth, update the Storyboard UI. In `apps/web/src/components/storyboard/StoryboardPage.tsx`, load the latest analysis alongside storyboards, style presets, and photos. Add a compact analysis area near the existing tone grid. It should show a run button when photos exist, a loading state during analysis, candidate emotion buttons when results exist, and a short story summary. Clicking a candidate should call the existing `handleToneChange` path with the candidate `value`; if the candidate value is not one of the current fixed `TONES`, the UI should still display the selected custom tone as an analysis-selected tone. Avoid building a new language selector or settings screen.

Ninth, add tests. In `packages/application/src/use-cases.test.ts`, test that analysis excludes deleted and excluded photos, requires at least one included photo, persists the adapter result, and returns the latest saved result. In `apps/api/src/photo-analysis/local-photo-analysis-generation.test.ts`, test deterministic output shape. In `apps/api/src/http/routes.test.ts`, test authorization and successful run/fetch behavior. If a Gemini adapter is added, unit-test prompt/result mapping with mocked provider responses and no network calls.

Tenth, update documentation and gap tracking. Keep `.env.example` synchronized if `GEMINI_API_KEY` or `GEMINI_PHOTO_ANALYSIS_MODEL` is introduced. Update `README.md` only if setup behavior changes. Update `docs/gap-analysis.md` twice if implementation happens over multiple turns: while planned or active, keep targeted rows as `🟡 In progress`; after implementation and verification, mark only truly delivered rows as `✅` or `⚠️`.


## Concrete Steps

Run all commands from `/Users/ran/my-app/gen-story`.

1. Capture the pre-change state:

    git status --short
    pnpm --filter @gen-story/application test
    pnpm --filter @gen-story/api test

   Expected result: existing tests pass, or pre-existing failures are recorded in `Surprises & Discoveries` before implementation changes.

2. Add domain/shared/application contracts:

    Edit packages/domain/src/model.ts
    Edit packages/domain/src/index.ts
    Edit packages/shared/src/index.ts
    Edit packages/application/src/ports.ts
    Edit packages/application/src/index.ts

   Expected result: TypeScript can see the new `ProjectPhotoAnalysis` and DTO types without importing app or provider code into `packages/domain` or `packages/application`.

3. Add persistence:

    Edit apps/api/src/db/schema.ts
    pnpm --filter @gen-story/api db:generate
    Edit apps/api/src/db/repositories.ts
    Edit apps/api/src/http/dto-mappers.ts

   Expected result: a migration creates `project_photo_analyses`, repository mapping round-trips JSON fields, and DTO mapping returns explicit REST shapes.

4. Add use cases and tests:

    Edit packages/application/src/use-cases.ts
    Edit packages/application/src/use-cases.test.ts
    pnpm --filter @gen-story/application test

   Expected result: tests pass and prove included-photo selection, empty-photo validation, persistence, and latest-result retrieval.

5. Add API adapters and dependency wiring:

    Add apps/api/src/photo-analysis/local-photo-analysis-generation.ts
    Add apps/api/src/photo-analysis/local-photo-analysis-generation.test.ts
    Optionally add apps/api/src/photo-analysis/gemini-photo-analysis-generation.ts
    Edit apps/api/src/app/create-api-context.ts
    Edit apps/api/src/test-support/in-memory-application.ts

   Expected result: local adapter tests pass and `createApiContext` uses Gemini only when configured, otherwise deterministic local analysis.

6. Add REST endpoints:

    Edit apps/api/src/http/schemas.ts
    Edit apps/api/src/http/routes.ts
    Edit apps/api/src/http/routes.test.ts
    pnpm --filter @gen-story/api test

   Expected result: authorized `POST /api/projects/:projectId/photo-analysis` returns a persisted analysis DTO and `GET /api/projects/:projectId/photo-analysis` returns the latest DTO or `null`.

7. Add web client and UI:

    Edit apps/web/src/lib/api-client.ts
    Edit apps/web/src/components/storyboard/StoryboardPage.tsx
    Edit apps/web/src/components/storyboard/StoryboardPage.module.css

   Expected result: the Storyboard page can run analysis, display candidates, and apply a candidate through the existing storyboard save path.

8. Run repository checks:

    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm format
    rg "from ['\\\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application

   Expected result: all checks pass. The architecture boundary check reports no forbidden imports.

9. Manually verify the flow:

    pnpm dev

   Open `http://localhost:3000`, create or open a project, upload at least two photos, set one as candidate and optionally one as reference, initialize a storyboard, run photo analysis from the Storyboard page, apply one candidate tone, reload the page, and confirm the latest analysis result is still visible.


## Validation and Acceptance

Automated acceptance:

- `pnpm --filter @gen-story/application test` passes with tests for included-photo filtering, validation, persistence, and latest-result fetch.
- `pnpm --filter @gen-story/api test` passes with route and adapter coverage.
- `pnpm typecheck` passes across the workspace.
- `pnpm lint`, `pnpm test`, and `pnpm format` pass, or any inability to run them is documented with the closest useful verification performed.
- The architecture boundary check produces no forbidden imports in `packages/domain` or `packages/application`.

Manual acceptance:

- A project with no candidate or reference photos shows a clear error when analysis is requested and does not create an empty analysis result.
- A project with candidate and reference photos can produce 3 to 5 emotion candidates and a story summary.
- Excluded photos are not included in the analysis input.
- Applying an emotion candidate updates the storyboard tone and persists after reload.
- Fetching the Storyboard page after reload displays the latest analysis result without rerunning analysis.
- Local development still works without `GEMINI_API_KEY` by using deterministic local output.


## Idempotence and Recovery

Running analysis multiple times is safe. Each successful run replaces or updates the latest project analysis result for that project. It does not mutate photos, scenes, generated images, or generation requests.

If a provider call fails, the use case should return a readable `validation_error` or `invalid_state` without overwriting the previous saved result. The UI should keep displaying the previous result if one exists and show the new error separately.

If the migration is generated incorrectly, do not hand-edit generated SQL blindly. Inspect `apps/api/src/db/schema.ts`, regenerate with `pnpm --filter @gen-story/api db:generate`, and document the correction here.

If dependency installation is unavailable or the Gemini SDK cannot be added, implement only the deterministic adapter in this slice, leave the Gemini adapter as a documented follow-up, and keep `docs/gap-analysis.md` at `⚠️` rather than `✅` for true photo vision analysis.

If tests fail because local commands cannot bind sockets or access a provider, record the exact failure here and run the nearest unit-level checks that do not require those resources.


## Artifacts and Notes

Relevant current files:

- `docs/gap-analysis.md` lists AI photo analysis and emotion candidates as the top high-priority missing gap.
- `docs/plans/20260514-per-scene-ai-fill.md` documents the current metadata-based per-scene fill path and states true photo vision analysis remains separate.
- `packages/application/src/ports.ts` currently has `SceneFillGenerationPort` but no project-level photo analysis port.
- `apps/api/src/photos/photo-asset-ingestion.ts` writes original and preview photo objects and registers `PhotoAsset` metadata.
- `apps/api/src/images/local-image-preprocessing.ts` shows how existing code reads photo bytes and creates AI-input normalized images.
- `apps/web/src/components/storyboard/StoryboardPage.tsx` is the existing home for storyboard tone selection.

External references checked while creating this plan:

- Google AI Gemini models: `https://ai.google.dev/gemini-api/docs/models`
- Google AI image understanding: `https://ai.google.dev/gemini-api/docs/image-understanding`
- Google AI Gemini deprecations: `https://ai.google.dev/gemini-api/docs/deprecations`


## Interfaces and Dependencies

New domain/application interfaces:

- `ProjectPhotoAnalysis` in `packages/domain/src/model.ts`
- `ProjectPhotoAnalysisRepositoryPort` in `packages/application/src/ports.ts`
- `PhotoAnalysisGenerationPort` in `packages/application/src/ports.ts`
- `analyzeProjectPhotos` and `getProjectPhotoAnalysis` in `packages/application/src/use-cases.ts`

New API interfaces:

- `project_photo_analyses` SQLite table in `apps/api/src/db/schema.ts`
- `SqliteProjectPhotoAnalysisRepository` in `apps/api/src/db/repositories.ts`
- `LocalPhotoAnalysisGenerationAdapter` in `apps/api/src/photo-analysis/local-photo-analysis-generation.ts`
- Optional `GeminiPhotoAnalysisGenerationAdapter` in `apps/api/src/photo-analysis/gemini-photo-analysis-generation.ts`
- `POST /api/projects/:projectId/photo-analysis`
- `GET /api/projects/:projectId/photo-analysis`

New web interfaces:

- `ProjectPhotoAnalysisDto`, `EmotionCandidateDto`, and `PhotoInsightDto` in `packages/shared/src/index.ts`
- `analyzeProjectPhotos` and `getProjectPhotoAnalysis` in `apps/web/src/lib/api-client.ts`
- Storyboard page analysis controls in `apps/web/src/components/storyboard/StoryboardPage.tsx`

Environment dependencies:

- `GEMINI_API_KEY` if the Gemini-backed adapter is implemented.
- `GEMINI_PHOTO_ANALYSIS_MODEL` only if model override is needed; otherwise default to `gemini-2.5-flash` in the API adapter.
- No provider credential is required for tests or local demos because the deterministic adapter must remain available.
