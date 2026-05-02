# Refine Clickable UI Mock From Review

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.

## Purpose / Big Picture

Revise the Phase 1 clickable UI mock so it better reflects `REQUIREMENTS_INIT.md` and the latest mock review. After this work, a reviewer should be able to open the web app, understand the purpose of each step, move backward and forward predictably, see image previews in storyboard contexts, compare original and generated mock images meaningfully, and inspect storyboard data through multiple views.

This is still a frontend-only UI mock milestone. It must not add database persistence, REST API integration, authentication, real file uploads, storage, real AI scanning, image generation calls, backend code, or package-layer changes. All AI analysis, style previews, generated images, and generation state shown by the mock are static or in-memory browser data.

This new plan intentionally leaves `docs/plans/20260501-clickable-ui-mock.md` intact as the completed first clickable mock plan.

## Progress

- [x] (2026-05-01 03:11Z) Read the current mock implementation in `apps/web/src/components/mock-flow/MockFlowClient.tsx`.
- [x] (2026-05-01 03:11Z) Read the completed first mock plan at `docs/plans/20260501-clickable-ui-mock.md`.
- [x] (2026-05-01 03:11Z) Read the relevant Phase 1 requirements in `REQUIREMENTS_INIT.md` and `USER_EXPERIENCE_FLOW.md`.
- [x] (2026-05-01 03:11Z) Created this review-driven ExecPlan.
- [x] (2026-05-02 06:03Z) Refined navigation so back buttons and step navigation preserve expected flow history.
- [x] (2026-05-02 06:03Z) Redesigned project creation occasion input as expandable occasion/theme choices.
- [x] (2026-05-02 06:03Z) Redesigned Step 4 from generic photo management into understandable mock AI photo analysis and curation.
- [x] (2026-05-02 06:03Z) Added tone/style visual previews to the emotion/style step.
- [x] (2026-05-02 06:03Z) Added image previews and multiple view modes to the storyboard step.
- [x] (2026-05-02 06:03Z) Clarified the generated result review step with original-vs-generated comparisons, adopt controls, and retry affordances.
- [x] (2026-05-02 06:03Z) Ran focused web checks: `pnpm --filter @gen-story/web typecheck`, `pnpm --filter @gen-story/web lint`, and `pnpm --filter @gen-story/web test`.
- [x] (2026-05-02 06:06Z) Ran `pnpm format`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and the architecture boundary check.
- [x] (2026-05-02 06:06Z) Started `pnpm dev:web` at `http://localhost:3000` and verified the page returns HTTP 200.
- [x] (2026-05-02 06:11Z) User manually verified the revised flow in the browser.

## Surprises & Discoveries

- Observation: The current mock already has the seven planned screens but uses names and controls that do not communicate the intended AI-assisted workflow clearly enough.
  Evidence: `MockFlowClient.tsx` defines screens named `projects`, `create`, `upload`, `manage`, `emotion`, `storyboard`, and `compare`; Step 4 renders "Photo management" with usage options `Hero`, `Support`, `Reference`, and `Omit`.

- Observation: The requirements expect photo usage labels and workflow semantics that differ from the current mock labels.
  Evidence: `REQUIREMENTS_INIT.md` describes photo usage as `使用`, `未使用`, and `参考のみ`, and later describes `photo_assets.curationStatus` plus scene-specific primary/reference relationships.

- Observation: The requirements explicitly ask for multiple storyboard viewing formats.
  Evidence: `REQUIREMENTS_INIT.md` says the storyboard should be viewable in card form, timeline form, and table form, and should support original/generated image comparison.

- Observation: Markdown and PDF storyboard output should not be included in this milestone.
  Evidence: `REQUIREMENTS_INIT.md` says JSON output is needed, and "現時点では、Markdown出力やPDF出力は不要とする."

- Observation: The focused web checks pass after the first implementation draft.
  Evidence: `pnpm --filter @gen-story/web typecheck`, `pnpm --filter @gen-story/web lint`, and `pnpm --filter @gen-story/web test` exited successfully on 2026-05-02.

- Observation: The full workspace verification set passes after the implementation.
  Evidence: `pnpm format`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` exited successfully on 2026-05-02. The architecture boundary grep returned no matches, with exit code 1 as expected.

- Observation: The local dev server required elevated execution in this sandbox, but the app served successfully once started.
  Evidence: sandboxed `pnpm dev:web` failed with `listen EPERM: operation not permitted 0.0.0.0:3000`; the elevated retry started Next.js at `http://localhost:3000`, and `curl -s -i http://localhost:3000` returned `HTTP/1.1 200 OK`.

