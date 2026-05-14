# Add per-scene AI fill for draft storyboard scenes

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.


## Purpose / Big Picture

After this change, a user who created blank template scenes from selected photos on the Storyboard page can click an AI fill action on a single scene and receive a draft title, description, image prompt, emotion, camera, lighting, and motion. The generated values are based on the scene's primary photo plus project/storyboard context, and the operation preserves any fields the user has already edited.

This closes the most direct usability gap left after template scene creation: the user can create scene shells from photos without typing, then ask the system to fill one scene at a time instead of writing every field manually. It also creates the first narrow, testable foundation for the broader `docs/gap-analysis.md` items "AI photo analysis -> emotion candidates", "AI-generated scene descriptions and image prompts", "Story-level AI context across uploaded photos", and "Per-scene AI fill button for empty text fields" without adding full automatic storyboard composition, complement scenes, test generation, or provider/model picker UI.

The visible behavior is on `apps/web/src/components/storyboard/StoryboardPage.tsx`: each saved scene card has a fill button. If a scene has blank fields, clicking the button fills only those blanks and refreshes the card. If the scene has no primary photo, the API rejects the request with a clear error. If an AI adapter is not configured locally, a deterministic local fallback can still return useful draft text so development, tests, and demos remain reproducible.


## Progress

- [x] (2026-05-13 15:22Z) Read repository instructions in `AGENTS.md`, the global ExecPlan standard in `/Users/ran/my-app/PLANS.md`, and the current gap analysis in `docs/gap-analysis.md`.
- [x] (2026-05-13 15:22Z) Inspected current Storyboard, API route, use-case, port, shared DTO, and schema extension points.
- [x] (2026-05-13) Add application-layer contracts for a per-scene AI fill operation.
- [x] (2026-05-13) Add an API adapter that can produce scene fill suggestions from scene/photo/storyboard context, with deterministic fallback behavior for tests and local development.
- [x] (2026-05-13) Add an authenticated REST endpoint for filling one scene.
- [x] (2026-05-13) Add a Storyboard page button and client call that fills only missing fields and preserves user edits.
- [x] (2026-05-13) Add focused tests for the use case, route behavior, and deterministic adapter. UI behavior is covered by TypeScript and manual acceptance because there is no existing Storyboard interaction test pattern.
- [x] (2026-05-13) Update `docs/gap-analysis.md` after implementation to mark the per-scene AI fill gap as implemented and metadata-based AI fill rows as partial.


## Surprises & Discoveries

- Observation: Template scenes intentionally create blank text fields, but the existing bulk scene save path currently substitutes fallback values for blank fields.
  Evidence: `apps/web/src/components/storyboard/StoryboardPage.tsx` maps empty title, description, imagePrompt, emotion, cameraDirection, lightingDirection, and motionDirection to defaults in `saveScenes()`.

- Observation: Scene assignment data is already available through `Scene.photoAssets`, so a per-scene AI fill use case does not need a schema migration to find the primary photo.
  Evidence: `packages/domain/src/model.ts` defines `Scene.photoAssets: ScenePhotoAsset[]`, and `createTemplateScenesFromPhotos` creates scenes through `createTemplateScene` with the selected photo assigned.

- Observation: The current architecture has ports for image preprocessing and image generation, but no text or multimodal scene-analysis port yet.
  Evidence: `packages/application/src/ports.ts` defines `ImagePreprocessingPort` and `ImageGenerationPort`, but no equivalent port for scene text generation.

- Observation: API routes already perform organization authorization before delegating to application use cases.
  Evidence: `apps/api/src/http/routes.ts` checks the owning project's `organizationId` for storyboard, scene, and generation request routes.

- Observation: The local shell does not expose `pnpm`, `npm`, or `node` on `PATH`, although several local binaries in `node_modules/.bin` can still run.
  Evidence: `pnpm --filter @gen-story/application test` and `pnpm --filter @gen-story/api test` failed with `zsh:1: command not found: pnpm`; local `vitest` and `tsc` commands were used for verification instead.

- Observation: API route tests require unsandboxed local server binding in this environment.
  Evidence: non-escalated route tests failed in `beforeEach` with `listen EPERM: operation not permitted 127.0.0.1`; rerunning the API suite with escalation passed.

- Observation: The repo-level package-manager and format commands are unavailable in this shell.
  Evidence: `pnpm typecheck`, `pnpm lint`, and `pnpm format` fail with `zsh:1: command not found: pnpm`; direct `./node_modules/.bin/prettier` fails with `exec: node: not found`.


## Decision Log

- Decision: Implement the next gap as per-scene AI fill, not full AI storyboard composition or global photo emotion analysis.
  Rationale: The user just completed template scene creation, and `docs/gap-analysis.md` explicitly says template scenes are blank for manual editing or later per-scene AI fill. Per-scene fill is the smallest useful step that turns the new blank scene workflow into a usable AI-assisted workflow.
  Date/Author: 2026-05-13 / Codex

