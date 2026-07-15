# Add a Story/Worldview that drives generation, and rebuild the storyboard as a visual-first, navigable board

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md` (gen-story has no child `PLANS.md`).

This plan implements `docs/gap-analysis.md` §19 ("Local Test Feedback — Storyboard UX Redesign & Story Cohesion"), raised on 2026-06-17 from local testing.

> **Status note (2026-06-17):** A first implementation of an earlier, narrower version of this plan (a `story` field plus a `sticky; top:0` jump bar inside the scene list, with the photo grid and per-scene photo picker left as-is) was built and then **reverted in full** at the user's request after local UX testing. The reverted approach kept the storyboard as a tall text form and the "jump bar" scrolled away with the list, so it navigated nothing. This revision re-scopes the work UX-first. See the Decision Log and Revision Notes.

## Purpose / Big Picture

Local testing showed the storyboard screen does not behave like a storyboard (絵コンテ) and does not let the author shape one cohesive worldview. Concretely, five problems were observed:

1. **No author-owned worldview.** The scenes share no explicit, user-owned definition of the world/story they collectively tell. The closest existing concept, the AI `storySummary` on the project photo analysis, is read-only (only displayed) and is never fed into image generation, so it cannot make the scenes cohesive.
2. **The photo grid never goes away.** The "Create scenes from photos" section renders every candidate photo at all times, even after scenes already exist — so the same photos are shown again as a persistent, full-width grid that the author must scroll past.
3. **The per-scene photo picker is redundant.** Each scene's "primary photo" control renders every candidate photo as a button row, so the same photos appear a _third_ time. Picking one photo per scene does not need the whole library re-rendered in every card.
4. **The cards are forms, not a storyboard.** Each scene card is dominated by large title / description / image-prompt text fields; the photo — the only image available on this screen — is incidental. The result reads as a data-entry form, not a visual board, and wastes vertical space.
5. **Navigation navigates nothing.** The scene-jump list was `position: sticky; top: 0` _inside_ the scene list, so it scrolls away with the list. For a long storyboard there is no persistent way to see or jump between scenes.

After this change the author gains:

- **A first-class Story / Worldview** that seeds from the AI summary, is freely editable, persists, can be regenerated, and — crucially — is composed into every scene's image-generation prompt so the scenes share one worldview.
- **A visual-first board** that leads with the scene's image (its assigned source photo), offered in **two switchable layouts** — photo-left/fields-right split and a gallery of tiles with a click-to-edit drawer — so the author picks the density they want without near-duplicate modes.
- **A persistent right-hand photo filmstrip** that survives scrolling, shows each scene's photo, auto-highlights the scene currently in view, and jumps to a scene on click; the rail scrolls on its own when the storyboard is long.
- **Photos surfaced exactly once where they're needed:** an "Add scenes" action opens a modal listing only the photos not yet turned into a scene; each scene shows its single chosen photo with a compact "Change" picker.
- **The board as the primary content:** the project-level configuration (tone, style, common prompt, negative prompt, story) is consolidated into one compact panel that is collapsed by default once configured.

Roles stay distinct: `commonPrompt` is the visual/style-consistency mechanism; `story` is the narrative/worldview meaning. They remain separate fields.

## Progress

Milestone A — Story / Worldview field that drives generation:

- [x] A.1 — Domain: add `story` to `Storyboard`, `CreateStoryboardInput`, and `createStoryboard`.
- [x] A.2 — Persistence: add `storyboards.story` column, generate migration `drizzle/migrations/0011_futuristic_ronan.sql`, apply/reconcile the local migration, and map it in `SqliteStoryboardRepository` (read + insert + upsert). The first local `db:migrate` hit the known duplicate-column state from the reverted attempt; see Outcomes.
- [x] A.3 — Use case: add `story` to `UpsertStoryboardInput` and a `resolveStory` seeded from the latest project photo analysis `storySummary`.
- [x] A.4 — API boundary: add `story` to `UpsertStoryboardSchema`, the route call, `StoryboardDto`, and `toStoryboardDto`.
- [x] A.5 — Generation: thread `story` through `composeImagePrompt` and `composeScenePrompt` (and the override type) + unit coverage.
- [x] A.6 — Web data: api-client `upsertStoryboard`/`StoryboardDto`; story state + `saveStory`; en/ja strings.

Milestone B — Visual-first, navigable storyboard board:

- [x] B.1 — Consolidate project config (tone/style/common/negative/story) into one compact, default-collapsed "Project settings" panel so the board is the primary content.
- [x] B.2 — Replace the always-on photo grid with an "Add scenes" button → modal listing **only unused** candidate photos (keep select-all + size toggle inside the modal). Replace the per-scene all-photos button row with a single primary-photo hero + a "Change" picker.
- [x] B.3 — Scene board view modes: a persisted view switcher (Split / Gallery) and the two `SceneCard` renderings; gallery tiles open a focused editor drawer. Rows mode was removed in follow-up D after local review found it redundant.
- [x] B.4 — Sticky photo filmstrip rail: an in-page two-column layout (board | rail); each rail cell uses the scene's primary photo as background + number/title; click jumps; the in-view scene is highlighted via scroll-spy against the `.content` scroll root; the rail scrolls internally when long.
- [x] Validation — `pnpm typecheck` passes; `pnpm lint` passes with the pre-existing `packages/domain/src/rules.ts` warning; changed files pass Prettier; `pnpm test` passes 176 tests. Full `pnpm format` is blocked by four pre-existing unrelated files.
- [x] Docs — `docs/gap-analysis.md` §19 moved to ✅ and summary counts updated to 6 implemented / 0 in progress.

Follow-up correction from local UI review on 2026-06-18:

- [x] C.1 — Replace the viewport-`fixed` photo rail with a scene-section-bounded sticky rail: it must not overlap content above the scene section, but it must remain visible while scrolling through scenes.
- [x] C.2 — Rework inline scene source-photo rendering so landscape and portrait photos fit inside the preview without zoom/crop, using direct image max-size constraints rather than relying on parent-card scaling.
- [x] C.3 — Re-run `pnpm typecheck` and `pnpm lint`; both pass, with the known pre-existing `packages/domain/src/rules.ts` warning.

Follow-up correction from local UI review on 2026-06-18 (view-mode simplification):

- [x] D.1 — Remove the Rows mode from the view-mode type, localStorage validation/default, view switcher, i18n labels, and unused Rows CSS/classes.
- [x] D.2 — Move the "show/hide description and prompt" control into Split mode so Split can collapse the long text fields.
- [x] D.3 — Re-run `pnpm typecheck` and `pnpm lint`; both pass, with the known pre-existing `packages/domain/src/rules.ts` warning.

Follow-up correction from local UI review on 2026-06-18 (sticky rail never engaged):

- [x] E.1 — Root cause: the `<main className={styles.content}>` scroll root had `overflow-y: auto` but **no height bound**, so it never scrolled internally — the document scrolled instead. `position: sticky; top: 24px` on the rail therefore never engaged (the rail scrolled away with the document), and the scroll-spy `IntersectionObserver` rooted at `closest("main")` never fired. The plan's Surprises section had assumed `.content` was already the scroll container; it was the intended container but was not actually scrolling.
- [x] E.2 — Fix: `apps/web/src/components/AppShell.module.css` `.content` now sets `height: 100vh; box-sizing: border-box` alongside the existing `overflow-y: auto`, making it a true scroll container (fixed sidebar + internally scrolling content). This is a shared AppShell change; it only strengthens sticky/scroll behavior on other pages.
- [x] E.3 — Restrict the filmstrip rail (and its layout column) to Split mode so Gallery no longer shows a rail whose scroll-spy highlight could not track.

## Surprises & Discoveries

- Observation: The app's scroll container is the page content area, **not** the window. A navigator must therefore be a sticky element _inside_ the storyboard content (or observe that scroll root), which is exactly why the previous `sticky; top: 0` jump bar inside the scene list scrolled away.
  Evidence: `apps/web/src/components/AppShell.module.css` — `.shell` is `grid-template-columns: 240px minmax(0, 1fr)`, and `.content` has `overflow-y: auto; padding: 32px`. The page renders inside `<main className={styles.content}>`.

- Observation: On the storyboard screen there is **no generated image yet** — generation happens later on the Generate screen. The only image per scene is its **assigned primary source photo**. This is the root of problems 2–4: the same photos render in the persistent grid, in each per-scene picker, and would be the natural "hero" of a visual card. So "show the image" means "show (and let the author change) the scene's primary photo."
  Evidence: `apps/web/src/components/storyboard/StoryboardPage.tsx` — scene cards have no generated-image field; photo assignment uses `assignPhotosToScene` with `role: "primary"`; `ScenePhotoAssetDto` carries `photoAssetId`/`role` only.

- Observation: The prompt-composition path is already centralized, so injecting `story` is a single-site change that automatically reaches both real generation and the live preview.
  Evidence: `apps/api/src/generation/compose-scene-prompt.ts` is the documented "single source of truth" called by both the image preprocessor and `POST /api/scenes/:id/preview-prompt`; it calls `composeImagePrompt` in `apps/api/src/generation/prompt-composer.ts`.

- Observation: `CollapsibleSection`, `SceneCard`, `SceneField`, `ComplementGap`, and `ComplementProposalModal` are all defined **inline** in `StoryboardPage.tsx` (one ~2000-line file). The redesign extends these in place rather than introducing new shared components, matching the existing local pattern.

- Observation: The local development SQLite database already contained `storyboards.story` from the reverted attempt and had a twelfth Drizzle migration row with the correct SQL hash but the older reverted-attempt timestamp, so the first regenerated migration apply tried to run the same `ALTER` again.
  Evidence: initial `pnpm --filter @gen-story/api db:migrate` failed with `SQLITE_ERROR: duplicate column name: story`; `PRAGMA table_info(storyboards)` showed `story` present; aligning the local `__drizzle_migrations.created_at` timestamp with `drizzle/migrations/meta/_journal.json` made `pnpm --filter @gen-story/api db:migrate` pass.

- Observation: A viewport-`fixed` filmstrip keeps the rail visible but violates the desired upper bound: when the user scrolls above the scene section, the rail overlaps the page header/settings area. The correct behavior is section-scoped stickiness: the rail starts at the scene section and sticks only while that section is in view.
  Evidence: local screenshot on 2026-06-18 showed the right rail overlapping near the top of the Storyboard page above the scene cards.

- Observation: Constraining the photo container alone is not enough if the image element is still stretched to fill both axes. For mixed landscape/portrait source photos, the `img` itself must use intrinsic-ratio sizing with `max-width: 100%` and `max-height: 100%`, not `width: 100%; height: 100%`.
  Evidence: local screenshot on 2026-06-18 still showed the source photo visually zoomed in the inline scene editor.

## Decision Log

- Decision: Revert the prior implementation and re-scope UX-first.
  Rationale: Local testing (2026-06-17) found the prior result kept the screen as a tall text form, left the photo grid and per-scene picker showing every photo, and used a jump bar that scrolled away. The user judged it low-value and requested a full revert plus a refined plan.
  Date/Author: 2026-06-17 / User + Claude (Opus 4.8)

- Decision: Keep `story` as a separate field (not folded into `commonPrompt`) that **drives image generation** (composed into every scene prompt), seeded server-side from the latest photo-analysis `storySummary`.
  Rationale: Style-consistency (`commonPrompt`) and narrative meaning (`story`) are different concerns; feeding `story` into generation is what addresses the cohesion gap. Mirroring the existing `commonPrompt`/`resolveCommonPrompt` plumbing keeps the backend slice low-risk. This part of the earlier plan was sound; only its UI surfacing changes.
  Date/Author: 2026-06-17 / User + Claude (Opus 4.8)

- Decision: Initially implement scene cards as **three user-switchable view modes** (image-hero Rows / photo-left Split / Gallery tiles with editor drawer), persisted client-side.
  Rationale: The user explicitly asked for all three implemented with a self-serve switch, rather than one fixed layout, so authors choose their working density. This was later superseded by the 2026-06-18 decision to remove Rows.
  Date/Author: 2026-06-17 / User

- Decision: Remove Rows mode and keep **two user-switchable view modes** (Split / Gallery), persisted client-side.
  Rationale: Local review on 2026-06-18 found Rows and Split were effectively redundant. The useful Rows-only detail toggle moves into Split, and Rows-specific code is removed instead of left as dead UI.
  Date/Author: 2026-06-18 / User

- Decision: The persistent navigator is a **sticky photo filmstrip** built as an in-page sticky right column (not a `top:0`-inside-the-list bar, not a floating overlay).
  Rationale: The user selected the sticky filmstrip; building it as a sticky column inside the scrolling content is what makes it actually persist (see Surprises).
  Date/Author: 2026-06-17 / User + Claude (Opus 4.8)

- Decision: Photos feed scenes via an **"Add scenes" modal listing only unused photos**, and each scene shows a single primary photo with a **"Change" picker**; the always-on full grid and per-scene all-photos button row are removed.
  Rationale: The user selected the add-scenes-modal option; this stops showing the same photos three times and keeps the board clean.
  Date/Author: 2026-06-17 / User

- Decision: Consolidate project config (tone/style/common/negative/story) into one compact, default-collapsed panel.
  Rationale: Makes the scene board the primary content (addresses "the board should lead"). Lower-touch than redesigning each control; reuses the existing inputs.
  Date/Author: 2026-06-17 / Claude (Opus 4.8)

## Outcomes & Retrospective

Implemented the full story/worldview vertical slice and storyboard UX redesign. The migration filename is `drizzle/migrations/0011_futuristic_ronan.sql`, containing the expected additive SQL:

    ALTER TABLE `storyboards` ADD `story` text DEFAULT '' NOT NULL;

The first local `db:migrate` apply hit the expected reverted-attempt edge case: this machine's `data/gen-story.sqlite` already had the `story` column, and the local `__drizzle_migrations` row for the same SQL hash had the older reverted-attempt timestamp. I reconciled that local metadata timestamp with the regenerated journal entry and reran `pnpm --filter @gen-story/api db:migrate`; it then completed successfully. The checked-in migration remains the normal additive migration for databases that do not already have the column.

Validation performed:

    pnpm --filter @gen-story/api db:generate
    pnpm --filter @gen-story/api db:migrate
    pnpm typecheck
    pnpm lint
    pnpm exec prettier --check <changed source files>
    pnpm test

Results: `pnpm typecheck` passed; `pnpm lint` passed with the pre-existing unrelated warning in `packages/domain/src/rules.ts`; changed source files passed Prettier; `pnpm test` passed 176 tests, including `prompt-composer.test.ts` story coverage and application use-case coverage for story seeding, preservation, and regeneration. Full `pnpm format` remains blocked by pre-existing unrelated formatting drift in `apps/api/src/scene-fill/gemini-scene-fill-generation.ts`, `apps/web/src/components/generate/GeneratePage.tsx`, `apps/web/src/components/generation-history/GenerationHistoryPage.tsx`, and `apps/web/src/components/photos/PhotosPage.tsx`.

Follow-up correction on 2026-06-18: replaced the viewport-fixed rail with a scene-section-scoped sticky rail (`position: sticky; top: 24px`) so it cannot overlap content above the scene section. Inline scene source photos now render with a dedicated `.primaryPhotoImage` class using intrinsic image sizing (`width: auto; height: auto; max-width: 100%; max-height: 100%`) inside fixed preview frames, so portrait and landscape photos fit without crop/zoom. Re-ran `pnpm typecheck` and `pnpm lint`; both passed with the same pre-existing domain warning.

Follow-up correction on 2026-06-18 (view-mode simplification): removed Rows mode from the storyboard view type, switcher, legacy localStorage validation, i18n labels, and dead Rows CSS classes. Split is now the default inline editor; a legacy stored `rows` value falls back to Split and is overwritten on the next persistence effect. The "show/hide description and prompt" control now appears in Split and collapses the description, image prompt, and scene negative prompt fields. Re-ran `pnpm typecheck` and `pnpm lint`; both passed with the same pre-existing domain warning.

## Context and Orientation

gen-story is a pnpm monorepo with clean-architecture layering (`packages/domain` → `packages/application` → `apps/api`/`apps/web`, with DTOs in `packages/shared`). Terms: a "storyboard" is the per-project plan whose scenes become generated images; "tone" is the storyboard's target emotion; "common prompt" is a project-level prompt fragment composed into every scene; "photo analysis" is the stored result of analyzing a project's photos and includes a `storySummary`. The only image available per scene on the storyboard screen is its **assigned primary source photo** (generation is a later screen).

Files relevant to Milestone A (the `story` vertical slice), each mirroring how `commonPrompt` is already handled:

- `packages/domain/src/model.ts` — `Storyboard` type, `CreateStoryboardInput`, and `createStoryboard` factory (where `commonPrompt: (input.commonPrompt ?? "").trim()` lives).
- `apps/api/src/db/schema.ts` — `storyboards` table; `commonPrompt: text("common_prompt").notNull().default("")`.
- `apps/api/src/db/repositories.ts` — `mapStoryboard` and `SqliteStoryboardRepository.save` (insert values + `onConflictDoUpdate` set).
- `packages/application/src/use-cases.ts` — `UpsertStoryboardInput`, `resolveCommonPrompt`, and `upsertStoryboard`; the latest analysis is read via `deps.projectPhotoAnalyses.findLatestByProjectId(projectId)`.
- `apps/api/src/http/schemas.ts` — `UpsertStoryboardSchema` (`commonPrompt: z.string().optional()`).
- `apps/api/src/http/routes.ts` — the `PUT /api/storyboards/:storyboardId` handler.
- `packages/shared/src/index.ts` — `StoryboardDto`.
- `apps/api/src/http/dto-mappers.ts` — `toStoryboardDto`.
- `apps/api/src/generation/prompt-composer.ts` — `composeImagePrompt` (pushes `commonPrompt` into `segments`).
- `apps/api/src/generation/compose-scene-prompt.ts` — `composeScenePrompt`, `ComposeScenePromptOverrides`, and the `composeImagePrompt` call.
- `apps/api/src/generation/prompt-composer.test.ts` — existing unit coverage to extend.

Files relevant to Milestone A.6 and Milestone B (web UI), all in `apps/web/src/components/storyboard/` unless noted:

- `StoryboardPage.tsx` — the single ~2000-line page component. Key landmarks: state block (`useState` group near the top); `accordionOpen` state; the config `CollapsibleSection`s (tone/style/commonPrompt/negativePrompt); the AI analysis panel that already shows `photoAnalysis.storySummary`; the always-on "Create Scenes from Photos" section (the `photos.some((p) => p.usage === "candidate")` IIFE block); the scene list (`styles.sceneList`, `scenes.map`, the scene-card wrapper `<div key=...>`); and the inline `CollapsibleSection` / `SceneCard` / `SceneField` definitions at the bottom. The per-scene primary-photo control is the `candidatePhotos.map(...)` button row inside `SceneCard`.
- `StoryboardPage.module.css` — styles for sections, scene cards, fields, and the photo grid; the redesign adds styles for the board layout grid, the filmstrip rail, the view switcher, the three card variants, and the change-photo picker.
- `apps/web/src/lib/api-client.ts` — `upsertStoryboard` input type and the `StoryboardDto` it returns; `assignPhotosToScene`, `createTemplateScenesFromPhotos`.
- `apps/web/src/lib/image-url.ts` — `storageKeyToUrl` for rendering photos.
- `apps/web/src/i18n/messages/en.json` and `ja.json` — `storyboard.*` strings (`sections.*`, `commonPrompt.*` are the patterns to copy for `story.*`; add `nav.*`, `view.*`, `addScenes.*`, `changePhoto.*`).

## Plan of Work

Milestone A is the backend `story` slice (clone the `commonPrompt` plumbing, reseed from `storySummary`, one line in the composer) plus minimal web data wiring; its UI lives inside the consolidated config panel from B.1. Milestone B is the storyboard board redesign and is the bulk of the work; it is web-only (no API/schema changes).

### Milestone A — Story / Worldview field that drives generation

A.1 **Domain.** Add `story: string` to `Storyboard`; `story?: string` to `CreateStoryboardInput`; in `createStoryboard` set `story: (input.story ?? "").trim()`. Empty is valid (means "not set / reseed").

A.2 **Persistence.** Add `story: text("story").notNull().default("")` to the `storyboards` table. Run `db:generate` (expected `drizzle/migrations/00NN_*.sql` with `ALTER TABLE \`storyboards\` ADD \`story\` text DEFAULT '' NOT NULL;`) and `db:migrate`. In `repositories.ts`, map `story: row.story`in`mapStoryboard`, and include `story: storyboard.story`in both the insert values and the`onConflictDoUpdate` set.

