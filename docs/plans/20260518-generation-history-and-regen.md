# Generation Version History, Per-Scene Re-generation & Motion Direction

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.


## Purpose / Big Picture

Today the generation review flow has three gaps that collectively make it hard to compare, recover, and iterate on generated images:

1. **Motion direction is stored but silently ignored.** `scenes.motion_direction` (options: "Slow pan", "Static", "Zoom in", "Zoom out", "Tracking") is persisted and shown in the storyboard editor, but `composeImagePrompt()` never includes it. Every image is generated as if the field were empty.

2. **No version history.** Once a scene is regenerated, the previous image is still in the database but invisible: the ReviewPage only shows the latest generation request per scene. The user cannot see, compare, or recover older versions.

3. **No per-scene re-generation with changed settings.** The user must go back to StoryboardPage to adjust a scene's camera, lighting, or image prompt, then trigger generation again from a different page. There is no inline "adjust and regenerate" flow on ReviewPage.

4. **No user-facing generation history view.** A debug endpoint (`GET /api/debug/generation-requests`) lists recent requests globally, but there is no user-accessible screen that shows generation history grouped by scene.

After this change:

- Every image generation prompt includes a motion-direction clause derived from the scene's `motionDirection` field (the same pattern already used for camera and lighting).
- ReviewPage shows a collapsible "History" section per scene card, listing every past generated image with a thumbnail, its status and timestamp, and an "Adopt" button so any version is retrievable.
- A "Re-generate" button on ReviewPage opens a lightweight settings modal pre-filled with the scene's current fields. Changing any field and confirming queues a new generation request (creating a new version entry visible in history).
- A "Generation history" page at `/projects/:id/generation-history` shows all generation requests across all scenes, grouped by scene and sorted newest-first, so the user has a full audit trail.

This closes five requirements tracked in `docs/gap-analysis.md`:

- Section 8: "Animation movement direction (selection)" — stored only, not yet composed into generation prompt.
- Section 11: "Version history across multiple generations" — no versioning; all images shown flat.
- Section 11: "Previous version retrievable after re-test" — no version grouping.
- Section 11: "Regenerate with changed scene settings" — no per-scene re-generation with modified settings UI.
- Section 14: "User-facing generation history view" — debug endpoint exists; no user UI.


## Progress

- [ ] Milestone 1 — Motion direction in generation prompt.
- [ ] Milestone 2 — Generation version history in ReviewPage.
- [ ] Milestone 3 — Per-scene re-generation modal in ReviewPage.
- [ ] Milestone 4 — Generation history page.
- [ ] Update `docs/gap-analysis.md` for all five targeted rows.


## Surprises & Discoveries

_(Fill in as work proceeds.)_


## Decision Log

- Decision: Add `motionDirection` to `composeImagePrompt()`'s input type and compose a new `MOTION_DESCRIPTORS` lookup alongside the existing `CAMERA_DESCRIPTORS` and `LIGHTING_DESCRIPTORS`.
  Rationale: The motion options ("Slow pan", "Static", "Zoom in", "Zoom out", "Tracking") are camera-movement directions that imply specific compositional cues even in a still image. Following the existing pattern keeps the function consistent and avoids a special-case branch.
  Date/Author: 2026-05-18 / Claude

- Decision: Show the full generation history as a collapsible panel inside each existing ReviewPage scene card rather than as a separate "Versions" page.
  Rationale: The user is already looking at the scene card when deciding whether to regenerate. Keeping history in the same view avoids a navigation round-trip and matches the "non-adopted images retained as history" requirement already stored in the DB.
  Date/Author: 2026-05-18 / Claude

- Decision: The re-generation modal submits to the existing `POST /api/scenes/:sceneId/generation-requests` endpoint rather than introducing a new endpoint.
  Rationale: That endpoint already accepts an opaque `inputJson` body that the preprocessing step enriches; feeding updated scene fields through `inputJson` is the established pattern. No schema change is needed.
  Date/Author: 2026-05-18 / Claude

