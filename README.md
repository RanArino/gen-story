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

| Variable                      | Default                 | Description                                                   |
| ----------------------------- | ----------------------- | ------------------------------------------------------------- |
| `API_PORT`                    | `4000`                  | Port for the API server                                       |
| `NEXT_PUBLIC_API_BASE_URL`    | `http://localhost:4000` | API base URL used by the web app                              |
| `GEN_STORY_SQLITE_PATH`       | `data/gen-story.sqlite` | Path to the SQLite database file                              |
| `GEN_STORY_AGENT_RUNTIME`     | `api`                   | Text/vision AI runtime: `api` (Gemini), `codex`, or `claude` (subscription CLI login, no new API key) |
| `GEN_STORY_DEPLOY_TARGET`     | `local`                 | Must be `local` (or unset) to select a CLI runtime above       |
| `GEN_STORY_AGENT_CHAT_RUNTIME`| _(follows `GEN_STORY_AGENT_RUNTIME`)_ | Runtime for the in-app chat only: `codex`, `claude`, or `api` (chat off) |
| `GEN_STORY_AGENT_CHAT_MODEL`  | _(provider default)_    | Optional model for the in-app agent chat (e.g. `gpt-5-codex`, `sonnet`) |
| `GEN_STORY_API_BASE_URL`      | `http://127.0.0.1:$API_PORT` | URL the chat's CLI session uses to reach this API's MCP endpoint |
| `OPENAI_API_KEY`              | _(none)_                | Optional. Set it to use real image generation instead of mock |
| `GEMINI_API_KEY`              | _(none)_                | Optional. Enables real photo analysis for emotion candidates  |
| `GEMINI_PHOTO_ANALYSIS_MODEL` | `gemini-2.5-flash`      | Gemini model used for project photo analysis                  |
| `GEMINI_STORY_SETUP_MODEL`    | `gemini-2.5-flash`      | Gemini model used for storyboard story setup (step 4)         |

The app works without an OpenAI key — it uses a mock adapter that generates placeholder images.
The app works without a Gemini key; photo analysis and story setup use deterministic local fallbacks.

## Apply Database Migrations

Run this once before starting the app for the first time, and again after pulling changes
(the agent chat needs migration `0019`; without it the chat screen cannot store anything):

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

## Exporting Images and Prompts for Coding Agents

On the review screen, **Export images and prompts locally** creates a
timestamped bundle in `data/exports/` at the repository root. This directory is
excluded from Git. Each bundle contains
`storyboard.json` (scene prompts and metadata) and an `assets/` directory with
the source photos and adopted generated images. The JSON includes each asset's
relative local path, so Codex or Claude Code can read the bundle directly.

The existing JSON export remains a browser download; its destination is set by
your browser.

## Refining a Project in the App Chat

Set `GEN_STORY_AGENT_CHAT_RUNTIME=codex` (or `claude`) in `apps/api/.env`,
restart the API, and open **AI refine** on a project. This setting is chat-only:
photo analysis, story setup, and scene fill keep using whatever
`GEN_STORY_AGENT_RUNTIME` selects, so turning the chat on does not re-route the
rest of the app. If the CLI is missing or logged out, the panel says so and the
composer stays disabled instead of failing when you press Send. The chat talks to your already-authenticated Codex or Claude Code
subscription CLI — no new API key — and is scoped to that project's AI photo
analysis, emotion/tone, and style preset.

Use the **Reference a field** button to point the agent at `@photo-analysis`,
`@tone`, or `@style-preset`; the message carries the canonical field, not just
the label. When the agent recommends a change it records a proposal, which
appears in the transcript as a card with a before/after diff per field. Approve
the items you want, then **Apply** — approving is not applying, and nothing in
the project changes until you apply. If someone edited the same field in the
meantime, the apply fails with a visible conflict instead of overwriting it.

Gen Story keeps the full transcript, but does not resend it: after the first
turn the CLI continues its own session, so later turns send only your new
message and the current values of the fields you referenced. The header shows
the provider, model, session, and how many times the context has been
compacted. **Compact context** compacts on demand (long sessions also compact
themselves between turns), and **New session** starts a fresh provider session
while keeping the transcript — that is also how you recover a session the
provider has lost.

## Refining a Project with Codex or Claude Code (MCP)

The API hosts a project-scoped MCP server so an agent can inspect and refine a
project's creative direction — AI photo analysis, emotion/tone, and style
preset — without ever touching the database. An agent reads current values,
records a **change proposal**, and can apply only the items you approved in the
app. Nothing is written by the act of proposing.

With the API running, attach an external agent to one project:

```sh
# stdio (Codex, Claude Code)
pnpm --filter @gen-story/api mcp:stdio -- --project <projectId>

# Streamable HTTP
# http://localhost:4000/api/mcp/projects/<projectId>
```

The repository ships the workflow as a skill for both clients:
`.claude/skills/gen-story-creative-refinement/` and
`.codex/skills/gen-story-creative-refinement/`.

The MCP surface is a fixed allowlist — read creative direction, list/read
proposals, propose changes, apply an approved proposal. There is no general
update tool, no SQL, and no shell access, and an agent cannot approve its own
proposal: approval is your action in the app. A pending proposal is stored in
SQLite, so it survives closing the browser and restarting the API. If you edit
a field after a proposal was made, applying it fails with a visible conflict
instead of overwriting your edit.

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

**Missing OpenAI key** — Set `OPENAI_API_KEY` in `apps/api/.env`. Its presence alone selects the real adapter. Without a key the mock adapter produces gray placeholder images.

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