- Note: the local dev SQLite already physically has this column from the reverted attempt (harmless). `db:generate` is driven by the schema, so the new migration will be regenerated cleanly; verify the generated SQL matches the expected `ALTER` before applying.

A.3 **Use case.** Add `story?: string` to `UpsertStoryboardInput`. Add `resolveStory(deps, { requestedStory, existingStory, projectId })` mirroring `resolveCommonPrompt`: if `requestedStory === undefined` and `existingStory.trim() !== ""` return existing; if `requestedStory` is a non-empty trimmed string return it; otherwise seed from `deps.projectPhotoAnalyses.findLatestByProjectId(projectId)`'s `storySummary` (or `""`). Call it in `upsertStoryboard` and pass into `createStoryboard`.

A.4 **API boundary.** Add `story: z.string().optional()` to `UpsertStoryboardSchema`; pass `story: parsed.data.story` into the route's `upsertStoryboard` call; add `story: string` to `StoryboardDto`; set `story: storyboard.story` in `toStoryboardDto`.

A.5 **Generation.** Add `story: string` to `composeImagePrompt`'s input and push `if (story.trim()) segments.push(story.trim())` immediately after the `commonPrompt` segment. Add `story?: string` to `ComposeScenePromptOverrides`, and in `composeScenePrompt` pass `story: overrides.story ?? storyboard.story ?? ""`. Extend `prompt-composer.test.ts` with cases asserting a non-empty `story` appears in the composed prompt and is absent when blank. (Existing `composeImagePrompt` calls in the test file gain `story: ""` since the field is required.)