- Decision: Add a new API endpoint `GET /api/storyboards/:storyboardId/generation-requests` that returns all requests for all scenes in the storyboard in one call, rather than having the history page fan out N per-scene calls.
  Rationale: The per-scene endpoint exists but requires one round-trip per scene; a storyboard-level query is a single DB join and keeps page load fast regardless of scene count.
  Date/Author: 2026-05-18 / Claude


## Outcomes & Retrospective

_(Fill in at completion.)_


## Context and Orientation

`gen-story` is a pnpm monorepo with clean-architecture layer isolation (see `CLAUDE.md`). Terms used below:

- **Prompt composer**: `apps/api/src/generation/prompt-composer.ts`. Exports `composeImagePrompt()`, which assembles a generation prompt from scene fields and storyboard settings. It is called from a single place: `apps/api/src/images/local-image-preprocessing.ts:62`.
- **Image preprocessing**: `apps/api/src/images/local-image-preprocessing.ts`. Fetches the scene, storyboard, and style preset from the database, calls `composeImagePrompt()`, collects source photos, and returns a `PreprocessedImageInput` that the OpenAI adapter consumes. This is where `motionDirection` must be passed to the composer.
- **GenerationRequest**: domain model at `packages/domain/src/model.ts:131`; DB schema at `apps/api/src/db/schema.ts:185`. Has `id`, `sceneId`, `status`, `inputJson`, `errorMessage`, `sourceGenerationRequestId`, `startedAt`, `completedAt`, `createdAt`. `deletedAt` is on the DB row but not in the domain model.
- **GeneratedImage**: a separate DB table/domain model. Produced when a `GenerationRequest` succeeds. Each image has `storageKey` and `isAdopted` / `adoptedAt`.
- **ReviewPage**: `apps/web/src/components/review/ReviewPage.tsx`. Assembles `SceneReview` objects (one per scene), each holding `scene`, `generatedImages`, `primaryPhoto`, and summary fields about the latest generation request. Displays three views: card, timeline, table. Adopting an image calls `POST /api/scenes/:sceneId/generated-images/:imageId/adopt`.
- **Existing generation-request endpoint per scene**: `GET /api/scenes/:sceneId/generation-requests` at `apps/api/src/http/routes.ts:1045`. Returns all non-deleted requests for the scene sorted newest-first; includes `status`, `errorMessage`, `createdAt`.
- **`GenerationRequestDto`** in `packages/shared/src/dto.ts`: fields `id`, `sceneId`, `status`, `errorMessage`, `createdAt`.
- **api-client helpers**: `apps/web/src/lib/api-client.ts`. `listGenerationRequests(sceneId)` and `listGeneratedImages(sceneId)` are already implemented; `listScenes(storyboardId)` returns `SceneDto[]`, each with `photoAssets`.
- **Debug endpoint**: `GET /api/debug/generation-requests` at `routes.ts:1322` — only for admin; not surfaced in the UI.


## Plan of Work

The work spans four milestones that can be implemented in order. Each milestone is independently verifiable.


### Milestone 1 — Motion direction in generation prompt

**Files changed:** `prompt-composer.ts`, `local-image-preprocessing.ts`, `prompt-composer.test.ts`.

Add a `MOTION_DESCRIPTORS` lookup table to `prompt-composer.ts` mapping each motion-direction label to a cinematic cue that makes sense for a still image (e.g. "Slow pan" → implied lateral sweep framing, "Zoom in" → subject-centred compression, "Static" → stable locked-off composition). Add `motionDirection: string` to `composeImagePrompt()`'s input type and append the descriptor to `segments` immediately after the lighting descriptor.

Update the only caller, `local-image-preprocessing.ts:62`, to pass `scene.motionDirection ?? ""`.

Update `prompt-composer.test.ts` to cover the new field (a "Slow pan" case and a missing/empty value fallback).

No domain, shared-package, or DB changes are needed.


### Milestone 2 — Generation version history in ReviewPage

**Files changed:** `ReviewPage.tsx`, `ReviewPage.module.css`.

Extend the `SceneReview` type to include `requests: GenerationRequestDto[]` (all requests for the scene, sorted newest-first). The `load()` function already calls `listGenerationRequests(scene.id)`; store the full array instead of just the latest summary fields.

