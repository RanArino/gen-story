# Common Project Prompt — Auto-Generated, Editable, Applied to Every Scene

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.


## Purpose / Big Picture

Today every storyboard carries a `tone` and an optional style preset, and each scene's
image is generated from a prompt assembled per-scene in `apps/api/src/generation/prompt-composer.ts`.
There is no single, project-level "common prompt" that the user can see or edit, and
nothing guarantees that a deliberate, human-readable style/emotion instruction is shared
verbatim across every scene.

After this change a storyboard gains a **common prompt**: one block of natural-language
text that describes the overall emotional tone and visual style for the whole project.
It is **auto-generated** the first time a storyboard is created or when the user has not
customized it (derived from the storyboard `tone` plus the selected style preset), it is
**editable** by the user in the StoryboardPage UI, and it is **applied to every scene's
generation prompt** so all generated images share a consistent foundation.

A reader can see it working by: opening a project's storyboard, observing a populated
"Common Prompt" textarea, editing it, regenerating it from a button, and confirming the
edited text appears inside the composed prompt sent to image generation for every scene.

This closes three rows of Section 5 ("Common Project Prompt") in `docs/gap-analysis.md`:

1. Per-project common prompt (auto-generated from emotion + style) — currently ❌.
2. Common prompt editable by user — currently ❌.
3. Prompt consistency mechanism across scenes — currently ⚠️.


## Progress

- [x] (2026-05-17 01:03Z) Milestone 1 — Domain: added `commonPrompt` to the `Storyboard`
      aggregate (`model.ts`), `CreateStoryboardInput`, and `createStoryboard`; added pure
      `composeCommonPrompt` rule to `rules.ts` and re-exported it from `index.ts`. Domain
      tests pass (20 tests green via `pnpm --filter @gen-story/domain test`).
- [x] (2026-05-17 01:10Z) Milestone 2 — Persistence: added `common_prompt` column to the
      `storyboards` table in `apps/api/src/db/schema.ts`; hand-authored
      `drizzle/migrations/0004_add_storyboard_common_prompt.sql` and registered it in
      `_journal.json` (idx 3); updated `mapStoryboard` and `save` in
      `apps/api/src/db/repositories.ts`. `db:migrate` applied cleanly — verified
      `common_prompt` column present on the `storyboards` table.
- [x] (2026-05-17 01:18Z) Milestone 3 — Application: added `commonPrompt?` to
      `UpsertStoryboardInput`; added a `resolveCommonPrompt` helper in `use-cases.ts` that
      keeps an existing value, uses an explicit non-empty value verbatim, or auto-generates
      via `composeCommonPrompt` (explicit empty string regenerates). Added 4 use-case
      tests; `pnpm --filter @gen-story/application test` reports 19 tests green.
- [x] (2026-05-17 01:20Z) Milestone 4 — API boundary: added `commonPrompt` to
      `StoryboardDto` (`packages/shared`), `commonPrompt` to `UpsertStoryboardSchema`
      (`apps/api/src/http/schemas.ts`), passed it through the route handler
      (`routes.ts`), and mapped it in `toStoryboardDto` (`dto-mappers.ts`).
- [x] (2026-05-17 01:24Z) Milestone 5 — Generation: added a `commonPrompt` input to
      `composeImagePrompt` (`prompt-composer.ts`), inserted after the style preset prompt
      and before the camera descriptor; threaded `storyboard.commonPrompt` through the
      `composeImagePrompt` call in `local-image-preprocessing.ts`. Added
      `prompt-composer.test.ts` asserting the common prompt is present/omitted as
      expected. `pnpm typecheck` passes across all 5 projects.
- [x] (2026-05-17 01:30Z) Milestone 6 — Web UI: added `commonPrompt` to the
      `upsertStoryboard` API client; added a "Common prompt" section to `StoryboardPage`
      with an editable textarea (`commonPromptDraft` state synced from the storyboard via
      effect), a "Save common prompt" button, and a "Regenerate from tone & style" button
      that submits `commonPrompt: ""`. `pnpm typecheck` passes across all 5 projects.