A.6 **Web data + strings.** In `api-client.ts` add `story?: string` to the `upsertStoryboard` input and `story: string` to `StoryboardDto`. In `StoryboardPage.tsx` add `storyDraft`/`setStoryDraft`, a sync effect on `storyboard?.story`, `savingStory`, and `saveStory(story)` cloned from `saveCommonPrompt` (sends `story`; reseeds when empty). The story editor renders inside the consolidated config panel (B.1) with: an intro hint, a textarea bound to `storyDraft` (placeholder = `photoAnalysis?.storySummary` when story is empty), a Save button (disabled when unchanged), and a "Regenerate from analysis" button calling `saveStory("")`. Add `storyboard.story.*` strings (`intro`, `placeholder`, `save`, `saving`, `savedMsg`, `failed`, `regenerate`, `notSet`) to `en.json` and `ja.json`.

### Milestone B — Visual-first, navigable storyboard board

B.1 **Consolidated project config.** Wrap the tone/style/common-prompt/negative-prompt/story controls in a single compact "Project settings" panel (one outer `CollapsibleSection`, or a panel with the existing sub-`CollapsibleSection`s inside). Default the panel collapsed when the storyboard is already configured (ref-guarded one-time init from `storyboard`: collapsed when tone non-empty _and_ a style/common/etc. are set), open when unconfigured. The AI-assist analysis card stays above as today. Goal: above the fold is "settings (collapsed) + the board," not five stacked accordions.