In the card view, add a collapsible "History (N)" disclosure below the current generated-image display. When expanded, it shows a horizontal strip of past generations: thumbnail (from `generatedImages` matched by `generationRequestId` if available, or a placeholder for pending/failed), status badge, and timestamp. Each past generation that succeeded has an "Adopt" button. The currently adopted image is highlighted. Collapsed by default; the expand state is local to the component (no persistence needed).

The `adoptedOrLatest()` helper already exists; ensure it still works after the type change.

Timeline and table views do not need changes in this milestone; they use `adoptedOrLatest()` which is unaffected.


### Milestone 3 — Per-scene re-generation modal in ReviewPage

**Files changed:** `ReviewPage.tsx`, `ReviewPage.module.css`, `api-client.ts` (optionally).

Add a "Re-generate" button to each scene card header (next to the existing retry-on-failure action). Clicking it opens a modal dialog pre-filled with the scene's current `imagePrompt`, `emotion`, `cameraDirection`, `lightingDirection`, and `motionDirection` fields (read from `SceneReview.scene`). The user may edit any field directly in the modal without leaving ReviewPage.

Submitting calls `POST /api/scenes/:sceneId/generation-requests` with the same `inputJson` shape already used by GeneratePage (`{ sceneId, storyboardId, projectId }` plus any scene-field overrides — or simply an empty body; the preprocessing step reads scene fields from the DB at execution time). Because the preprocessing step fetches scene fields from the DB, the scene fields the user adjusts in the modal must be persisted to the scene before the generation request is created. The simplest approach is to call `PATCH /api/scenes/:sceneId` with the changed fields first, then immediately submit the generation request. This updates the scene in place rather than threading overrides through `inputJson`.

After submitting, close the modal, show a "Generation queued" toast or inline status, and refresh the scene's history list. The new request appears in History with status "queued".

Navigation note: the user stays on ReviewPage. If they want to watch live progress they can click the existing "Generate" nav link. A one-line status such as "1 generation queued — view progress →" is sufficient feedback.


### Milestone 4 — Generation history page

**Files changed:**
- `apps/api/src/http/routes.ts` — new endpoint `GET /api/storyboards/:storyboardId/generation-requests`.
- `packages/shared/src/dto.ts` — no change needed if `GenerationRequestDto` already covers the required fields.
- `apps/web/src/lib/api-client.ts` — new helper `listStoryboardGenerationRequests(storyboardId)`.
- `apps/web/src/app/projects/[id]/generation-history/page.tsx` — new Next.js route.
- `apps/web/src/components/generation-history/GenerationHistoryPage.tsx` — new component.

The new API endpoint queries all non-deleted `generation_requests` for all scenes belonging to the given storyboard. It returns an array of `GenerationRequestDto` enriched with `sceneTitle: string | null` (joined from the `scenes` table) so the UI can group by scene without a second fetch. Add a `sceneTitle` field to the response shape (either extend `GenerationRequestDto` in shared or return a new `StoryboardGenerationRequestDto`).

The `GenerationHistoryPage` component fetches the storyboard's generation requests in one call, groups them by `sceneId` (preserving newest-first within each group), and renders a simple list: scene title as a heading, then a table of request rows (status badge, model from `inputJson.model` if available, timestamp, error message on failure). No thumbnail is shown on this page — the focus is the textual audit trail. A "Back to review" link navigates to ReviewPage.

The page is linked from ReviewPage's header as "Generation history".


## Concrete Steps

Run all commands from `/Users/ran/my-app/gen-story`.


### Milestone 1 steps

1. In `apps/api/src/generation/prompt-composer.ts`, add after the `LIGHTING_DESCRIPTORS` block:

       const MOTION_DESCRIPTORS: Record<string, string> = {
         "Slow pan": "slow lateral camera sweep, implied gentle motion across the frame",
         Static: "locked-off static composition, no implied camera movement",
         "Zoom in": "subject-centred framing, foreground pulls toward camera, subtle compression",
         "Zoom out": "expanding field of view, environment reveals around subject",
         Tracking: "subject mid-motion, dynamic framing with implied camera follow",
       };

