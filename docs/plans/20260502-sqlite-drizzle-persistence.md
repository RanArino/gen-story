# Wire SQLite And Drizzle Persistence To Ports

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.


## Purpose / Big Picture

Persist the Phase 2 domain model in local SQLite using Drizzle, then wire repository adapters in the API app to the application ports that already exist. After this work, the repository should be able to create, read, update, soft-delete, and restore the core Phase 2 records through SQLite-backed adapters, and the schema should be reproducible from migration files on a clean machine.

This is Phase 3 from `IMPLEMENTATION_PLAN.md`: SQLite And Drizzle Persistence. It comes after the completed Phase 2 domain/application skeleton and before REST routing, local file storage, authentication adapters, or image-generation job execution. The user-visible outcome is not a new UI screen; the observable outcome is that repository tests and migration checks prove the model can survive a real database boundary.


## Progress

- [x] (2026-05-02 07:25Z) Read `IMPLEMENTATION_PLAN.md`, `REQUIREMENTS_INIT.md`, `/Users/ran/my-app/PLANS.md`, and the completed Phase 2 ExecPlan.
- [x] (2026-05-02 07:25Z) Inspected the current workspace layout, package manifests, and API server entrypoint to choose the smallest adapter home for persistence work.
- [x] (2026-05-02 07:25Z) Created this ExecPlan for Phase 3 / SQLite And Drizzle Persistence.
- [ ] Add Drizzle schema, SQLite client setup, and migration scripts in the API app.
- [ ] Implement SQLite-backed repository adapters for the Phase 2 entities.
- [ ] Add integration tests that run migrations against a clean SQLite database and prove the persistence rules.
- [ ] Run the focused API/package checks and the workspace verification commands, then record the results here.


## Surprises & Discoveries

- Observation: The repository still has no dedicated infrastructure package, so the narrowest place to host the first persistence adapters is the API app itself.
  Evidence: `rg --files apps packages | sort` shows `apps/api`, `apps/web`, `packages/application`, `packages/domain`, and `packages/shared`, but no `packages/infrastructure`.

- Observation: The Phase 2 domain/application skeleton already exports the core vocabulary needed for persistence, but it does not yet expose `Membership`.
  Evidence: `packages/domain/src/index.ts` exports `Project`, `PhotoAsset`, `Storyboard`, `Scene`, `StylePreset`, `GenerationRequest`, `GeneratedImage`, `User`, and `Organization`, while `REQUIREMENTS_INIT.md` still lists `Membership` among the initial save targets.

- Observation: The requirements document is explicit about SQLite-specific persistence details that matter for this phase, including `deletedAt`, `storageKey`, checksum metadata, Drizzle Kit migrations, and transactional adoption switching.
  Evidence: `REQUIREMENTS_INIT.md` sections for storyboard/scene design, photo asset design, generation requests, and file storage all name those fields and behaviors directly.


## Decision Log

- Decision: Scope this plan to persistence adapters and schema/migration work only, not REST routes or UI wiring.
  Rationale: `IMPLEMENTATION_PLAN.md` places REST APIs and local authentication in Phase 5. Keeping Phase 3 focused on database persistence keeps the work small, testable, and aligned with the roadmap.
  Date/Author: 2026-05-02 / Codex

- Decision: Host the first Drizzle schema and SQLite repository adapters in `apps/api/src/db` rather than creating a new infrastructure package.
  Rationale: There is no `packages/infrastructure` yet, and the API app is already the runtime entrypoint that will eventually own the adapter composition root. Keeping the code next to `apps/api` avoids adding a new package boundary before it is necessary.
  Date/Author: 2026-05-02 / Codex

- Decision: Use `better-sqlite3` as the local SQLite driver for Drizzle.
  Rationale: It is the simplest synchronous local driver for Node, matches the current `tsx`-based API startup, and keeps the first repository implementation straightforward.
  Date/Author: 2026-05-02 / Codex

- Decision: Use SQLite partial unique indexes plus transactional repository methods to enforce single-primary and single-adopted-image rules where possible.
  Rationale: SQLite supports partial indexes, so the database can enforce the main invariants directly while the repository handles atomic switch logic for adoption and primary-photo replacement.
  Date/Author: 2026-05-02 / Codex