B.2 **Photo → scene flow.**

- Remove the always-on "Create Scenes from Photos" grid. Add an "Add scenes" button in the scene-list header that opens a modal (reuse `styles.modalOverlay`/`modalContent`). The modal lists **only candidate photos not already assigned as any scene's primary photo** (compute used IDs from `scenes[].photoAssets`), with the existing select-all and small/medium/large size toggle moved inside it. Confirm calls the existing `createTemplateScenesFromPhotos`. When no unused photos remain, the modal shows an empty state and the button can be hidden/disabled.
- Replace the per-scene `candidatePhotos.map(...)` button row with a **single primary-photo hero** (the assigned photo, or a placeholder "no photo") plus a "Change" control that opens a compact picker (popover or small modal) listing candidate photos; selecting calls the existing `handleAssignPhoto(id, "primary")`.

B.3 **Scene board view modes.**

- Add a view switcher control (segmented button: Split / Gallery) in the scene-list header; persist the choice in `localStorage` (e.g. `gen-story:storyboard-view`) with a safe default of Split. Treat the legacy `rows` value as Split.
- `SceneCard` uses the Split rendering for inline editing and shares the same field set and actions:
  - **Split** — primary photo on the left, fields stacked on the right, with description and prompt collapsible behind a toggle.
  - **Gallery** — a grid of image-first tiles (photo + number + title); clicking a tile opens a focused editor drawer/modal reusing the full field set for that one scene.
