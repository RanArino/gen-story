# Phase 1 Completion: Test Generation, JSON Export, and Style Previews

This ExecPlan delivers three high-priority Phase 1 features: test generation workflow, storyboard JSON export, and style preset preview images. Together, they complete the core generation cycle and enable handoff to video generation.

This plan follows `/Users/ran/my-app/PLANS.md` (ExecPlan standard).


## Purpose / Big Picture

After this work, users will be able to:

1. **Test generation** — Generate 3 preview images before committing to full generation, adjust style interactively, and confirm one test result to proceed with bulk generation. This prevents wasted generation cycles on mismatched styles.

2. **Export storyboard** — Export the complete adopted storyboard as JSON structured for video generation pipelines (CapCut, Seedance, etc.). This unblocks Phase 2 (video generation) and fulfills the Phase 1 deliverable contract.

3. **Preview styles** — See visual previews of each system style preset side-by-side before selection. This reduces uncertainty in style choice.

**Why it matters:** Phase 1's goal is "produce a storyboard and adopted generated-image set that can be handed to video generation." These three features close the gap between draft composition and final export, providing validation and clarity at each step.

**Observable outcome:** Users navigate: Storyboard → Select Style → *Test 3 samples → Confirm one → Bulk Generate* → Review & Adopt → *Export JSON* → Download file with scene data, asset URLs, and metadata.


## Context and Orientation

This repository is a pnpm monorepo (clean architecture) with API (`apps/api`), web frontend (`apps/web`), and domain/application packages (`packages/`). Current state for each requirement:

### Test Generation Workflow
- **Current gap:** `GeneratePage` goes directly to bulk generation; no preview/test phase.
- **Required steps:** Create test-generation request type, persist test results, build UI for preview + adjustment, implement confirmation logic.
- **Affected areas:** Domain (new policy/rule), Application (new use case), API (new endpoints), Web (new page/modal).

### Storyboard JSON Export
- **Current gap:** `GET /api/storyboards/:id` returns internal DB shape; no export endpoint or download flow.
- **Required structure:** Flatten adopted scenes with asset URLs, include tone, style preset, and metadata; return structured JSON consumable by video tools.
- **Affected areas:** API (new export endpoint), Web (export trigger on review page).

### Style Preset Preview Images
- **Current gap:** `style_presets` table exists; preview images not generated or served.
- **Strategy:** Add preview image files to `public/style-previews/` (e.g., `public/style-previews/cinematic.jpg`); reference in API and style picker UI.
- **Affected areas:** File storage (new public assets), API (serve preview URLs), Web (style picker UI).

**Dependency graph:**
- Test generation feeds into bulk generation.
- Style previews inform test generation selection.
- JSON export consumes the final adopted set.
- No architectural changes required; all work stays within existing layers.


## Plan of Work

Work will be completed in three independent milestones, each verifiable and shippable:

### Milestone 1: Style Preset Preview Images (Quickest Win)
Add visual previews for system style presets to unblock informed style selection before testing.

1. Create placeholder preview image files in `public/style-previews/` for all 9 system presets.
2. Update `StylePresetService` to serve preview URLs (e.g., `/public/style-previews/cinematic.jpg`).
3. Update `StyleSelector` component to display preview images in a gallery/comparison view.
4. Verify preview images appear in style picker UI on storyboard page.

**Files to create/modify:**
- `public/style-previews/*.jpg` (new; 9 system presets)
- `apps/api/src/generation/style-preset-service.ts` (add preview URL getter)
- `apps/web/src/components/StyleSelector.tsx` (display preview image per preset)

**Why first:** Lowest risk, no DB changes, unblocks UX immediately. Users can make informed style choice before testing.

### Milestone 2: Test Generation Workflow (Core Logic)
Implement the preview-test-confirm cycle before bulk generation.

1. Create domain policy: `TestGenerationPolicy` to enforce 3-pattern test limit, track state (pending → completed), and determine when bulk generation is allowed.
2. Create application use case: `RequestTestGenerationUseCase` to create test requests with reduced concurrency (e.g., max 1 test batch per project).
3. Extend API to add:
   - `POST /api/storyboards/:storyboardId/test-generation` — Create test batch (3 requests with same style/tone, different small variations)
   - `GET /api/storyboards/:storyboardId/test-generation/current` — Fetch current test batch and results
   - `POST /api/storyboards/:storyboardId/test-generation/confirm` — User selects one test result to adopt, proceed with bulk