- [x] (2026-05-17 01:38Z) Milestone 7 — Validation: `pnpm typecheck` green (5 projects);
      `pnpm test` green (domain 20, application 19, api 73); `pnpm build` green; the
      domain/application boundary `rg` check returns no matches. `pnpm lint` reports 0
      errors (1 pre-existing unused-import warning in `rules.ts`, unrelated). `pnpm format`
      fails repo-wide on pre-existing Prettier drift — all files this plan touched were
      already drift at HEAD, so no new drift was introduced and no repo-wide reformat was
      done. `docs/gap-analysis.md` Section 5 rows 1–3 set to ✅ and the summary row updated
      to `3 / 1 / 0`. Interactive browser verification was not performed in this
      environment; behavior is covered by `prompt-composer.test.ts` and the four
      `upsertStoryboard` use-case tests.


## Surprises & Discoveries

- Observation: `pnpm --filter @gen-story/api db:generate` must run with cwd at the repo
  root, not the package directory. The `drizzle.config.ts` `schema` path
  (`apps/api/src/db/schema.ts`) is resolved relative to the process cwd, so running it via
  the package script (cwd `apps/api`) fails with "No schema files found".
  Evidence: `drizzle-kit generate` errored until invoked from the repo root with
  `apps/api/node_modules/.bin/drizzle-kit generate --config=drizzle.config.ts`.

- Observation: Pre-existing migration drift unrelated to this plan —
  `drizzle/migrations/0003_add_test_generation_batches.sql` exists as a file but is NOT
  registered in `drizzle/migrations/meta/_journal.json` and has no `meta/0003_snapshot.json`.
  Consequently `test_generation_batches` was never created in the local dev DB, and
  `drizzle-kit generate` (which diffs from snapshot `0002`) bundles that table's
  `CREATE TABLE` into any newly generated migration.
  Evidence: `__drizzle_migrations` in `data/gen-story.sqlite` has only 3 rows (0000–0002);
  `SELECT ... sqlite_master ... 'test_generation_batches'` returns 0.
  Resolution for this plan: the auto-generated bundled migration was discarded and the
  `common_prompt` change was hand-authored as an isolated migration
  (`0004_add_storyboard_common_prompt.sql`) registered directly in `_journal.json`. The
  `test_generation_batches` journal/snapshot drift is left untouched as out of scope and
  should be flagged to the team separately.


## Decision Log

- Decision: Place the common-prompt composition logic as a pure function
  `composeCommonPrompt` in `packages/domain/src/rules.ts`, not in
  `apps/api/src/generation/prompt-composer.ts`.
  Rationale: Deriving a project-wide prompt from emotion + style is a business rule, and
  the `hexagonal-ddd-coach` skill requires business rules to live in Domain/Use Case code.
  The existing `prompt-composer.ts` maps selections to cinematic descriptor strings — that
  is a generation-adapter presentation concern and stays in `apps/api`. The common prompt
  is a domain concept the user reads and edits, so it belongs in the domain.
  Date/Author: 2026-05-17 / Claude

- Decision: Store a single `commonPrompt: string` field on `Storyboard` (no separate
  `commonPromptIsCustom` flag). Auto-generation happens in `upsertStoryboard` only when the
  incoming value is absent/empty and no existing non-empty value is stored; an explicit
  empty string from the client triggers regeneration.
  Rationale: Minimal sufficient design. A custom/auto flag is extra state the requirements
  do not ask for; "regenerate" is expressible as "send empty, let the server fill it".
  Date/Author: 2026-05-17 / Claude

- Decision: `commonPrompt` is nullable-free — column is `NOT NULL DEFAULT ''`, domain type
  is `string` (empty string = "not set").
  Rationale: Matches how `tone` and other text fields are modeled (non-null strings);
  avoids `null` branching across DTO, mapper, and UI.
  Date/Author: 2026-05-17 / Claude


## Outcomes & Retrospective

All seven milestones are complete. A storyboard now carries a `commonPrompt`: it is
auto-generated from the storyboard tone + style preset via the pure domain rule
`composeCommonPrompt` when no value is stored, it is editable in the `StoryboardPage`
"Common prompt" section (with a "Regenerate from tone & style" button), and it is composed
into every scene's image-generation prompt by `composeImagePrompt`. This closes Section 5
rows 1–3 of `docs/gap-analysis.md`.