- The composed-prompt preview (`ComposedPromptPreview`) and complement-gap affordance remain available (in Split inline; in Gallery within the editor drawer).

B.4 **Sticky photo filmstrip rail.**

- Restructure the scene area into a two-column layout (e.g. `display: grid; grid-template-columns: minmax(0,1fr) <rail-width>`): the board on the left, the filmstrip on the right.
- The rail is `position: sticky; top: 0; max-height: calc(100vh - <content padding>); overflow-y: auto`, so it stays in view as the board scrolls within `.content` and scrolls internally when there are many scenes. Each cell renders the scene's primary photo as a background image (placeholder when none), overlaid with the scene number and a truncated title; the cell is a button that calls `document.getElementById(scene-anchor)?.scrollIntoView({ behavior: "smooth", block: "start" })`.
- Add a stable anchor id per scene wrapper (`scene-${scene.id ?? idx}`). Highlight the in-view scene with an `IntersectionObserver` whose `root` is the `.content` scroll container (capture via a ref on the board or `closest`), updating an `activeSceneId` state; the active rail cell gets an active style.
- Render the rail only when there are ≥2 scenes; on narrow viewports collapse the rail (e.g. hide below a breakpoint) so the board stays usable. Add `storyboard.nav.*` strings (`label`, `untitled`).

