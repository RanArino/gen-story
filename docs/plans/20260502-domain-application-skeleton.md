# Build Domain And Application Skeleton

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.

## Purpose / Big Picture

Define the core `gen-story` domain model and application use case boundaries before adding SQLite, Drizzle, REST APIs, local file storage, authentication adapters, or image generation infrastructure. After this work, the repository should have tested TypeScript domain rules for projects, photo assets, storyboards, scenes, style presets, generation requests, and generated images, plus application-layer use cases that can run against in-memory test doubles.

This is the next milestone after the completed Phase 1 clickable UI mock plans:

    docs/plans/20260501-clickable-ui-mock.md
    docs/plans/20260501-refine-clickable-ui-mock-review.md

The result is not a user-visible UI change. The observable outcome is that domain and application tests prove the rules needed by the reviewed mock flow, while the existing architecture boundary check confirms that `packages/domain` and `packages/application` remain independent from frameworks, databases, SDKs, HTTP servers, and app code.

## Progress

- [x] (2026-05-02 06:45Z) Read `IMPLEMENTATION_PLAN.md`, `REQUIREMENTS_INIT.md`, `/Users/ran/my-app/PLANS.md`, and the two completed clickable UI mock ExecPlans.
- [x] (2026-05-02 06:45Z) Inspected the current `packages/domain` and `packages/application` baseline.
- [x] (2026-05-02 06:45Z) Created this ExecPlan for Phase 2 / Domain And Application Skeleton.
- [x] (2026-05-02 07:10Z) Replaced the placeholder domain model with explicit entities, value types, state unions, and pure transition helpers.
- [x] (2026-05-02 07:10Z) Added domain unit tests for scene ordering, photo usage, primary photo assignment, generated image adoption, and generation request state transitions.
- [x] (2026-05-02 07:10Z) Added application ports for repositories, storage, preprocessing, generation, queueing, progress events, and auth context.
- [x] (2026-05-02 07:10Z) Added application use cases with in-memory test doubles for the Phase 1 workflow boundaries.
- [x] (2026-05-02 07:15Z) Ran focused domain and application checks.
- [x] (2026-05-02 07:20Z) Ran workspace verification: `pnpm format`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and the architecture boundary check.

## Surprises & Discoveries

- Observation: The current domain package started as a Phase 0 placeholder, so the phase needed a full replacement rather than an incremental extension.
  Evidence: The baseline `packages/domain/src/index.ts` only exported `ProjectId`, `ProjectSummary`, and `createProjectSummary` before implementation.

- Observation: The current application package was also a placeholder and needed explicit ports plus orchestration tests.
  Evidence: The baseline `packages/application/src/index.ts` only wrapped `createProjectSummary` in a `createProject` function and had no use case tests.

- Observation: The next implementation sequence step is explicitly domain and application skeleton work, while the later initial milestone M2 includes persistence and API integration.
  Evidence: `IMPLEMENTATION_PLAN.md` lists Phase 2 as `Domain And Application Skeleton`, then Phase 3 as `SQLite And Drizzle Persistence`, and later summarizes M2 as persisted workspace functionality.

- Observation: The workspace verification passed after the phase implementation without introducing forbidden framework or SDK imports into `packages/domain` or `packages/application`.
  Evidence: `pnpm format`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` completed successfully; `rg "from ['\\\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application` returned no matches.

## Decision Log

- Decision: Scope this plan to Phase 2 only, not all of M2.
  Rationale: `IMPLEMENTATION_PLAN.md` says to define the core model and use case boundaries before wiring infrastructure. Mixing Drizzle, REST APIs, local auth, and UI integration into this plan would make the first post-mock step too large and would weaken the architecture boundary checks.
  Date/Author: 2026-05-02 / Codex

- Decision: Keep `packages/domain` dependency-free and implement rules with plain TypeScript types and pure functions.
  Rationale: `REQUIREMENTS_INIT.md` requires Domain to avoid DB, ORM, HTTP, OpenAI SDK, Next.js, Zod, cloud SDKs, and app dependencies. Plain TypeScript makes invariants easy to test before persistence exists.
  Date/Author: 2026-05-02 / Codex

