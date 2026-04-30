## Implementation Plan

This plan defines the execution order for the initial local web application, based on `REQUIREMENTS_INIT.md`, `USER_EXPERIENCE_FLOW.md`, and `MONETIZATION_STRATEGY.md`.

All implementation work, code comments, pull requests, task names, and technical documentation should be written in English from this point forward.

## A. Classification Result

Large.

The initial implementation includes UI, API, database persistence, local file storage, image preprocessing, asynchronous image generation jobs, and authentication adapters.

The first release does not include production cloud deployment, external queues, paid billing, SNS publishing, affiliate integration, travel planning, video generation, or BGM generation.

## B. Recommended Architecture Changes

- Start with a small monorepo that remains split-ready.
- Use Next.js, TypeScript, and Tailwind CSS for the initial web app.
- Use TypeScript for the initial backend.
- Use REST-first APIs with explicit request and response schemas.
- Use SQLite and Drizzle for the local database.
- Use Drizzle only inside repository adapters.
- Keep `packages/domain` independent from Next.js, Drizzle, OpenAI SDK, WorkOS SDK, GCP SDK, AWS SDK, Zod, and HTTP frameworks.
- Keep `packages/application` independent from framework and infrastructure details.
- Treat external dependencies as ports and adapters.
- Treat image generation as an asynchronous job from the beginning.
- Use a lightweight local worker first, then replace the execution backend through `JobQueuePort` when moving to production.
- Keep GCP and AWS as production candidates, but do not expose either cloud platform to Domain or Application code.

Initial package layout:

```text
apps/web
apps/api
packages/domain
packages/application
packages/infrastructure
packages/shared
```

`packages/infrastructure` may initially live inside `apps/api` if that keeps the first implementation simpler. Extract it once infrastructure code becomes large enough to justify the package boundary.

## C. Minimal Implementation Sequence

### Phase 0: Repository And Development Baseline

Goal:

- Create the smallest working monorepo that can run, typecheck, and test locally.

Implement:

- Workspace and package manager setup.
- Shared TypeScript configuration.
- `apps/web` with Next.js.
- `apps/api` with a TypeScript API server.
- `packages/domain`.
- `packages/application`.
- `packages/shared`.
- Minimal lint, format, typecheck, and test commands.
- Basic local environment files and setup documentation.

Verify:

- `apps/web` starts locally.
- `apps/api` starts locally.
- Typecheck passes.
- A minimal test suite passes.
- No Domain or Application package imports framework or SDK code.

### Phase 1: Clickable UI Mock

Goal:

- Validate the Phase 1 user flow before connecting real persistence or AI generation.

Implement:

- Project list screen.
- Project creation screen.
- Photo upload screen.
- Photo management screen.
- Emotion selection screen.
- Storyboard editing screen.
- Generated image comparison screen.
- Local file selection and preview.
- Mock data for navigation and state.
- Desktop-first layout that remains usable on tablet widths.

Verify:

- The seven core screens are reachable through clickable navigation.
- The user can complete the mocked flow from photo selection to generated image comparison.
- Layout does not break on desktop or tablet widths.
- The mock does not introduce real DB, real AI generation, or real authentication dependencies.

### Phase 2: Domain And Application Skeleton

Goal:

- Define the core model and use case boundaries before wiring infrastructure.

Implement:

- Domain concepts:
    - `Project`.
    - `PhotoAsset`.
    - `Storyboard`.
    - `Scene`.
    - `StylePreset`.
    - `GenerationRequest`.
    - `GeneratedImage`.
    - Minimal `User`.
    - Minimal `Organization`.
- Domain invariants:
    - Scene ordering.
    - Photo usage states.
    - One primary photo per scene.
    - One adopted generated image per scene.
    - Generation request state transitions.
- Application use cases:
    - Create project.
    - Upload/register photo asset.
    - Update photo usage.
    - Create or update storyboard.
    - Create or update scenes.
    - Assign photos to scenes.
    - Create generation requests.
    - Mark generated image as adopted.
    - Retry failed generation.
- Ports:
    - Repository ports.
    - `ObjectStoragePort`.
    - `ImagePreprocessingPort`.
    - `ImageGenerationPort`.
    - `JobQueuePort`.
    - `ProgressEventPort`.
    - `AuthContextPort`.

Verify:

- Domain unit tests pass.
- Application use case tests pass with mock repositories and mock adapters.
- Domain does not import infrastructure, framework, SDK, or validation libraries.
- Application does not import Next.js, Drizzle, OpenAI SDK, WorkOS SDK, GCP SDK, or AWS SDK.

### Phase 3: SQLite And Drizzle Persistence

Goal:

- Persist the initial data model in local SQLite using Drizzle migrations.

Implement:

- Drizzle schema and migrations.
- Repository adapters for:
    - Users.
    - Organizations.
    - Projects.
    - Photo assets.
    - Storyboards.
    - Scenes.
    - Scene photo assets.
    - Style presets.
    - Generation requests.
    - Generated images.