Validation: `pnpm typecheck`, `pnpm test` (112 tests across domain/application/api),
`pnpm build`, and the architecture boundary check all pass. The hexagonal-DDD goal held —
the auto-generation business rule lives in `packages/domain` and no new ports, aggregates,
or use-case splits were introduced.

Remaining gaps / lessons:
- Section 5 row 4 ("Story-level AI context across uploaded photos") is still ⚠️ and was
  intentionally out of scope — it needs real multi-photo vision analysis.
- Pre-existing repo issues surfaced (see Surprises & Discoveries) that are out of scope and
  should be flagged to the team: (1) the unregistered `0003_add_test_generation_batches`
  migration / snapshot drift, and (2) repo-wide Prettier drift causing `pnpm format` to
  fail independently of this work.
- `db:generate` cwd sensitivity is worth fixing in the package script later.


## Context and Orientation

This is a pnpm monorepo with strict clean-architecture layering (see `CLAUDE.md`).
Relevant terms and current state:

- **Storyboard**: the per-project aggregate that holds `tone` (a free-text emotional tone
  string), an optional `stylePresetId`, and an ordered list of scene IDs. Defined as a
  type plus `createStoryboard` factory in `packages/domain/src/model.ts` (type at
  lines 99-108, `CreateStoryboardInput` at 234-243, `createStoryboard` at 401-412).
- **StylePreset**: a named, reusable style with a generation `prompt` string. Type in
  `packages/domain/src/model.ts` lines 110-118.
- **Domain rules**: pure business-rule functions live in `packages/domain/src/rules.ts`
  (tested in `packages/domain/src/rules.test.ts`). The domain layer must not import any
  framework, ORM, or `apps/` code.
- **Use cases**: `packages/application/src/use-cases.ts`. `upsertStoryboard`
  (lines ~323-369) creates or updates a storyboard via `createStoryboard` and persists it
  through the `storyboards` output port. Tested in `use-cases.test.ts`.
- **Ports**: `StoryboardRepository` interface in `packages/application/src/ports.ts`.
- **DTOs**: `StoryboardDto` in `packages/shared/src/index.ts` (lines 54-63) — the explicit
  REST response shape; no ORM type may cross the API boundary.
- **API**: raw Node HTTP server. `apps/api/src/http/schemas.ts` holds Zod request schemas
  (`UpsertStoryboardSchema` at lines 20-25). `apps/api/src/http/routes.ts` has the
  `PUT /api/storyboards/:storyboardId` handler that calls `upsertStoryboard` (lines
  ~480-500). `apps/api/src/http/dto-mappers.ts` has `toStoryboardDto` (lines 97-108).
- **DB**: Drizzle + SQLite. The `storyboards` table is defined in
  `apps/api/src/db/schema.ts` (lines 94-111). Migrations live in `drizzle/migrations/`
  (latest is `0003_add_test_generation_batches.sql`); new migrations are produced with
  `pnpm --filter @gen-story/api db:generate`. The Drizzle storyboard repository adapter
  maps DB rows to/from the domain `Storyboard` — locate it under `apps/api/src/db/`
  (the repository that implements `StoryboardRepository`).
- **Generation prompt**: `apps/api/src/generation/prompt-composer.ts` exports
  `composeImagePrompt({ imagePrompt, emotion, cameraDirection, lightingDirection, tone,
  stylePresetPrompt })` (lines 60-89). Its only caller is
  `apps/api/src/images/local-image-preprocessing.ts` (lines 58-65), which loads the
  storyboard and its style preset before composing.
- **Web**: `apps/web/src/components/storyboard/StoryboardPage.tsx` renders the storyboard
  editor (tone, style gallery, scene list, test-generation gate). It calls the API client
  for the storyboard upsert.

### Hexagonal-DDD classification (per `.claude/skills/hexagonal-ddd-coach`)

## A. Classification Result

**Small.** Invariant differences are minor — one new non-null text field on an existing
aggregate. State transitions (`draft/editing/ready/completed`) are unchanged. The
storyboard lifecycle is identical. The REST contract change is purely additive and
backward compatible. No new aggregate or use-case split is warranted.

## B. Recommended Architecture Changes

- Extend the `Storyboard` entity with a `commonPrompt: string` value (treated as a simple
  domain field; no separate Value Object class is justified for a single free-text field).
