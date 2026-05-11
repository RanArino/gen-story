# Phase 7: Integrated Phase 1 Product Flow

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.


## Purpose / Big Picture


After this phase a user can open the app in a browser and complete the entire Phase 1 product flow end-to-end using real data — no mock data, no local-only state. They can upload their own photos, describe an emotion/style, have the app generate scene descriptions, trigger AI image generation, watch per-scene progress live, and then accept or reject each generated image. If they close the browser mid-generation and return, the app restores exactly where they left off. If any scene fails, a short reason is shown and the user can retry that scene alone.

The current state of the codebase (after Phase 6) is: the backend API has 18 REST endpoints, job-queue-based image generation, and local file storage fully implemented. The web front-end is a single giant `MockFlowClient.tsx` component that drives a seven-screen flow entirely from hard-coded mock data using only React state. Phase 7 replaces every mock screen with an API-connected equivalent while keeping the same visual design language.


## Progress


- [x] (2026-05-05) M1 — Foundation: file serving, API client, Next.js route structure
- [x] (2026-05-05) M2 — Project & Photo Flow: project list, creation, upload, management
- [x] (2026-05-05) M3 — Storyboard & Emotion: storyboard upsert, emotion/style persistence, scene editing, photo assignment
- [x] (2026-05-05) M4 — Generation Launch & Progress: trigger jobs, polling UI, per-scene statuses
- [x] (2026-05-05) M5 — Image Review: display generated images, adopt/reject, retry
- [x] (2026-05-05) M6 — E2E Coverage: Playwright main-flow test
- [x] (2026-05-05) Final: MockFlowClient removed; typecheck, lint, test (57/57), build all pass


## Surprises & Discoveries


*(fill in as work proceeds)*


## Decision Log


- Decision: Replace `MockFlowClient.tsx` with proper Next.js App Router pages instead of adding a "real API" mode to the existing component.
  Rationale: URL-based routing is required for state restoration after reload. A single 2000-line component cannot be progressively hydrated; splitting into pages also makes each screen independently testable.
  Date/Author: 2026-05-05 / Claude

- Decision: Use simple `fetch` + `useEffect` polling (every 2 s) for generation progress instead of adding TanStack Query or SWR.
  Rationale: CLAUDE.md says "prefer existing local patterns over new abstractions or dependencies." The existing mock uses plain React hooks. Adding a data-fetching library for one polling use-case is out of scope.
  Date/Author: 2026-05-05 / Claude

- Decision: Serve uploaded and generated image files via a new `GET /files/*` route added to the API server.
  Rationale: The API already knows the `data/uploads/` root and storage key convention. A separate static-file server or Next.js proxy would duplicate that knowledge.
  Date/Author: 2026-05-05 / Claude

- Decision: Keep `MockFlowClient.tsx` in place but make the root route (`/`) redirect to `/projects` so the old mock is no longer the entry point. Remove the mock file only after all connected screens are verified.
  Rationale: Reduces risk. The mock can be consulted as a visual reference while building real screens.
  Date/Author: 2026-05-05 / Claude


## Outcomes & Retrospective


*(fill in at completion)*


## Context and Orientation


**Repository layout** (abbreviated):

    apps/api/         Raw Node.js HTTP server, port 4000 by default
      src/http/       Router + route handlers (routes.ts) + Zod schemas
      src/generation/ Local job worker + OpenAI + mock adapters
      src/storage/    LocalObjectStorageAdapter (data/uploads/)
      src/server.ts   HTTP server entry point
    apps/web/         Next.js 16 / React 19, port 3000
      src/app/        App Router pages
      src/components/ Currently only mock-flow/MockFlowClient.tsx
    packages/shared/  DTO types shared by web and API
    data/uploads/     Local file storage (gitignored)

**Key terms:**

- *StorageKey* — a path string relative to `data/uploads/`, e.g. `originals/projects/{id}/{assetId}.jpg`. Never an absolute path.
- *GenerationRequest* — a DB row tracking one async image-generation job with statuses `queued | running | succeeded | failed | canceled`.
- *Scene* — one row in the `scenes` table. A storyboard has 1–N scenes, each linked to photos and eventually to a generated image.
- *Adopted image* — the one `generated_images` row per scene where `adoptedAt IS NOT NULL`.

**Auth:** The API uses a fixed local test user with `userId = "local-user-1"` and `organizationId = "local-org-1"`. No login screen is needed for Phase 7.

**Env vars needed by web:**

    NEXT_PUBLIC_API_BASE_URL=http://localhost:4000   (already in .env.example)


## Plan of Work