- Observation: Browser flow verification is complete.
  Evidence: The user manually verified the revised clickable flow after the local app was served at `http://localhost:3000`.

## Decision Log

- Decision: Create a new ExecPlan instead of editing the completed first mock plan.
  Rationale: The first plan records the initial Phase 1 mock milestone. This work is a review-driven second iteration with different acceptance criteria, so a new plan preserves milestone history.
  Date/Author: 2026-05-01 / Codex

- Decision: Keep the next implementation frontend-only and in-memory.
  Rationale: The review is about UX fidelity and requirements coverage. Adding persistence, API integration, real AI analysis, or real generation would mix later roadmap phases into this UI mock revision.
  Date/Author: 2026-05-01 / Codex

- Decision: Do not include Markdown or PDF storyboard export in this milestone.
  Rationale: `REQUIREMENTS_INIT.md` explicitly excludes Markdown/PDF output for the current phase. The mock may show future JSON export or structured handoff language only if it helps clarify the Phase 1 endpoint.
  Date/Author: 2026-05-01 / Codex

- Decision: Treat Step 7 as generated result review, not tone selection.
  Rationale: Tone/style choice belongs before storyboard generation. The final review step should make sense as per-scene original-vs-generated review with adoption and retry controls.
  Date/Author: 2026-05-01 / Codex

- Decision: Use static mock analysis and preview panels rather than generated assets or external URLs.
  Rationale: This milestone must remain offline and deterministic. Static CSS-backed panels and existing browser-selected previews are sufficient to communicate the workflow.
  Date/Author: 2026-05-01 / Codex

- Decision: Keep the revision in the existing client component and CSS module.
  Rationale: The change is still a single frontend mock surface. Splitting files now would add review overhead without creating clearer ownership boundaries.
  Date/Author: 2026-05-02 / Codex

## Outcomes & Retrospective

Implementation is complete. The clickable mock now includes structured occasion/theme choices, explicit history-aware navigation, mock AI photo analysis and curation, tone/style previews, richer storyboard editing with source image previews and multiple views, and generated result review with original-vs-generated comparison. Automated checks passed, the local app returned HTTP 200, and the user manually verified the revised browser flow.

## Context and Orientation

`gen-story` is a local web application for creating story-like generated image sequences from user photos. Phase 0 created the monorepo baseline. The first Phase 1 mock is implemented in `apps/web` and documented in `docs/plans/20260501-clickable-ui-mock.md`.

The current web route is `apps/web/src/app/page.tsx`. It renders `apps/web/src/components/mock-flow/MockFlowClient.tsx`, a client component that owns all in-memory mock state. Styling is in `apps/web/src/components/mock-flow/MockFlowClient.module.css`.

Important current mock terms:

`Project` means an in-memory project card, not a persisted domain entity.

`Photo` means either a browser-selected preview created with `URL.createObjectURL` or a static sample placeholder.

`Scene` means a storyboard row with editable text and one primary photo assignment.

`Generated candidate` currently means a static visual placeholder. In the revised mock, it should become a clearer generated result review item compared against the original source photo.

The review raised these issues:

1. Storyboard scenes need image previews.
2. Back buttons and step changes need predictable previous-screen behavior.
3. Occasion must support future expansion into many situations and themes.
4. Step 4 "Manage" is not intuitive; if it represents AI scanning and selection, the UI should say so.
5. The tone/style step needs previews, either static previews or prepared GIF-like examples.
6. Storyboard needs several gallery styles such as image-only, list, and table views, using Notion as a reference for view switching.
7. Step 7 "Compare" is unclear; generated comparison should not duplicate tone selection and should instead support reviewing generated outputs against source photos.

## Requirements Coverage Checklist

