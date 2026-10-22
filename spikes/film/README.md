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
    pnpm cli compile --treatment fixtures/project/treatments/verified-baseline.json --concat out/plans/verified-baseline/
    pnpm cli approve concat <concat plan digest> --subject verified-baseline
    pnpm cli render concat out/plans/verified-baseline/concat.plan.json --approval <id>
    pnpm cli contact-sheet out/plans/verified-baseline/c1.plan.json
    pnpm cli preview out/plans/verified-baseline/c1.plan.json   # prints a 127.0.0.1 URL; Ctrl-C stops

`render chapter` writes `out/artifacts/<name>/<chapter>.{mp4,stem.wav,json,frames.json}` after
ffprobe verifies the exact frame count, 1920x1080, 30 fps, and AAC 48 kHz. Artifacts are cached
in `.state/cache/chapters/<fingerprint>/`; an unchanged Chapter is a cache hit, and a cached file
that no longer matches its digest is discarded and rebuilt. `compile --concat` builds the
concatenation Plan from the verified cached Chapters. `render concat` paints only the overall
title, joins the Chapter video by stream copy (Chapter frames stay identical), darkens the last
Chapter frame for 800 ms at each join, and lays the BGM continuously under the cached stems.

The render server listens on 127.0.0.1 only and serves the runtime pages, the painter
transpiled from `src/painter/painter.ts`, Plans under `out/`, locked media, and registry font
blobs. Chrome aborts every other request.

`pnpm test` runs the render acceptance cases (`src/render/render.test.ts`) only when
`CHROME_PATH` names an installed Chrome; they take several minutes. Without it they are skipped,
and `pnpm accept` reports their rows as pending.

`.media/`, `.state/`, and `out/` are gitignored.
