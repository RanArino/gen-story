# @gen-story/film-spike

Non-production spike for the photo-to-film authoring contracts. See the private ExecPlan
`internal/plans/completed/20261021-photo-to-film-spike.md`. Nothing in `apps/*` or `packages/*`
imports this package.

All commands below run from `spikes/film/` (or prefix them with
`pnpm --filter @gen-story/film-spike`). Add `--json` to any CLI command to print its result envelope.

## Setup

Local prerequisites: Node.js 25.2.1, ffmpeg/ffprobe, and the reference project's four
`s1.jpg`–`s4.jpg` images under
`film-making-idea/film-studio/productions/sando/images/` at the repository root. The reference
project and its images are supplied separately and are not included in this package. Prepare
the media before running the spike tests or acceptance; both read the local media lock.
Rendering also needs Google Chrome; `doctor` fingerprints it from `CHROME_PATH`.

    pnpm install
    CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" pnpm cli doctor
    pnpm prepare:media
    pnpm cli bootstrap

`doctor` writes the environment fingerprint to `out/env.json`. `prepare:media` writes fixture
media to `.media/` and pins it in `.media/media-lock.json`; running it again verifies the files.
`bootstrap` registers the built-in Capabilities and is idempotent.

## Contracts

Canonical JSON Schemas live in `schemas/`, with valid examples in `fixtures/valid/` and invalid
examples in `fixtures/invalid/<schema>/<ERROR_CODE>.<case>.json`.

    pnpm cli validate recipe fixtures/recipes/test/baseline.r1.json
    pnpm accept          # runs the acceptance matrix and writes out/acceptance/report.json

`pnpm test` and `pnpm accept` limit the spike suite to two workers so the root workspace checks
do not start a font inspector and a TypeScript CLI in every worker at once. Test assertions and
timeouts are unchanged. Acceptance never treats a skipped check as passing and fails when the
underlying test process fails, including failures outside tagged tests.

## Approvals

Approvals are digest-bound and created only by the operator in an interactive terminal:

    pnpm cli approve <request|execution|promotion|timing|concat> <sha256:digest> --subject <text>

The command asks for the first eight hex characters of the digest. Mutating commands are dry
runs unless `--apply` is given, and they need `--approval <id>`.

## Fonts

Fonts move from `.state/quarantine/fonts/incoming/<dir>/` through quarantine, contained
inspection, and explicit promotion:

    pnpm cli font quarantine <dir> fixtures/fonts/<family>.draft.json --apply
    pnpm cli font inspect <candidate>          # prints the digest to approve
    pnpm cli approve promotion <digest> --subject <candidate>
    pnpm cli font promote <candidate> --approval <id> --apply

`pnpm cli font fixtures` writes the spike-authored fixture fonts (box glyphs, CC0) used by tests.
Promote `fixture-sans-jp` before `fixture-serif-jp`, whose fallback is pinned at quarantine.

Operator step for the real families: download Noto Sans JP, Noto Serif JP, and Cormorant
Garamond from the `google/fonts` repository into `incoming/noto-sans-jp/`,
`incoming/noto-serif-jp/`, and `incoming/cormorant-garamond/`. Rename each font file to the name
in its `fixtures/fonts/*.draft.json`, keep each family's `OFL.txt`, and record the source URL
and commit in `SOURCE.txt` and in the draft's `source.commit`.

Promote Noto Sans JP first, then quarantine and inspect Noto Serif JP so its fallback pins the
promoted sans manifest digest. Cormorant Garamond is independent. A24 stays pending until all
three families have promoted records, passing inspection reports, matching promotion approvals,
and intact font and license blobs in the local registry. Tests simulate approvals only in
temporary test registries; they do not approve or promote fonts in the local registry.

Inspection rejects restricted embedding flags in the font itself. Promotion rechecks both the
font bytes and the license bytes against the inspected manifest before accepting an approval.
Scope checks cover the full fallback chain: an organization font cannot expose a project-only
font, and a Treatment cannot reach another project's font through a fallback. Shared fallback
dependencies are deduplicated while preserving font preference; actual cycles remain errors.

