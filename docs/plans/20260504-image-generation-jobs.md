# Add Image Generation Jobs

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.


## Purpose / Big Picture


Run image generation as observable asynchronous jobs with full state lifecycle management. After this work, a developer can create a generation request through the Phase 5 REST API, watch it move from `queued` to `running` to `succeeded` or `failed` via the same API, and see generated image files appear on disk under the correct storage keys. A mock generation adapter lets automated tests run without OpenAI credentials; a real OpenAI adapter using `gpt-image-2` allows manual smoke testing. Project-level concurrency is capped at five `running` jobs; a sixth request stays `queued` until a slot opens. Failed scenes can be retried independently.

This is Phase 6 from `IMPLEMENTATION_PLAN.md`: Image Generation Jobs. It comes after Phase 5 REST API and local authentication. It does not replace the mock UI, add progress streaming to the browser, or build the Phase 7 full product flow. Those remain later phases.

The observable outcome is: after calling `POST /api/scenes/:sceneId/generation-requests`, polling `GET /api/scenes/:sceneId/generation-requests` eventually returns `status: "succeeded"` and `GET /api/scenes/:sceneId/generated-images` returns a generated image record with a valid storage key. Automated tests confirm the full lifecycle and concurrency cap using the mock adapter without any external API call.


## Progress


- [ ] Read `AGENTS.md`, `IMPLEMENTATION_PLAN.md`, `REQUIREMENTS_INIT.md`, `/Users/ran/my-app/PLANS.md`, and the completed Phase 4 and Phase 5 ExecPlans.
- [ ] Inspect current application ports, use cases, SQLite repositories, API context composition, HTTP routes, and test-support module.
- [ ] Created this ExecPlan for Phase 6 / Image Generation Jobs.
- [ ] Add `findRunningCountByProjectId` to `GenerationRequestRepositoryPort`, implement it in `SqliteGenerationRequestRepository` and the in-memory test double.
- [ ] Add `GenerationConcurrencyPolicy` in the application layer that checks the running count before allowing a new request to start.
- [ ] Add `MockImageGenerationAdapter` in `apps/api/src/generation/mock-image-generation.ts`.
- [ ] Add `OpenAiImageGenerationAdapter` in `apps/api/src/generation/openai-image-generation.ts`.
- [ ] Add `LocalJobWorker` in `apps/api/src/generation/local-job-worker.ts` with execute, concurrency enforcement, and background polling.
- [ ] Wire `LocalJobWorker` into the API server startup and graceful shutdown.
- [ ] Add `updateGenerationRequest` use case for worker-side state transitions.
- [ ] Add `saveGeneratedImage` use case for persisting generation results.
- [ ] Update `createApiContext` to use the correct `ImageGenerationPort` adapter based on environment.
- [ ] Add focused unit and integration tests for state transitions, concurrency cap, retry, and storage.
- [ ] Run workspace format, typecheck, lint, test, build, and architecture boundary checks.


## Surprises & Discoveries


This section is intentionally empty until implementation starts. Update it as work proceeds.


## Decision Log


This section is intentionally empty until implementation starts. Update it as work proceeds.


## Outcomes & Retrospective


This section is intentionally empty until implementation starts. Update it after each milestone.


## Context and Orientation


`gen-story` is a TypeScript monorepo for building emotional storyboard sequences from user photos. The current package layout is:

    apps/web
    apps/api
    packages/domain
    packages/application
    packages/shared

The relevant current files are:

