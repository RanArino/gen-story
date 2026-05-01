# Set Up Development Environment

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.


## Purpose / Big Picture

Set up the smallest working local development environment for the `gen-story` application so implementation can begin from a verifiable baseline. After this work, a developer should be able to install dependencies, start the web app, start the API app, typecheck the workspace, run linting, and run a minimal test suite from a clean checkout.

This is Phase 0 from `IMPLEMENTATION_PLAN.md`: repository and development baseline. It intentionally does not implement product screens, persistence, image preprocessing, authentication, or image generation. The goal is to create a stable foundation for later phases while keeping the repository split-ready.


## Progress

- [x] (2026-04-30 12:07Z) Read `/Users/ran/my-app/AGENTS.md`, `/Users/ran/my-app/PLANS.md`, and `IMPLEMENTATION_PLAN.md`.
- [x] (2026-04-30 12:07Z) Confirmed the child repository currently has no deeper `AGENTS.md` or `PLANS.md`.
- [x] (2026-04-30 12:07Z) Confirmed the repository is documentation-only except for `README.md` and planning documents.
- [x] (2026-04-30 12:29Z) Create the workspace package manager files and shared TypeScript configuration.
- [x] (2026-04-30 12:29Z) Scaffold `apps/web`, `apps/api`, `packages/domain`, `packages/application`, and `packages/shared`; omitted `packages/infrastructure` because Phase 0 has no adapter implementation yet.
- [x] (2026-04-30 12:29Z) Add minimal lint, format, typecheck, test, and dev commands.
- [x] (2026-04-30 12:29Z) Add local environment examples and setup documentation.
- [x] (2026-04-30 12:39Z) Run the verification commands and record results in this plan.
- [x] (2026-05-01 02:07Z) Fixed API startup so `apps/api/.env` is loaded before `startServer()`, preserving exported shell variables.


## Surprises & Discoveries

- Observation: The repository has no local stack files yet; only `README.md`, `IMPLEMENTATION_PLAN.md`, `REQUIREMENTS_INIT.md`, `USER_EXPERIENCE_FLOW.md`, `MONETIZATION_STRATEGY.md`, and `ToDo` are present.
  Evidence: `rg --files -g 'README.md' -g 'package.json' -g 'pnpm-workspace.yaml' -g 'turbo.json' -g 'tsconfig*.json' -g 'AGENTS.md'` returned only `README.md`.

- Observation: Node.js is available, but `pnpm` and `corepack` are not installed in the current shell.
  Evidence: `node --version` returned `v25.2.1`; `pnpm --version` and `corepack --version` returned `command not found`.

- Observation: The first `pnpm install` attempt failed under the restricted sandbox because DNS access to the npm registry was blocked.
  Evidence: The command ended with `ERR_PNPM_META_FETCH_FAIL` and `getaddrinfo ENOTFOUND registry.npmjs.org`.

- Observation: `pnpm dev:api` needs permissions to bind the IPC socket used by `tsx` in this environment.
  Evidence: The sandboxed attempt failed with `listen EPERM` for a `/var/folders/.../tsx-501/...pipe`; the approved rerun started `gen-story-api listening on http://localhost:4000`.


## Decision Log

- Decision: Use this plan to cover Phase 0 only, not the whole implementation roadmap.
  Rationale: The user asked to set up the environment first. Keeping this plan focused makes the work verifiable and avoids prematurely adding product behavior.
  Date/Author: 2026-04-30 / Codex

- Decision: Use a small TypeScript monorepo with separate `apps/web`, `apps/api`, and `packages/*` workspaces.
  Rationale: This matches `IMPLEMENTATION_PLAN.md` and gives clear boundaries for web, API, domain, application, and shared code without adding production infrastructure.
  Date/Author: 2026-04-30 / Codex

- Decision: Prefer `pnpm` workspaces unless implementation-time discovery reveals a stronger local convention.
  Rationale: There is no existing package manager in this repository. `pnpm` is a simple fit for TypeScript monorepos and avoids adding a heavier build orchestrator before it is needed.
  Date/Author: 2026-04-30 / Codex

- Decision: Keep `packages/domain` and `packages/application` free of framework, SDK, ORM, HTTP, and validation dependencies from the first commit.
  Rationale: The architecture plan requires these packages to stay independent, and enforcing this from setup prevents early coupling.
  Date/Author: 2026-04-30 / Codex

- Decision: Use Node's built-in HTTP server for the Phase 0 API app.
  Rationale: A health endpoint does not require an HTTP framework. This keeps Phase 0 smaller while preserving the option to introduce a framework at the API adapter boundary later.
  Date/Author: 2026-04-30 / Codex


## Outcomes & Retrospective

Completed. The Phase 0 baseline now includes a pnpm TypeScript workspace, a minimal Next.js web app, a minimal Node HTTP API app with `/health`, pure `domain`, `application`, and `shared` packages, environment examples, and setup documentation.

