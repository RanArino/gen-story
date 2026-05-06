# Phase 8: Local Release Readiness

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.


## Purpose / Big Picture


After this phase the local web application is stable enough for repeated personal use. A new contributor can clone the repository, follow the README to set up from scratch, and run the full generation flow without needing prior knowledge of the codebase. Users can delete photos or projects they no longer need and restore them within 7 days. A periodic cleanup script removes files and records that have passed the 7-day retention window. The API emits structured log lines so that generation problems are easy to diagnose. Error messages in the web UI are consistent and actionable.

The current state (after Phase 7) is: all seven screens are connected to the real API, the mock flow is removed, the Playwright E2E test covers the full flow, all 57 unit tests pass, and `pnpm build` succeeds. What is still missing for personal use: the README only contains minimal setup notes; there are no HTTP endpoints for deleting or restoring records despite the repository layer having `softDelete`/`restore` methods; the API emits no structured request logs; web UI errors are rendered inconsistently; no cleanup scripts exist; and there is no seed data to demonstrate the app.


## Progress


- [ ] M1 — Error display cleanup + API request logging
- [ ] M2 — Delete & restore behavior (API + web UI)
- [ ] M3 — Cleanup scripts (orphan detection + expired record purge)
- [ ] M4 — Debug endpoint + seed script
- [ ] M5 — README + known limitations document


## Surprises & Discoveries


*(fill in as work proceeds)*


## Decision Log


- Decision: Implement delete/restore only for `photo_assets` and `projects`. Storyboards, scenes, and generated images are managed implicitly through the parent record lifecycle.
  Rationale: These are the two record types a personal user would realistically want to delete and restore. Exposing restore for every table adds surface area without user-visible value in a local single-user deployment.
  Date/Author: 2026-05-05 / Claude

- Decision: Add delete/restore use cases inside `packages/application` rather than wiring directly from the route handler.
  Rationale: Consistent with existing use cases; keeps business invariants (e.g., the 7-day restore window check) out of the HTTP layer.
  Date/Author: 2026-05-05 / Claude

- Decision: Implement request logging as a thin middleware function inside `apps/api/src/http/` rather than adding an external logging library.
  Rationale: A local single-user app does not need log aggregation. `console.log` with timestamps and method/path/status/duration satisfies the debugging goal with zero new dependencies.
  Date/Author: 2026-05-05 / Claude

- Decision: Seed script creates a project with two placeholder scenes and no real photos, so it works without a real OpenAI key.
  Rationale: The seed only needs to demonstrate navigation and the UI layout. Real image generation can be triggered manually after seeding.
  Date/Author: 2026-05-05 / Claude


## Outcomes & Retrospective


*(fill in at completion)*


## Context and Orientation


**Repository layout** (abbreviated):

    apps/api/
      src/http/           Router, route handlers (routes.ts), Zod schemas (schemas.ts), error helpers (errors.ts)
      src/generation/     LocalJobWorker + OpenAI + mock adapters
      src/db/             Drizzle schema (schema.ts), repository implementations (repositories.ts)
      src/server.ts       HTTP server entry point
    apps/web/
      src/app/            Next.js App Router pages
      src/components/     ProjectListPage, ProjectCreatePage, PhotosPage, StoryboardPage, GeneratePage, ReviewPage
      src/lib/            api-client.ts, image-url.ts
      e2e/                Playwright tests
    packages/
      application/src/    use-cases.ts, ports.ts — business logic layer
      shared/src/         DTO types shared by web and API
    drizzle/migrations/   SQLite migration files (applied by `pnpm --filter @gen-story/api db:migrate`)
    scripts/              (does not exist yet — created in M3)
    data/uploads/         Local file storage (gitignored)

**Key terms:**

- *StorageKey* — a path string relative to `data/uploads/`, e.g. `originals/projects/{id}/{assetId}.jpg`. Never an absolute path.
- *Soft delete* — setting `deletedAt` to a non-null ISO timestamp so the record is excluded from normal list queries but can be restored within 7 days.
- *Hard delete* — physically removing a DB row and the associated file from `data/uploads/`.
- *Orphan file* — a file present under `data/uploads/` for which no DB record holds the matching `storageKey`.

