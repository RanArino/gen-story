# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> The full canonical agent guide is in `AGENTS.md`. The rules below are derived from it.

## Commands

Run all commands from the repository root.

```bash
pnpm install                # install dependencies
pnpm dev                    # run both web (3000) and API (4000) in parallel
pnpm dev:web                # web only
pnpm dev:api                # API only
pnpm build                  # build all packages
pnpm typecheck              # type-check all packages (run after every code change)
pnpm lint                   # lint (no lint:fix yet — make manual fixes)
pnpm format                 # check Prettier formatting
pnpm test                   # run all tests (Vitest)
pnpm --filter @gen-story/api db:generate   # generate Drizzle migration
pnpm --filter @gen-story/api db:migrate    # apply migrations to SQLite
```

Run a single test file:
```bash
pnpm --filter @gen-story/domain test -- src/index.test.ts
```

Check architecture boundary violations:
```bash
rg "from ['\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application
```

## Architecture

This is a pnpm monorepo following clean architecture with strict layer isolation.

```
apps/
  api/     Raw Node.js HTTP server — routing, validation, DB access, local auth, image preprocessing
  web/     Next.js 16 / React 19 frontend
packages/
  domain/        Pure domain models and business rules (no framework dependencies whatsoever)
  application/   Use cases + port interfaces (depends on domain only)
  shared/        DTO types used across the API boundary
drizzle/         SQLite migration files
data/            Local SQLite DB and uploaded files (gitignored)
```

**Request flow:** HTTP request → `apps/api/src/http/router.ts` → route handler → `requirePrincipal()` → use case (in `packages/application`) → port interface → concrete adapter (Drizzle repo / local storage / etc.) → DTO mapper → response.

**Dependency injection:** `apps/api/src/app/create-api-context.ts` wires all port implementations. Image generation, job queue, and progress events are NoOp stubs (not yet implemented).

**Storage layout:** `data/uploads/originals/projects/{projectId}/{photoAssetId}.ext`

**Environment variables** live in a single file, `apps/api/.env`, documented by `apps/api/.env.example`. Default: `API_PORT=4000`, `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`, `GEN_STORY_SQLITE_PATH=data/gen-story.sqlite`.

## Layer Isolation Rules (strictly enforced)

- `packages/domain` MUST NOT import: Next.js, Drizzle, OpenAI, WorkOS, GCP, AWS, Zod, HTTP frameworks, filesystem APIs, or anything from `apps/`.
- `packages/application` MUST NOT import: Next.js, Drizzle, OpenAI, WorkOS, GCP, AWS, or HTTP frameworks.
- `packages/*` MUST NEVER depend on `apps/*`.
- REST request/response shapes must be explicit — never expose ORM schemas or framework objects across the API boundary.

## Key Rules

- Write all code, comments, task names, PR text, and docs in **English**.
- `pnpm typecheck` after every code change.
- Update `docs/` when commands, env vars, APIs, or user-visible behavior changes.
- Update `internal/gap-analysis.md` whenever work starts, is planned with an ExecPlan, or is completed for any requirement tracked there. If an ExecPlan targets a `❌ Not yet implemented` requirement, change that requirement to `🟡 In progress` in the same change as the plan. (`internal/` is gitignored and excluded from the public release.)
- Use `apps/api/.env.example` to document new env vars; never commit `apps/api/.env` or secrets.
- Never edit generated files: `node_modules`, `.next`, `dist`, `*.tsbuildinfo`.
- Never add production cloud deployment, external queues, paid billing, WorkOS production auth, SNS, video generation, or BGM generation unless explicitly requested.

## Workflow

- Make only minimal changes tied to the request; do not refactor unrelated code.
- For a user-requested Discussion or an ambiguous, architectural, or cross-cutting proposal, follow `internal/discussion/AGENTS.md` before creating an ExecPlan or implementation plan.
- Prefer existing local patterns over new abstractions or dependencies.
- Run narrowest check first (`pnpm typecheck`), then broader checks (`pnpm lint`, `pnpm test`, `pnpm build`).
- Use an ExecPlan (see `/Users/ran/my-app/PLANS.md`) for multi-step, architectural, or migration work.
- When creating or updating an ExecPlan from `internal/gap-analysis.md`, keep `internal/gap-analysis.md` synchronized before finishing the turn, including status icons, notes, and summary counts. ExecPlans live in `internal/plans/`.
