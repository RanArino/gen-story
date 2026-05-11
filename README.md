# Gen Story

Local development baseline for the `gen-story` application.

## Prerequisites

- Node.js
- pnpm

If pnpm is unavailable, install it before running the workspace commands.

## Install

```sh
pnpm install
```

## Development

Start the web app:

```sh
pnpm dev:web
```

Start the API app:

```sh
pnpm dev:api
```

The default local URLs are:

- Web: `http://localhost:3000`
- API health: `http://localhost:4000/health`

## Verification

Run these commands from the repository root:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Database

The API app uses local SQLite for persistence. The default database path is:

```sh
GEN_STORY_SQLITE_PATH=data/gen-story.sqlite
```

Generate and apply Drizzle migrations from the repository root:

```sh
pnpm --filter @gen-story/api db:generate
pnpm --filter @gen-story/api db:migrate
```

## File Storage

The API app stores local uploaded and derived image files under storage keys in:

```sh
data/uploads
```

Database rows store storage keys such as `data/uploads/originals/projects/{projectId}/{photoAssetId}.jpg`, not absolute local paths. Local upload data is ignored by git.

## Workspace Layout

```text
apps/web
apps/api
packages/domain
packages/application
packages/shared
```

`packages/domain` and `packages/application` must stay independent from framework, SDK, ORM, HTTP, and cloud-specific code.

## Environment

Copy `.env.example` or the app-specific `.env.example` files when local overrides are needed. The baseline only uses:

- `API_PORT`
- `NEXT_PUBLIC_API_BASE_URL`
- `GEN_STORY_SQLITE_PATH`

## Current Limitations

This baseline intentionally does not include API routes for product screens, authentication, image generation, video generation, or BGM generation.
