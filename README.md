# Gen Story

A locally-run demo app for turning your photos into AI-powered story visuals.
Upload photos, build a storyboard, generate an AI image per scene, and review
the results, then create and download films from the Film stage.

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

| Variable                      | Default                      | Description                                                                             |
| ----------------------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| `API_PORT`                    | `4000`                       | Port for the API server                                                                 |
| `NEXT_PUBLIC_API_BASE_URL`    | `http://localhost:4000`      | API base URL used by the web app                                                        |
| `GEN_STORY_SQLITE_PATH`       | `data/gen-story.sqlite`      | Path to the SQLite database file                                                        |
| `GEN_STORY_DEPLOY_TARGET`     | `local`                      | CLI runtimes selected in Settings require local deployment                              |
| `GEN_STORY_AGENT_CHAT_MODEL`  | _(provider default)_         | Optional model for the in-app agent chat (e.g. `gpt-5-codex`, `sonnet`)                 |
| `GEN_STORY_API_BASE_URL`      | `http://127.0.0.1:$API_PORT` | URL the chat's CLI session uses to reach this API's MCP endpoint                        |
| `OPENAI_API_KEY`              | _(none)_                     | Optional. Real image generation with GPT Image instead of mock                          |
| `GEMINI_API_KEY`              | _(none)_                     | Optional. Photo analysis, explicit Nano Banana generation, and Automatic image fallback |
| `GEMINI_PHOTO_ANALYSIS_MODEL` | `gemini-2.5-flash`           | Gemini model used for project photo analysis                                            |
| `GEMINI_STORY_SETUP_MODEL`    | `gemini-2.5-flash`           | Gemini model used for storyboard story setup (step 4)                                   |

Image generation defaults to **Automatic (Codex → Gemini API)** for new model selections.
Install Codex CLI 0.164.0 or later and run `codex login` with your ChatGPT subscription
on the machine running the local API. Codex's built-in image generation uses included
Codex limits; it does not use `OPENAI_API_KEY`. Scene images, test samples, and character
sheets try Codex once, with a 180-second deadline. On an error, that image uses
`gemini-3.1-flash-image` through the configured Gemini API or Vertex AI, with normal
API billing. Each new image tries Codex again. Cancellation skips fallback.

Configure `GEMINI_API_KEY` (paid image-generation access) or Vertex AI for fallback.
If Codex fails and Gemini is unavailable, the job fails with an error rather than
returning a placeholder. Outside local deployment, Automatic uses Gemini directly.
Explicit Gemini and GPT Image selections retain the existing API/mock behavior;
previous saved selections are preserved. The image selection is independent of
the text/vision runtime in Settings. Character sheets always use Automatic.

The app works without a Gemini key for photo analysis and story setup using
deterministic local fallbacks. Explicit API image choices without their provider's
credentials generate placeholder images. Style-preview scripts retain their API path.

## Google Cloud project

All Google Cloud usage for this repository targets
`gen-story-496911`. Run GCP commands through the repository wrapper so the
project is specified for that command only and your global `gcloud` default
for other repositories is not changed:

```sh
pnpm gcloud services list --enabled
pnpm gcloud projects describe gen-story-496911
```

The wrapper rejects a different `--project` value. Authenticate normally with
`gcloud auth login` (or your organization-approved service-account flow); it
does not call `gcloud config set project`.

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

Open **Settings** and choose Claude Code (default), Codex, or API. The chat runs on the same runtime
as the rest of the app's text/vision AI. On `api` there is no CLI session to
open, so the panel says so and the composer stays disabled instead of failing
when you press Send. The CLI choices talk to your already-authenticated Codex or Claude Code
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

## Refining a Project with AI (MCP, internal)

The **AI refine** chat panel (see above) is how you refine a project's
creative direction — AI photo analysis, tone, style preset, common prompt,
story/worldview, negative prompt, character policy, and individual scenes —
with Codex or Claude Code. Internally the API hosts a project-scoped MCP
server (`http://localhost:4000/api/mcp/projects/<projectId>`) that the chat's
CLI session attaches to; you do not need to run or configure this yourself.
The agent reads current values, records a **change proposal**, and can apply
only the items you approved in the app. Nothing is written by the act of
proposing, and a pending proposal is stored in SQLite, so it survives closing
the browser and restarting the API. If you edit a field after a proposal was
made, applying it fails with a visible conflict instead of overwriting your
edit.