**Auth:** Fixed local test user `userId = "local-user-1"`, `organizationId = "local-org-1"`. No login screen.

**Soft delete is already in the DB layer:** Every table that holds user data has a `deletedAt text` column. All repository classes in `apps/api/src/db/repositories.ts` already implement `softDelete(id, timestamp)` and `restore(id, timestamp)` methods. What is missing is the use-case layer wiring and the HTTP endpoints.

**Existing error pattern in web components:** Each component manages a local `useState<string | null>` for `error`, catches API failures, and renders `<p className="error-msg">{error}</p>`. The CSS class `error-msg` is not defined in a shared stylesheet, so each component styles it independently or not at all. The goal in M1 is to replace these one-off patterns with a shared `ErrorAlert` component and a consistent failure recovery prompt.


## Plan of Work


### M1 — Error Display Cleanup + API Request Logging


**1.1 Shared `ErrorAlert` component**

Create `apps/web/src/components/ErrorAlert.tsx`. This is a stateless React component that accepts a `message: string` prop (and an optional `onRetry?: () => void` callback) and renders a styled error box. The same visual style used in `GeneratePage.module.css` for failure states should be extracted here.

Update every web component that currently renders `<p className="error-msg">{error}</p>` to use `<ErrorAlert message={error} />` instead. The affected files are at minimum:

- `apps/web/src/components/projects/ProjectListPage.tsx`
- `apps/web/src/components/projects/ProjectCreatePage.tsx`
- `apps/web/src/components/photos/PhotosPage.tsx`
- `apps/web/src/components/storyboard/StoryboardPage.tsx`
- `apps/web/src/components/generate/GeneratePage.tsx`
- `apps/web/src/components/review/ReviewPage.tsx`

For each component also verify that network failures during initial data load (`useEffect` fetch) are caught and surface an error via `ErrorAlert` rather than leaving the page blank. Add a `retry` button to the data-load error state that re-runs the fetch.

**1.2 API request logging middleware**

Create `apps/api/src/http/request-logger.ts`. Export one function:

    logRequest(method: string, path: string, statusCode: number, durationMs: number): void

The implementation calls `console.log` with a fixed prefix and JSON-serialized fields:

    [API] {"method":"GET","path":"/api/projects","status":200,"ms":4}

In `apps/api/src/http/routes.ts`, find the `handleApiRequest` function (or wherever the request is dispatched). Wrap the dispatch so that after `router.handle(req, res)` returns it records the start time, response status code, method, and path then calls `logRequest`. The Node.js `IncomingMessage` has `method` and `url`; the `ServerResponse` has `statusCode` after the handler sets it. Capture the start time before dispatch and compute `durationMs = Date.now() - startMs` after.

**1.3 Generation job state-transition logging**

In `apps/api/src/generation/local-job-worker.ts`, add `console.log` calls at each state transition inside `processQueued`:

- When a job moves from `queued` → `running`: log `[Worker] starting job {requestId} for scene {sceneId}`
- When a job completes with `succeeded`: log `[Worker] succeeded job {requestId} in {ms}ms`
- When a job fails: log `[Worker] failed job {requestId}: {errorMessage}`

These already have access to the request ID and scene ID from the `GenerationRequestRecord` returned by `findQueued`.


### M2 — Delete & Restore Behavior


**2.1 Application-layer use cases**

In `packages/application/src/use-cases.ts`, add four new exported functions:

    deletePhotoAsset(deps: ApplicationDependencies, photoAssetId: string): Promise<Result<void, UseCaseError>>
    restorePhotoAsset(deps: ApplicationDependencies, photoAssetId: string): Promise<Result<void, UseCaseError>>
    deleteProject(deps: ApplicationDependencies, projectId: string): Promise<Result<void, UseCaseError>>
    restoreProject(deps: ApplicationDependencies, projectId: string): Promise<Result<void, UseCaseError>>

`deletePhotoAsset`: calls `deps.photoAssets.softDelete(photoAssetId, now())`. Returns `not_found` if the record does not exist.