### M1 — Foundation


**1.1  File-serving route in the API**

Add `GET /files/*` to `apps/api/src/http/routes.ts`. The handler reads the wildcard tail from the request URL, constructs the absolute local path as `<projectRoot>/data/uploads/<tail>`, streams the file with `fs.createReadStream`, and sets `Content-Type` from the file extension. Return 404 if the file does not exist or if the resolved path escapes `data/uploads/` (path-traversal guard).

The router at `apps/api/src/http/router.ts` currently matches exact literal segments and `:param` segments. A wildcard `*` suffix needs to be added. The simplest approach is to check for a route registered as `"/files/*"` and match any request whose path starts with `"/files/"`, extracting the rest as `params["*"]`. Edit the `Router` class's `match` method to support this one wildcard pattern.

**1.2  Typed API client in the web app**

Create `apps/web/src/lib/api-client.ts`. This module exports one function per API endpoint. Each function calls `fetch` against `process.env.NEXT_PUBLIC_API_BASE_URL`, passes the appropriate method/body, and returns a typed value from `@gen-story/shared`. Non-2xx responses throw an `ApiError` with the status code and parsed `ApiErrorDto` body. Functions to implement:

    getMe(): Promise<MeDto>
    listProjects(): Promise<ProjectDto[]>
    createProject(name: string, occasion?: string): Promise<ProjectDto>
    listPhotoAssets(projectId: string): Promise<PhotoAssetDto[]>
    uploadPhotoAsset(projectId: string, file: File, notes?: string): Promise<PhotoAssetDto>
    patchPhotoAsset(id: string, usage: string, notes?: string): Promise<PhotoAssetDto>
    listStoryboards(projectId: string): Promise<StoryboardDto[]>
    upsertStoryboard(storyboardId: string, input: UpsertStoryboardInput): Promise<StoryboardDto>
    listScenes(storyboardId: string): Promise<SceneDto[]>
    upsertScenes(storyboardId: string, scenes: UpsertScenesInput): Promise<SceneDto[]>
    assignPhotosToScene(sceneId: string, photos: ScenePhotoInput[]): Promise<SceneDto>
    listStylePresets(): Promise<StylePresetDto[]>
    createGenerationRequest(sceneId: string, input: CreateGenRequestInput): Promise<GenerationRequestDto>
    listGenerationRequests(sceneId: string): Promise<GenerationRequestDto[]>
    retryGenerationRequest(genRequestId: string): Promise<GenerationRequestDto>
    listGeneratedImages(sceneId: string): Promise<GeneratedImageDto[]>
    adoptGeneratedImage(sceneId: string, imageId: string): Promise<void>

All types come from `@gen-story/shared` or are local input shapes matching the Zod schemas in `apps/api/src/http/schemas.ts`.

**1.3  Image URL helper**

Create `apps/web/src/lib/image-url.ts` with one function:

    storageKeyToUrl(storageKey: string): string
      → `${NEXT_PUBLIC_API_BASE_URL}/files/${storageKey}`

**1.4  Next.js route scaffolding**

Create the following page files (empty shells at first):

    apps/web/src/app/page.tsx              → redirect({ permanent: false }, "/projects")
    apps/web/src/app/projects/page.tsx
    apps/web/src/app/projects/new/page.tsx
    apps/web/src/app/projects/[projectId]/photos/page.tsx
    apps/web/src/app/projects/[projectId]/storyboard/page.tsx
    apps/web/src/app/projects/[projectId]/generate/page.tsx
    apps/web/src/app/projects/[projectId]/review/page.tsx

Each page imports from the relevant connected component described in M2–M5 below.

**1.5  Shared layout**

Create `apps/web/src/app/projects/layout.tsx` to wrap all project pages in a common `<AppShell>` component. The shell has the same dark sidebar from `MockFlowClient.module.css` with links: Projects, (when inside a project) Photos → Storyboard → Generate → Review.


### M2 — Project & Photo Flow


**2.1  Project list page**

Create `apps/web/src/components/projects/ProjectListPage.tsx` (client component). On mount it calls `api.listProjects()` and renders a grid of project cards. Each card shows project name, status, photo count, and an updated-at timestamp. A "New project" button navigates to `/projects/new`.

**2.2  Project creation page**

Create `apps/web/src/components/projects/ProjectCreatePage.tsx` (client component). A form with a text input for project name and an optional occasion selector (Anniversary, Graduation, Birthday, Travel, Other). On submit it calls `api.createProject(name, occasion)` and redirects to `/projects/${project.id}/photos`.

**2.3  Photo upload & management page**