- [x] Project list and project creation are reflected. Project creation now uses structured occasion/theme options plus a custom label for `Other`.
- [x] Local photo file selection and browser preview are reflected.
- [x] Photo notes and usage state are reflected. Step 4 now shows mock AI analysis cues, per-photo memo fields, and `Use` / `Reference only` / `Do not use` curation controls.
- [x] User-controlled photo ordering is reflected. Step 4 supports manual photo ordering when AI recommended order is off, and visibly toggles the AI recommended order.
- [~] Mock AI emotion candidates and scene structure suggestions are partial. The style step now presents static AI emotion candidates, and the storyboard supports inserted AI bridge scenes, but there is no generated scene-structure proposal workflow yet.
- [x] Emotion/tone selection is reflected with visual previews and generated suggestion context.
- [x] Project-wide image style selection with preview examples is reflected.
- [~] Model selection UI with default `gpt-image-2` is partial. The mock displays the default model in the style and generated review steps, but it does not yet provide a model dropdown.
- [x] Test generation preview with three patterns is reflected as static mock preview candidates.
- [x] Storyboard editing is reflected with source image previews, scene description, delivered emotion, camera work, lighting, motion direction, and user-facing edit notes.
- [x] AI補完シーン insertion between scenes is reflected as an `Insert AI scene` action.
- [x] Storyboard view formats are reflected with card, timeline/list, image-only gallery, and table views.
- [x] Generated image comparison is reflected with original-vs-generated side-by-side review, adopt/unadopt state, retry placement, and scene-level retry count.
- [~] JSON output or structured handoff affordance is partial. The generated review step now shows a structured storyboard JSON readiness label, but does not output actual JSON.
- [x] Markdown/PDF export is correctly out of scope for this milestone.
- [x] Backend persistence, real upload storage, auth, and real AI generation are correctly absent for the UI mock phase.

## Plan of Work

First, preserve the existing server/client boundary. `apps/web/src/app/page.tsx` should continue to render a client component. Browser APIs such as file selection and object URL cleanup must remain inside a `"use client"` component.

Second, refine the navigation model. Replace simple `current index - 1` back behavior with explicit previous-step behavior. The implementation may use a small navigation history stack or a central transition helper, but every primary forward action, back button, and sidebar step jump must result in predictable screen state. The current screen should remain highlighted, and jumping to a later screen should not erase selected photos, tone, or storyboard edits.

Third, change project creation from free-text-only `Occasion` to structured occasion/theme selection. Use an expandable set of options such as Anniversary, Wedding, Birthday, Graduation, Travel, Family Memory, and Other. Keep a custom text input only for `Other` or a short custom label. Store both `occasionId` and display label in mock state so future additions are easy to model.

Fourth, redesign Step 4. Rename the screen from `Manage` to a clearer label such as `Analyze` or `Photo review`. The screen should communicate mock AI scanning and curation: show each photo with preview, mock detected cues, optional memo input, usage status (`Use`, `Reference only`, `Do not use`), and a visible "AI recommended order" toggle. The toggle should affect mock ordering or at least visibly mark the recommended sequence. No real AI analysis may run.

Fifth, expand the emotion step into emotion and style selection with visual preview. Keep tone selection, but add static preview panels that use the same representative source photo concept across style examples. Include style options from `REQUIREMENTS_INIT.md`, such as cinematic live-action, anime film, warm hand-drawn, transparent light, film photo, watercolor, monochrome film, 3D animation, and AI recommendation. Show project-wide selection, not per-scene style selection.

Sixth, expand storyboard data and UI. Each scene should show source photo preview, scene title, scene description, generated image prompt, delivered emotion, camera/framing option, color/lighting option, motion direction option, and user-facing edit notes. Keep controls simple and selectable where possible. Add view mode tabs or segmented controls for card, timeline/list, image-only gallery, and table views. The views should share the same scene state.

Seventh, clarify Step 7 as generated result review. Rename visible copy from generic `Compare` to `Generated review` or similar. For each scene, show the original photo preview on the left and a static generated result preview on the right. Include adopt/unadopt state, a retry or regenerate button that changes visible mock status only, and a small generation metadata block such as model `gpt-image-2`, preset `Standard`, and status. Tone/style selection should not happen here.

Eighth, keep the implementation in `apps/web`. Use the existing component and CSS module unless the file becomes difficult to maintain. If splitting is needed, create narrowly scoped components under `apps/web/src/components/mock-flow/`. Do not modify `apps/api`, `packages/*`, environment files, or dependency manifests unless a future review explicitly changes the scope.

Finally, update this ExecPlan during implementation with progress, discoveries, decisions, command results, manual verification notes, and any remaining gaps.

## Concrete Steps

Run all commands from `/Users/ran/my-app/gen-story` unless noted otherwise.

Inspect current sources before editing:

    sed -n '1,220p' apps/web/src/components/mock-flow/MockFlowClient.tsx
    sed -n '1,260p' apps/web/src/components/mock-flow/MockFlowClient.module.css
    sed -n '470,545p' REQUIREMENTS_INIT.md
    sed -n '1,120p' USER_EXPERIENCE_FLOW.md

Implement the UI refinement primarily in:

    apps/web/src/components/mock-flow/MockFlowClient.tsx
    apps/web/src/components/mock-flow/MockFlowClient.module.css

