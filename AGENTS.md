# Gen Story Agent Instructions

These repository-specific instructions apply to Codex and Claude Code. The parent instructions in `/Users/ran/my-app/AGENTS.md` still apply.

## Critical Commands

Run commands from the repository root.

- Install: `pnpm install`
- Dev, both apps: `pnpm dev`
- Dev, web only: `pnpm dev:web`
- Dev, API only: `pnpm dev:api`
- Build: `pnpm build`
- Test all: `pnpm test`
- Test one package file: `pnpm --filter @gen-story/domain test -- src/index.test.ts`
- Lint: `pnpm lint`
- Format check: `pnpm format`
- Type check: `pnpm typecheck`
- Architecture boundary check: `rg "from ['\\\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application`

There is no `lint:fix` script yet. Use `pnpm lint`, then make minimal manual fixes.

Default local URLs:

- Web: `http://localhost:3000`
- API health: `http://localhost:4000/health`

## Architecture

- `apps/web`: Next.js UI. Keep product UI and browser-facing code here.
- `apps/api`: local TypeScript API server. Keep HTTP routing and API boundary validation here.
- `packages/domain`: pure domain model and invariants only.
- `packages/application`: use cases and ports. May depend on `packages/domain`.
- `packages/shared`: narrow shared types or DTO helpers only.
- Future adapter or infrastructure code belongs in an app-level adapter folder or `packages/infrastructure` if that package is created.

## Rules

- MUST write implementation work, code comments, task names, pull request text, and technical documentation in English.
- MUST keep `packages/domain` independent from Next.js, Drizzle, OpenAI SDK, WorkOS SDK, GCP SDK, AWS SDK, Zod, HTTP frameworks, filesystem APIs, and app code.
- MUST keep `packages/application` independent from Next.js, Drizzle, OpenAI SDK, WorkOS SDK, GCP SDK, AWS SDK, and HTTP frameworks.
- MUST keep REST request and response shapes explicit; never expose ORM schemas, SDK responses, or framework objects across boundaries.
- MUST run `pnpm typecheck` after code changes unless dependencies or environment issues make it impossible.
- MUST update docs when commands, setup, environment variables, APIs, configuration, or user-visible behavior changes.
- MUST use `.env.example` for documented local environment variables.
- NEVER commit `.env` files, secrets, credentials, or private tokens.
- NEVER edit generated outputs such as `node_modules`, `.next`, `dist`, or `*.tsbuildinfo` manually.
- NEVER make `packages/*` depend on `apps/*`.
- NEVER add production cloud deployment, external queues, paid billing, WorkOS production login, SNS publishing, affiliate integration, travel planning, video generation, or BGM generation unless explicitly requested.

## Workflow

- Start by reading the nearest instructions, relevant docs, package manifests, and similar existing code.
- Ask before guessing when the request is materially ambiguous or risky.
- Make only minimal changes tied to the request; do not refactor unrelated code.
- Prefer established local patterns over new abstractions or new dependencies.
- Run the narrowest relevant check first, then broader checks for shared behavior or workspace changes.
- If a check cannot run, document why and describe the closest verification performed.
- Use an ExecPlan for multi-step, risky, architectural, migration-oriented, or explicitly requested work; follow `/Users/ran/my-app/PLANS.md`.