## Concrete Steps

Run all commands from the repository root `/Users/ran/my-app/gen-story`.

After editing `apps/api/src/db/schema.ts`, generate and apply the migration:

    pnpm --filter @gen-story/api db:generate
    pnpm --filter @gen-story/api db:migrate

Expected: `db:generate` writes a new `drizzle/migrations/00NN_*.sql` containing

    ALTER TABLE `storyboards` ADD `story` text DEFAULT '' NOT NULL;

and `db:migrate` completes without error.

Then run the checks (narrowest first):

    pnpm typecheck
    pnpm lint
    pnpm exec prettier --check <changed files>
    pnpm test

## Validation and Acceptance

Automated:

- `pnpm typecheck` reports all projects "Done" with no errors.
- `pnpm lint` is clean except the one pre-existing unrelated warning in `packages/domain/src/rules.ts`.
- `pnpm test` passes, including new `prompt-composer.test.ts` assertions that a non-empty `story` appears in the composed prompt and is absent when empty.

Manual (free of AI cost; story seeding reuses the already-stored analysis), each mapping to a fixed problem:

- **Worldview (P1):** On a project with a photo analysis, the consolidated config panel's Story / Worldview shows the AI summary (seeded). Edit + Save + reload → persists. "Regenerate from analysis" resets it. Opening the composed-prompt preview for any scene shows the story text in the prompt (observable without image credits).
- **Photo grid (P2):** No persistent full photo grid on the board. "Add scenes" opens a modal listing only unused photos; after adding, those photos are gone from the modal; with none left the modal is empty/disabled.
- **Per-scene picker (P3):** Each scene shows one primary photo; "Change" opens a compact picker, not a full re-rendered library.
- **Visual-first card (P4):** The board leads with the image. Switching Split / Gallery changes the layout; the choice survives reload (localStorage). Split can hide/show description and prompt. Gallery tiles open an editor drawer.
- **Navigation (P5):** With many scenes, the right filmstrip stays visible while scrolling, scrolls internally when long, highlights the scene in view, and jumps to a scene on click.

