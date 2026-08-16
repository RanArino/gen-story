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
  table and text/vision AI work (photo analysis, story setup, scene AI fill,
  complement scene proposals) uses the `ai_jobs` table; both are polled by
  `LocalJobWorker` inside the API process. There is no external queue, no
  multi-process worker. Gemini `429 RESOURCE_EXHAUSTED` responses retry at
  most twice, honoring the provider's retry delay when supplied; other
  failures remain terminal.
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
- Each scene has a "Follow source photo" control (Off / Low / High), default
  Off, on its card in the storyboard. Off is the long-standing behavior:
  prompt-only, the photo is never sent to the image model. Low and High send
  the scene's primary and reference photos to OpenAI's `images.edit`. **Under
  the default model, `gpt-image-2`, there is no API-level fidelity parameter
  at all**: this model always processes an attached photo at maximum fidelity
  and rejects the `input_fidelity` parameter outright (confirmed against a
  live `400` and against OpenAI's image generation guide). Only `gpt-image-1`
  is confirmed to honor `input_fidelity: "low" | "high"` as a real parameter;
  this codebase has no way to select that model. To still give Low and High a
  real distinction, the composed prompt sent alongside the photo carries an
  explicit instruction — "preserve precisely" at High, "loose inspiration,
  reinterpret freely" at Low — following OpenAI's own documented technique for
  steering multi-image reference use when no numeric parameter exists. This is
  prompt-following, not an enforced setting, and its real effect on output is
  unverified without a paid generation at each level. Attaching photos at any
  non-Off level costs more input tokens than prompt-only generation, per the
  same OpenAI guidance.
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
- Story setup (setup step 4) falls back to the deterministic `composeCommonPrompt`
  template without a `GEMINI_API_KEY`, so the flow still completes but the story
  is only as good as the stored photo analysis summary.
- Every storyboard carries a `characterPolicy` (`featured` / `background_only` /
  `none`, default `background_only`) that adds a suppression or encouragement
  directive to every scene's composed prompt — this is what stops a story built
  from a plain landscape photo from getting an uninvented character. Story setup
  auto-suggests `none` when no photo insight mentions a person, but only while
  the storyboard is still at the default; it never overwrites a value the user
  set on the Storyboard page. For `featured` stories, an optional paid image call
  can generate one single-character reference sheet. The latest successful sheet
  is automatically attached to later scene image requests. Multi-character cast
  management and separate named-character sheets are not supported.

## Guided storyboard setup

- A new storyboard walks five ordered steps (photos → tone → style → story →
  scenes) and hides the steps it has not reached yet. Once all five are
  satisfied the storyboard is stamped complete and the full page unlocks
  permanently; a later edit that blanks a field does not re-lock it.
- Storyboards created before this feature were backfilled as complete by the
  `setup_completed_at` migration, so they keep the previous free-editing
  behaviour and never see the stepper.
- Steps 2, 4 and 5 spend AI calls. Each runs from an explicit button that states
  the number of calls it will make; nothing generates on arrival at a step.
  Step 5 bills once per scene that still has a blank field.
- Deleting a scene with the ✕ on its card is immediate and permanent: it asks
  for confirmation, then deletes on the server rather than waiting for "Save
  scenes". There is no undo and no restore screen for scenes.
- "Bulk delete" in the scene toolbar deletes in one request, with a choice of
  scope: **all scenes**, or **only the scenes AI has not filled** (scenes that
  still have a blank field — the same test that decides what "Fill all with AI"
  bills for). It is double-checked: a modal states the count for each scope, and
  its confirm button stays disabled until the acknowledgement checkbox is
  ticked. It is equally permanent, it discards unsaved edits because the scene
  list is re-read afterwards, and generated images survive with no scene
  referencing them.
- A photo may be the primary photo of more than one scene — a second scene from
  the same shot is how you get a different palette or moment out of it. The "Add
  scenes" picker opens on "Unused only" and switches to "All", where in-use
  photos are marked and can be picked again; selecting one asks for confirmation
  before the scenes are created.

## In-app agent chat

- The chat requires a locally installed, subscription-logged-in Codex or Claude
  Code CLI (`GEN_STORY_AGENT_RUNTIME=codex`/`claude`) and only runs on a local
  deployment. On the default `api` runtime the chat is visible but disabled,
  with the reason shown in the panel.
- One conversation is bound to one provider-native session. Switching providers,
  or recovering a session the provider no longer has, means starting a new
  session with **New session**: the Gen Story transcript is kept, but the new
  provider session starts with no context. Gen Story never silently replays the
  transcript to fake that context.
- The MCP server is attached to the spawned CLI per process — as
  `-c mcp_servers.<name>.url=...` config overrides for Codex and as
  `--mcp-config` plus an explicit tool allowlist for Claude Code. These flags
  have not been re-verified against a live CLI since the M1 probes; if a CLI
  changes them, the chat's tool calls stop working while ordinary conversation
  still succeeds.
- Compaction policy is a turn count (20 turns per session), not provider token
  usage, which Gen Story cannot observe. Compaction is recorded and shown, and
  can also be triggered manually.
- The chat's first slice covers AI photo analysis, emotion/tone, and style
  preset only. Scenes, prompts, and image generation are not reachable from it.
- Image generation is never triggered from the chat; it stays on the OpenAI API
  behind its own explicitly labelled paid action.

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
