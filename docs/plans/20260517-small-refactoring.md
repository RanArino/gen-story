# Close Remaining Phase 1 Gaps: Tech Debt, Complement Scenes, Photo-Aware AI, Reordering, Storyboard Views


This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.


This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.


## Purpose / Big Picture


After this change the gen-story app closes five of the highest-value remaining Phase 1 gaps tracked in `docs/gap-analysis.md`:


1. **Tech debt** — the Drizzle migration journal is repaired so `pnpm --filter @gen-story/api db:migrate` applies cleanly from scratch, and repo-wide Prettier drift is removed so `pnpm format` passes. This unblocks CI/pre-commit for every later change.
2. **Complement scenes** — users can insert AI-only scenes (no source photo) between existing scenes via a hover "+" affordance; each complement scene records which scenes it bridges, and the AI proposes 1–3 candidates.
3. **Photo-aware AI scenes** — per-scene AI fill and complement-scene proposals use real Gemini vision over the project's uploaded photos instead of deterministic metadata templates.
4. **Drag-and-drop reordering** — users can reorder uploaded photos and storyboard scenes by dragging.
5. **Storyboard views** — `ReviewPage` gains a timeline view, a table view, and an original-only / generated-only filter, alongside the existing card view.


A reader can see it working by: running migrations on a fresh DB, opening a storyboard, hovering between two scenes to insert an AI complement scene, dragging photos/scenes to reorder, and toggling timeline/table/filter controls on the review screen.


## Progress


- [x] (2026-05-17 10:02Z) Workstream A — Tech debt: repaired migration journal + snapshots; fixed `db:generate` cwd bug; resolved Prettier drift across 21 files. Fresh `db:migrate` applies all 5 migrations; `db:generate` reports no drift; `pnpm format` passes; typecheck/lint/test green.
- [x] (2026-05-17 15:05Z) Workstream B — Complement scenes: domain (`SceneKind`/`SceneBridge`, `createComplementScene`, `assertComplementSceneBridge`, optional photo assets); migration `0005_medical_professor_monster` adds `kind`/`bridge_from_scene_id`/`bridge_to_scene_id` to `scenes`; `ComplementSceneProposalPort` + `insertComplementScene`/`proposeComplementScenes` use cases; routes `POST /api/storyboards/:id/complement-scenes` and `.../proposals`; DTOs carry `kind`/`bridge`; `StoryboardPage` hover "+" gap with blank-insert and AI-propose modal; complement cards render photo-free with bridge label. Typecheck/lint green; 22 application + 75 API tests pass.
- [x] (2026-05-17 15:25Z) Workstream C — Photo-aware AI: `GeminiSceneFillGenerationAdapter` and `GeminiComplementSceneProposalAdapter` send the project's normalized photos to Gemini vision with tone/style/common-prompt context; wired as the runtime default in `create-api-context.ts` (no deterministic fallback — throws a clear error when `GEMINI_API_KEY` is unset); unit tests inject a mock client so CI needs no key; `.env.example` documents the new model vars. Removed the unused `LocalComplementSceneProposalAdapter`. 80 API tests pass.
- [x] (2026-05-17 15:45Z) Workstream D — Drag-and-drop reordering: `photo_assets.position` column (migration `0006_wise_northstar`); `reorderPhotos`/`reorderScenes` use cases; `PATCH /api/projects/:id/photos/order` and `PUT /api/storyboards/:id/scene-order`; HTML5 drag-and-drop on `PhotosPage` (photo grid) and `StoryboardPage` (scene drag handle). 24 application + 81 API tests pass.
- [x] (2026-05-17 16:05Z) Workstream E — Storyboard views: `ReviewPage` gains a Card/Timeline/Table view switcher and an All / Original only / Generated only filter; `TimelineView` and `TableView` are pure client-side renderers over already-fetched data (no API change).
- [x] (2026-05-17 16:05Z) Final: `pnpm typecheck`, `pnpm lint` (1 pre-existing domain warning), `pnpm test` (125 tests), `pnpm build`, `pnpm format` all green; `docs/gap-analysis.md` synchronized.


## Surprises & Discoveries


- Observation: The migration journal `drizzle/migrations/meta/_journal.json` is missing the `0003_add_test_generation_batches` entry, and `meta/` has no `0003_snapshot.json` or `0004_snapshot.json`.
  Evidence: `meta/` contains only `0000_snapshot.json`, `0001_snapshot.json`, `0002_snapshot.json`; journal entries jump from tag `0002_icy_pyro` (idx 2) directly to `0004_add_storyboard_common_prompt` (idx 3).


## Decision Log


- Decision: Deliver all five workstreams as one combined ExecPlan rather than five separate plans.
  Rationale: User chose a single combined plan; workstreams will still be committed/merged in workstream order (A first) to keep reviews tractable.
  Date/Author: 2026-05-17 / Claude