- Add one pure Domain rule function `composeCommonPrompt` in `packages/domain/src/rules.ts`
  — this is the "auto-generated from emotion + style" business rule and must stay framework-
  free and in the domain layer.
- No new ports. The existing `StoryboardRepository` port is reused; only its row mapper
  and the underlying table gain a column.
- No use-case split: `upsertStoryboard` keeps its single success/failure contract and
  simply gains optional input plus an auto-generate branch.

## C. Minimal Implementation Sequence

1. Domain: `Storyboard` type + `CreateStoryboardInput` + `createStoryboard` + new
   `composeCommonPrompt` rule. Tests first (`model.test.ts`, `rules.test.ts`).
2. Persistence: migration + Drizzle table column + repository mapper.
3. Use case: `upsertStoryboard` input + auto-generate branch + tests.
4. API boundary: DTO, Zod schema, route handler, DTO mapper.
5. Generation: thread `commonPrompt` through `composeImagePrompt` and its caller.
6. Web UI: editable textarea + regenerate button.

## D. Test Plan

Shared behavior:
- `createStoryboard` defaults `commonPrompt` to `""` when not supplied and preserves a
  supplied value (trim only — not "required text", empty is allowed).
- `composeCommonPrompt` returns a deterministic, non-empty string for a given tone +
  optional style preset, and a tone-only string when no preset is given.
- `composeImagePrompt` output contains the common prompt text when one is provided.

Variant-specific behavior:
- `upsertStoryboard` with `commonPrompt` omitted on a brand-new storyboard auto-generates
  a non-empty common prompt.
- `upsertStoryboard` with `commonPrompt` omitted on an existing storyboard that already
  has a non-empty value keeps the existing value.
- `upsertStoryboard` with an explicit empty `commonPrompt` regenerates from tone + style.
- `upsertStoryboard` with an explicit non-empty `commonPrompt` stores it verbatim.

## E. Risks And Migration Plan

- Compatibility: REST change is additive; existing clients that omit `commonPrompt`
  continue to work (server auto-generates). DTO gains a field — TypeScript consumers in
  `apps/web` recompile cleanly because the field is always present.
- Data migration: one additive column `common_prompt TEXT NOT NULL DEFAULT ''`. Existing
  rows get `''`; they auto-generate on the next `upsertStoryboard` call. No backfill
  script required.
- Rollback: drop the column / revert the migration file; no destructive data loss because
  the column is additive and other tables do not depend on it.
- Deprecation: no old flow is removed; nothing to deprecate.


## Plan of Work

The work is sequenced inside-out (domain → persistence → application → API → generation →
web) so each layer compiles against an already-correct layer beneath it. This is the
minimal sufficient path: a single new field plus one pure rule function, threaded through
the existing storyboard read/write path and the existing generation prompt path. No new
ports, aggregates, or use cases are introduced.

### Milestone 1 — Domain

In `packages/domain/src/model.ts`:

- Add `commonPrompt: string;` to the `Storyboard` type (after `stylePresetId`).
- Add `commonPrompt?: string;` to `CreateStoryboardInput`.
- In `createStoryboard`, set `commonPrompt: (input.commonPrompt ?? "").trim()`. Do not use
  `trimRequiredText` — an empty common prompt is a valid state ("not yet generated").

In `packages/domain/src/rules.ts`, add and export a pure function:

    export function composeCommonPrompt(input: {
      tone: string;
      stylePresetName: string | null;
      stylePresetPrompt: string | null;
    }): string

It returns a short, human-readable instruction such as
`"Overall emotional tone: <tone>. Visual style: <stylePresetName> — <stylePresetPrompt>."`
When no style preset is given it returns just the tone clause. It must not import
anything outside `packages/domain`. Keep it deterministic (no randomness, no dates).

Update `packages/domain/src/model.test.ts` to assert `createStoryboard` defaults and
preserves `commonPrompt`. Add `composeCommonPrompt` cases to `rules.test.ts`.

### Milestone 2 — Persistence

- In `apps/api/src/db/schema.ts`, add to the `storyboards` table:
  `commonPrompt: text("common_prompt").notNull().default("")`.