A paid end-to-end check (optional, spends image credits): generate one scene and confirm the worldview is reflected. Not part of routine validation per the project's cost guidance.

## Idempotence and Recovery

The migration is additive and safe to re-run via Drizzle's journal. `resolveStory` is idempotent: repeated saves with unchanged input return the same value; the `storyboards` row is upserted by id. Legacy storyboards have `story = ''`; the next `upsertStoryboard` reseeds from the latest analysis (or stays empty). The view-mode preference is client-only (`localStorage`); a missing/invalid value falls back to Split, and the legacy `rows` value is treated as Split. The filmstrip scroll-spy degrades gracefully: if the `IntersectionObserver` root cannot be resolved, no cell is highlighted but click-jump still works. If the migration was not applied, re-run `pnpm --filter @gen-story/api db:migrate`.

## Artifacts and Notes

Files expected to change:

- `packages/domain/src/model.ts`, `packages/domain/src/model.test.ts` (storyboard fixture gains `story: ""`)
- `apps/api/src/db/schema.ts`, `apps/api/src/db/repositories.ts`, `drizzle/migrations/00NN_*.sql` (+ `meta/` snapshot and journal)
- `packages/application/src/use-cases.ts`
- `apps/api/src/http/schemas.ts`, `apps/api/src/http/routes.ts`, `apps/api/src/http/dto-mappers.ts`
- `packages/shared/src/index.ts`
- `apps/api/src/generation/prompt-composer.ts`, `apps/api/src/generation/compose-scene-prompt.ts`, `apps/api/src/generation/prompt-composer.test.ts`
- `apps/web/src/lib/api-client.ts`
- `apps/web/src/components/storyboard/StoryboardPage.tsx`, `apps/web/src/components/storyboard/StoryboardPage.module.css`
- `apps/web/src/i18n/messages/en.json`, `apps/web/src/i18n/messages/ja.json`
- `docs/gap-analysis.md` (§19 status icons, notes, and summary counts)