## Compile

    pnpm cli preflight --treatment fixtures/project/treatments/verified-baseline.json --chapters fixtures/project/chapters.json
    pnpm cli compile --treatment fixtures/project/treatments/verified-baseline.json --chapters fixtures/project/chapters.json

`compile` writes one Resolved Render Plan and one timing proposal per Chapter to
`out/plans/<treatment>/`. Add `--reduced-motion` or `--force-level0` to compile those variants.
`verified-baseline` uses the promoted Noto fonts, so it needs the three real font families in the
local registry. The `test-*` Treatments pin the fixture fonts that tests promote in temporary
registries; against the local registry they return `FS_NOT_PROMOTED`.

## Render

Rendering needs `CHROME_PATH`, ffmpeg, and a current `out/env.json` from `doctor`. A Plan compiled
in a different environment (Chrome, ffmpeg, Node, OS, or painter source) is refused with
`FS_ENV_MISMATCH`; recompile it.

    pnpm cli approve timing <proposal digest> --subject c1          # operator, interactive
    pnpm cli render chapter out/plans/verified-baseline/c1.plan.json --approval <id> [--no-cache]
    pnpm cli compile --treatment fixtures/project/treatments/verified-baseline.json --chapters fixtures/project/chapters.json --concat out/plans/verified-baseline/
    pnpm cli approve concat <concat plan digest> --subject verified-baseline
    pnpm cli render concat out/plans/verified-baseline/concat.plan.json --approval <id>
    pnpm cli contact-sheet out/plans/verified-baseline/c1.plan.json [--grayscale]
    pnpm cli preview out/plans/verified-baseline/c1.plan.json   # prints a 127.0.0.1 URL; Ctrl-C stops

`render chapter` writes `out/artifacts/<name>/<chapter>.{mp4,stem.wav,json,frames.json}` after
ffprobe verifies the exact frame count, 1920x1080, 30 fps, and AAC 48 kHz. Artifacts are cached
in `.state/cache/chapter-media-v2/<render-digest>/`. The render digest omits only parent
Story Graph/Treatment revision numbers, Chapter index, and the existing fingerprint. Original
New Chapter Plans also bind `provenance.projectId`; legacy Plans remain readable and must be
recompiled before concatenation. Plans and cache metadata remain immutable; reuse writes fresh output metadata bound to the
current full Plan digest. New storage starts cold once, leaving legacy caches intact. Damaged
Chapter media fails with `FS_ARTIFACT_VERIFY_FAILED`.

`compile --concat` requires the current `--chapters` document, selecting exactly its Chapter IDs
and order. Removed Chapters can leave files behind; those files are ignored. Missing, duplicate,
or stale selected Plans fail. Current settings, scene provenance, Recipe, fonts, and overall-title
glyph coverage are revalidated independently of parent revision numbers. A supported title-only
change reuses Chapter media; missing glyphs fail at `/overallTitle` with `FS_GLYPH_MISSING`.

New concatenation Plans use `film.concat-plan@2`, pinning both MP4 and stem checksums and actual
Chapter frame counts in fingerprints and approvals. Legacy v1 Plans remain readable, but rendering
requires compiling v2 and obtaining its new approval; approved Plans are never silently upgraded.
`render concat` paints only the overall title, joins the Chapter video by stream copy (Chapter frames stay identical), darkens the last
Chapter frame for 800 ms at each join, and lays the BGM continuously under the cached stems.

The render server listens on 127.0.0.1 only and serves the runtime pages, the painter
transpiled from `src/painter/painter.ts`, Plans under `out/`, locked media, and registry font
blobs. Chrome aborts every other request.

`pnpm test` runs the render acceptance cases (`src/render/render.test.ts`) only when
`CHROME_PATH` names an installed Chrome; they take several minutes. Without it they are skipped,
and `pnpm accept` reports their rows as pending.

## Three Cuts and Recipe forks

The system Recipes `fixtures/recipes/system/{quiet-cinema,memory-board,pulse-cut}.r1.json` pin
the promoted Noto fonts. Their Treatments are `fixtures/project/treatments/<cut>.json`, and
`fixtures/project/cuts/<cut>.<chapter>.json` holds one Cut per Chapter, equal to that Chapter's
state in the Treatment. Compile and render them like `verified-baseline` above.