- Soft delete using `deletedAt`.
- Storage metadata columns such as `storageKey`, MIME type, size, width, height, and checksum.
- `generation_requests.status` with `queued`, `running`, `succeeded`, `failed`, and `canceled`.
- Adoption switching for generated images.

Verify:

- Migrations apply to local SQLite from a clean database.
- Project, PhotoAsset, Storyboard, and Scene records can be created and retrieved.
- Scene order is restored by `orderIndex`.
- Soft-deleted records are excluded from normal list queries.
- A failed `GenerationRequest` does not mark the Storyboard itself as failed.
- A scene has at most one adopted generated image through repository or application enforcement.

### Phase 4: Local File Storage And Image Preprocessing

Goal:

- Store original files, previews, and AI-ready normalized images through storage keys instead of absolute paths.

Implement:

- Local `ObjectStoragePort` adapter.
- Original photo storage.
- HEIC upload support.
- HEIC to JPEG conversion for display, preview, and AI input.
- Original HEIC retention.
- One initial preview size.
- AI input normalization with a maximum resolution.
- Original file checksum calculation.
- Project-level exact duplicate detection by checksum.

Storage key conventions:

```text
data/uploads/originals/projects/{projectId}/{photoAssetId}.{ext}
data/uploads/previews/projects/{projectId}/{photoAssetId}_{preset}.{ext}
data/uploads/generated/images/projects/{projectId}/scenes/{sceneId}/{generatedImageId}.{ext}
data/uploads/generated/videos/projects/{projectId}/scenes/{sceneId}/{generatedVideoId}.{ext}
data/uploads/generated/bgms/projects/{projectId}/{generatedBgmId}.{ext}
```

Verify:

- Uploaded files are stored under storage keys.
- The database never stores absolute local file paths.
- Preview images are generated and retrievable.
- Normalized AI input images are generated when needed.
- Exact duplicates within the same project are detected by original file checksum.
- Domain and Application code do not depend on local filesystem paths.

### Phase 5: REST API And Local Authentication

Goal:

- Connect the web UI to persisted data through REST APIs while keeping authentication testable.

Implement:

- REST API routes.
- Zod request validation at the API boundary.
- DTOs and API schemas in a shared package when useful.
- Local/test auth adapter.
- Fixed local test user and organization.
- Project API.
- PhotoAsset API.
- Storyboard API.
- Scene API.
- StylePreset API.
- GenerationRequest API.
- GeneratedImage API.

Verify:

- Invalid API input is rejected at the API boundary.
- API DTOs do not leak Drizzle schema objects.
- API DTOs do not expose SDK response objects.
- Local automated tests run without WorkOS.
- WorkOS can be added later as an adapter without changing use case contracts.
- The UI can read and write project, photo, storyboard, and scene data through the API.

### Phase 6: Image Generation Jobs

Goal:

- Run image generation as asynchronous jobs with resumable UI state.

Implement:

- Generation request creation.
- State transitions:
    - `queued`.
    - `running`.
    - `succeeded`.
    - `failed`.
    - `canceled`.
- Lightweight local worker.
- Mock image generation adapter for automated tests.
- OpenAI image generation adapter for limited real generation.
- Project-level concurrency policy:
    - Maximum five `running` generation requests per project.
    - Additional requests may remain `queued`.
- Short failure reason storage.
- Retry only failed scenes.
- Generated image storage through `ObjectStoragePort`.
- Generated image metadata persistence.
- Adopt and unadopt generated images.

Verify:

- Queued jobs move to running and then to succeeded or failed.
- Project-level running jobs never exceed five.
- Failed scenes can be retried independently.
- Generated image files are stored through storage keys.
- Generated image metadata is saved.
- Adoption switching is transactional.
- Mock generation tests are fast and deterministic.
- Real OpenAI API tests are limited to manual or smoke verification.

### Phase 7: Integrated Phase 1 Product Flow

Goal:

- Replace the mock flow with real persistence, file handling, and generation jobs.

Implement:

- Project list connected to API.
- Project creation connected to API.
- Photo upload connected to API and storage.
- Photo management connected to API.
- Emotion selection persistence.
- Storyboard editing persistence.
- Scene photo assignment.
- Image generation start action.
- Generation progress UI.
- Scene-level generation statuses:
    - Waiting.
    - Running.
    - Succeeded.
    - Failed.
- Overall progress such as `4 of 12 completed`.
- Current scene name display.
- Short failure reason display.
- Generated image comparison.
- Adopt and reject actions.
- Regenerate failed or selected scenes.
- State restoration after reload or navigation.

Verify:

- The user can complete the flow from photo upload to adopted generated image set.
- The user can leave the generation screen and return without losing job state.
- Reloading the browser restores project, storyboard, scene, and generation state.
- Failed generation shows a short reason and retry action.
- The main flow has E2E coverage.