4. Build web UI:
   - New `TestGenerationModal` shown after style selection on `StoryboardPage`
   - Display 3 test results as cards with "confirm" action
   - "Regenerate tests" option to start over (reset test state)
   - Progress indicator (N of 3 complete)
5. Update `StoryboardPage` flow: Style select → Test modal → (if confirmed) Bulk generation.

**Files to create/modify:**
- `packages/domain/src/policies/test-generation.policy.ts` (new)
- `packages/application/src/use-cases/request-test-generation.use-case.ts` (new)
- `apps/api/src/http/routes/storyboards-test-generation.ts` (new)
- `apps/api/src/http/router.ts` (register test generation routes)
- `apps/web/src/pages/StoryboardPage.tsx` (add test flow, conditional routing)
- `apps/web/src/components/TestGenerationModal.tsx` (new)
- `packages/shared/src/dtos/test-generation.dto.ts` (new; request/response shapes)

**DB change:** Add `test_generation_batches` table to track test state per storyboard (status, confirmedScenePhotoGenerationId, createdAt, completedAt).

**Why second:** Builds on existing generation infrastructure; no schema conflicts; can be tested independently before export.

### Milestone 3: Storyboard JSON Export
Create export endpoint and download flow for video generation pipeline consumption.

1. Create application use case: `ExportStoryboardAsJsonUseCase` to flatten adopted scenes, resolve asset URLs, and include metadata (tone, style preset name, generation config).
2. Add API endpoint: `GET /api/storyboards/:storyboardId/export.json` returns JSON with:
   - Storyboard metadata (title, description, tone, stylePresetName)
   - Array of scenes with: title, description, emotion, camera, lighting, motion, adopted image URL, source photo URL, image prompt
   - Project metadata (uploadedPhotoURLs for reference)
3. Build web UI:
   - "Export JSON" button on `ReviewPage`
   - Trigger download with filename `storyboard-{projectId}-{timestamp}.json`
4. Validate JSON schema against a doc spec (include `.json.schema` or `.jsonschema` file for reference).

**Files to create/modify:**
- `packages/application/src/use-cases/export-storyboard-as-json.use-case.ts` (new)
- `apps/api/src/http/routes/storyboards-export.ts` (new)
- `apps/api/src/http/router.ts` (register export route)
- `apps/web/src/pages/ReviewPage.tsx` (add export button)
- `docs/storyboard-export-schema.md` (new; JSON schema and example)
- `packages/shared/src/dtos/storyboard-export.dto.ts` (new)

**Why third:** Depends on adopted generation results; safe to implement last.

**Ordering rationale:** Previews → Test generation (core logic) → Export. Test generation unlocks user control; export is the final handoff.


## Concrete Steps

### Milestone 1: Style Preset Preview Images

1. **Generate placeholder preview images:**

       mkdir -p public/style-previews
       # Create or download 9 preview images (one per system preset).
       # For now, use placeholder 600x400 JPEG or PNG for each style.
       # Names: cinematic.jpg, vibrant.jpg, moody.jpg, etc. (match style preset names)
       ls -la public/style-previews/  # Verify all 9 images present

2. **Update StylePresetService to return preview URLs:**
   - Open `apps/api/src/generation/style-preset-service.ts`
   - Add method `getPreviewImageUrl(presetName: string): string` returning `${API_BASE}/public/style-previews/${presetName}.jpg`
   - Test: `curl http://localhost:4000/public/style-previews/cinematic.jpg` returns the image

3. **Update StyleSelector component:**
   - Open `apps/web/src/components/StyleSelector.tsx`
   - Fetch preview URL for each preset and render in a gallery grid (e.g., 3 columns)
   - Each preset card shows image + name + description
   - On click, update storyboard tone and proceed to test generation modal

4. **Verify in browser:**

       pnpm dev
       # Navigate to storyboard page, open style picker
       # Expected: 9 style images displayed, clicking a style selects it and shows test modal

5. **Type check and test:**

       pnpm typecheck
       pnpm test


### Milestone 2: Test Generation Workflow

1. **Create domain policy:**
   - Open `packages/domain/src/policies/test-generation.policy.ts` (new file)
   - Define `TestGenerationPolicy` class with:
     - `validateTestGenerationRequest(storyboardId, currentTestBatchStatus)` — Ensure max 1 active test batch per storyboard
     - `canProceedToBulk(testBatchStatus)` — Return true only if test batch status is "completed" and user has confirmed one result
   - Minimal, no dependencies outside domain

