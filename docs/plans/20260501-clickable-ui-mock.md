# Build Clickable UI Mock

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.

## Purpose / Big Picture

Build the Phase 1 clickable UI mock for `gen-story` so the core product flow can be reviewed before persistence, authentication, file storage, or AI generation are implemented. After this work, a user should be able to open the web app, move through the seven planned screens, select local photo files for preview, edit mocked storyboard content, and reach a generated image comparison screen using only browser state and mock data.

This is Phase 1 and initial milestone M1 from `IMPLEMENTATION_PLAN.md`. It intentionally does not add real database persistence, REST API calls, authentication, image preprocessing, image generation, upload storage, or backend changes. The goal is to validate navigation, screen structure, and user flow with the smallest useful frontend implementation.

## Progress

- [x] (2026-05-01 02:24Z) Read `IMPLEMENTATION_PLAN.md`, `/Users/ran/my-app/PLANS.md`, and the completed Phase 0 plan at `docs/plans/20260330-setup-development-environment.md`.
- [x] (2026-05-01 02:24Z) Confirmed Phase 0 created the workspace, minimal Next.js web app, API health server, and package boundaries.
- [x] (2026-05-01 02:24Z) Created this ExecPlan for Phase 1 / M1.
- [x] (2026-05-01 02:47Z) Replace the Phase 0 placeholder page with the clickable mock application shell.
- [x] (2026-05-01 02:47Z) Implement the seven core mock screens and navigation between them.
- [x] (2026-05-01 02:47Z) Add browser-only local photo selection and preview for the mock upload and photo management screens.
- [x] (2026-05-01 02:47Z) Add mock storyboard editing, generated image candidates, and image adoption interactions.
- [x] (2026-05-01 02:47Z) Run `pnpm format`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
- [x] (2026-05-01 02:47Z) Start `pnpm dev:web` and verify `http://localhost:3000` returns HTTP 200.
- [ ] Complete a GUI browser click-through at 1440px and 768px viewports.

## Surprises & Discoveries

- Observation: The current web app is still the Phase 0 placeholder page.
  Evidence: `apps/web/src/app/page.tsx` renders only `Gen Story` and `Phase 0 development baseline is running.`

- Observation: The root workspace already has the commands needed to verify this UI milestone.
  Evidence: `package.json` defines `pnpm format`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm dev:web`.

- Observation: Starting the Next.js dev server inside the default sandbox could not bind port `3000`.
  Evidence: `pnpm dev:web` failed with `listen EPERM: operation not permitted 0.0.0.0:3000`; rerunning the same command with approved escalation started the server at `http://localhost:3000`.

## Decision Log

- Decision: Scope this plan to Phase 1 / M1 only.
  Rationale: `IMPLEMENTATION_PLAN.md` separates the clickable UI mock from domain modeling, persistence, storage, API integration, and generation jobs. Keeping this milestone frontend-only makes the result reviewable without prematurely coupling it to later architecture.
  Date/Author: 2026-05-01 / Codex

- Decision: Keep mock state inside `apps/web` instead of adding shared DTOs or application package code.
  Rationale: Phase 1 is explicitly a browser-facing mock. Shared contracts should wait until REST API and persistence work define real request and response shapes.
  Date/Author: 2026-05-01 / Codex

- Decision: Use local component state and static mock records rather than browser localStorage.
  Rationale: The milestone verifies flow and layout, not reload persistence. State restoration is part of later integrated product flow work.
  Date/Author: 2026-05-01 / Codex

- Decision: Avoid adding a UI component library or new runtime dependency for this milestone.
  Rationale: The existing Next.js and React setup is sufficient for a clickable mock. New dependencies would increase setup and maintenance before there is a concrete need.
  Date/Author: 2026-05-01 / Codex

- Decision: Keep `apps/web/src/app/page.tsx` as a Server Component and render a dedicated client component for the interactive mock.
  Rationale: App Router pages are Server Components by default, while this milestone needs React state, file input handling, and browser APIs such as `URL.createObjectURL`. A dedicated client component keeps the route boundary explicit.
  Date/Author: 2026-05-01 / Codex

## Outcomes & Retrospective

Implemented the Phase 1 clickable mock inside `apps/web` without adding dependencies or touching backend/package code. `apps/web/src/app/page.tsx` remains a Server Component and renders `apps/web/src/components/mock-flow/MockFlowClient.tsx`, which is the browser-only client component that owns React state, file input handling, `URL.createObjectURL` previews, photo usage controls, tone selection, storyboard editing, and generated image candidate adoption. Styling lives in `apps/web/src/components/mock-flow/MockFlowClient.module.css`.

The root layout metadata now describes the clickable mock and sets body margin to `0` so the app shell fills the viewport cleanly.