- Decision: Add a new application port named `SceneFillGenerationPort` instead of calling a provider directly from HTTP routes or web UI.
  Rationale: `packages/application` must stay independent from provider SDKs and HTTP frameworks. A port keeps the use case testable and follows the existing `ImageGenerationPort` and `ImagePreprocessingPort` pattern.
  Date/Author: 2026-05-13 / Codex

- Decision: Preserve all non-blank user-edited fields by default and fill only blank fields.
  Rationale: `docs/gap-analysis.md` says the scene card action should populate blank fields while preserving user-edited values. Replacing all fields would create data-loss risk and surprise users.
  Date/Author: 2026-05-13 / Codex

- Decision: Keep provider/model selection out of this change.
  Rationale: Model/provider picker is a separate missing item in `docs/gap-analysis.md`. This plan should introduce one internal adapter and one UI action, not a configuration surface.
  Date/Author: 2026-05-13 / Codex

- Decision: Use existing scene fields and avoid database migrations.
  Rationale: The generated content maps directly to existing `Scene` columns. No new persistence is needed for the first version.
  Date/Author: 2026-05-13 / Codex


## Outcomes & Retrospective

Implemented the per-scene AI fill path from Storyboard UI to API use case to scene persistence. The application layer now owns blank-only merge behavior through `fillSceneWithAi`, the API exposes `POST /api/scenes/:sceneId/ai-fill`, and the web Storyboard card can fill one saved scene without requiring a second save click. The first adapter is deterministic and metadata-based; true photo vision analysis remains a separate gap.


## Context and Orientation

The repository is a pnpm monorepo with a Next.js web app in `apps/web`, a local TypeScript API in `apps/api`, pure domain types and invariants in `packages/domain`, use cases and ports in `packages/application`, and DTO types in `packages/shared`.

The Storyboard page lives at `apps/web/src/components/storyboard/StoryboardPage.tsx`. It loads storyboards, style presets, project photos, and scenes. A recently completed feature adds `createTemplateScenesFromPhotos`, exposed through `POST /api/storyboards/:storyboardId/template-scenes`, which creates one scene per selected photo. Each template scene assigns the selected photo as the primary photo and leaves title, description, image prompt, emotion, camera, lighting, and motion blank.

Scene persistence currently flows through `upsertScenes` in `packages/application/src/use-cases.ts`, `PUT /api/storyboards/:storyboardId/scenes` in `apps/api/src/http/routes.ts`, and `upsertScenes` in `apps/web/src/lib/api-client.ts`. The `Scene` domain model already has all fields needed for AI fill: `title`, `description`, `imagePrompt`, `emotion`, `cameraDirection`, `lightingDirection`, `motionDirection`, `notes`, and `photoAssets`.

Generation prompt composition already exists in `apps/api/src/generation/prompt-composer.ts` and is applied later during image generation. This plan should not duplicate that composition logic. The AI fill should draft the user-editable scene fields. Image generation can continue to compose the final provider prompt from those fields during preprocessing.

The new term in this plan is "scene fill suggestion": a structured draft for one scene containing optional values for the existing scene fields. It is a suggestion generated from the current scene, its primary photo, the storyboard tone, the selected style preset if any, and other project photos or scene summaries as context. The first implementation applies the suggestion immediately to blank fields rather than adding a separate review queue.


## Plan of Work

First, add application contracts. In `packages/application/src/ports.ts`, define `SceneFillGenerationPort` with a method such as `generateSceneFill(input)`. The input should be plain data: project, storyboard, scene, primary photo, optional style preset, project photos, and sibling scenes. The return type should be a structured object with `title`, `description`, `imagePrompt`, `emotion`, `cameraDirection`, `lightingDirection`, and `motionDirection`. Add the port to `ApplicationDependencies`. Keep this interface independent of provider SDK types.

Second, add a use case in `packages/application/src/use-cases.ts`, for example `fillSceneWithAi`. The use case should load the scene, storyboard, project, primary photo, all project photos, sibling scenes, and optional style preset. It should validate that all entities belong to the same project and that the scene has a non-deleted primary photo. It then calls `deps.sceneFillGeneration.generateSceneFill(...)`, merges returned values into the existing scene only when the current field is blank after trimming, saves the scene, and returns the updated scene. This is the core behavioral rule: blank fields are fillable; edited fields are preserved. If no blank fields remain, the use case may return the existing scene unchanged without calling the adapter.