2. Add `motionDirection: string` to the `composeImagePrompt` input type (lines 73-80) and add this segment after the lighting push (after line 103):

       if (MOTION_DESCRIPTORS[motionDirection]) segments.push(MOTION_DESCRIPTORS[motionDirection]);

3. In `apps/api/src/images/local-image-preprocessing.ts:62`, add `motionDirection: scene.motionDirection ?? ""` to the `composeImagePrompt` call.

4. Add a test case in `apps/api/src/generation/prompt-composer.test.ts` for `motionDirection: "Slow pan"` (assert the descriptor appears in the output) and `motionDirection: ""` (assert no crash and descriptor absent).

5. Run: `pnpm typecheck && pnpm test`.


### Milestone 2 steps

1. In `ReviewPage.tsx`, extend `SceneReview`:

       import type { GenerationRequestDto, ... } from "@gen-story/shared";

       type SceneReview = {
         ...existing fields...
         requests: GenerationRequestDto[];
       };

2. In `load()`, change from storing just the latest summary to storing the full `requests` array. Remove `latestRequestId`, `latestRequestStatus`, `latestErrorMessage` from `SceneReview` if they can be derived from `requests[0]` instead (or keep them as computed getters to minimize diff).

3. Add a `HistoryPanel` sub-component (or inline section) in the card view that renders when a scene card is expanded. Show each past `GenerationRequest` as a row: matched `GeneratedImage` thumbnail (if `status === "succeeded"` and a matching image exists in `generatedImages`), status chip, relative timestamp, and "Adopt" button (disabled if already adopted, hidden if failed).

4. Run: `pnpm typecheck && pnpm test`.


### Milestone 3 steps

1. Add a `RegenModal` state per-scene: `regenSceneId: string | null`.

2. Render a `<dialog>` or modal overlay when `regenSceneId` is set, pre-filled with the scene's current fields. Use simple `<select>` dropdowns (reuse the same options as StoryboardPage: `MOTION_OPTIONS`, `CAMERA_OPTIONS`, `LIGHTING_OPTIONS`, `EMOTION_OPTIONS`) plus a `<textarea>` for `imagePrompt`.

3. On submit:
   a. If any scene field changed, call `PATCH /api/scenes/:sceneId` (existing endpoint) with the updated fields.
   b. Call `POST /api/scenes/:sceneId/generation-requests` with `{ sceneId, storyboardId: storyboardId!, projectId }` as `inputJson`.
   c. Close the modal, refresh the scene's request list.

4. Run: `pnpm typecheck`.


### Milestone 4 steps

1. In `apps/api/src/http/routes.ts`, add after the existing scene generation-request routes:

       router.get("/api/storyboards/:storyboardId/generation-requests", async (req, res) => {
         const principal = requirePrincipal(req, res);
         if (!principal) return;
         const { storyboardId } = req.params;
         // query: join generation_requests + scenes, filter by storyboard, order by created_at desc
         const rows = await deps.generationRequests.findByStoryboardId(storyboardId);
         res.json(rows.map(toGenerationRequestWithSceneTitleDto));
       });

   The repository method `findByStoryboardId` is a new query on the existing `GenerationRequestRepository`. It joins `generation_requests` and `scenes` on `scene_id` and filters by `storyboard_id`.

2. Add `findByStoryboardId(storyboardId: string)` to the repository interface (`packages/application/src/ports.ts` or wherever `GenerationRequestRepository` is declared) and implement it in the Drizzle adapter (`apps/api/src/db/repositories.ts`).

3. Add `GenerationRequestWithSceneTitleDto` to `packages/shared/src/dto.ts` (extends `GenerationRequestDto` with `sceneTitle: string | null`).

4. Add `listStoryboardGenerationRequests(storyboardId: string)` to `apps/web/src/lib/api-client.ts`.

