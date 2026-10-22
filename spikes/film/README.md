# @gen-story/film-spike

Non-production spike for the photo-to-film authoring contracts. See the private ExecPlan
`internal/plans/active/20261021-photo-to-film-spike.md`. Nothing in `apps/*` or `packages/*`
imports this package.

All commands below run from `spikes/film/` (or prefix them with
`pnpm --filter @gen-story/film-spike`). Add `--json` to any CLI command to print its result envelope.

## Setup

Local prerequisites: Node.js 25.2.1, ffmpeg/ffprobe, and the reference project's four
`s1.jpg`–`s4.jpg` images under
`film-making-idea/film-studio/productions/sando/images/` at the repository root. The reference
project and its images are supplied separately and are not included in this package. Prepare
the media before running the spike tests or acceptance; both read the local media lock.
Chrome is fingerprinted by `doctor` for later rendering milestones.

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

`.media/`, `.state/`, and `out/` are gitignored.