Third, implement the API-side adapter in `apps/api`. Add a module such as `apps/api/src/scene-fill/local-scene-fill-generation.ts`. The adapter should accept repository/storage dependencies only if it needs to read the photo bytes or preview image; otherwise the use case can pass enough metadata and storage keys. For this first version, prefer a deterministic fallback implementation that builds reasonable English copy from photo name, photo notes, storyboard tone, and selected style preset. If a real AI provider is configured, add that behind the adapter without leaking provider SDK objects into `packages/application`. Do not add a provider/model UI.

Fourth, wire the adapter in `apps/api/src/app/create-api-context.ts` when constructing `ApplicationDependencies`. Tests should be able to provide a fake `SceneFillGenerationPort` through existing in-memory application setup in `apps/api/src/test-support/in-memory-application.ts`.

Fifth, expose one REST endpoint. Add a schema in `apps/api/src/http/schemas.ts` for an optional request body, initially something like `{ fields?: string[] }` only if field targeting is needed. The simplest endpoint can accept an empty JSON object or no meaningful options. Add `POST /api/scenes/:sceneId/ai-fill` in `apps/api/src/http/routes.ts`. It should authenticate the user, verify the scene's project belongs to the user's organization, call the use case, and return `toSceneDto(updatedScene)`. The endpoint should use existing error mapping so missing primary photo returns a `422` validation or `409` invalid state response with a readable message.

Sixth, add a client wrapper in `apps/web/src/lib/api-client.ts`, for example `fillSceneWithAi(sceneId: string): Promise<SceneDto>`, using `POST /api/scenes/${sceneId}/ai-fill`.

Seventh, update `apps/web/src/components/storyboard/StoryboardPage.tsx`. Add loading state for the scene currently being filled. Pass an `onAiFill` callback into `SceneCard`. Show a button in each saved scene card header, disabled while the operation is running or while the scene has no `id`. The button should call the new client method, then merge the returned `SceneDto` into local state for that scene. It should not require a separate "Save scenes" click after success because the API has already saved the scene. Keep the visual change small and consistent with the existing scene-card header controls.

Eighth, update styles in `apps/web/src/components/storyboard/StoryboardPage.module.css` only as needed for the button layout and disabled state. Avoid unrelated visual refactors.

Ninth, update tests. Add application use-case tests in `packages/application/src/use-cases.test.ts` proving that blank fields are filled, edited fields are preserved, no-primary-photo scenes are rejected, and the adapter is not called when there are no blank fields. Add route tests in `apps/api/src/http/routes.test.ts` for authentication/authorization shape and successful `POST /api/scenes/:sceneId/ai-fill`. Add adapter tests for deterministic fallback output if a local adapter is created. If a frontend test pattern already exists for Storyboard interactions, add a narrow test for the client function or UI action; otherwise keep UI verification manual and document it in the plan outcome.

Tenth, update `docs/gap-analysis.md` after implementation. Mark "Per-scene AI fill button for empty text fields" as implemented. Mark "AI-generated scene title", "AI-generated scene description", and "AI-generated image prompt per scene" as implemented or partial depending on whether the adapter uses real photo analysis or deterministic metadata-based drafting. Keep "AI photo analysis -> emotion candidates" and global AI scene ordering as not implemented unless they are truly delivered.


## Concrete Steps

Run all commands from `/Users/ran/my-app/gen-story`.

1. Inspect current tests and setup before editing:

    pnpm --filter @gen-story/application test
    pnpm --filter @gen-story/api test

   Expected result: existing tests pass. If they do not pass, record failures in `Surprises & Discoveries` before changing behavior.

2. Add the application port and use case:

    Edit packages/application/src/ports.ts
    Edit packages/application/src/use-cases.ts
    Edit packages/application/src/index.ts if exports are required
    Edit packages/application/src/use-cases.test.ts

   Expected result: `pnpm --filter @gen-story/application test` passes and includes tests for preservation of edited fields.

3. Add API adapter and dependency wiring:

    Add apps/api/src/scene-fill/local-scene-fill-generation.ts
    Edit apps/api/src/app/create-api-context.ts
    Edit apps/api/src/test-support/in-memory-application.ts as needed
    Add or edit apps/api/src/scene-fill/local-scene-fill-generation.test.ts

   Expected result: adapter tests pass and no provider SDK leaks into `packages/application`.

4. Add REST endpoint:

    Edit apps/api/src/http/schemas.ts
    Edit apps/api/src/http/routes.ts
    Edit apps/api/src/http/routes.test.ts

   Expected result: `pnpm --filter @gen-story/api test` passes and `POST /api/scenes/:sceneId/ai-fill` returns a `SceneDto` for an authorized user.

5. Add web client and UI button:

    Edit apps/web/src/lib/api-client.ts
    Edit apps/web/src/components/storyboard/StoryboardPage.tsx
    Edit apps/web/src/components/storyboard/StoryboardPage.module.css

   Expected result: Storyboard page builds and the button updates only the targeted scene in local state.