`recipe fork` creates an organization Recipe in `.state/recipes/` from a saved revision, without
any source change. Replacements name exact versions offered for new work; the fork pins their
registry digests and drops parameters of replaced Capabilities. It is a dry run unless `--apply`
is given, and a saved revision is immutable (different bytes give `FS_VERSION_COLLISION`).

    pnpm cli recipe fork system.quiet-cinema r1 --as org.local.quiet-editorial --title "Quiet Editorial" \
      --slots typography=film.typography.editorial-note@1.1.0,transition=film.transition.dip@1.0.0,surface=film.surface.paper-tone@1.0.0 \
      --fonts caption=font.noto-sans-jp@1.0.0,title=font.noto-sans-jp@1.0.0 [--effects id@version,...|none] [--apply]

A fork needs a Treatment bound to its digest (`recipe` and `shared.typography`) before it compiles.
`grammar <plans-dir>...` prints editing-grammar metrics read from compiled Plans (shot count, shot
length mean and variance, layout, transition, and motion histograms, text windows), and
`contact-sheet --grayscale` writes `<chapter>.gray.png` for the diversity evaluation.

Tests exercise the Cuts by forking each system Recipe into a temporary registry with the fixture
fonts (`src/testing/cuts.ts`). A21 and A22 also check the operator's real-font evidence in
`out/evidence/` (`recipe-variation.json`, `diversity-review.json`, `diversity/key.json`) and stay
pending without it.

`.media/`, `.state/`, and `out/` are gitignored.

## Capability authoring (M6)

Every gate up to and including promotion is available: request, static, fallback compile, contained runtime, painter evidence, review, and promotion. Promoted Capabilities load from their registry bytes and run in the contained process. Acceptance rows A26–A28 cover the lifecycle, negative candidates, and exact-version replay.

    pnpm cli validate request fixtures/requests/torn-reveal.request.json
    pnpm cli approve request <request digest> --subject film.transition.torn-reveal@1.0.0
    pnpm cli candidate scaffold fixtures/requests/torn-reveal.request.json --approval <id> --apply
    pnpm cli candidate static-check torn-reveal

Scaffolding requires an exact request approval even in dry-run mode. It writes a placeholder
implementation and a manifest under `.state/quarantine/capabilities/<request-id>/`; repeat
scaffolding preserves author edits. Author the candidate only after request approval.
Static checks parse source without importing it and write `static.json` and `source.diff`.
The execution target binds the approved request, manifest, source, and trusted runner/SDK bytes.
Static success does not authorize execution or promotion. Quarantine is absent from catalog search.

Candidate imports may use only `film-capability-sdk`. The conservative static subset also rejects
computed property access and reflective constructor/prototype access, so forbidden globals cannot
be reached by a computed property spelling. Use array methods and named properties instead.

After reviewing the static report and source diff, obtain the separate execution approval:

    pnpm cli approve execution <execution digest> --subject film.transition.torn-reveal@1.0.0
    pnpm cli candidate run torn-reveal --approval <id> --apply

`candidate run` requires the saved static report to match the current source, manifest, request,
runner/SDK/containment, and generated ABI inputs. It defaults to a dry run that executes nothing.
Each declared fixture is tested at default and boundary parameters, twice in one contained
process and once in another. A passing report records all output digests. These synthetic ABI
checks do not replace the required real-media painter evidence, fallback compilation, independent
review, and promotion. Approval of execution does not make the candidate a catalog entry.

Fallback compile (no approval; quarantined code never runs in-process):

    pnpm cli candidate compile torn-reveal --treatment fixtures/project/treatments/memory-board.json --chapters fixtures/project/chapters.json

This puts the candidate in its kind's slot of the Treatment's Recipe, in memory only. Under default options it checks
resolution and compatibility only. Under `reducedMotion` and `forceLevel0`, it compiles every Chapter wherever the
safety fallback replaces the candidate. The result is written to `compile.json`.

Painter evidence (needs `CHROME_PATH` and the same execution approval):

    pnpm cli candidate evidence torn-reveal --approval <execution approval id> --apply