5. Create `apps/web/src/app/projects/[id]/generation-history/page.tsx` (Next.js server component wrapper) and `apps/web/src/components/generation-history/GenerationHistoryPage.tsx` (client component). The page fetches the first storyboard for the project, then calls `listStoryboardGenerationRequests`, groups rows by `sceneId`, and renders them.

6. Add a "Generation history" link to the ReviewPage header navigation.

7. Run: `pnpm typecheck && pnpm test && pnpm build`.


## Validation and Acceptance


### After Milestone 1

- `pnpm typecheck` passes.
- `pnpm test` passes; `prompt-composer.test.ts` includes a "Slow pan" case.
- Manual: trigger a new generation for a scene with `motionDirection = "Slow pan"`. Inspect the stored `inputJson.prompt` via `GET /api/debug/generation-requests`; the composed prompt must contain "slow lateral camera sweep".


### After Milestone 2

- `pnpm typecheck` passes.
- `pnpm test` passes.
- Manual: open ReviewPage for a scene that has two or more past generations. The card shows a "History (N)" disclosure. Expanding it shows past thumbnails with correct statuses. Clicking "Adopt" on an older image changes the adopted state (the card's main image updates on reload).


### After Milestone 3

- `pnpm typecheck` passes.
- Manual: on ReviewPage, click "Re-generate" on a scene card. The modal opens pre-filled. Change `cameraDirection` from "Medium" to "Wide". Submit. The scene is updated in the DB and a new generation request appears in the History panel with status "queued".


### After Milestone 4

- `pnpm typecheck` passes; `pnpm build` succeeds.
- `GET http://localhost:4000/api/storyboards/<id>/generation-requests` returns a JSON array with `sceneTitle` on each item.
- Navigating to `http://localhost:3000/projects/<id>/generation-history` shows a grouped list of all past generation requests for the project, each with a status, timestamp, and scene name.
- A "Generation history" link in ReviewPage's header navigates to this page.


## Idempotence and Recovery

- All four milestones are purely additive (new code, no DB migrations, no destructive changes).
- Milestones 1–3 can be developed and tested in isolation; each leaves the app in a coherent state.
- Milestone 4 introduces a new DB query (`findByStoryboardId`) but adds no migration — it queries existing tables.
- If the history page is slow, the bottleneck is the single `findByStoryboardId` query; add an index on `generation_requests.storyboard_id` if needed (the column is already defined; check whether an index exists in `schema.ts`).


## Artifacts and Notes

- `generation_requests` has existing indexes on `project_id`, `storyboard_id`, `scene_id`, `status` (confirmed in `apps/api/src/db/schema.ts`). The `findByStoryboardId` query can use the `storyboard_id` index directly.
- `GenerationRequestDto` already has `id`, `sceneId`, `status`, `errorMessage`, `createdAt`. Only `sceneTitle` is new.
- Motion descriptor values deliberately use compositional language ("locked-off", "expanding field of view") rather than animation verbs ("pan", "zoom") because gpt-image generates still images — the descriptor must describe a *compositional stance*, not an animation sequence.


## Interfaces and Dependencies

- `apps/api/src/generation/prompt-composer.ts` — add `MOTION_DESCRIPTORS` and `motionDirection` input field.
- `apps/api/src/images/local-image-preprocessing.ts` — pass `scene.motionDirection` to `composeImagePrompt`.
- `apps/api/src/http/routes.ts` — new `GET /api/storyboards/:storyboardId/generation-requests` endpoint.
- `packages/application/src/ports.ts` (or equivalent) — add `findByStoryboardId` to `GenerationRequestRepository` interface.
- `apps/api/src/db/repositories.ts` — implement `findByStoryboardId` with a join on `scenes`.
- `packages/shared/src/dto.ts` — add `GenerationRequestWithSceneTitleDto`.
- `apps/web/src/lib/api-client.ts` — add `listStoryboardGenerationRequests`.
- `apps/web/src/components/review/ReviewPage.tsx` — version history panel + re-generation modal.
- `apps/web/src/app/projects/[id]/generation-history/page.tsx` — new Next.js route.
- `apps/web/src/components/generation-history/GenerationHistoryPage.tsx` — new client component.