2. **Create application use case:**
   - Open `packages/application/src/use-cases/request-test-generation.use-case.ts` (new file)
   - `RequestTestGenerationUseCase` accepts `{ storyboardId, scenesToTest: SceneId[] }`
   - Creates 3 `GenerationRequest` objects with flag `isTest: true`, same style/tone, minor prompt variations
   - Returns test batch info (id, status, requestIds)
   - Inject `TestGenerationRepository`, `GenerationRequestRepository`

3. **Create DTO types:**
   - Open `packages/shared/src/dtos/test-generation.dto.ts` (new file)
   - `TestGenerationBatchDTO`, `TestGenerationResultDTO`, `ConfirmTestGenerationDTO`

4. **Create API routes:**
   - Open `apps/api/src/http/routes/storyboards-test-generation.ts` (new file)
   - `POST /api/storyboards/:storyboardId/test-generation` — Call use case, return batch info
   - `GET /api/storyboards/:storyboardId/test-generation/current` — Fetch current batch and its 3 generation results
   - `POST /api/storyboards/:storyboardId/test-generation/confirm` — Mark batch complete, allow bulk generation
   - Register in `apps/api/src/http/router.ts`

5. **Create test-generation table:**
   - Open `drizzle/schema.ts` and add:
     ```
     testGenerationBatches: sqliteTable('test_generation_batches', {
       id: text('id').primaryKey(),
       storyboardId: text('storyboard_id').notNull().references(() => storyboards.id),
       status: text('status').notNull(), // 'pending' | 'completed'
       confirmedGenerationRequestId: text('confirmed_generation_request_id'),
       createdAt: integer('created_at').notNull(),
       completedAt: integer('completed_at'),
     })
     ```
   - Generate migration: `pnpm --filter @gen-story/api db:generate`
   - Review, then apply: `pnpm --filter @gen-story/api db:migrate`

6. **Create web UI:**
   - Open `apps/web/src/components/TestGenerationModal.tsx` (new file)
   - Display 3 test result cards with adopted image preview + metadata
   - "Confirm this style" button per result
   - "Generate new tests" button to start over
   - Show progress (N of 3 complete)
   - On confirm, close modal and show "Proceed to bulk generation" button
   
7. **Update StoryboardPage flow:**
   - Open `apps/web/src/pages/StoryboardPage.tsx`
   - After user selects a style, check if test batch exists and is pending
   - If pending: show `<TestGenerationModal />` (blocks generation until confirmed)
   - If confirmed: show "Generate all" button to proceed with bulk generation
   - If no test yet: "Generate Test Patterns" button to kick off 3 test requests

8. **Verify:**

       pnpm dev
       # Storyboard → Select style → "Generate Test Patterns" → Wait for 3 results → Confirm → Bulk generation button unlocks
       
9. **Type check, test, lint:**

       pnpm typecheck
       pnpm test
       pnpm lint


### Milestone 3: Storyboard JSON Export

1. **Create JSON export use case:**
   - Open `packages/application/src/use-cases/export-storyboard-as-json.use-case.ts` (new file)
   - `ExportStoryboardAsJsonUseCase` accepts `{ storyboardId, projectId }`
   - Fetch storyboard, all adopted scenes, their generation requests, source photos, adopted images
   - Flatten into JSON structure: `{ storyboard: {...}, scenes: [{...}], assetIndex: {...} }`
   - Return as string (caller serializes to file)

2. **Create DTO:**
   - Open `packages/shared/src/dtos/storyboard-export.dto.ts` (new file)
   - `StoryboardExportDTO` with full nested structure
   - Include URLs for all images (adopted generation result, source photo)

3. **Create API endpoint:**
   - Open `apps/api/src/http/routes/storyboards-export.ts` (new file)
   - `GET /api/storyboards/:storyboardId/export.json`
   - Set response header: `Content-Type: application/json`
   - Optional: `Content-Disposition: attachment; filename="storyboard-{timestamp}.json"`
   - Call use case, return JSON string

4. **Register endpoint:**
   - Open `apps/api/src/http/router.ts`
   - Add route: `app.get('/api/storyboards/:storyboardId/export.json', handleExportStoryboard)`

5. **Create schema doc:**
   - Open `docs/storyboard-export-schema.md` (new file)
   - Define JSON structure with comments, field descriptions, example output
   - Include URL patterns for images (e.g., `http://localhost:4000/uploads/...`)

6. **Add web UI:**
   - Open `apps/web/src/pages/ReviewPage.tsx`
   - Add "Export Storyboard" button (e.g., bottom-right corner)
   - On click: call `GET /api/storyboards/:id/export.json`, trigger browser download with filename `storyboard-{projectId}-{createdAt}.json`