`restorePhotoAsset`: calls `deps.photoAssets.restore(photoAssetId, now())`. Returns `not_found` if the record does not exist or `conflict` if `deletedAt` is null (already active) or older than 7 days (past retention window).

`deleteProject`: calls `deps.projects.softDelete(projectId, now())`.

`restoreProject`: calls `deps.projects.restore(projectId, now())`. Returns `conflict` if past the 7-day retention window (compare `deletedAt` ISO string with `now() - 7 * 24 * 3600 * 1000`).

The retention window check (7 days) belongs in the use case, not the repository, to keep the repository simple.

Export the four functions from `packages/application/src/index.ts`.

**2.2 HTTP endpoints**

In `apps/api/src/http/routes.ts` add four new routes:

    DELETE /api/photo-assets/:photoAssetId
      → deletePhotoAsset(ctx, photoAssetId) → 204 No Content on success

    POST /api/photo-assets/:photoAssetId/restore
      → restorePhotoAsset(ctx, photoAssetId) → 200 with the restored PhotoAssetDto

    DELETE /api/projects/:projectId
      → deleteProject(ctx, projectId) → 204 No Content on success

    POST /api/projects/:projectId/restore
      → restoreProject(ctx, projectId) → 200 with the restored ProjectDto

For restore endpoints the route handler needs to re-fetch the record after restore to produce the DTO. Use the existing `findById` methods in the repositories (fetched via `ctx`).

Add Zod schemas if inputs exist (these are path-parameter-only routes, so no body schema is needed).

**2.3 Web UI — photo delete and restore**

In `apps/web/src/lib/api-client.ts` add:

    deletePhotoAsset(id: string): Promise<void>
    restorePhotoAsset(id: string): Promise<PhotoAssetDto>
    deleteProject(id: string): Promise<void>
    restoreProject(id: string): Promise<ProjectDto>

In `apps/web/src/components/photos/PhotosPage.tsx` add a delete button (trash icon or "Delete" text) to each photo card. On click it calls `api.deletePhotoAsset(id)` and re-fetches the photo list. Below the active photo grid, add a collapsible "Recently deleted" section that shows soft-deleted photos (fetched by a separate call or by filtering the full list). Each deleted photo card shows a "Restore" button (calls `api.restorePhotoAsset(id)`) and the date it was deleted.

To expose deleted photos from the API, add a query parameter to `GET /api/projects/:projectId/photo-assets`:

    ?includeDeleted=true

When `includeDeleted=true` the repository query omits the `isNull(photoAssets.deletedAt)` condition. Only soft-deleted records within the 7-day window are returned (filter server-side: `deletedAt IS NOT NULL AND deletedAt > now - 7 days`).

In `apps/web/src/components/projects/ProjectListPage.tsx` add a "Delete" button on each project card. On click it calls `api.deleteProject(id)` and refreshes the list. Since restore of a whole project is a heavier operation, a "Recently deleted" section in the project list showing projects deleted in the last 7 days with a Restore button covers the requirement.

**2.4 Update shared DTO types if needed**

If `PhotoAssetDto` and `ProjectDto` in `packages/shared/src/` do not already include `deletedAt`, add it as an optional `string | null` field so the web can display the deletion date.


### M3 — Cleanup Scripts


Create a `scripts/` directory at the repository root. Add `scripts/tsconfig.json` that extends `../../tsconfig.base.json` and targets Node.js ESM. Add `"scripts": { "cleanup-expired": "tsx scripts/cleanup-expired.ts", "detect-orphans": "tsx scripts/detect-orphans.ts" }` to the root `package.json`.

**3.1 `scripts/cleanup-expired.ts`**

This script purges records that have been soft-deleted for more than 7 days.