Create `apps/web/src/components/photos/PhotosPage.tsx` (client component). This page handles both the upload step and the curation/management step, separated by a tab or step indicator.

*Upload tab:* A file drop zone accepting `image/jpeg, image/png, image/heic, image/webp`. For each file the user selects, call `api.uploadPhotoAsset(projectId, file)`. Show an inline progress indicator per file. After upload, the photo appears in the grid.

*Manage tab:* Fetches `api.listPhotoAssets(projectId)`. Displays each photo as a card with the preview image served from `storageKeyToUrl(photo.storageKey)` (fall back to the original if no preview key exists — the preprocessing adapter will have generated one). Each card has a usage toggle (`use / reference / unused`) that calls `api.patchPhotoAsset(id, usage)`. An optional notes text area also calls `patchPhotoAsset` on blur.

A "Continue to Storyboard →" button navigates to `/projects/${projectId}/storyboard`.


### M3 — Storyboard & Emotion


**3.1  Storyboard page**

Create `apps/web/src/components/storyboard/StoryboardPage.tsx` (client component).

On mount:
1. Call `api.listStoryboards(projectId)`. If no storyboard exists yet, the page shows an "Initialize storyboard" button that calls `api.upsertStoryboard` with `status: "draft"` and default tone `"warm"`.
2. Once a storyboard exists, fetch `api.listScenes(storyboardId)` and `api.listStylePresets()`.

*Emotion & Style panel* (left or top section):
- Tone selector: four buttons — Warm, Cinematic, Playful, Quiet. Selecting one calls `api.upsertStoryboard(storyboardId, { tone })`.
- Style preset grid: renders each `StylePresetDto` as a swatch card. Selecting one calls `api.upsertStoryboard(storyboardId, { stylePresetId })`.

*Scene list* (main area):
- Each scene is an editable card showing: title, description, image prompt, emotion, camera direction, lighting direction, motion direction, and notes. All fields are `<textarea>` or `<select>` inputs.
- A "Save scenes" button calls `api.upsertScenes(storyboardId, scenes)` with the current state of all scenes.
- Each scene card has a "Assign photos" section — a small grid of project photos (fetched from `api.listPhotoAssets`) with a role selector (`primary / reference`). Changes call `api.assignPhotosToScene(sceneId, [...])`.

Scene reordering: Up/Down buttons change `orderIndex` locally and persist on "Save scenes".

A "Generate images →" button navigates to `/projects/${projectId}/generate`.


### M4 — Generation Launch & Progress


**4.1  Generation page**

Create `apps/web/src/components/generate/GeneratePage.tsx` (client component).

On mount, fetch scenes and their latest generation requests via `api.listGenerationRequests(sceneId)` for each scene. If all scenes already have a `succeeded` or `failed` request, skip the launch step and show results directly.

*Launch mode* (no active requests yet): Shows a summary of scenes with their primary photos, then a "Start generation" button. On click, for each scene without an active or completed request, call `api.createGenerationRequest(sceneId, { inputJson: { ... } })` in sequence (not parallel, to respect the five-concurrent-jobs limit).

*Progress mode* (requests in flight): Shows a progress header — e.g. `4 of 12 completed` — and a per-scene status list. Each scene row shows: scene title, primary photo thumbnail, current status badge (Waiting / Running / Succeeded / Failed), and the failure reason if status is `failed`.

Polling: Use `useEffect` with `setInterval(pollAllScenes, 2000)`. Stop polling when every scene's latest request is `succeeded` or `failed`. `pollAllScenes` calls `api.listGenerationRequests(sceneId)` for each scene and updates component state.

On completion, a "Review images →" button navigates to `/projects/${projectId}/review`.


### M5 — Image Review


**5.1  Review page**

Create `apps/web/src/components/review/ReviewPage.tsx` (client component).

On mount, fetch all scenes, their generated images (`api.listGeneratedImages(sceneId)` per scene), and the current adoption state (`scene.adoptedGeneratedImageId`).

Displays a two-column layout per scene:
- Left: primary source photo (`storageKeyToUrl(photo.storageKey)`)
- Right: generated image (`storageKeyToUrl(image.storageKey)`) with Adopt / Unadopt / Regenerate buttons.

"Adopt" calls `api.adoptGeneratedImage(sceneId, imageId)` and marks that image as accepted. Only one image per scene can be adopted at a time (the API enforces this).

"Regenerate" (for failed scenes or user-initiated) calls `api.retryGenerationRequest(latestGenRequestId)` for that scene, then navigates back to the generate page (or shows an inline progress indicator for that single scene).

