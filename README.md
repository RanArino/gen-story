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

For **Ukiyo-e Woodblock**, Automatic uses Codex alone for scene images and test
samples, including retries and regeneration. If Codex is unavailable or times
out, the image fails and can be retried. Use the model selector to explicitly
choose an API model. Run the seed command below to refresh a previously seeded
Ukiyo-e preset in place. Existing images and saved project prompts are preserved.

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

The script prints the project URL when complete. It also seeds the eleven
built-in image style presets (idempotent — safe to re-run).

## Generate Style Preview Images (Optional)

The storyboard style gallery shows a preview image per style preset. The heart
in a preset's top-right corner marks it as a favorite; favorites are listed first
and are remembered in that browser (localStorage). The script
generates one base image, then restyles that same image into every other style
(OpenAI's "character anchor" pattern), so all eleven previews show the same
subject and differ only by visual style.

```sh
# Render all eleven previews
OPENAI_API_KEY=... pnpm tsx scripts/generate-style-previews.ts

# Regenerate only specific styles using the cached base
pnpm tsx scripts/generate-style-previews.ts "Anime Movie" "Film Photo"

# Regenerate the Codex-rendered previews with a local Codex subscription
pnpm tsx scripts/generate-style-previews.ts ukiyo-e-woodblock radiant-cel-cgi

# Force the base image to be regenerated
pnpm tsx scripts/generate-style-previews.ts --fresh-base
```

This writes JPEG files to `apps/web/public/style-previews/`. The base image is
cached at `data/style-preview-base.png` so re-runs do not regenerate it.
Creating the base and rendering the other presets requires `OPENAI_API_KEY`
(read from `apps/api/.env`). The Ukiyo-e restyle uses Codex and can run without
an API key when the base is already cached.

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
Ukiyo-e Automatic displays the Codex error and can be retried when Codex is
available again. For other styles, Automatic needs a paid `GEMINI_API_KEY` or
configured Vertex AI for fallback. Each local retry attempts Codex again.

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

See [docs/ui-design.md](docs/ui-design.md) for web UI conventions and design tooling.

## License

Released under the [MIT License](LICENSE).

## Make a film

After Review, open **Film**. The Film page is one editing workspace: the overall title, save status, **Save and check timing**, **Organize photos**, **Create AI direction** and **Export…** stay in the top bar, so a title edit never sends you looking for Save. New films start with all photos unassigned and the photo organizer open. Select several photo thumbnails and choose **New Chapter from selection** to name and create a Chapter in one action. Use **Move to Chapter** to choose a destination by its title and photo previews, or **Return to unassigned** to remove selected photos from the structure. The Unassigned and All photos filters let you organize photos in batches, including photos in previously saved Chapters; choose **Show photos** on a Chapter to reorder its photos with the arrow buttons. Opening and closing the organizer keeps the selected Chapter, scene and preview position. Existing saved structures are retained; no automatic reset is performed. Empty structures and Chapters can be saved while organizing, but must contain photos before rendering. Template (Quiet Cinema, Memory Board, Pulse Cut), reduced motion and video size are under **Video settings** in the top bar. Each Chapter starts with a 60-second limit; clear the limit to remove the custom Chapter limit. The cinematic runtime currently supports up to 600 seconds per Chapter; longer films can use multiple Chapters.

Below the organizer, a player shows the selected photo with its camera move and the subtitles for the current export language, and an ordered strip lists each Chapter and its scenes. Select a scene to open its only editor: Japanese and English subtitles (120 and 200 characters), display time in seconds (empty = automatic), image source (original or a generated image), and camera move, strength and focus point. Light, sound and ambience open on demand under **Light and sound**. Select a Chapter heading to edit its name, time limit, music and sound-effect level. An empty subtitle shows no text for that photo; **Use scene title** removes the override so the Storyboard scene title is used. Saved words stay with the photo when it moves between Chapters. On screens narrower than 760 px, **Edit this scene** opens the editor as a sheet over the preview. Edits are saved with **Save and check timing**, and pending edits are saved automatically before an AI request or an export. A failed save keeps every edit and offers **Retry save**.

### AI direction

Every Chapter needs an applied AI direction before it can be rendered. **Create AI direction** (in the top bar and next to the photos) directs the whole film; Chapter and single-photo requests sit in the Chapter and scene editors. The button explains what the AI reads (your photos, their order and the Storyboard story), what it proposes (camera moves, music, sound effects and Japanese/English subtitles) and that subtitles you entered are kept. A confirmation shows the scope, AI runtime (Claude or Codex, from Settings), the number of photos and an estimated time before any AI call; the same photos reuse the saved direction without another call. A ready draft opens in the same player and editors, marked **Previewing AI draft**: play it, and edit its subtitles, camera, light and sound where you see them. **Use this draft** (or the whole-film **Approve all N Chapters**) makes it the current version and leaves a compact **Applied** status. You can keep revising an applied camera, light, sound or music, and the saved subtitles, without another AI request. Applying an older draft never overwrites a Chapter name or subtitle you changed after the request (including a deliberately empty subtitle); when both you and the draft changed the same value, the editor lists each conflict and you choose which to keep. If a Chapter's photos, their order, or the video size change afterwards, the direction is marked as changed and must be made again. Failures are shown in the workspace with a retry. Rendering and downloading never call the AI. AI direction is not available with the API runtime.

**Try moves** in a scene's camera control opens a camera sample: every move plays on one bundled example photo with the same length, video size and focus, in gentle and strong versions, with play/pause and a start/middle/end frame comparison (the default when the system prefers reduced motion). The main preview then shows the chosen move on your own photo with its current size and focus, using the same camera path and framing code as the renderer. The preview omits atmosphere effects, walking sway, music and the renderer's subtitle typography.

**Export…** opens a compact dialog: export the whole film or one Chapter, in the current video size, with Both, Japanese only, English only, or None subtitles. It shows the version (revision) being exported, whether any Chapter still has an unapplied draft (only applied direction is exported), and a **Check subtitles** list whose **Edit** buttons close the dialog and open that scene's editor. The video size is changed under **Video settings**: 16:9 (1920×1080), 9:16 (1080×1920), or 1:1 (1080×1080).

Export saves pending edits, then renders. A complete-film job generates missing or changed Chapters automatically, reuses matching verified Chapter outputs, and joins them under the overall title. When the job finishes the dialog plays and downloads exactly that output; outputs of the current version for the chosen subtitle mode are shown as current, and earlier exports stay listed with their version as **earlier version**. Editing one Chapter invalidates that output and the complete film while other Chapters remain reusable.

Film rendering runs locally at 30 fps in the selected size. Install FFmpeg (`ffmpeg` and `ffprobe` on PATH) and Google Chrome. Chrome is detected in standard local install locations or PATH. For a custom installation, set `CHROME_PATH` in `apps/api/.env` to its executable and restart the API. An explicit invalid override reports an error; it never silently switches browsers. The detected Chrome path and version are included in the render fingerprint. Rendering itself does not call an AI provider; it materializes the approved direction into exact camera paths, footsteps with walking sway, per-photo light and ambience, sound events, and a locally synthesized score built from the approved key, tempo and instruments. At rest each whole photo fits the frame over a subdued blurred background; camera moves then travel toward the chosen focus point. Subtitles wrap within the frame and are sized for phone viewing in 9:16 and 1:1. Bundled system fonts and procedural sound instruments run offline. New Recipes and user Capability code are not exposed.

Template examples using the same three synthetic coastal travel photos are available at `/film-previews/quiet-cinema.mp4`, `/film-previews/memory-board.mp4`, and `/film-previews/pulse-cut.mp4` on the web server. These archived 720p examples show the earlier sparse template renderer, not the current cinematic GUI output. They play without the API or local render setup. Representative cinematic public previews remain part of the quality-recovery work. Source photos, prompts, and the regeneration command are documented in [the preview asset notes](apps/web/public/film-previews/README.md).

Film settings and render jobs persist in SQLite. Render snapshots/cache files live under `data/film/`; downloadable MP4s live in local object storage. Interrupted queued/running jobs fail explicitly on API restart and can be rendered again. Rendering captures immutable image bytes, so an edit cannot change an already running job.

The project-scoped API provides GET/PUT `/api/projects/:projectId/film`, GET `.../film/recipes`, POST `.../film/chapters/:chapterId/renders`, POST `.../film/assembly-renders`, GET `.../film/jobs/:jobId`, and GET `.../film/artifacts/:jobId`. Complete-film rendering does not require individual Chapter jobs first; it schedules missing Chapters and reports failures on the parent job. Save requests include `expectedRevision`, optionally `outputAspect` (`"16:9"`, `"9:16"`, or `"1:1"`), and optionally `sceneCaptions: { [sceneId]: { ja, en } }`. Missing overrides use scene titles; explicit empty strings hide both lines. Overrides must reference current project scenes; deleted-scene overrides are omitted when loading the treatment. Render requests include `revision` and optionally `subtitles` (`"both"` default, `"ja"`, `"en"`, or `"none"`); GET `.../film?subtitles=` returns preflight fingerprints for that mode. Rendering a Chapter without a current approved direction returns 409. POST `.../film/directions` with `{ scope: "film" | "chapter", chapterId?, regenerate?, sceneId? }` starts AI direction (202) and returns the proposals; planning runs in the background and the Film detail lists `directions` with `generating`, `proposed`, `approved` or `failed` status plus `directionInputDigests` for staleness. PATCH `.../film/directions/:id` with `{ content }` edits a proposed direction, or revises an applied one (camera, light, sound and music only; the saved treatment owns its name and subtitles). POST `.../film/directions/:id/approve` with `{ expectedRevision, resolutions? }` applies it and returns the updated Film detail. Each proposal records the Chapter name and subtitles it started from (`base`); a value changed both manually and by the draft returns 409 `direction_conflict` with `conflicts: [{ field, mine, draft }]` (`field` is `chapterName` or `caption:<sceneId>`), and `resolutions: { [field]: "mine" | "draft" }` resolves them. Artifact responses support byte ranges for seeking and `?download=1` for an attachment. POST `.../film/scenes/:sceneId/original` selects the original photo and clears generated-image adoption. Film routes apply the same organization authorization as other project routes.

Storyboard Motion fields have been removed: still-image generation no longer accepts or emits `motionDirection`. Legacy database values are retained for recovery but are not loaded into current contracts. Film motion comes from the selected template and the reduced-motion setting.