- `packages/domain/src/model.ts`, which defines `GenerationRequest` with `status: GenerationRequestStatus` (`queued | running | succeeded | failed | canceled`), `GeneratedImage`, and the `createGenerationRequest` / `retryGenerationRequest` domain factories.
- `packages/application/src/ports.ts`, which defines `ImageGenerationPort`, `JobQueuePort`, `ProgressEventPort`, `GenerationRequestRepositoryPort`, and `GeneratedImageRepositoryPort`. `ImageGenerationPort.generate` already returns `{ storageKey, mimeType, size, width, height, checksum }`.
- `packages/application/src/use-cases.ts`, which has `createGenerationRequestUseCase` (saves a `queued` request and enqueues a job) and `retryFailedGenerationRequest` (saves a new `queued` request from a `failed` one and enqueues it). Neither transitions to `running` or `succeeded`; that is the worker's job.
- `apps/api/src/app/create-api-context.ts`, which currently uses `NoOpJobQueue` (returns a random job ID without scheduling anything) and `NoOpImageGeneration` (throws immediately).
- `apps/api/src/db/repositories.ts`, which implements `SqliteGenerationRequestRepository` with `findById`, `findBySceneId`, and `save`, but has no `findRunningCountByProjectId`.
- `apps/api/src/http/routes.ts`, which exposes `POST /api/scenes/:sceneId/generation-requests` and `POST /api/generation-requests/:generationRequestId/retry`; these already call the application use cases.
- `apps/api/src/test-support/in-memory-application.ts`, which provides `InMemoryGenerationRequestRepository` used by route tests.
- `apps/api/src/storage/storage-keys.ts`, which provides helpers for generated image storage keys.

Important terms for this phase:

- `LocalJobWorker` means an in-process worker that polls `generation_requests` for `queued` jobs, enforces the project-level concurrency cap, dispatches them to `ImageGenerationPort`, and persists results. It replaces `NoOpJobQueue` as the execution engine for local development.
- `GenerationConcurrencyPolicy` means the rule that a project may have at most five `running` generation requests simultaneously; a job stays `queued` if the cap is reached when its slot is claimed.
- `MockImageGenerationAdapter` means an `ImageGenerationPort` implementation that writes a tiny deterministic JPEG to object storage and returns its metadata, with no network calls.
- `OpenAiImageGenerationAdapter` means an `ImageGenerationPort` implementation that calls the OpenAI Images API (`gpt-image-2`) with the input JSON prompt and input photo storage keys, writes the result to object storage, and returns its metadata.
- `State transition` means the worker moving a `GenerationRequest` from `queued` → `running` → `succeeded` or `failed`, with matching timestamps and an optional error message stored in the database.
- `Adoption switching` means the existing `markGeneratedImageAdopted` use case, which sets `isAdopted = true` on one generated image and `false` on all others for the same scene transactionally.


## Plan of Work


### Step 1: Extend the repository port and implementations

Add `findRunningCountByProjectId(projectId: string): Promise<number>` to `GenerationRequestRepositoryPort` in `packages/application/src/ports.ts`. This method must return the count of `GenerationRequest` records for the project where `status === "running"` and `deletedAt` is null.

Implement it in `SqliteGenerationRequestRepository` in `apps/api/src/db/repositories.ts` using a `COUNT(*)` query filtered by `project_id` and `status = 'running'`.

Update the `InMemoryGenerationRequestRepository` in `apps/api/src/test-support/in-memory-application.ts` to implement the same method by filtering the in-memory map.

Add `findByProjectIdAndStatus(projectId: string, status: GenerationRequestStatus): Promise<GenerationRequest[]>` to the port and both implementations at the same time. This method is used by the worker to claim `queued` jobs for a specific project.

### Step 2: Add the concurrency policy helper

Add a small module at `packages/application/src/concurrency-policy.ts` that exports a single function:

    async function checkConcurrencyAllowed(
      deps: Pick<ApplicationDependencies, "generationRequests">,
      projectId: string,
      maxConcurrent: number,
    ): Promise<boolean>

This function calls `findRunningCountByProjectId` and returns `true` when the count is strictly below `maxConcurrent`. The default cap is `5`. Keep it as a named constant `MAX_CONCURRENT_PER_PROJECT = 5` in the same file. This helper belongs in `packages/application` because the concurrency rule is a business rule, not an infrastructure concern.

Re-export `checkConcurrencyAllowed` and `MAX_CONCURRENT_PER_PROJECT` from `packages/application/src/index.ts`.

### Step 3: Add the mock image generation adapter

Create `apps/api/src/generation/mock-image-generation.ts`. This adapter implements `ImageGenerationPort`. When `generate` is called:

1. Create a 1×1 pixel JPEG buffer (hard-coded minimal JPEG bytes — no `sharp` needed for this).
2. Compute its SHA-256 checksum using `node:crypto`.
3. Build a storage key using the `generatedImageStorageKey` helper from `apps/api/src/storage/storage-keys.ts`. The `generatedImageId` can be derived from `input.requestId` or from a caller-supplied property in `inputJson`.
4. Call `objectStorage.putObject` with the JPEG buffer.
5. Return `{ storageKey, mimeType: "image/jpeg", size, width: 1, height: 1, checksum }`.

`MockImageGenerationAdapter` must accept an `ObjectStoragePort` in its constructor.

Add a test file at `apps/api/src/generation/mock-image-generation.test.ts` that proves the adapter writes a file to a temp object storage and returns correct metadata.

### Step 4: Add the OpenAI image generation adapter

Create `apps/api/src/generation/openai-image-generation.ts`. This adapter implements `ImageGenerationPort`. It accepts `{ objectStorage: ObjectStoragePort, openaiApiKey: string }` in its constructor. When `generate` is called:

1. Extract `prompt`, `model`, `size`, `quality`, and `inputPhotoStorageKeys` from `inputJson`. Fall back to sensible defaults for `model` (`gpt-image-2`), `size` (`1024x1024`), and `quality` (`standard`).
2. If `inputPhotoStorageKeys` is a non-empty array, read each photo from object storage and pass them as `image` inputs to the OpenAI edit endpoint (`images.edit`). Otherwise use the generation endpoint (`images.generate`).
3. Receive the base64 response, decode it to a `Uint8Array`.
4. Compute SHA-256 checksum.
5. Build a storage key using `generatedImageStorageKey`. Use `input.requestId` plus a fixed suffix to make the key deterministic per request.
6. Call `objectStorage.putObject`.
7. Return the metadata.

The OpenAI SDK (`openai`) must be added to `apps/api/package.json`. It must not be imported in `packages/domain` or `packages/application`.

Do not add a unit test that calls the real OpenAI API. Add a brief comment at the top of the test file noting that real API tests must be run manually with `OPENAI_API_KEY` set.

### Step 5: Add use cases for worker-side state transitions

Add two new use cases in `packages/application/src/use-cases.ts`:

**`markGenerationRequestRunning`** — accepts `{ generationRequestId, startedAt }`. Loads the request, asserts it is `queued`, updates `status` to `running`, sets `startedAt`, saves, publishes `generation-request.running` progress event, returns the updated request. Returns `invalid_state` if not `queued`.

**`markGenerationRequestCompleted`** — accepts `{ generationRequestId, generatedImageId, storageKey, mimeType, size, width, height, checksum, completedAt }`. Loads the request, asserts it is `running`, updates `status` to `succeeded`, sets `completedAt`, saves the updated request. Creates and saves a new `GeneratedImage` record with the provided storage metadata and `isAdopted: false`. Publishes `generation-request.succeeded`. Returns `{ generationRequest, generatedImage }`.

**`markGenerationRequestFailed`** — accepts `{ generationRequestId, errorMessage, completedAt }`. Loads the request, asserts it is `running` or `queued`, updates `status` to `failed`, sets `errorMessage` and `completedAt`, saves, publishes `generation-request.failed`. Returns the updated request.

These use cases are called only by the worker, not by HTTP routes. They must not be exposed as REST endpoints in this phase.

Re-export them from `packages/application/src/index.ts`.

Add unit tests for each in `packages/application/src/use-cases.test.ts`.

### Step 6: Add the local job worker

Create `apps/api/src/generation/local-job-worker.ts`. This module exports a class `LocalJobWorker` with the following interface:

    class LocalJobWorker {
      constructor(deps: ApplicationDependencies, options?: { pollIntervalMs?: number })
      start(): void
      stop(): void
    }

On `start`, the worker begins polling on a fixed interval (`pollIntervalMs`, default `500`). Each poll tick:

1. Queries `generation_requests` for all `queued` records (across all projects), ordered by `createdAt` ascending.
2. For each queued request, calls `checkConcurrencyAllowed` for its `projectId`. If allowed:
   a. Calls `markGenerationRequestRunning`.
   b. Calls `deps.imageGeneration.generate({ requestId, inputJson })`.
   c. On success, calls `markGenerationRequestCompleted` with the result metadata, using a freshly generated `generatedImageId`.
   d. On error, calls `markGenerationRequestFailed` with a short error message derived from the thrown error. Truncate the message to 500 characters.
3. Dispatches at most `MAX_CONCURRENT_PER_PROJECT` jobs per poll tick across all projects. Do not start more than five concurrent `Promise` executions per tick.
4. The worker must not throw unhandled rejections. Errors from individual job executions are caught and fed to `markGenerationRequestFailed`.

The worker needs read access to `queued` requests across all projects. Add `findQueued(): Promise<GenerationRequest[]>` to `GenerationRequestRepositoryPort`, returning requests with `status === "queued"` ordered by `createdAt` ascending. Implement it in `SqliteGenerationRequestRepository` and the in-memory test double.

Add tests at `apps/api/src/generation/local-job-worker.test.ts` that prove: a queued job moves to `succeeded`, the concurrency cap prevents a sixth job from starting until one completes, failed jobs capture an error message, and a retry of a failed job is processed.

### Step 7: Wire the worker into the API server

In `apps/api/src/server.ts`, after the `createApiContext` call:

1. Construct a `LocalJobWorker` from the API context.
2. Call `worker.start()`.
3. Register `process.on("SIGTERM")` and `process.on("SIGINT")` handlers that call `worker.stop()` before exiting.

Update `apps/api/src/app/create-api-context.ts` to use `MockImageGenerationAdapter` as the default `ImageGenerationPort` for local development, and `OpenAiImageGenerationAdapter` when `OPENAI_API_KEY` is set in the environment. The selection should happen inside `createApiContext` by reading `process.env.OPENAI_API_KEY`.

The `NoOpJobQueue` and `NoOpImageGeneration` stubs in `create-api-context.ts` should be removed once the worker is wired. The `JobQueuePort` in `ApplicationDependencies` remains; the worker calls use cases directly and the `NoOpJobQueue` stub that the application use case calls for `enqueue` can stay as a no-op since the worker discovers jobs by polling the database, not by receiving queue messages.

### Step 8: Update shared DTOs

In `packages/shared/src/index.ts`, add or confirm that `GenerationRequestDto` and `GeneratedImageDto` contain `status`, `errorMessage`, `startedAt`, and `completedAt` fields, since the Phase 5 routes may have left them as stubs. Verify the Phase 5 route tests also confirm these fields are populated after a completed run.

### Step 9: Tests and verification

Add or update focused integration tests in `apps/api/src/http/routes.test.ts` using the `InMemoryGenerationRequestRepository` and `MockImageGenerationAdapter` to assert:

- After creating a generation request via POST, polling its status eventually shows `succeeded` (simulate worker execution inline in the test).
- A generated image record appears with a valid storage key after success.
- Adopting the generated image via `POST /api/scenes/:sceneId/generated-images/:generatedImageId/adopt` returns success and sets the image as adopted.
- Retrying a failed request returns a new queued request.

Run workspace checks as described in the Validation section.


## Concrete Steps


Run all commands from `/Users/ran/my-app/gen-story` unless a step explicitly names another working directory.

Inspect the current state before editing:

    sed -n '1,160p' packages/application/src/ports.ts
    sed -n '60,170p' packages/application/src/use-cases.ts
    sed -n '500,740p' packages/application/src/use-cases.ts
    sed -n '1,60p' apps/api/src/app/create-api-context.ts
    grep -n "GenerationRequest\|generationRequest" apps/api/src/db/repositories.ts
    cat apps/api/src/test-support/in-memory-application.ts

Add the OpenAI SDK dependency to the API app:

    pnpm --filter @gen-story/api add openai