Algorithm:
1. Open the database using `openDatabase(getDatabasePath())` from `apps/api/src/db`.
2. Calculate the expiry cutoff: `new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()`.
3. Query each table that has `deletedAt` for rows where `deletedAt IS NOT NULL AND deletedAt < cutoff`. Tables to check: `projects`, `photo_assets`, `generated_images`, `storyboards`, `scenes`.
4. For records that also have a `storageKey` column (`photo_assets`, `generated_images`), resolve the local file path as `path.join(dataRoot, "uploads", storageKey)` and delete it with `fs.rm(path, { force: true })`.
5. Hard-delete the DB row with a `DELETE FROM ... WHERE id = ?` raw Drizzle query.
6. Print a summary: `Purged N records from photo_assets, M records from generated_images, ...`

The script resolves `dataRoot` from `GEN_STORY_SQLITE_PATH` env var (same logic as `apps/api/src/db/client.ts`).

Add `"db:cleanup-expired": "tsx ../../scripts/cleanup-expired.ts"` to `apps/api/package.json` scripts as well, so it can also be invoked as `pnpm --filter @gen-story/api db:cleanup-expired`.

**3.2 `scripts/detect-orphans.ts`**

This script lists files under `data/uploads/` that have no matching `storageKey` in the database.

Algorithm:
1. Open the database.
2. Collect all `storageKey` values from `photo_assets` and `generated_images` (including soft-deleted ones, since the file may still be within the retention window).
3. Walk `data/uploads/` recursively using `fs.readdirSync` with `{ recursive: true }`.
4. Convert each file path to a relative storage key (strip the `data/uploads/` prefix).
5. Report any file whose relative key is not in the set from step 2.
6. Print: `Found N orphan file(s):` followed by the list, or `No orphan files found.`

The script does not delete anything. It is a read-only diagnostic tool.


### M4 — Debug Endpoint + Seed Script


**4.1 Debug endpoint for generation requests**

Add one route to `apps/api/src/http/routes.ts`:

    GET /api/debug/generation-requests

No authentication is required beyond the existing local auth (all routes already go through `requirePrincipal`). The handler queries the `generation_requests` table for the 50 most recent rows ordered by `createdAt DESC` and returns them as JSON. Include `id`, `sceneId`, `projectId`, `status`, `provider`, `model`, `errorMessage`, `startedAt`, `completedAt`, and `createdAt`. This endpoint is intentionally not part of the shared DTO package because it is a debug-only view.

**4.2 Seed script**

Create `scripts/seed.ts`. The script:

1. Opens the database.
2. Calls `seedLocalPrincipal(db)` (already exported from `apps/api/src/auth/local-auth.ts`) to ensure the local user and organization exist.
3. Inserts one project with `name = "Demo — Family Trip"` and `status = "active"` using the local user and organization.
4. Inserts one storyboard for that project with `title = "Summer 2025"`, `status = "draft"`, `tone = "warm"`.
5. Inserts three scenes with placeholder titles, descriptions, and prompts (`orderIndex` 0, 1, 2).
6. Inserts one system `StylePreset` named `"Cinematic"` if it does not already exist (check by `name` and `scope = "system"`).
7. Prints: `Seed complete. Project id: {id}. Visit http://localhost:3000/projects/{id}/storyboard to explore.`

This requires no file uploads and no real API key. The scenes will show as having no photos assigned and no generation requests, which is fine for a demo.

Add `"db:seed": "tsx ../../scripts/seed.ts"` to `apps/api/package.json` and document the command in the README.


### M5 — README + Known Limitations


**5.1 Complete README.md**

Rewrite `README.md` at the repository root. The file should cover:

*Prerequisites* — Node.js ≥ 22, pnpm ≥ 9. Provide the install command for pnpm.

*Clone and install* — `git clone`, `pnpm install`.

*Environment variables* — Copy `.env.example` to `apps/api/.env`. List the required variables with their defaults:
- `API_PORT=4000`
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`
- `GEN_STORY_SQLITE_PATH=data/gen-story.sqlite`
- `OPENAI_API_KEY=<your key>` (optional; the app works without it using the mock adapter)
- `IMAGE_GENERATION_ADAPTER=mock` (set to `openai` to use real generation)

*Apply database migrations* — `pnpm --filter @gen-story/api db:migrate`

*Start the application* — `pnpm dev` (starts both web on port 3000 and API on port 4000)

*Load seed data (optional)* — `pnpm --filter @gen-story/api db:seed`

*Running tests* — `pnpm test` (unit + integration, Vitest), `pnpm --filter @gen-story/web test:e2e` (Playwright, requires both servers running)

*Maintenance scripts* — `pnpm --filter @gen-story/api db:cleanup-expired` to purge records older than 7 days; `node scripts/detect-orphans.js` (after `pnpm build`) to find orphaned upload files.

*Troubleshooting* — short entries for common issues: port in use, missing `.env`, SQLite locked, HEIC conversion missing system library.

*Debug* — visit `http://localhost:4000/api/debug/generation-requests` to see recent generation job history.