Verification completed:

    pnpm --filter @gen-story/web typecheck
    pnpm --filter @gen-story/web lint
    pnpm --filter @gen-story/web test
    pnpm format
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build
    rg "from ['\\\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application

All verification commands passed. The architecture boundary check returned no matches, which is the expected clean result. `pnpm dev:web` is running at `http://localhost:3000`, and `curl -s -i http://localhost:3000` returned HTTP 200 with the Gen Story clickable mock HTML. A GUI browser click-through across the full flow and the 1440px/768px viewport checks remain for reviewer verification because the repo does not currently include browser automation tooling.

## Context and Orientation

`gen-story` is a local web application planned to help users create story-like generated image sequences from their photos. The roadmap lives in `IMPLEMENTATION_PLAN.md`. Phase 0 has already created the development baseline: a pnpm TypeScript workspace, `apps/web` as a minimal Next.js app, `apps/api` as a health-check server, and pure `packages/domain`, `packages/application`, and `packages/shared` packages.

The Phase 1 clickable UI mock lives entirely in `apps/web`. It should be a realistic but non-persistent browser flow. The user should see product screens and controls that resemble the intended workflow, but actions should operate on mock data in React state.

The seven core screens from `IMPLEMENTATION_PLAN.md` are:

1. Project list screen.
2. Project creation screen.
3. Photo upload screen.
4. Photo management screen.
5. Emotion selection screen.
6. Storyboard editing screen.
7. Generated image comparison screen.

Repository terms used in this plan:

`apps/web/src/app/page.tsx` is the current top-level Next.js route for `/`. It is the minimal place to build the single-page clickable mock unless the implementation becomes too large.

`Project` in this mock means an in-memory item with a title, customer-facing occasion, updated time, photo count, and storyboard progress. It is not the future domain entity from `packages/domain`.

`Photo` in this mock means a browser-selected file preview or static placeholder item used to simulate upload and review. It is not stored in the backend and has no storage key.

`Scene` in this mock means one storyboard row or panel with editable text, selected photos, and generated image candidates. It is not persisted and has no generation request record.

`Generated image candidate` in this mock means a static visual placeholder associated with a scene. It should let the user compare options and mark one as adopted, but it must not call any image generation service.

## Plan of Work

First, replace the Phase 0 placeholder route in `apps/web/src/app/page.tsx` with a Server Component that renders a dedicated client component for the interactive mock. Add `"use client"` at the top of that client component because it will own React state, file input handling, and browser APIs such as `URL.createObjectURL`. If the client component becomes hard to read, split only the necessary local components into files under `apps/web/src/components/`. Keep the implementation inside `apps/web`; do not modify `apps/api` or `packages/*`.

Second, create a compact navigation model for the seven screens. Use an in-page stepper or sidebar so the reviewer can jump between screens while still supporting the intended forward flow. The UI should make the current project, selected photos, storyboard scenes, and generated comparison state visible enough to evaluate the workflow.

Third, implement the project list and project creation screens with mock data. The project list should show at least two sample projects plus a path to create a new one. Creating a project should update in-memory state and advance to photo upload.

Fourth, implement local photo selection and preview. Use a normal file input with image MIME acceptance. Use `URL.createObjectURL` for browser previews and clean up object URLs when they are replaced or removed. This proves the mock can exercise real local selection without uploading files.

Fifth, implement photo management, emotion selection, and storyboard editing. Photo management should let a reviewer mark or categorize selected photos using mock status controls. Emotion selection should offer a small set of story tones. Storyboard editing should show editable scene titles or prompts, ordering, primary photo assignment, and simple validation such as requiring at least one scene.

Sixth, implement generated image comparison. Use static styled placeholders or simple CSS-backed panels for candidates. The user should be able to choose an adopted candidate per scene and see the selected state clearly. Do not use AI-generated assets, external image URLs, or generated files for this milestone unless a later design decision explicitly adds visual assets.

Seventh, keep styling local and maintainable. The app should be desktop-first and usable at tablet widths. Use stable dimensions for repeated cards, controls, preview grids, and storyboard rows so labels and dynamic content do not shift the layout unexpectedly. Keep the visual style restrained and workflow-oriented.

Finally, run the repository verification commands. Update this ExecPlan with command results, manual verification notes, and any decisions made during implementation.

## Concrete Steps

Run all commands from `/Users/ran/my-app/gen-story` unless a step explicitly names another working directory.

Inspect the current web app before editing:

    sed -n '1,220p' apps/web/src/app/page.tsx
    sed -n '1,220p' apps/web/src/app/layout.tsx
    sed -n '1,220p' apps/web/package.json

Implement the clickable mock in the web app:

    apps/web/src/app/page.tsx
    apps/web/src/components/mock-flow/MockFlowClient.tsx