- Decision: Keep `packages/application` dependent only on `@gen-story/domain` and local port interfaces.
  Rationale: Application use cases should express orchestration and persistence contracts without choosing Drizzle, filesystem storage, OpenAI, WorkOS, or a queue implementation.
  Date/Author: 2026-05-02 / Codex

- Decision: Do not modify `apps/web` in this milestone.
  Rationale: The reviewed mock UI already validates the flow. This milestone defines the model and use cases that later API and persistence work will connect to the UI.
  Date/Author: 2026-05-02 / Codex

- Decision: Use in-memory repositories and mock adapters only in tests.
  Rationale: Phase 2 needs executable use case tests, but real storage, database adapters, image preprocessing, auth providers, and image generation providers belong to later phases.
  Date/Author: 2026-05-02 / Codex

- Decision: Treat failed generation requests as retryable by creating a new queued request derived from the failed one.
  Rationale: This keeps the original failure record intact for debugging while giving the application layer a clean retry path for later queue adapters.
  Date/Author: 2026-05-02 / Codex

## Outcomes & Retrospective

Phase 2 is complete. The repository now has a dependency-free domain model, pure domain rules, application ports, and application use cases backed by in-memory tests.

Final implementation files:

    packages/domain/src/model.ts
    packages/domain/src/rules.ts
    packages/domain/src/index.ts
    packages/domain/src/model.test.ts
    packages/domain/src/rules.test.ts
    packages/application/src/ports.ts
    packages/application/src/use-cases.ts
    packages/application/src/index.ts
    packages/application/src/use-cases.test.ts

Verification completed successfully:

    pnpm --filter @gen-story/domain typecheck
    pnpm --filter @gen-story/domain lint
    pnpm --filter @gen-story/domain test
    pnpm --filter @gen-story/application typecheck
    pnpm --filter @gen-story/application lint
    pnpm --filter @gen-story/application test
    pnpm format
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build
    rg "from ['\\\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application

No remaining gaps are known for this phase. Phase 3 can now build on the exported vocabulary and port contracts without needing to reinterpret the domain model.

## Context and Orientation

`gen-story` is a local web application for creating emotional, cinematic storyboards and generated image sets from user photos. Phase 0 established a pnpm TypeScript monorepo. Phase 1 built and refined a clickable frontend mock in `apps/web` with browser-only state.

The next roadmap step is Phase 2 from `IMPLEMENTATION_PLAN.md`: define the Domain and Application skeleton before infrastructure. The relevant packages already exist:

    packages/domain
    packages/application
    packages/shared

`packages/domain` should contain the business concepts and invariants. It must not import Next.js, Drizzle, OpenAI SDKs, WorkOS SDKs, Zod, HTTP frameworks, cloud SDKs, filesystem APIs, or app code.

`packages/application` should contain use cases and port interfaces. It may depend on `packages/domain`, but it must not depend on UI frameworks, Drizzle, OpenAI SDKs, WorkOS SDKs, cloud SDKs, HTTP frameworks, or app code.

Repository terms for this milestone:

`Project` is the workspace owned by a user and organization. It groups photos, storyboard state, style selection, and generation work.

`PhotoAsset` is a registered photo record. It stores metadata and storage keys in later phases, but this milestone only defines the shape and curation rules.

`Storyboard` is the project-level story plan. It has a status, selected tone, selected style preset, and ordered scenes.

`Scene` is one storyboard unit with title, description, image prompt, delivered emotion, camera/framing direction, lighting/color direction, motion direction, and user-facing notes.

`ScenePhotoAsset` is the relationship between a scene and a photo. A scene can have at most one `primary` photo and multiple `reference` photos.

`StylePreset` describes system or user-defined image style settings. System presets are not directly editable.

`GenerationRequest` is the source of truth for queued/running/succeeded/failed/canceled generation work.