- Decision: Photo-aware AI uses Gemini as a hard requirement at runtime — no deterministic fallback.
  Rationale: User chose "Gemini required". To keep CI key-free, unit/integration/E2E tests inject a mock `SceneFillGenerationPort` / complement-proposal port; only the real adapter calls Gemini and it throws a clear error when `GEMINI_API_KEY` is unset.
  Date/Author: 2026-05-17 / Claude


## Outcomes & Retrospective


All five workstreams (A–E) are complete. Final state: `pnpm typecheck`, `pnpm lint`
(one pre-existing unused-import warning in `packages/domain/src/rules.ts`), `pnpm test`
(20 domain + 24 application + 81 API = 125 tests), `pnpm build`, and `pnpm format` are green.

- Workstream A — repaired the Drizzle migration journal and the `db:generate` cwd bug; cleared Prettier drift.
- Workstream B — complement scenes end-to-end: domain model, migration `0005`, ports, use cases, API routes, and the `StoryboardPage` hover "+" UI.
- Workstream C — photo-aware AI: Gemini vision adapters for scene fill and complement proposals, wired as the runtime default; tests inject mock clients.
- Workstream D — drag-and-drop reordering: `photo_assets.position` (migration `0006`), reorder use cases + endpoints, HTML5 DnD on photos and scenes.
- Workstream E — `ReviewPage` Card/Timeline/Table view switcher and original/generated filter (pure client-side).

Retrospective notes:
- Adding `kind`/`bridge` to the domain `Scene` required threading the new fields through every `createScene`/`buildScene` path; `buildScene` had to explicitly carry them so the scenes `PUT` upsert never drops complement metadata.
- The combined-plan approach kept the migration sequence coherent (`0005`, `0006` appended cleanly after the Workstream A journal repair).


## Context and Orientation


gen-story is a pnpm monorepo with clean-architecture layering (`packages/domain` pure, `packages/application` use cases + ports, `apps/api` Node HTTP server, `apps/web` Next.js). Migrations live in `drizzle/migrations/` and are tracked by `drizzle/migrations/meta/_journal.json` plus a per-migration `NNNN_snapshot.json`.


Key files referenced by this plan:


- Domain: `packages/domain/src/model.ts` (`Scene`, `ScenePhotoAsset`, `createScene`, `createTemplateScene`), `packages/domain/src/rules.ts`.
- Application: `packages/application/src/ports.ts` (`SceneFillGenerationPort`, `PhotoAnalysisGenerationPort`, `SceneRepositoryPort`, `PhotoAssetRepositoryPort`), `packages/application/src/use-cases.ts`.
- Shared DTOs: `packages/shared/src/index.ts`.
- API: `apps/api/src/http/routes.ts`, `router.ts`, `schemas.ts`, `dto-mappers.ts`; `apps/api/src/app/create-api-context.ts`; `apps/api/src/photo-analysis/gemini-photo-analysis-generation.ts` (existing Gemini adapter pattern to mirror).
- Web: `apps/web/src/components/storyboard/StoryboardPage.tsx`, `apps/web/src/components/photos/PhotosPage.tsx`, `apps/web/src/components/review/ReviewPage.tsx`.


Terms: a **complement scene** is a scene with no source/primary photo whose purpose is to bridge two adjacent photo-derived scenes. A **bridge** is the ordered pair of scene IDs the complement scene sits between.


## Plan of Work


### Workstream A — Tech debt (do first)


Repair the migration journal so a fresh `db:migrate` applies all five migrations in order. Add the missing `0003` journal entry and regenerate/handwrite the missing `meta/0003_snapshot.json` and `meta/0004_snapshot.json`. The safest minimal path: re-run `pnpm --filter @gen-story/api db:generate` against a clean state is risky because it bundles drift; instead, manually insert the `0003_add_test_generation_batches` entry into `_journal.json` (idx 3) and renumber the existing `0004` entry to idx 4, then produce the two missing snapshot files by deriving them from the prior snapshot plus each migration's DDL. Validate by deleting the local SQLite file and running `db:migrate` from scratch.


Then resolve Prettier drift: run `pnpm format` to list the ~21 offending files, apply `npx prettier --write` to exactly those files, and confirm `pnpm format` passes. Do not reformat unrelated files beyond what Prettier reports.


### Workstream B — Complement scenes


Domain: make source photo optional. In `model.ts`, `ScenePhotoAsset[]` may be empty; add an optional `bridge?: { fromSceneId: SceneId; toSceneId: SceneId }` and a `kind: "photo" | "complement"` field to `Scene` and `CreateSceneInput`. Add a domain factory `createComplementScene` that produces a draft scene with `kind: "complement"`, no photo assets, and a recorded bridge. Add a rule validating that a complement scene's bridge references two existing sibling scene IDs.


Schema/migration: add a new migration (next sequential number after journal repair) adding `kind` and `bridge_from_scene_id` / `bridge_to_scene_id` columns to the `scenes` table; default existing rows to `kind = 'photo'`.