A scene where generation failed shows the `errorMessage` from the generation request and a "Retry" button.


### M6 — E2E Coverage


**6.1  Playwright setup**

Add Playwright to `apps/web`:

    pnpm --filter @gen-story/web add -D @playwright/test

Create `apps/web/playwright.config.ts`:
- `baseURL: "http://localhost:3000"`
- `webServer.command: "pnpm dev"` (or use an already-running server)
- `testDir: "e2e"`

Add `e2e/` directory to `apps/web`.

Add `"test:e2e": "playwright test"` to `apps/web/package.json` scripts, and add `pnpm --filter @gen-story/web test:e2e` to the root `package.json` test:e2e target.

**6.2  Main flow test**

Create `apps/web/e2e/main-flow.spec.ts`. The test:

1. Navigates to `http://localhost:3000` — expects redirect to `/projects`.
2. Clicks "New project", fills in name "E2E Test Project", clicks Create.
3. Expects redirect to `/projects/.../photos`.
4. Uploads one test image from `apps/web/e2e/fixtures/test-photo.jpg` (a small JPEG checked into the repo).
5. Sets photo usage to "use".
6. Clicks "Continue to Storyboard".
7. Selects tone "Cinematic" and a style preset.
8. Fills in scene title and description.
9. Assigns the uploaded photo as primary for the first scene.
10. Clicks "Save scenes".
11. Clicks "Generate images".
12. Clicks "Start generation".
13. Waits (up to 60 s) for at least one scene to reach `succeeded` or `failed` status.
14. Clicks "Review images".
15. Adopts the first generated (or mock-generated) image.
16. Asserts that the scene row shows an "Adopted" badge.

For CI the test should use the mock image generation adapter. The API context wiring (`create-api-context.ts`) should check an env var `IMAGE_GENERATION_ADAPTER=mock` to select the mock adapter. Add that to `.env.test` (or pass via env in the Playwright webServer command).


## Concrete Steps


**Setup — verify baseline before starting**

    cd /Users/ran/my-app/gen-story
    pnpm typecheck
    pnpm test

Both must pass before any changes are made.


**M1 steps**

Step 1.1 — Edit `apps/api/src/http/router.ts` to support wildcard routes. The `match` method should return `{ params: { "*": tail } }` for a route registered as `/files/*` when the incoming path starts with `/files/`.

Step 1.2 — Add the file-serving handler in `apps/api/src/http/routes.ts`:

    router.add("GET", "/files/*", async (req, res) => {
      const tail = getParam(req.params, "*")
      const safePath = path.join(uploadsRoot, tail)
      if (!safePath.startsWith(uploadsRoot)) {
        sendJson(res, 403, errorBody("FORBIDDEN", "Access denied"))
        return
      }
      if (!fs.existsSync(safePath)) {
        sendJson(res, 404, notFoundBody("File not found"))
        return
      }
      const ext = path.extname(safePath).toLowerCase()
      const mime = MIME_MAP[ext] ?? "application/octet-stream"
      res.writeHead(200, { "Content-Type": mime })
      fs.createReadStream(safePath).pipe(res)
    })

`uploadsRoot` is resolved from `process.env.GEN_STORY_SQLITE_PATH` (or `data/`) using the same config pattern as the existing storage adapter. `MIME_MAP` covers `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`.

Step 1.3 — Run `pnpm typecheck` to confirm the router and route changes compile.

Step 1.4 — Create `apps/web/src/lib/api-client.ts` and `apps/web/src/lib/image-url.ts` as described in Plan of Work.

Step 1.5 — Create the page scaffolding files. All pages start as client components that render a placeholder `<div>` so typecheck passes.

Step 1.6 — `pnpm typecheck` must pass.


**M2 steps**

Step 2.1 — Implement `ProjectListPage.tsx`. Wire to `apps/web/src/app/projects/page.tsx`.

Step 2.2 — Implement `ProjectCreatePage.tsx`. Wire to `apps/web/src/app/projects/new/page.tsx`.

Step 2.3 — Implement `PhotosPage.tsx`. Wire to `apps/web/src/app/projects/[projectId]/photos/page.tsx`.

Step 2.4 — `pnpm typecheck && pnpm --filter @gen-story/api dev` in one terminal, `pnpm --filter @gen-story/web dev` in another. Visit `http://localhost:3000`, create a project, upload a photo, set usage. Confirm the photo appears in the list after reload.


**M3 steps**

Step 3.1 — Implement `StoryboardPage.tsx`. Wire to the storyboard page route.

Step 3.2 — Start dev server. Create a project, upload photos, navigate to storyboard. Select an emotion and style. Add scene descriptions. Save. Reload page — confirm storyboard state is restored from API.