This re-executes exactly the approved inputs and fails with `FS_NONDETERMINISTIC` unless every output equals
`runtime.json`. It paints the first fixture's parameter cases over two locked images and writes
`out/candidates/<candidate>/evidence/{clip.mp4,contact-sheet.png}` and `evidence.json`.
It is implemented for transitions only.

Operator-recorded independent review, then separate promotion approval:

    pnpm cli candidate promotion-target torn-reveal     # prints the digest to review and approve
    pnpm cli review record <promotion digest> --candidate torn-reveal --subject <id@version> --reviewer <name> --verdict accept --notes <text>
    pnpm cli approve promotion <promotion digest> --subject <id@version>
    pnpm cli registry promote torn-reveal --approval <id> --apply

The promotion target binds the Manifest, implementation bytes, execution target, and the static,
runtime, compile, and evidence reports. `registry promote` refuses with `FS_REVIEW_REQUIRED` until an
accepted review of that exact digest exists, then requires the promotion approval. It stores the reports as
registry blobs and offers the version for new work. The service and `review_record` tool only prepare
a review and return the operator command. Applied service/tool requests fail with `FS_OPERATOR_REQUIRED`.
Only the CLI persists a review, after actual stdin/stdout TTY checks and typed digest confirmation.
It recomputes the current candidate target and rejects stale digests and a reviewer matching the
Manifest author or request requester after Unicode normalization, trimming, and case folding.
`film.review-record@2` binds candidate, both author identities, reviewer, recording operator,
verdict, notes, and confirmation provenance. Legacy evidence and promoted entries remain intact;
legacy reviews cannot authorize new promotion. This local operator boundary adds no authentication service.

Replay a pinned Chapter Plan (read-only):

    pnpm cli replay out/plans/<name>/c1.plan.json --treatment <file> --chapters fixtures/project/chapters.json

Every locked Capability must still resolve to its pinned manifest and implementation bytes
(`FS_REPLAY_MISSING_VERSION` when a version is gone), and recompiling must reproduce the Plan digest.

Negative candidates live under `fixtures/candidates/invalid/`. Each `candidate.json` names its first
failing gate and code. `fixtures/candidates/valid/torn-reveal/` is a byte-identical copy of the
authored 1.0.0 candidate for tests.

## Capability Authoring Skill (M7 complete)

`skills/capability-authoring/SKILL.md` is an agent-neutral authoring workflow, not an editor-registered Skill. It prefers Recipe composition, confines direct edits to quarantine and evidence, and stops for operator request, execution, and promotion approvals. Its operation names are checked against the authoring service by `src/adapters/skill.test.ts`. The Tool Calling adapter and the real walkthrough are complete.

Local manual-viewing preparation is in `out/evidence/viewing-sheet.md`: all four joined films, their transition and caption windows, and Chapter joins. Verdicts must come from the operator watching with sound.

The resumed local A30 transcript is `out/evidence/skill-walkthrough.md`. Runtime and painter evidence are complete for `torn-reveal-1-1-0`, and the transcript reaches the exact promotion handoff without running an approval command. By the product owner's 2026-10-25 decision, an independent review of this real candidate is not required to complete the spike walkthrough. This does not waive the registry's review gate or authorize promotion; the candidate remains quarantined.

## Tool Calling

`src/adapters/tool-calling.ts` exports `listTools()` and async `callTool(name, input)`.
The 31 tool names, descriptions, and input DTOs are defined by
`schemas/tool-calling.schema.json`. No approval, bootstrap, or fixture-font creation tool
is exposed. Inputs are validated before service delegation; unknown tools and invalid
DTOs return `FS_SCHEMA_INVALID` envelopes. Tools with a `dryRun` input default to `true`.
Pass `dryRun: false` to apply; approval-gated operations also need the existing exact
`approvalId`. Dry run does not waive an approval gate or other prerequisites.

Existing authoring/evidence exceptions remain: Recipe forks, font quarantine/inspection,
static checks, candidate fallback compilation, ordinary compilation, contact sheets, do not gain new approval gates. Review preparation remains read-only; recording requires the
interactive operator command and typed confirmation. Candidate static checks still require
the approved request receipt. Reviews remain independent evidence, never approvals.
The adapter covers every public service operation, including candidate compilation,
promotion targets, concatenation planning, grammar metrics, and historical replay.
`bootstrap` and fixture-font creation remain CLI-only helpers.