- Decision: Defer `Membership` persistence until the auth phase unless a later adapter bootstrap proves it is required earlier.
  Rationale: The current Phase 2 ports do not expose `Membership`, so adding a schema-only table now would not be exercised by the existing use cases. The auth phase is the first place where membership becomes behaviorally meaningful.
  Date/Author: 2026-05-02 / Codex


## Outcomes & Retrospective

This section will be filled in after implementation. The intended outcome is a clean SQLite/Drizzle persistence layer that can round-trip the Phase 2 entities, preserve soft-deletion semantics, restore scene ordering, and enforce one-primary/one-adopted-image rules without leaking Drizzle into `packages/domain` or `packages/application`.

When the phase is complete, the repository should have:

- A reproducible Drizzle schema and migration set for the initial persisted entities.
- SQLite-backed repository adapters that satisfy the existing application ports.
- Integration tests proving migration application and the required repository invariants.
- Documentation updates for the local database path and any new database commands or environment variables.


## Context and Orientation

`gen-story` is a local TypeScript monorepo for building emotional storyboard sequences from user photos. Phase 0 set up the workspace, Phase 1 built the clickable mock UI, and Phase 2 defined the domain and application skeleton. The relevant code that already exists is:

- `packages/domain/src/model.ts` and `packages/domain/src/rules.ts`, which define the pure entities and invariants.
- `packages/application/src/ports.ts` and `packages/application/src/use-cases.ts`, which define the repository and capability ports plus orchestration use cases.
- `apps/api/src/server.ts`, which is still only a minimal health-check server.

For this phase, the important terms are:

- `Repository adapter` means the code that translates between Drizzle rows and the domain model behind the application ports.
- `Soft delete` means keeping a `deletedAt` timestamp instead of immediately removing the record.
- `Scene photo asset` means the join between a scene and a photo, with a `primary` or `reference` role.
- `Adopted generated image` means the single generated image chosen as the preferred result for a scene.

The requirements document is stricter than the current implementation in one place: it lists `Membership` among the initial persistence targets. Because the current domain/application vocabulary does not expose it yet, this plan defers that table unless later adapter bootstrap work proves it is needed immediately.


## Plan of Work

First, add the SQLite and Drizzle plumbing in `apps/api`. The API app should own the first persistence boundary because it is already the runtime entrypoint. Add the Drizzle schema in `apps/api/src/db/schema.ts`, a SQLite client wrapper in `apps/api/src/db/client.ts`, and small bootstrap helpers in `apps/api/src/db/index.ts`. Add migration configuration so Drizzle Kit can generate and apply migrations into `drizzle/migrations/`.

Second, define the table layout for the Phase 2 entities. The schema should cover users, organizations, projects, photo assets, storyboards, scenes, scene photo assets, style presets, generation requests, and generated images. The schema should carry the metadata required by the requirements document, including `storageKey`, `mimeType`, `size`, `width`, `height`, `checksum`, `createdAt`, `updatedAt`, and `deletedAt` where the record owns file metadata or soft deletion. Keep `storyboards` and `scenes` as separate tables, keep `scene_photo_assets` as its own join table, and keep `generation_requests` independent from `storyboards` so a failed request does not imply a failed storyboard.

Third, implement repository adapters that satisfy the existing application ports. Keep the adapters narrow and boring: convert domain objects to rows, map rows back to domain objects, and centralize the soft-delete filtering logic in the repository methods. Add transaction-aware methods for scene photo assignment and generated image adoption so that the previous primary or adopted row is cleared before the replacement row is set. Where SQLite can enforce the invariant directly, use a partial unique index instead of duplicating the rule in application code.

Fourth, wire a small database composition root in `apps/api`. The current API server only exposes `/health`; it does not need REST routes yet. The new composition code should simply prove the database can be opened, migrated, and handed to repository adapters without importing Drizzle into `packages/domain` or `packages/application`.

Fifth, add integration tests that use a temporary SQLite database and real migrations. The tests should prove that migrations apply from a blank database, that projects/photos/storyboards/scenes can be created and read back, that scenes are returned in `orderIndex` order, that soft-deleted rows are excluded from normal list queries, that only one `primary` scene-photo row can exist per scene, that only one adopted generated image can exist per scene, and that a failed `GenerationRequest` does not mutate the storyboard lifecycle.

Finally, update the package scripts and documentation so the persistence workflow is repeatable. Add explicit database commands to the API package, record the local database path in the environment example if a new variable is needed, and update `README.md` only if the new workflow changes the developer setup.