- Run `pnpm --filter @gen-story/api db:generate` to produce
  `drizzle/migrations/0004_*.sql`. Inspect the generated SQL; it must `ALTER TABLE
  storyboards ADD COLUMN common_prompt text NOT NULL DEFAULT ''` (or the SQLite
  table-rebuild equivalent Drizzle emits). Rename the file to a descriptive name if the
  repo convention uses descriptive suffixes (e.g. `0004_add_storyboard_common_prompt.sql`)
  and keep `drizzle/migrations/meta` consistent — only rename if existing migrations show
  that convention; otherwise keep the generated name.
- Apply with `pnpm --filter @gen-story/api db:migrate`.
- In the Drizzle storyboard repository adapter (the file under `apps/api/src/db/` that
  implements `StoryboardRepository`), update the row→domain mapper to read
  `commonPrompt: row.commonPrompt` and the domain→row mapper to write
  `commonPrompt: storyboard.commonPrompt`.

### Milestone 3 — Application

In `packages/application/src/use-cases.ts`:

- Add `commonPrompt?: string;` to `UpsertStoryboardInput`.
- In `upsertStoryboard`, after loading `existingStoryboard` and resolving the effective
  `stylePresetId`, compute the effective common prompt:
  - If `input.commonPrompt` is a non-empty trimmed string → use it verbatim.
  - Else if `existingStoryboard?.commonPrompt` is non-empty → keep it.
  - Else → call `composeCommonPrompt`, loading the style preset name/prompt via the
    `stylePresets` port when a `stylePresetId` is set.
- Pass the result into `createStoryboard({ ..., commonPrompt })`.

Note the `stylePresets` repository port is already a dependency used elsewhere in the
file (e.g. the AI-fill flow loads `deps.stylePresets.findById`). Reuse it; do not add a
new port.

Update `packages/application/src/use-cases.test.ts` with the four `upsertStoryboard`
cases listed in the Test Plan above.

### Milestone 4 — API boundary

- `packages/shared/src/index.ts`: add `commonPrompt: string;` to `StoryboardDto`.
- `apps/api/src/http/schemas.ts`: add `commonPrompt: z.string().optional()` to
  `UpsertStoryboardSchema`.
- `apps/api/src/http/routes.ts`: pass `commonPrompt: parsed.data.commonPrompt` into the
  `upsertStoryboard` call.
- `apps/api/src/http/dto-mappers.ts`: add `commonPrompt: storyboard.commonPrompt` to
  `toStoryboardDto`.

### Milestone 5 — Generation

- `apps/api/src/generation/prompt-composer.ts`: add `commonPrompt: string` to the
  `composeImagePrompt` input object. Push it onto `segments` early — after the style
  preset prompt and before the camera descriptor — so it frames the whole prompt. Skip it
  when empty.
- `apps/api/src/images/local-image-preprocessing.ts`: pass
  `commonPrompt: storyboard.commonPrompt ?? ""` into the `composeImagePrompt` call
  (the storyboard is already loaded there at lines 49-52).

This is the consistency mechanism: because every scene's generation prompt is composed
from the same storyboard `commonPrompt`, all scenes share that instruction verbatim.

### Milestone 6 — Web UI

In `apps/web/src/components/storyboard/StoryboardPage.tsx`:

- Render a "Common Prompt" `<textarea>` bound to the storyboard's `commonPrompt`, in the
  storyboard-settings area near the existing `tone` / style controls.
- Add a "Regenerate" button that submits the storyboard upsert with `commonPrompt: ""`
  (the server then auto-generates and returns the fresh value, which the page re-renders).
- Saving an edited textarea submits the upsert with the edited string.
- Reuse the existing storyboard upsert API-client call and existing styling patterns in
  `StoryboardPage.module.css`; do not introduce new component abstractions.

If `StylePresetDto` is needed to show the style name in the regenerate hint, it is already
loaded by the page (the style gallery uses it) — no new fetch required.

### Milestone 7 — Validation & docs

Run the full check suite (see Concrete Steps) and update `docs/gap-analysis.md`:
Section 5 rows 1 and 2 move from ❌ to ✅, row 3 ("Prompt consistency mechanism") moves
from ⚠️ to ✅, and the Section 5 summary-table row plus any affected note text are
updated. (Note: at plan-creation time rows 1 and 2 are set to 🟡 In progress per
`CLAUDE.md`; this milestone advances them to ✅.)