If the page becomes too large for readable maintenance, add narrowly scoped component or data files, for example:

    apps/web/src/app/mock-data.ts
    apps/web/src/components/mock-flow/ProjectListScreen.tsx
    apps/web/src/components/mock-flow/ProjectCreationScreen.tsx
    apps/web/src/components/mock-flow/PhotoUploadScreen.tsx
    apps/web/src/components/mock-flow/PhotoManagementScreen.tsx
    apps/web/src/components/mock-flow/EmotionSelectionScreen.tsx
    apps/web/src/components/mock-flow/StoryboardEditorScreen.tsx
    apps/web/src/components/mock-flow/GeneratedComparisonScreen.tsx

Use only the files that are necessary. A single `page.tsx` plus a small local stylesheet is acceptable if it remains readable.

Run focused checks after the first working draft:

    pnpm --filter @gen-story/web typecheck
    pnpm --filter @gen-story/web lint
    pnpm --filter @gen-story/web test

Run workspace checks before completing the milestone:

    pnpm format
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build

Start the web app for manual verification:

    pnpm dev:web

Open or request the local page:

    http://localhost:3000

If command-line verification is needed while the dev server is running, use:

    curl -s -i http://localhost:3000

Expected observable result: HTTP 200 and HTML for the Gen Story mock app.

## Validation and Acceptance

This milestone is accepted only when the following behavior is observable in the browser at `http://localhost:3000`:

The project list screen is visible from the first page and shows mock project records plus a create-project action.

The user can create or select a project and reach the photo upload screen.

The photo upload screen accepts local image files and shows browser previews without uploading files or calling the API.

The photo management screen shows selected photos and lets the user adjust mock usage state.

The emotion selection screen lets the user choose one story tone or emotion and move forward.

The storyboard editing screen shows scenes with editable text and photo assignment controls.

The generated image comparison screen shows mock candidates per scene and lets the user mark one candidate as adopted.

The seven core screens are reachable through clickable navigation.

The mocked flow can be completed from photo selection to generated image comparison without a database, real API call, authentication flow, image preprocessing, or image generation.

The layout remains usable on desktop and tablet-width viewports. A practical manual check is browser widths around 1440px and 768px.

The repository checks pass:

    pnpm format
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build

The architecture boundary check remains clean:

    rg "from ['\\\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application

Expected result: no matches. The command may exit with code 1 when there are no matches.

## Idempotence and Recovery

This milestone is safe to resume because it edits frontend source files and stores no external state. Re-running typecheck, lint, tests, build, and the dev server is safe.

Creating mock projects, selecting files, editing scenes, and adopting generated image candidates affect only in-memory browser state. Refreshing the page should reset the mock, which is acceptable for this phase.

If a selected photo preview stops rendering, remove the file from mock state and select it again. If object URLs are used, ensure cleanup runs when previews are removed or when the component unmounts.

If `pnpm dev:web` cannot bind port `3000`, stop the existing process or temporarily run the Next.js app on another port:

    cd apps/web && pnpm exec next dev --port 3001

Record `http://localhost:3001` or any other alternate URL in this plan if it is used for verification.

If `pnpm build` fails because browser-only APIs are being used during server rendering, move those APIs back inside `apps/web/src/components/mock-flow/MockFlowClient.tsx` or another file with `"use client"` at the top.

## Artifacts and Notes

The completed Phase 0 plan is `docs/plans/20260330-setup-development-environment.md`. It records that `pnpm install`, `pnpm format`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm dev:api`, and `pnpm dev:web` were verified for the baseline.

Current Phase 0 web page before this milestone:

    export default function HomePage() {
      return (
        <main style={{ fontFamily: "system-ui, sans-serif", padding: "48px" }}>
          <h1>Gen Story</h1>
          <p>Phase 0 development baseline is running.</p>
        </main>
      );
    }

Update this section with concise command results and any important screenshots or manual verification notes after implementation.

Implemented artifacts:

    apps/web/src/app/layout.tsx
    apps/web/src/app/page.tsx
    apps/web/src/components/mock-flow/MockFlowClient.tsx
    apps/web/src/components/mock-flow/MockFlowClient.module.css

Manual verification note: `http://localhost:3000` responds with HTTP 200 and server-rendered HTML for the project list screen. The running dev server logs `GET / 200`.

## Interfaces and Dependencies

This milestone depends on the existing Next.js and React setup in `apps/web`.

No new backend interfaces are required. `apps/api` should remain unchanged.

No new package-level interfaces are required. `packages/domain`, `packages/application`, and `packages/shared` should remain unchanged unless implementation-time discovery reveals a direct need, which must be recorded in `Decision Log`.

No external services are required. The mock must not call OpenAI, WorkOS, GCP, AWS, database services, object storage, or the local API.

Browser APIs used for file previews may include `File`, `FileList`, and `URL.createObjectURL`. These must be used only in client-side interaction code.
