# Gen Story

A locally-run demo app for turning your photos into AI-powered story visuals.
Upload photos, build a storyboard, generate an AI image per scene, and review
the results.

This repository is published as a **public demo**: it runs entirely on your own
machine (local SQLite + local file storage) and needs no cloud setup. See
[docs/known-limitations.md](docs/known-limitations.md) for what is intentionally
out of scope in this version.

## Prerequisites

- Node.js ≥ 22
- pnpm ≥ 9

Install pnpm if needed:

```sh
npm install -g pnpm
```

## Clone and Install

```sh
git clone <repo-url>
cd gen-story
pnpm install
```

## Environment Variables

Copy the example env file and edit as needed:

```sh
cp apps/api/.env.example apps/api/.env
```

| Variable                      | Default                 | Description                                                  |
| ----------------------------- | ----------------------- | ------------------------------------------------------------ |
| `API_PORT`                    | `4000`                  | Port for the API server                                      |
| `NEXT_PUBLIC_API_BASE_URL`    | `http://localhost:4000` | API base URL used by the web app                             |
| `GEN_STORY_SQLITE_PATH`       | `data/gen-story.sqlite` | Path to the SQLite database file                             |
| `OPENAI_API_KEY`              | _(none)_                | Optional. Required for real image generation                 |
| `IMAGE_GENERATION_ADAPTER`    | `mock`                  | Set to `openai` to use real generation                       |
| `GEMINI_API_KEY`              | _(none)_                | Optional. Enables real photo analysis for emotion candidates |
| `GEMINI_PHOTO_ANALYSIS_MODEL` | `gemini-2.5-flash`      | Gemini model used for project photo analysis                 |

The app works without an OpenAI key — it uses a mock adapter that generates placeholder images.
The app works without a Gemini key; photo analysis uses deterministic local suggestions.

## Apply Database Migrations

Run this once before starting the app for the first time, and again after pulling changes:

```sh
pnpm --filter @gen-story/api db:migrate
```

## Start the Application

```sh
pnpm dev
```

- Web: http://localhost:3000
- API: http://localhost:4000

## Load Seed Data (Optional)

Populate the database with a demo project and three scenes to explore the UI without uploading photos:

```sh
pnpm --filter @gen-story/api db:seed
```

The script prints the project URL when complete. It also seeds the nine
built-in image style presets (idempotent — safe to re-run).

## Generate Style Preview Images (Optional)

The storyboard style gallery shows a preview image per style preset. The script
generates one base image, then restyles that same image into every other style
(OpenAI's "character anchor" pattern), so all nine previews show the same
subject and differ only by visual style.

```sh
# Render all nine previews
OPENAI_API_KEY=... pnpm tsx scripts/generate-style-previews.ts

# Regenerate only specific styles (base image is reused — no extra cost)
pnpm tsx scripts/generate-style-previews.ts "Anime Movie" "Film Photo"

# Force the base image to be regenerated
pnpm tsx scripts/generate-style-previews.ts --fresh-base
```

This writes JPEG files to `apps/web/public/style-previews/`. The base image is
cached at `data/style-preview-base.png` so re-runs do not regenerate it. The
script requires `OPENAI_API_KEY` (read from `apps/api/.env`);
without it the gallery simply shows no preview thumbnails.

## Running Tests

Unit and integration tests (Vitest):

```sh
pnpm test
```

End-to-end tests (Playwright, requires both servers running):

```sh
pnpm --filter @gen-story/web test:e2e
```

Full verification suite:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Maintenance Scripts

Purge records soft-deleted more than 7 days ago and their associated files:

```sh
pnpm --filter @gen-story/api db:cleanup-expired

# Preview what would be deleted without making changes:
pnpm --filter @gen-story/api db:cleanup-expired -- --dry-run
```

Find upload files that have no matching database record:

```sh
pnpm --filter @gen-story/api db:detect-orphans
```

## Debug

Inspect recent generation job history:

```
http://localhost:4000/api/debug/generation-requests
```

API terminal logs each request in structured format:

```
[API] {"method":"POST","path":"/api/projects","status":201,"ms":12}
```

## Troubleshooting

**Port already in use** — Another process is using port 3000 or 4000. Stop it or change `API_PORT` / the Next.js port. `pnpm dev` keeps the web server running even when the API fails to bind, so the only browser symptom is "Cannot reach the API server" — check the `apps/api dev:` lines for the startup error.

**`apps/api/.env` not found** — Copy `apps/api/.env.example` as described above. The app will start but generation will use the mock adapter.

**SQLite locked** — Only one process should write to the database at a time. Stop any other running API instances.

**HEIC conversion fails** — `sharp` requires `libvips`. On macOS: `brew install vips`. On Linux: `apt install libvips-dev`.

**Missing OpenAI key** — Set `OPENAI_API_KEY` in `apps/api/.env` and `IMAGE_GENERATION_ADAPTER=openai`. Without a key the mock adapter produces gray placeholder images.

## Workspace Layout

```
apps/
  api/     Raw Node.js HTTP server — routing, Drizzle/SQLite, local auth, image gen
  web/     Next.js 16 / React 19 frontend
packages/
  domain/        Pure domain models and rules (no framework dependencies)
  application/   Use cases and port interfaces
  shared/        DTO types shared across the API boundary
drizzle/         SQLite migration files
scripts/         Maintenance and seed scripts
data/            Local SQLite DB and uploaded files (gitignored)
```

See [docs/known-limitations.md](docs/known-limitations.md) for features intentionally excluded from this local version.

## License

Released under the [MIT License](LICENSE).