## Concrete Steps

Run all commands from `/Users/ran/my-app/gen-story` unless a step explicitly names another working directory.

Inspect the current API and package boundaries before editing:

    sed -n '1,220p' apps/api/src/server.ts
    sed -n '1,220p' apps/api/package.json
    sed -n '1,220p' packages/application/src/ports.ts
    sed -n '1,220p' packages/domain/src/index.ts

Add the SQLite and Drizzle dependencies to the API app, then add database scripts for schema generation and migration:

    pnpm --filter @gen-story/api add drizzle-orm better-sqlite3
    pnpm --filter @gen-story/api add -D drizzle-kit @types/better-sqlite3

Create the schema, client, and adapter files under `apps/api/src/db`, then generate the first migration set:

    pnpm --filter @gen-story/api db:generate
    pnpm --filter @gen-story/api db:migrate

Add repository integration tests under `apps/api/src/db` and run them against a temporary SQLite file:

    pnpm --filter @gen-story/api test

Run the API package checks after the persistence code exists:

    pnpm --filter @gen-story/api typecheck
    pnpm --filter @gen-story/api lint
    pnpm --filter @gen-story/api test

Run the workspace verification once the adapter layer is complete:

    pnpm format
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build
    rg "from ['\\\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application


## Validation and Acceptance

This phase is accepted when a clean local database can be migrated and exercised through repository adapters without breaking the domain or application boundaries.

The persistence layer must prove the following observable behaviors:

- A blank SQLite database can be migrated successfully with the checked-in Drizzle migrations.
- `Project`, `PhotoAsset`, `Storyboard`, `Scene`, `StylePreset`, `GenerationRequest`, and `GeneratedImage` records can be created and retrieved through repository adapters.
- Scene ordering is restored by `orderIndex`.
- Soft-deleted records are excluded from normal list queries.
- A scene can have at most one `primary` photo assignment.
- A scene can have at most one adopted generated image.
- Switching the adopted generated image for a scene is atomic.
- A failed `GenerationRequest` remains a request failure and does not force the related `Storyboard` into a failed lifecycle.

The repository-level verification commands must pass:

    pnpm --filter @gen-story/api typecheck
    pnpm --filter @gen-story/api lint
    pnpm --filter @gen-story/api test
    pnpm format
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build

The boundary check must still return no matches in `packages/domain` and `packages/application` for the forbidden framework and SDK imports:

    rg "from ['\\\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application


## Idempotence and Recovery

Migration generation and migration application should be repeatable. If the schema changes, regenerate the migration set and rerun the clean-database migration test instead of hand-editing migration history.

Repository tests should create temporary SQLite files or directories and delete them after the run, so repeated execution does not contaminate the working tree.

If a repository method proves too coupled to the DB schema, push the mapping logic back into the adapter rather than importing Drizzle into the domain or application packages. If a constraint is easier to express in SQL than in code, prefer the SQL constraint and keep the repository method focused on transactional switching and row mapping.

If the `Membership` requirement becomes unavoidable during implementation, record that decision before adding it so the schema and the application boundary stay aligned.


## Artifacts and Notes

Expected files for this phase include:

    apps/api/src/db/client.ts
    apps/api/src/db/schema.ts
    apps/api/src/db/index.ts
    apps/api/src/db/*.test.ts
    drizzle/migrations/*

Expected documentation or script updates may include:

    apps/api/package.json
    apps/api/.env.example
    README.md

Keep the final note in this section short and factual after implementation: record which tables were added, which invariants are enforced by SQLite versus repository transactions, and which verification commands passed.


## Interfaces and Dependencies

The required dependency set for this phase is intentionally small:

- `drizzle-orm` for the repository implementation and row mapping.
- `drizzle-kit` for schema-driven migration generation and application.
- `better-sqlite3` for the local SQLite driver.
- `@types/better-sqlite3` for TypeScript support if the adapter is written in TypeScript.

The main code interfaces involved are:

- `packages/application/src/ports.ts`, which defines the repository contracts that the adapters must satisfy.
- `packages/domain/src/index.ts`, which defines the entity and rule vocabulary that the adapters must preserve.
- `apps/api/src/server.ts`, which will remain the API entrypoint and eventually compose the database-backed adapters.

No Next.js, OpenAI, WorkOS, cloud SDK, HTTP framework, or filesystem-specific types should leak into `packages/domain` or `packages/application` during this phase.