The CLI keeps its existing defaults. Add `--dry-run` to `candidate static-check`,
`candidate compile`, `font inspect`, `review record`, `render chapter`, `render concat`,
and `contact-sheet` to validate without writing. Font inspection dry runs validate the
quarantine manifest without starting the inspector; rendering and contact-sheet dry runs
validate the Plan (and rendering approval) without launching Chrome. `compile --dry-run`
already suppresses Plan writes. `font promotion-target <candidate> --json` now exposes
the service's read-only font promotion target. Applied font inspection envelopes correctly
report `dryRun: false` because they write inspection reports.

`fixtures/tool-calling/*.json` contains inputs, equivalent CLI arguments, and expected
success, error codes, and mutation kinds. The test harness expands `$fixture` document
references and synthetic approval tokens, copies the CLI package into a temporary directory,
and resets isolated state between adapter and CLI calls. It compares complete envelopes,
normalizing only evidence timestamps and their verified report hash, and checks filesystem
snapshots for dry runs and refusals. The real registry and rendered films are untouched.

    pnpm exec vitest run src/adapters/tool-calling.test.ts src/adapters/skill.test.ts src/adapters/cli.test.ts --maxWorkers=2

The CLI terminal guard is tested directly without invoking the approval command. A30 requires
exact request/execution/promotion commands and confirmations, a promotion-target call, and no
approval command in the agent's executed transcript. The real walkthrough satisfies that
contract and stops without promoting the candidate.

M7 is implemented. Final Chrome-backed acceptance reports 30 pass, 0 fail, and 0 pending. The earlier first run failed A20 on a missing PSNR measurement, and the requested rerun passed it; both historical reports are retained locally under `out/evidence/m7-acceptance-*`.

The optional 1.1.0 review package is `out/evidence/torn-reveal/1.1.0/review-package.md`. Runtime: 12/12 cases pass; painter evidence matches every approved output. Execution approval does not authorize promotion, and no promotion was performed.

## Audit repairs (2026-10-27)

Source BGM and sound events are checksum-verified before cache reuse or rendering. ffmpeg reads
verified temporary copies, and concatenation checks both cached MP4 and stem bytes. Changed
source audio returns `FS_DIGEST_MISMATCH`; damaged media returns `FS_ARTIFACT_VERIFY_FAILED`,
without publishing a successful output.

Chapter timing preserves exact fixed milliseconds and round-half-up frame rounding. Preflight
uses the selected profile fps and limits blank-scene allocation to both logical and frame-safe
budgets. A fixed 6,020 ms runtime becomes 181 frames at 30 fps and cannot fit a 6,020 ms limit.
ffprobe checks presented video, audio, and container duration; hidden AAC encoder padding does
not count as presented duration. Concatenation offsets and runtime come from frame counts;
stems are positioned at corresponding 48 kHz sample offsets. Every MP4 encoding/remux stage
uses a 48 kHz movie clock, and the concat demuxer receives explicit part durations, so edit
metadata preserves fractional-frame boundaries.

The bounded spike delivery and historical owner viewing waiver remain recorded in the completed
spike Plan. These repairs do not deliver production Film UI, APIs, persistence, or Capability
promotion. Current repair verification is recorded in the private audit ExecPlan.

Repair verification: all 272 cases passed across the full Chrome run and one targeted retry of
a Chrome startup timeout before caption assertions. Combined acceptance is 30 pass / 0 fail /
0 pending, recorded locally in `out/acceptance/audit-fixes-report.json`; the original full-run
exit 1 and successful retry are retained separately. Workspace typecheck/lint, painter build,
and new-file formatting pass. Root formatting fails on 11 unchanged files; modified-spike
formatting fails on the same 33 existing paths as the untouched baseline. The private completion
record is `internal/plans/completed/20261027-photo-to-film-audit-fixes.md`. Historical human
viewing verdicts remain unrecorded and the owner's waiver remains unchanged.
