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

## Phase 0 Limitations

This baseline intentionally does not include product screens, persistence, image preprocessing, authentication, image generation, video generation, or BGM generation.