Verification results:

    pnpm install
    Passed after rerunning with network access. Created pnpm-lock.yaml.

    pnpm format
    Passed. Formatting is intentionally scoped to Phase 0 code and config so pre-existing requirements Markdown is not reformatted.

    pnpm typecheck
    Passed across apps and packages.

    pnpm lint
    Passed across apps and packages after limiting package lint scripts to source files and avoiding generated `.next` output.

    pnpm test
    Passed. API health test and domain tests ran successfully; packages without tests use `--passWithNoTests`.

    pnpm build
    Passed. Next.js built the minimal web app, and TypeScript packages emitted build output.

    rg "from ['\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\.\./\.\./apps)" packages/domain packages/application
    Passed with no matches. The command exits with code 1 because `rg` found no forbidden imports.

Manual server verification:

    pnpm dev:api
    Started on http://localhost:4000 after approval for local socket binding.

    curl -s -i http://localhost:4000/health
    Returned HTTP 200 with body {"status":"ok","service":"gen-story-api"}.

    pnpm dev:web
    Started on http://localhost:3000 after approval for local socket binding.

    curl -s -i http://localhost:3000
    Returned HTTP 200 and HTML containing "Gen Story" and "Phase 0 development baseline is running."

Known gaps: `pnpm install` and local server/curl checks needed approval in this sandboxed session. On a normal local machine, they should run directly once pnpm is installed.


## Context and Orientation

`gen-story` is planned as a local web application for creating story-like generated image sequences from user photos. The implementation roadmap lives in `IMPLEMENTATION_PLAN.md`.

Key repository terms:

`apps/web` is the Next.js browser application. It should eventually contain screens for project creation, photo upload, storyboard editing, generation progress, and generated image comparison. In this setup phase it only needs a minimal runnable page.

`apps/api` is the local TypeScript API server. It should eventually expose REST endpoints for projects, photos, storyboards, scenes, style presets, generation requests, and generated images. In this setup phase it only needs a health endpoint and a way to start locally.

`packages/domain` contains pure business concepts and invariants. It must not import Next.js, Express, Fastify, Drizzle, OpenAI SDK, WorkOS SDK, cloud SDKs, Zod, or filesystem APIs.

`packages/application` contains use case orchestration and ports. It can depend on `packages/domain`, but it must not depend on framework or infrastructure details.

`packages/shared` contains narrowly shared TypeScript types or API DTO helpers when needed. It must not become a dumping ground for UI components, database schemas, SDK responses, or app-specific state.

`packages/infrastructure` may be omitted during initial setup if no infrastructure implementation exists yet. If created, it should contain adapter code only and must not be imported by `packages/domain`.

The parent instruction file `/Users/ran/my-app/AGENTS.md` requires minimal, surgical changes, repository discovery before editing, explicit verification, and living ExecPlans for multi-step work.


## Plan of Work

First, establish the workspace skeleton. Add `package.json`, `pnpm-workspace.yaml`, a root TypeScript base config, and workspace folders for `apps/web`, `apps/api`, `packages/domain`, `packages/application`, and `packages/shared`. Keep root scripts explicit: `dev`, `dev:web`, `dev:api`, `typecheck`, `lint`, `format`, `test`, and `build`.

Second, scaffold the web app as a minimal Next.js TypeScript app. It should render a simple first page that proves the app starts. Avoid product UI implementation in this phase.

Third, scaffold the API app as a minimal TypeScript HTTP server with a health endpoint. Choose the smallest framework or runtime setup that supports local development cleanly. The API should return an observable health response, for example HTTP 200 with JSON containing a status field.

Fourth, create minimal source and test files for the domain and application packages. The domain package should include a tiny pure function or value object test only to prove the test runner and package boundaries work. The application package should depend on domain only if needed.

Fifth, add linting, formatting, typechecking, and tests. Use one test runner across packages if practical. Keep configuration centralized where it reduces duplication, but do not introduce a build orchestrator unless command performance or package dependency ordering requires it.

Sixth, document setup in `README.md`. Include prerequisites, install command, development commands, verification commands, and known limitations. Add `.env.example` files only for values needed by the baseline, such as API port or web API base URL.

Finally, run all verification commands. Update this ExecPlan with results, command output summaries, decisions, and any recovery notes.


## Concrete Steps

Run all commands from `/Users/ran/my-app/gen-story` unless a step explicitly names another working directory.

Inspect the current tree:

    pwd
    rg --files
    git status --short

Create workspace directories:

    mkdir -p apps/web apps/api packages/domain packages/application packages/shared

Initialize package manager files:

    pnpm init

If `pnpm` is not installed, use Corepack if available:

    corepack enable
    corepack prepare pnpm@latest --activate

