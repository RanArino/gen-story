# Connect REST API Routes And Local Authentication

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.

## Purpose / Big Picture

Connect the local web UI to persisted project data through explicit REST APIs, and make every API request run as a fixed local user and organization without requiring WorkOS. After this work, a developer can start the API, create and read projects, upload/register photos, edit storyboard and scene data, create generation requests, and adopt generated images through HTTP requests backed by SQLite and local file storage.

This is Phase 5 from `IMPLEMENTATION_PLAN.md`: REST API And Local Authentication. It comes after Phase 3 SQLite persistence and Phase 4 local file storage/image preprocessing. It does not add production authentication, external deployment, production WorkOS login, image-generation workers, or UI replacement work. Those remain later phases.

The observable user-facing outcome is that the mock UI has real API contracts available for Phase 7 integration, and local automated tests can exercise those contracts without secrets, browser login, or external services.

## Progress

- [x] (2026-05-04 02:59Z) Read `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, `REQUIREMENTS_INIT.md`, `/Users/ran/my-app/PLANS.md`, and the completed Phase 3 and Phase 4 ExecPlans.
- [x] (2026-05-04 02:59Z) Inspected the current API server, application ports and use cases, SQLite repositories, Phase 4 ingestion service, package manifests, and existing shared DTO package.
- [x] (2026-05-04 02:59Z) Created this ExecPlan for Phase 5 / REST API And Local Authentication.
- [ ] Add shared REST DTO types and API-boundary Zod schemas.
- [ ] Add local auth principal seeding and request-scoped auth context.
- [ ] Add API composition helpers that wire SQLite repositories, local object storage, image preprocessing, local auth, no-op progress events, and a deterministic local job queue.
- [ ] Add REST routes for projects, photo assets, storyboards, scenes, style presets, generation requests, and generated images.
- [ ] Add API integration tests for validation, auth scoping, DTO shape, and main write/read flows.
- [ ] Run focused API/shared checks, workspace checks, and the architecture boundary check.

## Surprises & Discoveries

- Observation: The API server currently uses only Node's built-in `node:http` module and exposes only `GET /health`.
  Evidence: `apps/api/src/server.ts` defines `handleRequest` with a health route and a JSON 404 fallback.

- Observation: `packages/shared` currently exports only `ApiHealthDto`, so Phase 5 can introduce REST DTOs without migrating existing contracts.
  Evidence: `packages/shared/src/index.ts` contains only the health DTO export.

- Observation: The application layer already has an `AuthContextPort`, but the existing use cases accept user and organization IDs as explicit inputs and do not currently call the auth port.
  Evidence: `packages/application/src/ports.ts` defines `AuthContextPort`, while `createProjectUseCase` accepts `organizationId` and `ownerUserId` in its input.

- Observation: Listing APIs need a small read-side expansion because the current `ProjectRepositoryPort` has `findById` and `save`, but no organization-scoped project listing method.
  Evidence: `packages/application/src/ports.ts` defines `ProjectRepositoryPort` with only `findById` and `save`.

- Observation: Phase 4 deliberately stopped before REST routing and left an API-local `PhotoAssetIngestionService` ready for this phase to call.
  Evidence: `docs/plans/20260502-local-file-storage-image-preprocessing.md` records the decision to add ingestion without REST routes because Phase 5 owns API wiring.

## Decision Log

- Decision: Keep the first REST implementation on the current `node:http` server rather than introducing Express, Fastify, Hono, or Next.js API routes.
  Rationale: The current server is small and sufficient for the Phase 5 contract surface. Avoiding an HTTP framework preserves the existing dependency footprint and keeps HTTP framework imports out of `packages/domain` and `packages/application`.
  Date/Author: 2026-05-04 / Codex

- Decision: Use Zod only inside `apps/api` for request validation, and export TypeScript DTO types from `packages/shared` only when they are useful to both API and web.
  Rationale: `IMPLEMENTATION_PLAN.md` requires Zod request validation at the API boundary, while `AGENTS.md` forbids Zod in `packages/domain` and keeps shared packages narrow. API-local schemas avoid turning `packages/shared` into a validation dumping ground.
  Date/Author: 2026-05-04 / Codex

- Decision: Represent local authentication as a fixed seeded principal with IDs `local-user-1` and `local-org-1`.
  Rationale: The phase requires automated tests to run without WorkOS while preserving the future adapter shape. A stable local principal makes API behavior deterministic and lets route handlers derive ownership instead of trusting client-supplied user or organization IDs.
  Date/Author: 2026-05-04 / Codex

- Decision: Do not accept `ownerUserId` or `organizationId` in client project-create requests.
  Rationale: Those values are authentication context, not client-controlled request data. The API route should derive them from the current local principal and pass them to the existing application use case.
  Date/Author: 2026-05-04 / Codex

- Decision: Use a JSON base64 upload contract for the first local photo upload route instead of multipart parsing.
  Rationale: The current API server has no framework or multipart parser. For a local Phase 5 REST contract, `{ name, mimeType, contentBase64, notes, usage }` is explicit, testable, and enough for the web app to send local `File` bytes. Multipart can be added later if real browser ergonomics or file-size limits require it.
  Date/Author: 2026-05-04 / Codex

- Decision: Keep generation execution out of Phase 5.
  Rationale: Phase 6 owns image-generation jobs. Phase 5 should create generation requests, persist queued state, and expose request/image read/adoption routes, but it should not run real OpenAI generation or a worker.
  Date/Author: 2026-05-04 / Codex

## Outcomes & Retrospective

This section is intentionally empty until implementation starts. Update it after each milestone with the routes added, validation behavior confirmed, tests run, and any remaining gaps.

## Context and Orientation

`gen-story` is a TypeScript monorepo for building emotional storyboard sequences from user photos. The current package layout is:

    apps/web
    apps/api
    packages/domain
    packages/application
    packages/shared

The relevant current files are:

- `apps/api/src/server.ts`, which starts the local API and currently handles only `GET /health`.
- `apps/api/src/db/client.ts`, which opens the local SQLite database from `GEN_STORY_SQLITE_PATH` or `data/gen-story.sqlite`.
- `apps/api/src/db/repositories.ts`, which maps SQLite rows to domain objects and implements repository ports.
- `apps/api/src/photos/photo-asset-ingestion.ts`, which stores uploaded bytes, generates previews, calculates checksums, and registers `PhotoAsset` records.
- `apps/api/src/storage/local-object-storage.ts`, which maps storage keys to local files without exposing absolute paths through ports.
- `apps/api/src/images/local-image-preprocessing.ts`, which prepares AI input image metadata through storage keys.
- `packages/application/src/use-cases.ts`, which contains create/register/update/upsert/assign/generation/adoption use cases.
- `packages/application/src/ports.ts`, which defines repository ports, `AuthContextPort`, `ObjectStoragePort`, `ImagePreprocessingPort`, `JobQueuePort`, and `ProgressEventPort`.
- `packages/shared/src/index.ts`, which currently contains only the API health DTO.

Important terms for this phase:

- `REST DTO` means an explicit HTTP request or response shape. It is not a Drizzle row, domain entity, SDK response, or framework object.
- `API boundary validation` means validating and parsing untrusted HTTP input in `apps/api` before calling use cases or repositories.
- `Local principal` means the fixed local user and organization used while production auth is out of scope.
- `Auth scoping` means route handlers must verify that a project-scoped resource belongs to the local principal's organization before returning or mutating it.
- `Composition root` means the API-local code that creates repositories, storage adapters, auth context, and use-case dependencies for a request.

## Plan of Work

First, add the API contract vocabulary. Expand `packages/shared/src/index.ts` with small DTO types for projects, photo assets, storyboards, scenes, style presets, generation requests, generated images, and errors. Keep these as plain TypeScript types. Add API-local Zod schemas in `apps/api/src/http/schemas.ts` for request bodies and route parameters. The schemas should parse unknown input into use-case input values and should not be imported by `packages/domain`, `packages/application`, or `packages/shared`.

Second, add the local authentication adapter in `apps/api/src/auth/local-auth.ts`. Define `LOCAL_ORGANIZATION_ID` as `local-org-1`, `LOCAL_USER_ID` as `local-user-1`, and an `ensureLocalPrincipal` function that saves the fixed `Organization` and `User` through repositories if they do not exist. Define a request-scoped auth context that implements `AuthContextPort` and returns the fixed principal. The API server should call the seeding helper during startup and test setup before protected routes run.

Third, add an API composition module in `apps/api/src/app/create-api-context.ts` or a similarly named file. It should open SQLite, create repository adapters, create `LocalObjectStorage`, create `LocalImagePreprocessingAdapter`, create a deterministic local no-op or in-memory `JobQueuePort`, create a no-op `ProgressEventPort`, and expose a function for route handlers to get `ApplicationDependencies`. If keeping a single long-lived SQLite client is simpler for server startup, do that and close it in tests.

Fourth, add a small HTTP layer under `apps/api/src/http`. The layer should include helpers to parse URLs, match route patterns, read JSON request bodies with a bounded maximum size, decode base64 upload bodies, send JSON responses, and map `UseCaseResult` errors to HTTP status codes. Keep the router boring and explicit. Do not introduce framework abstractions beyond what is needed to route Phase 5 endpoints.

Fifth, add route handlers. Route handlers should call application use cases for writes and repository methods for reads. For read endpoints that need lists not currently covered by a port, add narrow repository port methods and SQLite/in-memory implementations rather than querying Drizzle from route handlers. The minimal route surface is:

    GET /health
    GET /api/me
    GET /api/projects
    POST /api/projects
    GET /api/projects/:projectId
    GET /api/projects/:projectId/photo-assets
    POST /api/projects/:projectId/photo-assets
    PATCH /api/photo-assets/:photoAssetId
    GET /api/projects/:projectId/storyboards
    PUT /api/storyboards/:storyboardId
    GET /api/storyboards/:storyboardId/scenes
    PUT /api/storyboards/:storyboardId/scenes
    PUT /api/scenes/:sceneId/photo-assets
    GET /api/style-presets
    GET /api/scenes/:sceneId/generation-requests
    POST /api/scenes/:sceneId/generation-requests
    POST /api/generation-requests/:generationRequestId/retry
    GET /api/scenes/:sceneId/generated-images
    POST /api/scenes/:sceneId/generated-images/:generatedImageId/adopt

The create project route should generate a server-side project ID if the client does not provide one, derive owner and organization from local auth, and return a project DTO. The photo upload route should accept JSON with `name`, `mimeType`, `contentBase64`, optional `notes`, and optional `usage`; it should call `PhotoAssetIngestionService` and return the created photo asset DTO. Storyboard and scene routes should call the existing upsert use cases. Generation request routes should create queued requests only; actual job execution remains Phase 6.

Sixth, add auth scoping and DTO mapping tests. Each project-scoped route should first resolve the project or parent resource and confirm it belongs to the local principal's organization. Tests should prove that route handlers reject invalid JSON, unknown enum values, invalid base64 upload content, resource/project mismatches, and attempts to pass foreign `ownerUserId` or `organizationId`. Response tests should assert that DTOs contain explicit fields and do not include Drizzle-only fields such as `deletedAt`, framework objects, local absolute paths, or SDK responses.

Finally, update docs only if setup or API usage changes. Because adding Zod changes dependencies and REST routes change developer behavior, update `apps/api/package.json`, `packages/shared/package.json` if needed, `README.md` if it exists, and `.env.example` only if a new environment variable is introduced. Do not add WorkOS environment variables in this phase.

## Concrete Steps

Run all commands from `/Users/ran/my-app/gen-story` unless a step explicitly names another working directory.

Inspect the current contracts before editing:

    sed -n '1,220p' apps/api/src/server.ts
    sed -n '1,260p' packages/application/src/ports.ts
    sed -n '1,760p' packages/application/src/use-cases.ts
    sed -n '1,260p' apps/api/src/db/repositories.ts
    sed -n '1,220p' apps/api/src/photos/photo-asset-ingestion.ts
    sed -n '1,220p' packages/shared/src/index.ts

Add the API-boundary validation dependency to the API package:

    pnpm --filter @gen-story/api add zod

Create or update the shared DTO file:

    packages/shared/src/index.ts

Create API-local auth and composition files:

    apps/api/src/auth/local-auth.ts
    apps/api/src/auth/local-auth.test.ts
    apps/api/src/app/create-api-context.ts
    apps/api/src/app/create-api-context.test.ts

Create API-local HTTP helper and route files:

    apps/api/src/http/dto-mappers.ts
    apps/api/src/http/errors.ts
    apps/api/src/http/json.ts
    apps/api/src/http/router.ts
    apps/api/src/http/schemas.ts
    apps/api/src/http/routes.ts
    apps/api/src/http/routes.test.ts

Update the server entrypoint so it composes the API and keeps `GET /health` working:

    apps/api/src/server.ts
    apps/api/src/health.test.ts

Add the minimal read-side repository methods needed by routes, with in-memory and SQLite implementations. Expected additions include organization-scoped project listing and style preset listing:

    packages/application/src/ports.ts
    apps/api/src/db/repositories.ts
    apps/api/src/db/repositories.test.ts
    apps/api/src/test-support/in-memory-application.ts

Run focused checks as each layer is completed:

    pnpm --filter @gen-story/shared typecheck
    pnpm --filter @gen-story/shared test
    pnpm --filter @gen-story/api exec vitest run src/auth/local-auth.test.ts
    pnpm --filter @gen-story/api exec vitest run src/http/routes.test.ts
    pnpm --filter @gen-story/api test

Run static checks for touched packages:

    pnpm --filter @gen-story/shared typecheck
    pnpm --filter @gen-story/api typecheck
    pnpm --filter @gen-story/shared lint
    pnpm --filter @gen-story/api lint

Run workspace verification after the full phase is implemented:

    pnpm format
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build
    rg "from ['\\\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application

Manually smoke-test the API against a temporary or local SQLite database:

    pnpm --filter @gen-story/api db:migrate
    pnpm dev:api
    curl -s http://localhost:4000/health
    curl -s http://localhost:4000/api/me
    curl -s -X POST http://localhost:4000/api/projects -H 'content-type: application/json' -d '{"name":"Local Story"}'
    curl -s http://localhost:4000/api/projects

## Validation and Acceptance

This phase is accepted when REST routes can create, read, and update the persisted Phase 5 resource set through explicit DTOs while local automated tests run without WorkOS.

Validation behavior must be observable:

- Invalid JSON returns HTTP 400 with an explicit API error DTO.
- Invalid route parameters or request body fields return HTTP 400.
- Missing resources return HTTP 404.
- Conflicts from application use cases return HTTP 409.
- Invalid state from application use cases returns HTTP 422.
- Unexpected server failures return HTTP 500 without leaking stack traces in the response body.

Authentication behavior must be observable:

- `GET /api/me` returns the fixed local user and organization.
- The local user and organization are present in SQLite after API context startup.
- `POST /api/projects` creates a project owned by `local-user-1` under `local-org-1`.
- Client-supplied `ownerUserId` or `organizationId` is ignored or rejected by schemas; it never controls ownership.
- Automated tests do not require WorkOS environment variables or browser login.

REST contract behavior must be observable:

- API responses are DTOs with explicit fields.
- API responses do not contain Drizzle schema objects, `deletedAt`, absolute local file paths, Node request/response objects, or SDK response objects.
- The project list route returns only active projects for the local organization.
- Photo upload writes an original and preview through storage keys and returns a `PhotoAsset` DTO.
- Storyboard upsert persists and can be read back.
- Scene upsert persists ordered scenes and can be read back in `orderIndex` order.
- Scene photo assignment persists primary/reference assignments and rejects cross-project photo IDs.
- Generation request creation returns a queued request and does not execute real image generation.
- Generated image adoption switches the adopted image for a scene when generated images exist.

The verification commands must pass:

    pnpm --filter @gen-story/shared typecheck
    pnpm --filter @gen-story/api typecheck
    pnpm --filter @gen-story/api test
    pnpm --filter @gen-story/api lint
    pnpm format
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build

The architecture boundary check must return no matches in `packages/domain` and `packages/application`:

    rg "from ['\\\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application

## Idempotence and Recovery

The local principal seeding step must be idempotent. Running server startup or test setup multiple times should update or preserve `local-org-1` and `local-user-1` without creating duplicate rows.

Route tests should use temporary SQLite files and temporary upload roots so repeated runs do not contaminate `data/gen-story.sqlite` or `data/uploads`. If a test fails after writing files, test cleanup should remove the temporary directory.

Request handlers should be safe to retry when the client supplies the same explicit ID and the use case returns a conflict. Server-generated IDs should be unique, but tests may use deterministic IDs where conflict behavior is being asserted.

If adding list methods to application repository ports becomes too broad, keep the change limited to read methods needed by current routes. Do not add generic query builders, pagination, filtering, or search until a route needs them.

If base64 JSON uploads become too large for practical manual testing, add a bounded body-size error and record the limitation. Do not switch to multipart in the middle of this phase unless the JSON contract cannot satisfy Phase 5 acceptance.

If the `better-sqlite3` native binding is missing again, rebuild or reinstall dependencies according to the repo setup instead of changing database code. Record the exact failure and verification gap in `Outcomes & Retrospective`.

## Artifacts and Notes

Expected new or changed files include:

    packages/shared/src/index.ts
    packages/application/src/ports.ts
    apps/api/package.json
    apps/api/src/server.ts
    apps/api/src/auth/local-auth.ts
    apps/api/src/app/create-api-context.ts
    apps/api/src/http/dto-mappers.ts
    apps/api/src/http/errors.ts
    apps/api/src/http/json.ts
    apps/api/src/http/router.ts
    apps/api/src/http/schemas.ts
    apps/api/src/http/routes.ts
    apps/api/src/http/*.test.ts
    apps/api/src/db/repositories.ts
    apps/api/src/test-support/in-memory-application.ts

Expected route response examples should be captured here during implementation after tests confirm the final DTO shapes.

## Interfaces and Dependencies

The only new dependency expected for this phase is:

- `zod` in `apps/api`, for API-boundary request validation.

Existing interfaces and modules used by this phase:

- `AuthContextPort` in `packages/application/src/ports.ts`, for the future-compatible authentication adapter shape.
- Repository ports in `packages/application/src/ports.ts`, for use-case writes and route read models.
- Use cases in `packages/application/src/use-cases.ts`, for project creation, photo curation, storyboard upsert, scene upsert, scene photo assignment, generation request creation/retry, and generated image adoption.
- `PhotoAssetIngestionService` in `apps/api/src/photos/photo-asset-ingestion.ts`, for JSON base64 photo upload handling.
- `LocalObjectStorage` in `apps/api/src/storage/local-object-storage.ts`, for original and preview file storage.
- `LocalImagePreprocessingAdapter` in `apps/api/src/images/local-image-preprocessing.ts`, for generation request preprocessing.
- SQLite repositories in `apps/api/src/db/repositories.ts`, for persisted reads and writes.

Interfaces intentionally not introduced in this phase:

- WorkOS SDK types or production login callbacks.
- OpenAI SDK types or real image generation execution.
- Cloud SDKs, external queues, billing, SNS publishing, video generation, or BGM generation.