7. **Verify:**

       pnpm dev
       # ReviewPage → Click "Export" → JSON file downloads → Open file, verify structure matches schema

8. **Type check, test, lint:**

       pnpm typecheck
       pnpm test
       pnpm lint


## Validation and Acceptance

### Milestone 1 Acceptance Criteria
- [ ] 9 preview images visible in `public/style-previews/`
- [ ] StyleSelector component renders preview gallery with 3-column layout
- [ ] Clicking a preview selects style and triggers test generation modal
- [ ] No TypeErrors, no lint errors

### Milestone 2 Acceptance Criteria
- [ ] Test generation endpoints respond correctly (POST create, GET current, POST confirm)
- [ ] 3 test requests created with flag `isTest: true`, different prompts
- [ ] Test batch table created and migrated
- [ ] UI flow: Select style → Test modal → Confirm → Bulk generation button unlocks
- [ ] "Generate new tests" resets test batch state
- [ ] No TypeErrors, all tests pass, no lint errors

### Milestone 3 Acceptance Criteria
- [ ] `GET /api/storyboards/:id/export.json` returns valid JSON structure
- [ ] Exported JSON includes all scenes, adopted image URLs, tone, style preset name
- [ ] ReviewPage shows "Export" button
- [ ] Clicking "Export" downloads JSON file with timestamp filename
- [ ] Downloaded JSON validates against documented schema
- [ ] No TypeErrors, all tests pass, no lint errors

### Full Integration Acceptance
- [ ] End-to-end flow: Storyboard → Select style (with preview) → Generate tests (3 samples) → Confirm → Bulk generate → Review → Export JSON → File downloads
- [ ] Manual smoke test in browser
- [ ] E2E test updated or new test added to `e2e/` (optional if coverage exists via unit tests)


## Idempotence and Recovery

- **Milestone 1 images:** Safe to regenerate or update anytime.
- **Milestone 2 DB migration:** Idempotent with Drizzle. If migration applied twice, no-op.
- **Test batch state:** If test batch creation fails mid-flight, next attempt will create a new batch. No orphan cleanup required.
- **Export endpoint:** Safe to call multiple times; returns same JSON each time for a given storyboard snapshot.

**Recovery steps if migration fails:**
1. Rollback: `rm drizzle/xxx.sql` (the generated migration file)
2. Fix schema in `drizzle/schema.ts`
3. Re-generate: `pnpm --filter @gen-story/api db:generate`
4. Apply: `pnpm --filter @gen-story/api db:migrate`


## Progress

- [x] Milestone 1: Style preset preview images (COMPLETED 2026-05-16)
  - [x] Create `public/style-previews/` and 9 placeholder images
  - [x] Update `toStylePresetDto` mapper with preview URL generator
  - [x] Add `previewImageUrl` field to StylePresetDto
  - [x] Update `StoryboardPage` component to display preview images with img elements
  - [x] Type check and test - all passing

- [x] Milestone 2: Test generation workflow (COMPLETED 2026-05-16)
  - [x] Created domain types: `TestGenerationBatch`, `TestGenerationBatchId`, `TestGenerationBatchStatus`
  - [x] Created domain functions: `createTestGenerationBatch`, `canStartTestGeneration`, `completeTestGenerationBatch`, `resetTestGenerationBatch`
  - [x] Created database schema for `test_generation_batches` table
  - [x] Generated and applied database migration (0003_add_test_generation_batches.sql)
  - [x] Created `TestGenerationBatchRepositoryPort` in `packages/application/src/ports.ts`
  - [x] Created `SqliteTestGenerationBatchRepository` in `apps/api/src/db/repositories.ts`
  - [x] Created `TestGenerationBatchDto` in `packages/shared/src/index.ts`
  - [x] Created `toTestGenerationBatchDto` mapper in `apps/api/src/http/dto-mappers.ts`
  - [x] Created application use cases: `requestTestGeneration`, `confirmTestGeneration`, `resetTestGeneration`
  - [x] Added 4 API routes: POST create, GET current, POST confirm, POST reset
  - [x] Created `TestGenerationModal` component with polling, variant cards, confirm and reset actions
  - [x] Updated `StoryboardPage` to conditionally show test modal vs. bulk generation link
  - [x] Wired `testGenerationBatches` into in-memory test support (use-cases.test.ts + in-memory-application.ts)
  - [x] Type check - all 5 packages passing; 71 API + 15 application + 16 domain tests passing