There is no way to drive this from a separate, standalone Codex/Claude Code
terminal session today: a proposal only reaches this app's approval UI when
it is attached to an active chat conversation, so an externally created
proposal would never appear anywhere for you to review. Use the in-app chat
panel. The MCP contract is documented for reference (not as a supported
external attach point) in `.claude/skills/gen-story-creative-refinement/` and
`.codex/skills/gen-story-creative-refinement/`.

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

**Automatic image generation failed** — Check `codex login status` reports ChatGPT
and Codex CLI is at least 0.164.0. If Codex is unavailable or its limits are reached,
Automatic needs a paid `GEMINI_API_KEY` or configured Vertex AI for fallback. The
job error names both provider failures. Each retry attempts Codex again.

**Placeholder images instead of real ones** — An explicit API model is selected
without its credentials. Nano Banana needs a paid `GEMINI_API_KEY` or Vertex AI
via `GEMINI_USE_VERTEXAI=true`; GPT Image needs `OPENAI_API_KEY`. Configure these
in `apps/api/.env` using `apps/api/.env.example`. Automatic never returns a mock.

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

## Make a film

After Review, open **Film**. New films start with all photos unassigned. Select several photo thumbnails and choose **New Chapter from selection** to name and create a Chapter in one action. Use **Move to Chapter** to choose a destination by its title and photo previews, or **Return to unassigned** to remove selected photos from the structure. The Unassigned and All photos filters let you organize photos in batches, including photos in previously saved Chapters. Chapter cards show their photos; choose **Edit** to see those photos in the library, adjust their order with the arrow buttons, and set their durations. Expand **Change image** on a photo to select its original or a generated image. Existing saved structures are retained; no automatic reset is performed. Empty structures and Chapters can be saved while organizing, but must contain photos before rendering. Choose Quiet Cinema, Memory Board, or Pulse Cut under **Title & film style**. Chapter style controls adjust pacing, motion amount, emphasis, sound effects, and visual intensity within the shared project identity. Enter exact scene durations in seconds or leave them automatic. Each Chapter starts with a 60-second limit; clear the limit for an unlimited Chapter.

Choose **Save and check timing** to see resolved durations and preflight errors. Entered durations are preserved; impossible limits block rendering. Render each Chapter, play its MP4 in the browser, and download it. Once every current Chapter has rendered, render the complete film using the overall title. It retains Chapter titles and reuses verified Chapter outputs. Editing one Chapter invalidates that output and the complete film while other Chapters remain reusable. Previous outputs remain available and are labelled as previous versions.

Film rendering runs locally at 16:9, 1920×1080, 30 fps. Install FFmpeg (`ffmpeg` and `ffprobe` on PATH) and Chrome, and set `CHROME_PATH` in `apps/api/.env` to the Chrome executable. Film rendering does not call an AI provider. Bundled system fonts and sound effects are used offline; the initial shared BGM is silence. New Recipes, user Capability code, and other output profiles are not exposed in this first delivery.

Film settings and render jobs persist in SQLite. Render snapshots/cache files live under `data/film/`; downloadable MP4s live in local object storage. Interrupted queued/running jobs fail explicitly on API restart and can be rendered again. Rendering captures immutable image bytes, so an edit cannot change an already running job.

The project-scoped API provides GET/PUT `/api/projects/:projectId/film`, GET `.../film/recipes`, POST `.../film/chapters/:chapterId/renders`, POST `.../film/assembly-renders`, GET `.../film/jobs/:jobId`, and GET `.../film/artifacts/:jobId`. Save requests include `expectedRevision`; render requests include `revision`. Artifact responses support byte ranges for seeking and `?download=1` for an attachment. POST `.../film/scenes/:sceneId/original` selects the original photo and clears generated-image adoption. Film routes apply the same organization authorization as other project routes.

Storyboard Motion fields have been removed: still-image generation no longer accepts or emits `motionDirection`. Legacy database values are retained for recovery but are not loaded into current contracts. Film motion comes from the selected template and the reduced-motion setting.