### Phase 8: Local Release Readiness

Goal:

- Make the local web application stable enough for repeated personal use.

Implement:

- Error display cleanup.
- Basic logging.
- Minimal debug views or logs for generation requests.
- Soft delete and restore behavior.
- Basic orphan file detection.
- Basic cleanup script for expired deleted files.
- Seed or demo data.
- README setup instructions.
- README test instructions.
- Known limitations list.

Verify:

- A clean checkout can be set up from the README.
- Database migrations can be applied from scratch.
- Main tests pass.
- Main E2E flow passes.
- Known non-implemented future features are documented.

## D. Test Plan

Shared behavior:

- Test Domain invariants with unit tests.
- Test Application use cases with mock repositories and mock adapters.
- Test Repository adapters against SQLite.
- Test REST API validation and response contracts.
- Test the main UI flow with E2E tests.

Adapter-specific behavior:

- Test Local ObjectStorage adapter with real local files.
- Test image preprocessing adapter separately because HEIC support can be environment-dependent.
- Use the mock image generation adapter for standard automated tests.
- Restrict real OpenAI API checks to smoke tests or manual verification.
- Do not require WorkOS login for local automated tests.

Architecture checks:

- `packages/domain` must not depend on framework, SDK, ORM, HTTP, Zod, or cloud libraries.
- `packages/application` must not depend on Next.js, Drizzle, OpenAI SDK, WorkOS SDK, GCP SDK, or AWS SDK.
- `packages/shared` must not become a dumping ground for UI components, database models, SDK responses, or app-specific state.
- `apps/*` may depend on `packages/*`.
- `packages/*` must not depend on `apps/*`.

Recommended command categories:

```text
typecheck
lint
test
test:integration
test:e2e
db:migrate
dev
```

Exact commands should be finalized when the workspace tooling is created.

## E. Risks And Migration Plan

- Compatibility:
    - Keep REST contracts explicit so future web, mobile, desktop, and agent clients can be added.
    - Keep generation job semantics stable even while the execution backend changes.
    - Keep API DTOs separate from Domain entities and Drizzle schemas.
- Data migration:
    - Use Drizzle Kit migrations from the first database version.
    - Prefer schema choices that can move from SQLite to PostgreSQL later.
    - Keep generated files addressable through storage keys instead of local absolute paths.
- Cloud migration:
    - Start with local adapters.
    - Add GCP or AWS adapters behind existing ports.
    - Do not let cloud SDK objects cross adapter boundaries.
- Queue migration:
    - Start with a local worker.
    - Replace worker dispatch with `JobQueuePort` adapter when production needs it.
    - Preserve `generation_requests` as the source of truth for job state.
- Authentication migration:
    - Start with local/test auth.
    - Add WorkOS as an adapter.
    - Keep automated tests independent from real WorkOS login.
- Rollback:
    - Mock adapters must remain available for generation and auth.
    - If OpenAI integration fails, the rest of the product flow should still work with mock generation.
    - If external queue integration fails later, revert to local worker behavior.
- Deprecation:
    - Travel planning, monetization, SNS publishing, payment, affiliate integration, external calendar sync, and map/route integration are not part of the initial implementation.
    - Video generation, BGM generation, similar-image detection, and estimated remaining time are future features.

## Initial Milestones

### M1: Clickable UI Mock

Done when:

- The seven core screens are navigable.
- The user can complete the mocked flow from photo input to generated image comparison.
- Desktop and tablet layouts are acceptable.

### M2: Persisted Project Workspace

Done when:

- Project, PhotoAsset, Storyboard, Scene, and StylePreset records persist in SQLite.
- The UI can create, edit, and read the core workspace through APIs.
- Local/test auth is active and does not block automated tests.

### M3: File Storage And Preprocessing

Done when:

- Original files, previews, and normalized AI input images are stored.
- The database stores storage keys and metadata.
- Project-level exact duplicate detection works.
- HEIC conversion is validated in an adapter-level test or manual smoke check.

### M4: Image Generation Jobs

Done when:

- Mock generation jobs move through the full state lifecycle.
- Project-level concurrency is capped at five running jobs.
- Generated images are stored and visible in the UI.
- Failed scenes can be retried independently.

### M5: Phase 1 Usable Flow

Done when:

- The user can upload photos, manage them, select emotion, edit storyboard scenes, generate images, compare results, and select adopted images.
- State survives navigation and browser reload.
- Errors show short, actionable messages.
- The main flow has automated coverage.

## Out Of Scope For Initial Implementation

- Production GCP or AWS deployment.
- External queue infrastructure.
- Stripe or paid coin purchase.
- WorkOS production login requirement.
- SNS auto-publishing.
- Affiliate link generation.
- Travel planning.
- Google Calendar integration.
- Google Maps or route planning integration.
- Video generation.
- BGM generation.
- Mobile apps.
- Desktop apps.
- Similar-image duplicate detection.
- Estimated remaining time display.