**M4 steps**

Step 4.1 — Implement `GeneratePage.tsx`. Wire to the generate page route.

Step 4.2 — Confirm the API starts the local worker automatically (`local-job-worker.ts` is started in `server.ts`). Check `apps/api/src/server.ts` — if the worker is not auto-started, add `worker.start()` there.

Step 4.3 — Set `IMAGE_GENERATION_ADAPTER=mock` in `.env` (or `.env.local`) so smoke tests use the mock adapter. Trigger generation from the UI. Confirm scenes move from Waiting → Running → Succeeded within a few seconds.

Step 4.4 — Test reload mid-generation: while jobs are running, reload the browser. Confirm the progress UI restores the current state.


**M5 steps**

Step 5.1 — Implement `ReviewPage.tsx`. Wire to the review page route.

Step 5.2 — Complete a generation run with the mock adapter. Navigate to `/review`. Confirm generated images load (served from `/files/...`). Click Adopt on one scene. Reload — confirm adopted state is preserved.


**M6 steps**

Step 6.1 — Install Playwright and add configuration files.

Step 6.2 — Add `apps/web/e2e/fixtures/test-photo.jpg` (a minimal 100×100 JPEG).

Step 6.3 — Implement `e2e/main-flow.spec.ts`.

Step 6.4 — Run:

    pnpm --filter @gen-story/web test:e2e

All assertions must pass.


**Final cleanup**

Step F.1 — Remove `apps/web/src/components/mock-flow/MockFlowClient.tsx` and `MockFlowClient.module.css` after confirming all E2E tests pass and no other file imports them.

Step F.2 — `pnpm typecheck && pnpm lint && pnpm test && pnpm build` must all pass.


## Validation and Acceptance


The following observable behaviors confirm Phase 7 is complete:

1. `pnpm typecheck` passes with zero errors.
2. `pnpm test` passes (all unit + integration tests).
3. `pnpm --filter @gen-story/web test:e2e` passes (main flow E2E test).
4. Manual: visit `http://localhost:3000`, create a project, upload a real JPEG from the local file system, select usage, select emotion/style, edit at least one scene, assign the uploaded photo, trigger generation (mock adapter), watch progress update in the browser without manual refresh, navigate away and back, confirm state is restored, adopt a generated image, confirm adopted state survives a browser reload.
5. Manual: cause a generation to fail (temporarily break the mock adapter or test with an invalid scene), confirm the failure reason appears in the UI and the Retry button triggers a new generation request.
6. `GET http://localhost:4000/files/originals/projects/{id}/{assetId}.jpg` returns the uploaded image with `Content-Type: image/jpeg`.
7. After completing the flow, `MockFlowClient.tsx` no longer exists in the repository.


## Idempotence and Recovery


- All API calls are idempotent for upsert operations (`PUT /api/storyboards/:id`, `PUT /api/storyboards/:id/scenes`). Running the same upsert twice is safe.
- Generation requests are created once per scene per "Start generation" click. The UI only shows the "Start generation" button if no active request exists for any scene. If the user clicks the button and some requests already exist, the client skips those scenes.
- Playwright test setup: the test creates a fresh project on each run; it does not depend on pre-existing DB state. If a test fails mid-run, the orphan project remains in the DB but does not affect subsequent runs.
- Recovery from a failed typecheck: revert the offending file using `git checkout -- <file>` and retry the step.


## Artifacts and Notes


*(populate with notable transcripts or diffs as work proceeds)*


## Interfaces and Dependencies


**`@gen-story/shared`** — DTO types (`ProjectDto`, `PhotoAssetDto`, `StoryboardDto`, `SceneDto`, `StylePresetDto`, `GenerationRequestDto`, `GeneratedImageDto`). Already published as a workspace package.

**`@gen-story/application`** — Use cases invoked by the API. No direct web dependency; used only on the server side.

**Node.js `fs` + `path`** — Used in the new `/files/*` API route for local file serving. Already available in the API server environment.

**`@playwright/test`** — Added as a devDependency to `apps/web` for E2E tests. Version: latest stable at time of work.

**`NEXT_PUBLIC_API_BASE_URL`** — Must be set in `apps/web/.env.local` (or inherited from root `.env`) to `http://localhost:4000`. Already documented in `.env.example`.

**`IMAGE_GENERATION_ADAPTER`** — Env var read by `apps/api/src/app/create-api-context.ts` to select `mock` vs `openai` image generation adapter. Set to `mock` during E2E tests to keep tests fast and deterministic.