6. Run repository checks:

    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm format

   Expected result: all checks pass. `pnpm typecheck` is mandatory after code changes per `AGENTS.md`.

7. Manually verify the user flow:

    pnpm dev

   In the browser, open `http://localhost:3000`, create or open a project, upload candidate photos, initialize a storyboard, create template scenes from photos, click the AI fill button on a blank scene, and confirm the scene card receives generated text while pre-existing typed values remain unchanged.


## Validation and Acceptance

Acceptance is observable through both tests and UI behavior.

Automated acceptance:

- `pnpm --filter @gen-story/application test` passes with tests proving blank-only merge behavior.
- `pnpm --filter @gen-story/api test` passes with route coverage for `POST /api/scenes/:sceneId/ai-fill`.
- `pnpm typecheck` passes across the workspace.
- `pnpm lint`, `pnpm test`, and `pnpm format` pass, or any inability to run them is documented with the closest useful verification performed.
- The architecture boundary check still reports no forbidden imports from domain/application:

    rg "from ['\\\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application

  Expected result: no matches.

Manual acceptance:

- A saved template scene with a primary photo and blank fields shows an AI fill action.
- Clicking the action saves and displays a non-empty title, description, image prompt, emotion, camera, lighting, and motion for fields that were blank.
- If the user typed a title before clicking AI fill, that title remains unchanged after the request.
- A scene without a primary photo produces a readable error and does not mutate the scene.
- Continuing to Generate still uses the existing image generation flow and composed prompts.


## Idempotence and Recovery

The use case is safe to run repeatedly because it only fills fields that are blank after trimming. Running it again on a fully filled scene returns the same persisted scene and does not call the adapter. Running it after the user clears one field fills only that newly blank field.

No data migration is planned. If implementation introduces a migration unexpectedly, stop and revise this ExecPlan before editing schema files.

If adapter output is malformed or incomplete, validate and normalize it at the adapter boundary. The use case should reject missing required suggestions only when those suggestions are needed for currently blank fields; otherwise it should preserve existing values.

If the API endpoint is added but the UI fails, the route can still be verified directly through route tests and the web change can be retried independently. If the real provider path fails due to missing credentials, local deterministic fallback should keep tests and demos working.

If tests fail because existing unrelated tests are already broken, record exact failures in `Surprises & Discoveries` and run the narrowest relevant tests after each fix.


## Artifacts and Notes

Relevant current files:

- `docs/gap-analysis.md` identifies per-scene AI fill, AI-generated scene title/description/prompt, and story-level AI context as missing.
- `docs/plans/20260512-template-scenes-and-cancel-generation.md` records the recently completed template scene and cancel generation work.
- `packages/domain/src/model.ts` defines `Scene`, `ScenePhotoAsset`, `PhotoAsset`, `Storyboard`, and related plain domain types.
- `packages/application/src/ports.ts` defines application dependencies and is the correct place for a new AI fill port.
- `packages/application/src/use-cases.ts` contains `createTemplateScenesFromPhotos`, `upsertScenes`, and related scene use cases.
- `apps/api/src/http/routes.ts` contains current authenticated REST routes and organization authorization patterns.
- `apps/api/src/http/schemas.ts` contains Zod request schemas.
- `apps/api/src/app/create-api-context.ts` wires concrete API adapters into application dependencies.
- `apps/web/src/lib/api-client.ts` contains frontend API wrappers.
- `apps/web/src/components/storyboard/StoryboardPage.tsx` is the user-facing page that should expose the button.

Do not modify generated outputs such as `node_modules`, `.next`, `dist`, or `*.tsbuildinfo`. Do not add production cloud deployment, external queues, billing, WorkOS production login, video generation, BGM generation, or a provider/model chooser as part of this work.


## Interfaces and Dependencies

New application interface:

- `SceneFillGenerationPort` in `packages/application/src/ports.ts`. This is needed so the application use case can request structured draft scene fields without depending on OpenAI, Gemini, Google, HTTP, or filesystem APIs.

Existing repository interfaces:

- `ProjectRepositoryPort`, `StoryboardRepositoryPort`, `SceneRepositoryPort`, `PhotoAssetRepositoryPort`, and `StylePresetRepositoryPort` are needed to load and validate context for one scene fill.

Existing domain functions and types:

- `createScene` and existing `Scene` fields are sufficient for persistence. No new domain entity is required.

Existing HTTP and DTO interfaces:

- `toSceneDto` in `apps/api/src/http/dto-mappers.ts` should be reused for the endpoint response.
- `SceneDto` in `packages/shared/src/index.ts` should remain the UI contract for the updated scene.

External dependencies:

- No new runtime dependency is required for the deterministic fallback.
- If a real provider path is added, keep provider SDK usage inside `apps/api` only and document any required environment variable in `.env.example` and README. Do not expose SDK response shapes through REST or application ports.