- [x] Milestone 3: Storyboard JSON export (COMPLETED 2026-05-16)
  - [x] Created `exportStoryboardAsJson` use case with flattened scene + asset URL structure
  - [x] Added `GET /api/storyboards/:storyboardId/export.json` endpoint with `Content-Disposition: attachment` header
  - [x] Added `exportStoryboardUrl` helper to `apps/web/src/lib/api-client.ts`
  - [x] Added "Export Storyboard JSON" download button to `ReviewPage`
  - [x] Type check and all tests passing

- [x] Update `docs/gap-analysis.md` to reflect completion (COMPLETED 2026-05-16)


## Surprises & Discoveries

*(To be populated as work progresses)*


## Decision Log

- **Decision:** Implement test generation as a separate batch entity rather than modifying existing GenerationRequest logic.
  **Rationale:** Keeps test requests isolated, allows future queries like "list all test batches for a storyboard", and simplifies the test→confirm→bulk flow. Test batch has its own lifecycle.
  **Date/Author:** 2026-05-16 / Claude Code

- **Decision:** Style preview images stored as static assets in `public/` rather than generated on-demand or stored in S3.
  **Rationale:** System presets are immutable; no user-generated styles yet. Static files are fastest to serve and require no API logic. If custom styles are added later, revisit.
  **Date/Author:** 2026-05-16 / Claude Code

- **Decision:** JSON export endpoint uses GET (not POST) and serves JSON directly rather than queueing an async job.
  **Rationale:** Export is fast (no generation), deterministic (no side effects), and file downloads are idiomatic with GET. Export is read-only from the user's perspective.
  **Date/Author:** 2026-05-16 / Claude Code


## Outcomes & Retrospective

All three milestones delivered on 2026-05-16.

**What shipped:**
- 9 style preset preview images served from `/public/style-previews/`, with `previewImageUrl` wired into `StylePresetDto` and displayed as a gallery in `StoryboardPage`.
- Full test generation flow: `TestGenerationBatch` domain entity, DB migration, Sqlite repository, 4 API endpoints, `TestGenerationModal` component (3 variant cards with 2s polling, confirm, reset), and conditional StoryboardPage footer (test modal gate before bulk generation).
- JSON export: `exportStoryboardAsJson` use case, `GET /api/storyboards/:id/export.json` endpoint returning JSON with `Content-Disposition: attachment`, and "Export Storyboard JSON" download button on ReviewPage.

**Surprises:**
- `pnpm --filter @gen-story/api db:generate` failed with "no schema files found" (working directory issue). Fixed by writing the migration SQL manually and applying directly.
- `ApplicationDependencies` interface required updating two test support files (`use-cases.test.ts` and `in-memory-application.ts`) in addition to the main wiring in `create-api-context.ts`.
- A TypeScript error in routes.ts (passing `UseCaseError` instead of `UseCaseErrorCode` to the error-to-status helper) required patching after initial generation.


## Interfaces and Dependencies

### Required Existing Interfaces
- `GenerationRepository` — Create generation requests flagged as tests
- `StoryboardRepository` — Fetch/update storyboard state
- `SceneRepository` — Fetch scenes and adopted image results
- `PhotoAssetRepository` — Resolve image URLs

### New Ports / Adapters
- `TestGenerationRepository` (port) — Persist/fetch test batch state
- Test generation adapter implementation in `apps/api/src/adapters/test-generation.adapter.ts`

### New Domain Concepts
- `TestGenerationPolicy` — Enforce test constraints and state transitions
- `TestGenerationBatch` (value object or aggregate) — Encapsulate test batch identity, status, confirmed result

### API Changes
- `POST /api/storyboards/:storyboardId/test-generation`
- `GET /api/storyboards/:storyboardId/test-generation/current`
- `POST /api/storyboards/:storyboardId/test-generation/confirm`
- `GET /api/storyboards/:storyboardId/export.json`

### DB Changes
- New table: `test_generation_batches`
- New columns on `generation_requests`: `isTest: boolean` (optional but recommended)

### Files to Create (Summary)
- Domain: `packages/domain/src/policies/test-generation.policy.ts`
- Application: `packages/application/src/use-cases/request-test-generation.use-case.ts`, `export-storyboard-as-json.use-case.ts`
- Shared: `packages/shared/src/dtos/test-generation.dto.ts`, `storyboard-export.dto.ts`
- API: `apps/api/src/http/routes/storyboards-test-generation.ts`, `storyboards-export.ts`
- Web: `apps/web/src/components/TestGenerationModal.tsx`, updates to `StoryboardPage.tsx`, `ReviewPage.tsx`
- Docs: `docs/storyboard-export-schema.md`
- Public: `public/style-previews/*.jpg` (9 images)