Create new adapter and worker files:

    apps/api/src/generation/mock-image-generation.ts
    apps/api/src/generation/mock-image-generation.test.ts
    apps/api/src/generation/openai-image-generation.ts
    apps/api/src/generation/openai-image-generation.test.ts
    apps/api/src/generation/local-job-worker.ts
    apps/api/src/generation/local-job-worker.test.ts

Add or update application files:

    packages/application/src/concurrency-policy.ts
    packages/application/src/use-cases.ts
    packages/application/src/use-cases.test.ts
    packages/application/src/ports.ts
    packages/application/src/index.ts

Update API composition and server:

    apps/api/src/app/create-api-context.ts
    apps/api/src/server.ts
    apps/api/src/db/repositories.ts
    apps/api/src/db/repositories.test.ts
    apps/api/src/test-support/in-memory-application.ts
    apps/api/src/http/routes.test.ts

Optionally update shared DTOs if fields are missing:

    packages/shared/src/index.ts

Run focused package checks as each layer is completed:

    pnpm --filter @gen-story/application test
    pnpm --filter @gen-story/api exec vitest run src/generation/mock-image-generation.test.ts
    pnpm --filter @gen-story/api exec vitest run src/generation/local-job-worker.test.ts
    pnpm --filter @gen-story/api exec vitest run src/http/routes.test.ts
    pnpm --filter @gen-story/api test

Run static checks for touched packages:

    pnpm --filter @gen-story/application typecheck
    pnpm --filter @gen-story/api typecheck
    pnpm --filter @gen-story/application lint
    pnpm --filter @gen-story/api lint

Run workspace verification after the full phase is implemented:

    pnpm format
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build
    rg "from ['\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application

Manually smoke-test the worker with mock generation:

    pnpm --filter @gen-story/api db:migrate
    pnpm dev:api
    # In another terminal:
    curl -s -X POST http://localhost:4000/api/projects -H 'content-type: application/json' -d '{"name":"Smoke Test"}' | jq .
    # Use the returned projectId and create a storyboard, scene, and generation request, then poll for status.

Manually smoke-test with real OpenAI (optional, requires OPENAI_API_KEY):

    OPENAI_API_KEY=sk-... pnpm dev:api
    # Create a generation request via the API and verify a generated image appears under data/uploads/generated/images/


## Validation and Acceptance


This phase is accepted when automated tests confirm the full generation state lifecycle and concurrency cap without external API calls.

State lifecycle behavior must be observable:

- A `queued` generation request is picked up by the local worker and transitions to `running`, then `succeeded` or `failed`.
- A `succeeded` request has a non-null `completedAt`.
- A `failed` request has a non-null `errorMessage` (up to 500 characters) and a non-null `completedAt`.
- A `GeneratedImage` record exists after success with a storage key matching the convention `data/uploads/generated/images/projects/{projectId}/scenes/{sceneId}/{generatedImageId}.jpg`.
- The generated image file exists on disk under the storage key.

Concurrency behavior must be observable:

- Five `queued` requests for the same project may all move to `running` simultaneously.
- A sixth `queued` request for the same project stays `queued` until one of the five completes.
- Requests from different projects do not share the five-slot cap.

Retry behavior must be observable:

- `POST /api/generation-requests/:generationRequestId/retry` on a `failed` request creates a new `queued` request.
- The retry request moves through the full lifecycle independently.
- Retrying a `succeeded` or `queued` request returns `HTTP 422`.

Adoption behavior must be observable:

- `POST /api/scenes/:sceneId/generated-images/:generatedImageId/adopt` sets `isAdopted: true` on the target image.
- A previously adopted image for the same scene is set to `isAdopted: false` in the same transaction.
- The operation is idempotent: adopting an already-adopted image is allowed.

Mock adapter behavior must be observable:

- `MockImageGenerationAdapter.generate` completes without any network call.
- The returned storage key is deterministic for the same `requestId`.
- Tests using the mock adapter are fast (under one second each) and deterministic.

The verification commands must pass:

    pnpm --filter @gen-story/application typecheck
    pnpm --filter @gen-story/api typecheck
    pnpm --filter @gen-story/api test
    pnpm --filter @gen-story/api lint
    pnpm format
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build