Application: add a use case `insertComplementScene` (manual insert with empty fields) and `proposeComplementScenes` (returns 1–3 AI candidates). Add a port `ComplementSceneProposalPort` in `ports.ts`.


API: add routes — `POST /api/storyboards/:storyboardId/complement-scenes` (insert) and `POST /api/storyboards/:storyboardId/complement-scenes/proposals` (AI proposals). Extend `schemas.ts`, `dto-mappers.ts`, and shared DTOs with `kind` and `bridge`.


Web: in `StoryboardPage.tsx` render a hover "+" affordance between adjacent scene cards; clicking it offers "Insert blank complement scene" or "AI-propose (1–3)". Complement scene cards render without a primary-photo preview and show the bridged scene titles.


### Workstream C — Photo-aware AI scenes


Add a real Gemini-backed adapter mirroring `gemini-photo-analysis-generation.ts` for the existing `SceneFillGenerationPort` and the new `ComplementSceneProposalPort`. The adapter loads the project's uploaded normalized photos (AI-input images, max 1536 px) and the primary photo for the target scene, sends them to Gemini vision with the storyboard tone/style/common prompt as context, and returns generated title/description/image-prompt (and emotion/camera/lighting where blank). It throws a descriptive error if `GEMINI_API_KEY` is unset. Wire it in `create-api-context.ts`, replacing the deterministic `SceneFillGenerationPort` implementation as the runtime default. Tests inject a mock port so CI needs no key. Update `.env.example` notes if wording changes.


### Workstream D — Drag-and-drop reordering


Add an explicit `order` (or `position`) integer column where ordering is currently implicit. Photos currently order by `createdAt` (`photo_assets`); add a `position` column + migration and a `PATCH /api/projects/:projectId/photos/order` endpoint accepting an ordered ID list. Scenes already have ordering via `storyboard.sceneIds`; add `PUT /api/storyboards/:storyboardId/scene-order`. On the web side, add lightweight drag-and-drop (HTML5 draggable attributes, no new dependency unless an existing one is present) to `PhotosPage.tsx` and the scene list in `StoryboardPage.tsx`, persisting the new order on drop.


### Workstream E — Storyboard views + filter


In `ReviewPage.tsx`, add a view switcher (Card / Timeline / Table) and a filter control (All / Original only / Generated only). Timeline view renders scenes in order along a horizontal/vertical track; table view renders a row per scene with columns (order, title, emotion, camera, adopted image, source photo). Filter hides scenes/images not matching. All three views are pure client-side rendering over already-fetched data; no API change.


## Concrete Steps


Run all commands from `/Users/ran/my-app/gen-story` unless noted.


Workstream A:


    pnpm format
    npx prettier --write <files reported above>
    rm -f data/gen-story.sqlite
    pnpm --filter @gen-story/api db:migrate
    pnpm format


Expected: `db:migrate` reports all five migrations applied with no error; `pnpm format` reports no issues.


Per workstream B–E, after edits:


    pnpm typecheck
    pnpm --filter @gen-story/api db:generate   # only when a new migration is needed
    pnpm test


Final:


    pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm format


## Validation and Acceptance


- Workstream A: deleting `data/gen-story.sqlite` and running `db:migrate` succeeds; `_journal.json` has five ordered entries; `pnpm format` passes.
- Workstream B: hovering between two scene cards in `StoryboardPage` shows a "+"; inserting a complement scene creates a card with no photo and labeled with bridged scene titles; reloading the page persists it.
- Workstream C: with `GEMINI_API_KEY` set, AI fill on a blank scene returns photo-grounded text; with the key unset the real adapter throws a clear error; `pnpm test` passes without a key.
- Workstream D: dragging a photo in `PhotosPage` and a scene in `StoryboardPage` persists the new order across reload.
- Workstream E: `ReviewPage` switches between Card/Timeline/Table and the original/generated filter changes what is shown.
- Final: all five commands above are green.


## Idempotence and Recovery


Migration repair (Workstream A) is the riskiest step: back up `_journal.json` and `meta/` before editing. If `db:migrate` fails, restore the backup. New migrations (B, D) are append-only and safe to regenerate against a fresh `data/gen-story.sqlite`. Prettier and code edits are repeatable. Web changes are stateless.


## Artifacts and Notes


Current journal gap (pre-repair): entries idx 0–2 then idx 3 = tag `0004_...`; on-disk migration `0003_add_test_generation_batches.sql` unregistered; `meta/` missing `0003`/`0004` snapshots.


## Interfaces and Dependencies


- Drizzle Kit — migration generation and journal/snapshot format.
- `@google/genai` (already used by `gemini-photo-analysis-generation.ts`) — Gemini vision for Workstream C.
- New ports: `ComplementSceneProposalPort`; revised `SceneFillGenerationPort` runtime adapter.
- No new web dependency expected for drag-and-drop unless one already exists in `apps/web`.
