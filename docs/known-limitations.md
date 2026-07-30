# Known Limitations

Gen Story is published as a **local demo**. It is intentionally scoped to run on a
single machine so the storyboard-and-generation experience can be explored without
any cloud setup. The following features are deliberately excluded from this version.

## Authentication

- A single fixed local principal is seeded automatically (`Local User` /
  `Local Organization`). There is no sign-up, login, password, or multi-user
  support. Every request runs as the same local user.
- No production identity provider (WorkOS/SSO/OAuth) is wired up.

## Generation & jobs

- Background work runs in-process. Image generation uses the `generation_requests`
  table and text/vision AI work (photo analysis, scene AI fill, complement scene
  proposals) uses the `ai_jobs` table; both are polled by `LocalJobWorker` inside
  the API process. There is no external queue, no multi-process worker, and no
  retry-with-backoff.
- Progress is delivered by server-sent events on
  `GET /api/projects/:projectId/events`, fanned out in memory to subscribers of
  the same API process. Events are not persisted or replayed: a client that
  connects late misses earlier events and must read job state from
  `GET /api/ai-jobs/:aiJobId` instead.
- Jobs left `running` by a killed API process are marked `failed` with
  `interrupted by restart` on the next startup; they are not resumed.
- Image generation defaults to a **mock adapter** that returns placeholder
  images. Real generation requires an `OPENAI_API_KEY`; its presence alone
  selects the OpenAI adapter.
- Confirming a test-generation sample only records the choice. It does not start
  the real generation — that is a separate action on the Generate screen.
- A storyboard may hold any number of test-generation batches. Exactly one of
  them is confirmed at a time, and confirming a sample from an older batch moves
  the confirmation rather than copying it. Per-variant adjustments apply to the
  newest batch only; older batches stay readable and confirmable. Every batch is
  listed in the storyboard's test-generation dialog and on the generation-history
  screen.
- Samples are generated from a real scene, so they produce ordinary
  `generation_requests` rows for it. Scene-scoped views — the review screen's
  per-scene history and the per-scene groups of the generation-history screen —
  list only the **confirmed** sample and hide the rejected ones, which are read
  in the test-generation dialog instead. The confirmed sample is tagged as a
  sample and can be chosen as the scene's image like any other generation.
- A new batch is refused only while a sample of the newest batch is still queued
  or running. There is no "reset": generating another batch is the way to
  replace samples, and each one costs three image generations.
- Samples are always generated from the storyboard's **first** scene, so they
  represent that scene's prompt rather than the storyboard as a whole.
- Photo analysis for emotion candidates falls back to deterministic local
  suggestions unless a `GEMINI_API_KEY` is provided.

## Video & audio

- There is **no video rendering or export**. The product builds a storyboard and
  per-scene AI images; assembling those into a finished video is out of scope for
  this demo.
- No background-music (BGM) generation or audio pipeline.

## Infrastructure

- Storage is the local filesystem (`data/uploads/...`) and the database is a
  local SQLite file. No object storage, no managed database, no external queue.
- No production cloud deployment, containerization, or billing/payments.
- Structured request logs print to the terminal; there is no external
  observability, metrics, or alerting.

## Scope notes

These exclusions are enforced by the repository's agent rules (`AGENTS.md`):
production cloud deployment, external queues, paid billing, production auth, SNS
publishing, video generation, and BGM generation are not added unless explicitly
requested. This keeps the demo simple to run and easy to reason about.
