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

- The job queue and progress-event ports are `NoOp` stubs
  (`apps/api/src/app/create-api-context.ts`). Image generation runs
  synchronously within the request rather than through a real async queue, and
  there is no live progress stream.
- Image generation defaults to a **mock adapter** that returns placeholder
  images. Real generation requires an `OPENAI_API_KEY` and
  `IMAGE_GENERATION_ADAPTER=openai`.
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