## Interfaces and Dependencies

- Drizzle ORM + drizzle-kit — the additive `storyboards.story` column and its migration.
- `ProjectPhotoAnalysisRepositoryPort.findLatestByProjectId` (already used) — the seed source for `resolveStory`; no new port.
- next-intl (`useTranslations`) — the new `storyboard.story.*`, `nav.*`, `view.*`, `addScenes.*`, `changePhoto.*` strings.
- Browser `Element.scrollIntoView` (jump), `IntersectionObserver` (scroll-spy), and `window.localStorage` (view-mode persistence) — all standard web APIs; no new dependency is added.

## Revision Notes

2026-06-17: Initial version (narrow scope: `story` field + sticky jump bar + default-collapsed accordions).

2026-06-17: Implementation of the initial scope completed, then **reverted in full** at the user's request after local UX testing found it low-value (screen stayed a text form; photo grid and per-scene picker still showed every photo; jump bar scrolled away).

2026-06-17 (refine): Re-scoped UX-first. The `story` backend slice (Milestone A) is retained largely as before; Milestone B is rebuilt around a visual-first board with three user-switchable view modes, a sticky photo filmstrip rail (in-page sticky column with scroll-spy), an "Add scenes" modal listing only unused photos, a per-scene single-photo "Change" picker, and a consolidated default-collapsed config panel. Design choices captured in the Decision Log were selected by the user on 2026-06-17.

2026-06-18 (follow-up): Rows mode was removed because local review found it redundant with Split. The detail visibility toggle was moved into Split, and the view switcher now offers only Split and Gallery.