`GeneratedImage` is one generated image result. A scene should have at most one adopted generated image at a time.

`Port` means an application-layer interface implemented later by adapters, such as repositories, object storage, image preprocessing, image generation, job queueing, progress events, and auth context.

## Plan of Work

First, replace the placeholder domain exports with a minimal but complete Phase 2 model. Keep implementation in `packages/domain/src` and avoid external dependencies. Prefer a small number of files that are easy to review, such as `model.ts`, `rules.ts`, and `index.ts`, instead of a deep folder tree. Use explicit string union types for states and roles so future database schemas can map to them directly.

Second, encode the required invariants as pure functions. The domain should validate non-empty names/titles, keep scene order deterministic, enforce one primary photo per scene, compute photo usage from scene relationships where needed, enforce one adopted generated image per scene, protect direct editing of system style presets, and restrict generation request state transitions.

Third, add domain tests. Tests should cover the rules named in `IMPLEMENTATION_PLAN.md` and `REQUIREMENTS_INIT.md`: scene ordering, photo curation and scene photo roles, one primary photo per scene, one adopted image per scene, generation request state transitions, system style preset edit protection, and the fact that a failed generation request does not directly fail a storyboard.

Fourth, define application ports in `packages/application/src`. Repository ports should cover the core records needed by this phase: users, organizations, projects, photo assets, storyboards, scenes, style presets, generation requests, and generated images. External capability ports should include `ObjectStoragePort`, `ImagePreprocessingPort`, `ImageGenerationPort`, `JobQueuePort`, `ProgressEventPort`, and `AuthContextPort`. Keep these as TypeScript interfaces only.

Fifth, implement narrow application use cases that match the roadmap without infrastructure. The initial use cases should create projects, register photo assets, update photo curation, create or update storyboards, create or update scenes, assign photos to scenes, create generation requests, mark generated images as adopted, and retry failed generation requests. Each use case should accept dependencies through ports and return explicit domain objects or simple result types.

Sixth, add application tests using in-memory repositories and mock adapters. These tests should prove orchestration behavior without SQLite, files, API routes, auth providers, queues, or OpenAI calls. Keep test doubles local to test files unless they become clearly reusable.

Finally, update this ExecPlan with command results, discoveries, decisions, and any changes to the planned Phase 3 persistence work.

## Concrete Steps

Run all commands from `/Users/ran/my-app/gen-story` unless a step explicitly names another directory.

Inspect the current package state before editing:

    sed -n '1,220p' packages/domain/src/index.ts
    sed -n '1,220p' packages/domain/src/index.test.ts
    sed -n '1,220p' packages/domain/package.json
    sed -n '1,220p' packages/application/src/index.ts
    sed -n '1,220p' packages/application/package.json
    sed -n '1,220p' packages/application/tsconfig.json

Implement the domain skeleton in a small set of files. A reasonable default file set is:

    packages/domain/src/model.ts
    packages/domain/src/rules.ts
    packages/domain/src/index.ts
    packages/domain/src/model.test.ts
    packages/domain/src/rules.test.ts

If the model remains small enough, `packages/domain/src/index.test.ts` may be reused instead of adding multiple test files. Do not create a deep entity-per-file hierarchy unless the implementation becomes difficult to read.

Implement the application skeleton in a small set of files. A reasonable default file set is:

    packages/application/src/ports.ts
    packages/application/src/use-cases.ts
    packages/application/src/index.ts
    packages/application/src/use-cases.test.ts

Keep in-memory repositories and mock adapters in `packages/application/src/use-cases.test.ts` unless there is a clear need to share them across tests.

Run focused checks after the first domain draft:

    pnpm --filter @gen-story/domain typecheck
    pnpm --filter @gen-story/domain lint
    pnpm --filter @gen-story/domain test

Run focused checks after the first application draft:

    pnpm --filter @gen-story/application typecheck
    pnpm --filter @gen-story/application lint
    pnpm --filter @gen-story/application test

Run the full workspace verification before completing the milestone:

    pnpm format
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build