## Concrete Steps

All commands run from the repository root `/Users/ran/my-app/gen-story`.

1. Domain change + tests:

       pnpm --filter @gen-story/domain test

   Expect the new `composeCommonPrompt` and `createStoryboard` cases to pass.

2. Generate and apply the migration:

       pnpm --filter @gen-story/api db:generate
       pnpm --filter @gen-story/api db:migrate

   Expect a new file `drizzle/migrations/0004_*.sql` adding `common_prompt`, and
   `db:migrate` to report the migration applied with no error.

3. Application tests:

       pnpm --filter @gen-story/application test

   Expect the four `upsertStoryboard` common-prompt cases to pass.

4. Type-check everything (run after every code change, per `CLAUDE.md`):

       pnpm typecheck

5. Architecture boundary check — confirm the domain layer stayed pure:

       rg "from ['\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\.\./\.\./apps)" packages/domain packages/application

   Expect no matches.

6. Broader checks:

       pnpm lint
       pnpm test
       pnpm build

7. Manual UI verification:

       pnpm dev

   Then in a browser at `http://localhost:3000`, open a project's storyboard and follow
   the Validation steps below.


## Validation and Acceptance

Acceptance is observable behavior:

- **Auto-generation**: Open a storyboard that has never had a common prompt. The "Common
  Prompt" textarea is non-empty and its text reflects the storyboard tone (and style
  preset name, if one is selected).
- **Editable + persisted**: Edit the textarea, save, reload the page. The edited text
  survives the reload (proves DB persistence via the new column).
- **Regenerate**: Click "Regenerate". The textarea content is replaced by a freshly
  composed prompt derived from the current tone + style preset.
- **Applied to every scene**: With a populated common prompt, trigger image generation
  (or inspect the composed prompt). The common prompt text appears inside the composed
  prompt for every scene — confirm by checking the `generation_requests.inputJson` /
  composed prompt for at least two different scenes; both contain the identical common
  prompt substring.
- **Tests**: `pnpm test` reports all suites green, including the new domain, rule, and
  use-case cases.
- **Type & boundary**: `pnpm typecheck` passes; the `rg` boundary check returns no matches.

If `pnpm dev` cannot be run in the working environment, document that and verify instead
by asserting `composeImagePrompt` output in a unit test contains the common prompt text.


## Idempotence and Recovery

- Domain, application, API, and web edits are ordinary source edits — safe to re-apply.
- The migration is the only stateful step. `db:generate` is safe to re-run (it diffs
  schema vs. migrations; if the column already exists it produces no new migration).
  `db:migrate` is idempotent — Drizzle records applied migrations and skips them.
- Recovery if the migration is wrong: delete the generated `0004_*.sql` file and its
  `drizzle/migrations/meta` entry, fix `schema.ts`, and re-run `db:generate`. For a local
  SQLite DB that is dev-only data, the DB at `data/gen-story.sqlite` can be deleted and
  rebuilt from scratch with `db:migrate` if it enters an inconsistent state — confirm with
  the user before deleting any DB file.
- The auto-generate branch in `upsertStoryboard` is idempotent: re-running an upsert with
  the same input yields the same stored `commonPrompt`.


## Artifacts and Notes

- The cinematic descriptor maps already in `prompt-composer.ts` are intentionally left
  untouched; the common prompt is prepended as an additional natural-language segment, not
  a replacement for the descriptor logic.
- `composeCommonPrompt` lives in the domain so it can later be reused by AI-fill or export
  features without crossing layer boundaries.


## Interfaces and Dependencies

- No new libraries. Existing stack only: `zod` (API schema, `apps/api` only),
  Drizzle (migration + table), Vitest (tests).
- Reused port: `StoryboardRepository` and `StylePresetRepository` from
  `packages/application/src/ports.ts` — the latter is needed in `upsertStoryboard` to read
  the style preset name/prompt for auto-generation.
- New domain export: `composeCommonPrompt` from `packages/domain/src/rules.ts`
  (re-exported via `packages/domain/src/index.ts` if that file re-exports rules).
- New shared field: `StoryboardDto.commonPrompt` in `packages/shared/src/index.ts`.
- New DB column: `storyboards.common_prompt` (migration `0004_*`).