The architecture boundary check must return no matches in `packages/domain` and `packages/application`:

    rg "from ['\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application


## Idempotence and Recovery


The worker must be safe to restart. If the process exits while a request is `running`, the request stays `running` in the database after restart. The worker does not automatically re-claim stale `running` requests because a concurrent process could also be running them. A manual or future recovery mechanism can reset stale `running` requests to `queued`; this phase does not implement that.

`markGenerationRequestRunning` is not idempotent: calling it twice on the same request returns `invalid_state`. The worker must not call it if the request is already `running`.

If `imageGeneration.generate` throws after the request was marked `running`, the worker must call `markGenerationRequestFailed`. Unhandled rejections must not crash the process.

If `objectStorage.putObject` succeeds but the database `save` for the `GeneratedImage` fails, the orphaned file under the storage key will exist on disk with no matching DB row. This phase does not implement rollback for this edge case; it is acceptable for local development.

Tests must use temporary SQLite files and temporary upload roots so repeated runs do not contaminate `data/gen-story.sqlite` or `data/uploads`. Tests that exercise the worker should use short `pollIntervalMs` values (5–20 ms) to avoid slow test suites.


## Artifacts and Notes


Expected new files:

    packages/application/src/concurrency-policy.ts
    apps/api/src/generation/mock-image-generation.ts
    apps/api/src/generation/mock-image-generation.test.ts
    apps/api/src/generation/openai-image-generation.ts
    apps/api/src/generation/openai-image-generation.test.ts
    apps/api/src/generation/local-job-worker.ts
    apps/api/src/generation/local-job-worker.test.ts

Expected changed files:

    packages/application/src/ports.ts
    packages/application/src/use-cases.ts
    packages/application/src/use-cases.test.ts
    packages/application/src/index.ts
    packages/shared/src/index.ts
    apps/api/package.json
    apps/api/src/app/create-api-context.ts
    apps/api/src/server.ts
    apps/api/src/db/repositories.ts
    apps/api/src/db/repositories.test.ts
    apps/api/src/test-support/in-memory-application.ts
    apps/api/src/http/routes.test.ts


## Interfaces and Dependencies


The application interfaces involved are:

- `ImageGenerationPort` in `packages/application/src/ports.ts`, implemented by `MockImageGenerationAdapter` and `OpenAiImageGenerationAdapter`.
- `JobQueuePort` in `packages/application/src/ports.ts`, still wired as a no-op; the worker discovers jobs by polling, not by consuming a queue.
- `GenerationRequestRepositoryPort` in `packages/application/src/ports.ts`, extended with `findRunningCountByProjectId`, `findByProjectIdAndStatus`, and `findQueued`.
- `markGenerationRequestRunning`, `markGenerationRequestCompleted`, `markGenerationRequestFailed` in `packages/application/src/use-cases.ts`, called only by the worker.
- `checkConcurrencyAllowed` in `packages/application/src/concurrency-policy.ts`, called by the worker before transitioning a job to `running`.

The API-local modules involved are:

- `LocalJobWorker` in `apps/api/src/generation/local-job-worker.ts`, started by `apps/api/src/server.ts`.
- `MockImageGenerationAdapter` in `apps/api/src/generation/mock-image-generation.ts`, used by default in local development and all automated tests.
- `OpenAiImageGenerationAdapter` in `apps/api/src/generation/openai-image-generation.ts`, activated when `OPENAI_API_KEY` is present in the environment.
- `LocalObjectStorage` in `apps/api/src/storage/local-object-storage.ts`, used by both generation adapters to persist image bytes.
- `generatedImageStorageKey` helper in `apps/api/src/storage/storage-keys.ts`, used to build deterministic storage keys.

New package dependency:

- `openai` in `apps/api`, for the OpenAI Images API adapter.

Interfaces intentionally not introduced in this phase:

- Browser-visible progress streaming (SSE or WebSocket).
- Video or BGM generation adapters.
- WorkOS production login.
- External job queue (SQS, Pub/Sub, Cloud Tasks).
- Billing, coin credits, or cost tracking.
- Phase 7 UI integration (replacing the mock flow with real API calls).