**5.2 `docs/known-limitations.md`**

Create `docs/known-limitations.md`. List every feature that is intentionally not implemented in this local version:

- Production cloud deployment (GCP / AWS).
- External job queue (SQS, Pub/Sub, Cloud Tasks).
- WorkOS authentication.
- Stripe / coin-based billing.
- SNS auto-publishing.
- Affiliate link generation.
- Video generation (Phase 2).
- BGM generation.
- Similar-image duplicate detection.
- Estimated generation remaining time.
- AI-suggested photo ordering.
- Custom style presets (the form is not yet implemented).
- AI scene analysis / emotion detection (scenes are manually edited).
- Multi-language UI (hardcoded English).
- Mobile or desktop application.
- Storyboard PDF / Markdown export.
- Scene drag-and-drop reordering (use the up/down buttons instead).

Each entry should include one sentence explaining when it is planned (Phase 2, post-MVP, or not yet scheduled).


## Concrete Steps


**Before starting — verify baseline**

    cd /Users/ran/my-app/gen-story
    pnpm typecheck
    pnpm test

Both must pass with zero errors before any changes.


**M1 steps**

Step 1.1 — Create `apps/web/src/components/ErrorAlert.tsx`. Implement the shared error component. Run `pnpm typecheck` to confirm.

Step 1.2 — Update each web component listed in M1.1 to use `<ErrorAlert>`. Also add a retry button to data-load error states. Run `pnpm typecheck`.

Step 1.3 — Create `apps/api/src/http/request-logger.ts` with the `logRequest` function.

Step 1.4 — Wrap `handleApiRequest` in `apps/api/src/http/routes.ts` to call `logRequest` after dispatch. Run `pnpm typecheck`.

Step 1.5 — Add state-transition log lines to `apps/api/src/generation/local-job-worker.ts`. Run `pnpm typecheck && pnpm test`.

Step 1.6 — Manual smoke: start both servers (`pnpm dev`). Make one API call. Verify log output like `[API] {"method":"GET","path":"/api/projects","status":200,"ms":3}` appears in the API terminal.


**M2 steps**

Step 2.1 — Add `deletePhotoAsset`, `restorePhotoAsset`, `deleteProject`, `restoreProject` to `packages/application/src/use-cases.ts`. Export them from `packages/application/src/index.ts`. Run `pnpm typecheck`.

Step 2.2 — Add the four HTTP routes to `apps/api/src/http/routes.ts`. Add `?includeDeleted=true` support to the photo-assets list route. Run `pnpm typecheck`.

Step 2.3 — Add the four API client functions to `apps/web/src/lib/api-client.ts`.

Step 2.4 — Update `PhotosPage.tsx` to add the delete button and "Recently deleted" section. Update `ProjectListPage.tsx` to add the delete button and recently-deleted section.

Step 2.5 — If `PhotoAssetDto` or `ProjectDto` in `packages/shared` lack `deletedAt`, add it. Run `pnpm typecheck && pnpm test`.

Step 2.6 — Manual smoke: start dev. Upload a photo, delete it via the UI, confirm it appears in "Recently deleted". Click Restore, confirm it returns to the active grid.


**M3 steps**

Step 3.1 — Create `scripts/` directory. Create `scripts/tsconfig.json`.

Step 3.2 — Create `scripts/cleanup-expired.ts`. Test by manually soft-deleting a record, setting its `deletedAt` to 8 days ago via a direct SQLite update, and running the script. Confirm the record and file are removed.