Add the root workspace files manually:

    package.json
    pnpm-workspace.yaml
    tsconfig.base.json
    .gitignore
    README.md

Install only the baseline dependencies required for a runnable TypeScript workspace. Candidate categories are:

    next, react, react-dom for apps/web
    typescript and tsx for TypeScript execution
    a small HTTP server library for apps/api
    eslint and prettier or the repository's chosen equivalents
    vitest for minimal tests
    @types/node and React type packages as needed

Scaffold `apps/web` with:

    apps/web/package.json
    apps/web/tsconfig.json
    apps/web/next.config.ts
    apps/web/src/app/layout.tsx
    apps/web/src/app/page.tsx

Scaffold `apps/api` with:

    apps/api/package.json
    apps/api/tsconfig.json
    apps/api/src/server.ts
    apps/api/src/health.test.ts

Scaffold packages with:

    packages/domain/package.json
    packages/domain/tsconfig.json
    packages/domain/src/index.ts
    packages/domain/src/index.test.ts
    packages/application/package.json
    packages/application/tsconfig.json
    packages/application/src/index.ts
    packages/shared/package.json
    packages/shared/tsconfig.json
    packages/shared/src/index.ts

Run verification:

    pnpm install
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build

Start the development servers in separate terminals:

    pnpm dev:web
    pnpm dev:api

Expected observable results:

    The web app starts and serves a page locally.
    The API app starts and its health endpoint returns HTTP 200.
    Typecheck, lint, tests, and build complete successfully.


## Validation and Acceptance

This setup is accepted only when all of the following are observable:

Running `pnpm install` from `/Users/ran/my-app/gen-story` installs workspace dependencies without manual package edits.

Running `pnpm typecheck` completes without TypeScript errors across `apps/*` and `packages/*`.

Running `pnpm lint` completes without lint errors.

Running `pnpm test` reports at least one passing test from the workspace.

Running `pnpm build` succeeds for the packages and apps included in Phase 0.

Running `pnpm dev:web` starts the Next.js app. Visiting the local web URL shows a minimal page, not a product mock.

Running `pnpm dev:api` starts the API server. Requesting the health endpoint returns HTTP 200 and a small JSON body.

Static dependency checks confirm `packages/domain` and `packages/application` do not import Next.js, Drizzle, OpenAI SDK, WorkOS SDK, GCP SDK, AWS SDK, Zod, HTTP frameworks, or app code. A simple first check is:

    rg "from ['\\\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application

The expected result for that check is no matches, except if the API framework choice appears only outside `packages/domain` and `packages/application`.


## Idempotence and Recovery

Directory creation with `mkdir -p` is safe to repeat.

Dependency installation with `pnpm install` is safe to repeat. If installation fails because network access is unavailable, keep the generated manifests, record the failure in `Surprises & Discoveries`, and verify all file-level configuration that does not require downloaded packages.

Development servers can be stopped with Ctrl-C and restarted with the same commands.

If a port is already in use, prefer changing only the local environment value for the affected app, then document the chosen port in this plan and in `README.md` if it becomes the default.

If a generated scaffold introduces unrelated files or formatting churn, remove only the scaffolded extras that are not needed for Phase 0. Do not rewrite planning documents except this ExecPlan and setup documentation.

If package manager choice becomes problematic before substantial code is added, record the reason in `Decision Log`, remove the package-manager-specific files created by this setup, and switch to the simplest viable alternative. Do not keep two package managers active.


## Artifacts and Notes

Current repository discovery:

    pwd
    /Users/ran/my-app/gen-story

    rg --files -g 'README.md' -g 'package.json' -g 'pnpm-workspace.yaml' -g 'turbo.json' -g 'tsconfig*.json' -g 'AGENTS.md'
    README.md

    git status --short
    ?? IMPLEMENTATION_PLAN.md

The existing `IMPLEMENTATION_PLAN.md` is untracked at the time this ExecPlan was created. Treat it as user-provided planning input and do not overwrite it.


## Interfaces and Dependencies

Node.js is required to run the TypeScript, Next.js, and API development servers.

`pnpm` is the planned workspace package manager. It is needed for root scripts, workspace dependency linking, and repeatable installs.

Next.js, React, and React DOM are needed for `apps/web` because `IMPLEMENTATION_PLAN.md` explicitly chooses Next.js for the initial web app.

TypeScript is required across apps and packages because the implementation plan chooses TypeScript for both frontend and backend.

A small TypeScript API server dependency may be used for `apps/api`. Keep it isolated to `apps/api` so `packages/domain` and `packages/application` stay framework-independent.

Vitest or an equivalent lightweight runner is needed for minimal unit tests. The initial tests should prove the workspace wiring and pure package boundaries, not product behavior.

Linting and formatting tools are needed for consistent local checks. Keep their configuration minimal until the repository has enough code to justify stricter rules.