Run the architecture boundary check:

    rg "from ['\\\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application

Expected result: no matches. Exit code `1` is acceptable when there are no matches.

## Validation and Acceptance

This milestone is accepted when automated tests demonstrate the Phase 2 domain and application behavior.

Domain acceptance:

`Project`, `PhotoAsset`, `Storyboard`, `Scene`, `StylePreset`, `GenerationRequest`, `GeneratedImage`, minimal `User`, and minimal `Organization` are exported from `@gen-story/domain`.

Scene ordering is deterministic and can be restored by `orderIndex`.

A scene can have multiple reference photos but at most one primary photo.

Photo usage can represent candidate, excluded, and reference curation at the photo level, while scene-level usage can distinguish primary and reference relationships.

Only one generated image can be adopted for a scene at a time.

Generation requests support only valid transitions among `queued`, `running`, `succeeded`, `failed`, and `canceled`.

A failed `GenerationRequest` does not mutate or imply a failed `Storyboard`; storyboard status remains its own editing lifecycle.

System `StylePreset` records cannot be directly edited through domain rules.

Application acceptance:

Use cases exist for creating projects, registering photo assets, updating photo curation, creating/updating storyboards, creating/updating scenes, assigning photos to scenes, creating generation requests, marking generated images as adopted, and retrying failed generation requests.

Application tests pass with in-memory repositories and mock adapters only.

Repository and external service ports are explicit and contain no Drizzle, Next.js, OpenAI, WorkOS, HTTP framework, cloud SDK, or filesystem-specific types.

Workspace acceptance:

All required checks pass:

    pnpm format
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build

The architecture boundary check returns no matches for forbidden framework, SDK, ORM, cloud, HTTP, validation, or app imports in `packages/domain` and `packages/application`.

## Idempotence and Recovery

This milestone is safe to resume because it only edits TypeScript source and tests in `packages/domain`, `packages/application`, and this plan document. Re-running tests, typecheck, lint, format, and build is safe.

If model names or state unions need adjustment during implementation, update tests and this ExecPlan together so future persistence work has the correct vocabulary.

If a use case starts to require database transactions, file paths, OpenAI request shapes, WorkOS users, or HTTP request objects, stop and move that concern behind a port interface. Do not import infrastructure into Domain or Application to make a test pass.

If the implementation becomes too large, split the milestone by keeping only Domain entities and invariants in this plan, then create a follow-up Application use case ExecPlan. Record that decision in the Decision Log before changing scope.

## Artifacts and Notes

The completed Phase 1 UI mock plans are:

    docs/plans/20260501-clickable-ui-mock.md
    docs/plans/20260501-refine-clickable-ui-mock-review.md

The completed Phase 1 mock implementation currently lives in:

    apps/web/src/app/page.tsx
    apps/web/src/components/mock-flow/MockFlowClient.tsx
    apps/web/src/components/mock-flow/MockFlowClient.module.css

This Phase 2 plan intentionally does not modify the mock UI. The mock is useful context because it names the workflow, but Domain and Application behavior should be validated through package tests.

Current baseline before implementation:

    packages/domain/src/index.ts
    packages/domain/src/index.test.ts
    packages/application/src/index.ts

These files contain only placeholder project summary behavior. Replace or evolve them during implementation; do not preserve placeholder APIs unless they remain useful under the real model.

## Interfaces and Dependencies

This milestone depends on the existing TypeScript, Vitest, ESLint, and pnpm workspace setup.

No new runtime or dev dependencies are planned. If implementation discovers a strong need for a dependency, record the decision first. Domain should remain dependency-free.

No backend API, database schema, Drizzle migration, local file storage adapter, image preprocessing adapter, real image generation adapter, auth adapter, or web UI integration is part of this milestone.

The application ports created in this milestone are contracts for future adapters. Later phases will implement those ports with SQLite/Drizzle repositories, local object storage, HEIC preprocessing, local/test auth, job queueing, progress events, and OpenAI image generation.