Step 3.3 — Create `scripts/detect-orphans.ts`. Test by copying a dummy file into `data/uploads/` and running the script. Confirm it is reported as an orphan.

Step 3.4 — Add the npm scripts to root `package.json` and `apps/api/package.json`. Run `pnpm typecheck`.


**M4 steps**

Step 4.1 — Add `GET /api/debug/generation-requests` to `apps/api/src/http/routes.ts`. Run `pnpm typecheck`.

Step 4.2 — Create `scripts/seed.ts`. Run `pnpm --filter @gen-story/api db:seed` against a fresh database. Verify the project appears at `http://localhost:3000/projects`.

Step 4.3 — `pnpm typecheck && pnpm test`.


**M5 steps**

Step 5.1 — Rewrite `README.md` as described.

Step 5.2 — Create `docs/known-limitations.md`.

Step 5.3 — Follow the README from scratch in a new terminal to confirm every command works as documented.


**Final validation**

    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm --filter @gen-story/web test:e2e
    pnpm build

All must pass with zero errors.


## Validation and Acceptance


The following observable behaviors confirm Phase 8 is complete:

1. `pnpm typecheck` passes with zero errors.
2. `pnpm test` passes (all unit + integration tests).
3. `pnpm --filter @gen-story/web test:e2e` passes (main flow E2E test).
4. `pnpm build` succeeds for all packages.
5. A contributor who has never seen the repository can follow the README and reach `http://localhost:3000` with a working app. The README must be verified manually by reading each section top to bottom and executing each command.
6. `pnpm --filter @gen-story/api db:migrate` on a clean (non-existent) database creates all tables with zero errors.
7. `pnpm --filter @gen-story/api db:seed` populates the database and prints the project URL.
8. API terminal shows structured log lines like `[API] {"method":"POST","path":"/api/projects","status":201,"ms":12}` for every request.
9. Uploading a photo, deleting it, and restoring it leaves the photo in its original state (confirmed by checking the API response and the UI).
10. Running `pnpm --filter @gen-story/api db:cleanup-expired` on a database that has a record with `deletedAt` set 8 days ago removes that record and its file.
11. `docs/known-limitations.md` exists and lists at least 10 out-of-scope features.


## Idempotence and Recovery


- All new API endpoints use `softDelete` and `restore`, which are reversible. Hard deletes only happen via the `cleanup-expired` script, which only targets records past the 7-day window.
- The seed script checks for an existing project with the same name before inserting. Running it twice produces one project, not two.
- The `cleanup-expired` script uses a dry-run flag (`--dry-run`) to print what would be deleted without actually deleting. Add this flag before the script deletes anything to allow safe inspection.
- If a web component update causes a typecheck failure, restore the component from git and re-implement the change more carefully.
- If a migration or schema change is accidentally introduced, revert with `git checkout -- drizzle/` and `git checkout -- apps/api/src/db/schema.ts`.


## Artifacts and Notes


*(populate as work proceeds)*


## Interfaces and Dependencies


**`packages/application/src/use-cases.ts`** — Four new exported functions: `deletePhotoAsset`, `restorePhotoAsset`, `deleteProject`, `restoreProject`. They depend on `ApplicationDependencies` (already imported).

**`packages/application/src/ports.ts`** — `PhotoAssetRepository` and `ProjectRepository` must expose `softDelete(id, ts)` and `restore(id, ts)`. These methods already exist in `apps/api/src/db/repositories.ts`; verify the port interfaces declare them.

**`apps/api/src/db/repositories.ts`** — `softDelete` and `restore` already implemented for all tables. No changes needed in the repository layer.

**`apps/web/src/components/ErrorAlert.tsx`** — New shared component. No external dependencies beyond React.

**`apps/api/src/http/request-logger.ts`** — New utility. No dependencies beyond Node.js `console`.

**`scripts/cleanup-expired.ts`** and **`scripts/detect-orphans.ts`** — Depend on `apps/api/src/db` exports and Node.js `fs`. They are invoked with `tsx` (already a devDependency in the monorepo).

**`tsx`** — Used to run TypeScript scripts directly. Already available as a devDependency.