If the client component becomes too large to review safely, split only local mock-flow components, for example:

    apps/web/src/components/mock-flow/mockData.ts
    apps/web/src/components/mock-flow/PhotoAnalysisScreen.tsx
    apps/web/src/components/mock-flow/EmotionStyleScreen.tsx
    apps/web/src/components/mock-flow/StoryboardScreen.tsx
    apps/web/src/components/mock-flow/GeneratedReviewScreen.tsx

After a first working draft, run focused web checks:

    pnpm --filter @gen-story/web typecheck
    pnpm --filter @gen-story/web lint
    pnpm --filter @gen-story/web test

Before completion, run full workspace checks:

    pnpm format
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build

Run the architecture boundary check:

    rg "from ['\\\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application

Expected result: no matches. Exit code `1` is acceptable when there are no matches.

Start the web app:

    pnpm dev:web

If port `3000` cannot be used:

    cd apps/web && pnpm exec next dev --port 3001

Verify the app at:

    http://localhost:3000

or, if the alternate port is used:

    http://localhost:3001

## Validation and Acceptance

This milestone is accepted only when the revised mock is observable in the browser.

The project creation screen shows structured occasion/theme choices and still allows a custom label for unsupported occasions.

Back buttons, sidebar step buttons, and primary forward actions move predictably without losing selected photos, tone/style choices, or storyboard edits.

The former Step 4 is no longer a vague `Manage` screen. It is visibly an AI photo analysis or photo review step, with photo previews, mock analysis cues, per-photo memo fields, use/reference/do-not-use controls, and an AI recommended order affordance.

The emotion/style step shows visual previews for tone and image style choices. The selected style is clearly project-wide.

Storyboard editing shows image previews inside scene cards or rows. Each scene includes editable story text plus mock generation-relevant controls for emotion, prompt, camera/framing, lighting/color, motion direction, and user-facing notes.

Storyboard view mode switching works for card, timeline/list, image-only gallery, and table views, and the same scene edits are reflected across views.

The generated review step clearly compares original source photos with static generated mock outputs. Each scene has visible adopt/unadopt state and a retry/regenerate affordance that updates in-memory mock state only.

The flow remains frontend-only. There are no API calls, database writes, real uploads, real AI calls, auth flows, storage adapters, or package-layer changes.

The layout remains usable around `1440px` desktop width and `768px` tablet width.

All verification commands pass:

    pnpm format
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build

The architecture boundary check remains clean.

## Idempotence and Recovery

This milestone is safe to resume because it should only edit frontend mock files and this plan document. Re-running typecheck, lint, tests, build, and dev server commands is safe.

Mock project creation, photo selection, analysis labels, storyboard edits, view mode changes, and generated review state must remain in browser memory only. Refreshing the browser may reset the mock; that is acceptable for this phase.

If local photo previews stop rendering, remove the affected photo from state and select it again. Any object URLs created by `URL.createObjectURL` must be revoked when photos are removed and when the component unmounts.

If `pnpm build` fails because browser-only APIs are used during server rendering, move those APIs back into a file with `"use client"` at the top.

If `pnpm dev:web` fails with a port binding error, use the alternate port command from the Concrete Steps section and record the alternate URL in `Outcomes & Retrospective`.

## Artifacts and Notes

The first clickable mock plan is `docs/plans/20260501-clickable-ui-mock.md`. It records the initial seven-screen mock and the verification commands that passed for that milestone.

Current implementation entry points before this refinement:

    apps/web/src/app/page.tsx
    apps/web/src/components/mock-flow/MockFlowClient.tsx
    apps/web/src/components/mock-flow/MockFlowClient.module.css

The mock review that triggered this plan identified missing storyboard previews, unreliable back navigation, occasion scalability, unclear Step 4 purpose, missing style/tone previews, missing storyboard gallery views, unclear Step 7 semantics, and incomplete reflection of `REQUIREMENTS_INIT.md`.

Documentation validation for this plan:

    pnpm exec prettier --check docs/plans/20260501-refine-clickable-ui-mock-review.md

## Interfaces and Dependencies

This milestone depends on the existing Next.js and React setup in `apps/web`.

No new backend interfaces are required. `apps/api` should remain unchanged.

No new package-level interfaces are required. `packages/domain`, `packages/application`, and `packages/shared` should remain unchanged.

No external services are required. The mock must not call OpenAI, WorkOS, GCP, AWS, database services, object storage, or the local API.

No Markdown or PDF storyboard export interface should be added in this milestone. `REQUIREMENTS_INIT.md` explicitly says Markdown/PDF output is not needed at this point.

Browser APIs used for file previews may include `File`, `FileList`, and `URL.createObjectURL`. These must be used only in client-side interaction code.
