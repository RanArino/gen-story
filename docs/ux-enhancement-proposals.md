# UX Enhancement Proposals — Image Generation (and Phase 2 Video Readiness)

Author: assistant draft
Date: 2026-05-23
Scope: Proposals. Sections **A–D were accepted on 2026-06-02 and reflected to `docs/gap-analysis.md` §18** (each such heading is tagged 📌 below). Sections **E–H remain proposals only** — not yet committed. Accepted items still need an ExecPlan before implementation.

This document proposes new features and UX improvements grounded in the current implementation:
- `apps/web/src/components/storyboard/StoryboardPage.tsx`
- `apps/web/src/components/generate/GeneratePage.tsx`
- `apps/web/src/components/review/ReviewPage.tsx`
- `apps/api/src/generation/prompt-composer.ts`
- and the notes in `docs/video-editing-notes.md`.

Each proposal lists:
- **What** — the change in one line.
- **Why** — user value.
- **Shape** — concrete UI / data sketch.
- **Effort** — S / M / L rough size.
- **Phase fit** — P1 (now), P1.5 (polish), P2 (video).

Legend for priority: `[H]` high impact, `[M]` medium, `[L]` lower / nice-to-have.

Reflection marker: **📌 reflected → GA §18** on a heading means the proposal has been promoted to `docs/gap-analysis.md` (§18, accepted 2026-06-02). Headings without the marker (E–H) are not yet reflected.

---

## A. Generation feedback & flow

### A1. Live generation panel with thumbnails and ETA  `[H]`  📌 reflected → GA §18
- **What**: Replace the flat status list on `GeneratePage` with a live panel showing per-scene thumbnail (source photo), animated progress chip, and a rolling ETA.
- **Why**: Today the page polls every 2s but the user only sees a textual badge — generation feels opaque, especially for 10+ scene boards.
- **Shape**: Scene row gains a left thumbnail (source photo), middle column with stage labels (queued → preparing input → calling model → saving), right column with elapsed seconds. When succeeded, the right side flips to a small generated thumbnail with a one-click "Adopt" pin.
- **Effort**: M
- **Phase fit**: P1

### A2. Background generation + global progress chip  `[H]`  📌 reflected → GA §18
- **What**: Allow generation to keep running when the user navigates away from `/generate`. Add a global progress chip in `AppShell` ("3 of 12 scenes generating") that links back to the page.
- **Why**: Users currently feel pinned to the Generate screen. They should be free to keep editing scenes or browse Review while batches run.
- **Shape**: A polling hook hoisted into `AppShell` for the current project; chip appears whenever queued/running > 0. Click jumps to `/generate`.
- **Effort**: M
- **Phase fit**: P1

### A3. Variants per scene (N candidates per request)  `[H]`  📌 reflected → GA §18
- **What**: Allow each scene to request 2–4 variants in a single bulk pass (not just one image).
- **Why**: The test-generation modal already proves "pick from 3" is valuable. Carrying it into the per-scene flow lets users curate without going back to test mode.
- **Shape**: `inputJson.variants: number` on `GenerationRequest`. Variants render as a tray inside the scene card on Review with "Adopt this one". Adopting one auto-marks the rest as non-adopted but kept in history.
- **Effort**: M–L (worker, storage, UI)
- **Phase fit**: P1

### A4. Composed-prompt preview before submit  `[M]`  📌 reflected → GA §18
- **What**: Show the fully composed prompt from `prompt-composer.ts` in a collapsible "What we'll send to the model" panel before generation.
- **Why**: Today, prompts are stitched server-side; users can't see why their image looks off until after they pay for a call.
- **Shape**: New `POST /api/scenes/:id/preview-prompt` endpoint returning the composed string. Renders inside `StoryboardPage` scene editor and inside the Regen modal.
- **Effort**: S–M
- **Phase fit**: P1

### A5. Negative prompt field per scene (and per project)  `[M]`  📌 reflected → GA §18
- **What**: Add `negativePrompt` to `scenes` and `storyboards` (project-wide).
- **Why**: Standard image-gen control; today users cannot say "no text, no watermark, no extra people".
- **Shape**: New textarea under "Image prompt"; composed into final request payload (model-dependent).
- **Effort**: S
- **Phase fit**: P1

### A6. Adjustment chips on test generation  `[M]`  📌 reflected → GA §6 & §18 (already in progress)
- **What**: Implement the `❌` items in gap-analysis §6: "warmer", "more cinematic", "darker", "brighter", "more candid".
- **Why**: Lets non-technical users iterate without writing prompt deltas. Already specified in REQUIREMENTS_INIT.
- **Shape**: After test batch returns, chips appear under each variant. Clicking a chip queues a new variant where the chip text appends a curated suffix to `commonPrompt` and re-runs that single slot.
- **Effort**: M
- **Phase fit**: P1

### A7. Estimated cost / coin preview  `[L]`  📌 reflected → GA §18
- **What**: Surface a per-request cost estimate (and project-wide total) before the user clicks "Start generation".
- **Why**: Cost-awareness — image API calls are paid. Aligns with the memory note "image calls cost money, avoid wasteful regeneration".
- **Shape**: Static per-model price table in `packages/shared`; `GeneratePage` shows "Estimated: $0.40 for 12 scenes" with a confirm dialog if > $X threshold.
- **Effort**: S
- **Phase fit**: P1

### A8. Failure clustering and recovery hints  `[M]`  📌 reflected → GA §18
- **What**: When ≥2 scenes fail with the same error class, collapse into one banner with an actionable hint.
- **Why**: 12 red "Failed" rows from the same missing API key is noise; one banner with "Set `OPENAI_API_KEY` in .env" is signal.
- **Shape**: Classifier maps error message → category → hint string. Banner appears at top of `GeneratePage`. Individual rows still show their error.
- **Effort**: S
- **Phase fit**: P1

---

## B. Scene composition & prompt quality

### B1. Reference image set (multi-input) per scene  `[H]`  📌 reflected → GA §13 & §18
- **What**: Allow each scene to attach more than one input photo (e.g., primary + facial reference + outfit reference).
- **Why**: `docs/gap-analysis.md` §13 calls this out as `❌`. Single-photo input limits consistency across scenes.
- **Shape**: `scene_photo_assets.role` already exists; add `reference_face`, `reference_outfit`, `reference_background` roles. Upload UI on scene card lets the user drop additional photos. Worker sends all of them to `images.edit()` when the model supports it.
- **Effort**: M–L
- **Phase fit**: P1

### B2. Character anchors (project-level subject consistency)  `[H]`  📌 reflected → GA §18
- **What**: A "characters" tab where users define each recurring subject with 1–3 portrait references and a short label ("Mom", "Niece"). Scenes can tag which characters appear.
- **Why**: Anime/family-story projects need the same face across 12+ scenes. Today the model drifts.
- **Shape**: New `characters` table scoped to project. `scenes.characterIds` array. When generating, the worker prepends character portraits as additional input images and adds a "consistent character: <label>" segment in the prompt.
- **Effort**: L
- **Phase fit**: P1 (essential for family-story use case)

### B3. Seed / determinism control  `[M]`  📌 reflected → GA §18
- **What**: Optional `seed` per scene to reproduce or slightly vary a generation.
- **Why**: Once a user adopts a result, they often want minor variations of the same image instead of a fresh roll.
- **Shape**: Hidden by default; "Advanced" toggle in scene card reveals seed field and a "Lock seed" toggle. Carried into `inputJson`.
- **Effort**: S
- **Phase fit**: P1

### B4. Aspect ratio per scene  `[H, P2 blocker]`  📌 reflected → GA §18
- **What**: Per-scene aspect ratio selector (16:9, 9:16, 1:1, 4:3, 2.39:1).
- **Why**: Video output is fixed-aspect (Phase 2). Today images may be generated at the wrong shape and crop badly.
- **Shape**: `scenes.aspectRatio` enum; default inherited from project setting (`storyboards.defaultAspectRatio`). Worker maps to model's size parameter.
- **Effort**: S–M
- **Phase fit**: P1 (foundation), P2 (consumed by video)

### B5. Style strength slider  `[M]`  📌 reflected → GA §18
- **What**: 0–100 slider per scene for "how strongly to apply the style preset".
- **Why**: Today the style preset prompt is concatenated unconditionally. Users can't dial it down for one photoreal hero scene inside an anime set.
- **Shape**: `scenes.stylePresetStrength` 0–100, default 100. Composer either drops or trims style segment when low.
- **Effort**: S
- **Phase fit**: P1.5

### B6. "Anime Layout Master" composition assistant  `[M]`  📌 reflected → GA §18
- **What**: An optional, opinionated scene-composer mode inspired by `docs/video-editing-notes.md`: fields for vanishing point (inside/outside/edge/distant), horizon position, foreground/midground/background roles, dominant emotion.
- **Why**: Power-users get cinematic control; novices can ignore it. Maps directly to the existing `prompt-composer.ts` segments.
- **Shape**: A `Composition…` button on the scene card opens a drawer with structured selects. Saves to `scenes.compositionJson`. Composer maps each field to a prompt segment.
- **Effort**: M
- **Phase fit**: P1.5

### B7. Shot-variation generator (Seedance-style)  `[M]`  📌 reflected → GA §18
- **What**: From any adopted image, ask the AI to propose N composition variants (different camera/horizon/perspective) for the user to pick one and turn into a new scene.
- **Why**: Mirrors the Seedance "20 shots from one source image" workflow already documented in `docs/video-editing-notes.md`.
- **Shape**: "Generate shot variations" button on a scene card; opens modal with N proposal cards (text + thumbnail). Picking one creates a sibling scene with the new prompt and the same source photo.
- **Effort**: M–L
- **Phase fit**: P1.5

---

## C. Review and adoption

### C1. Compare slider (source ↔ generated)  `[M]`  📌 reflected → GA §18
- **What**: Drag-to-reveal slider overlay on the comparison row in `ReviewPage`.
- **Why**: Side-by-side is OK; a slider makes pose/framing differences obvious at a glance.
- **Shape**: Replace the two side-by-side `imgBox`es in card view with a single overlay; clicking either side toggles to a fuller view.
- **Effort**: S
- **Phase fit**: P1.5

### C2. Variant tray inside scene card  `[H]`  📌 reflected → GA §18
- **What**: If a scene has 2+ generated images that aren't adopted, show them as a horizontal thumbnail strip with quick-adopt buttons.
- **Why**: Right now the unadopted history is hidden behind a "Generation history (N)" expander. Users skip it.
- **Shape**: Above the history toggle, render up to 4 most recent succeeded generations as 80px thumbs. Click expands; small Adopt button on hover.
- **Effort**: S
- **Phase fit**: P1

### C3. Star / favorite generations across history  `[L]`  📌 reflected → GA §18
- **What**: Toggleable star on each generated image; favorites pinned to the top of the history panel.
- **Why**: Lets users keep a shortlist while iterating.
- **Shape**: `generated_images.isFavorite` boolean.
- **Effort**: S
- **Phase fit**: P1.5

### C4. Bulk operations on Review  `[M]`  📌 reflected → GA §18
- **What**: Multi-select scenes, then bulk re-generate / bulk adopt-latest / bulk apply a tweak.
- **Why**: For a 20-scene board, going one-by-one is painful when the user wants the same correction (e.g., "make all of them warmer").
- **Shape**: Checkbox selection mode on each card. Floating action bar at the bottom.
- **Effort**: M
- **Phase fit**: P1.5

### C5. Inpainting / region regen  `[L, future]`  📌 reflected → GA §18
- **What**: Draw a mask on a generated image and regenerate only the masked area.
- **Why**: Common need: "fix the face" or "remove the watermark". Saves a full regeneration cost.
- **Shape**: Canvas-based mask drawer; sends mask + image back to model (when supported).
- **Effort**: L
- **Phase fit**: P1.5 / P2

### C6. Outpainting to target aspect  `[M, P2 helper]`  📌 reflected → GA §18
- **What**: Extend a generated image to a new aspect ratio for video framing.
- **Why**: Phase 2 video clips are usually 16:9 or 9:16; some adopted images will be square. Outpainting avoids re-rolling the whole scene.
- **Shape**: "Extend to 16:9" button on adopted images; sends to model edit endpoint with padding.
- **Effort**: M
- **Phase fit**: P2 prep

### C7. Continuity check between adjacent scenes  `[M]`  📌 reflected → GA §18
- **What**: Automated "consistency report" comparing adopted images across the timeline — flag color-temperature jumps, subject-size jumps, lighting jumps.
- **Why**: Helps avoid breaking the visual story when scenes were generated at different times.
- **Shape**: Server-side analyzer that compares histograms / dominant palette / detected face size between sibling scenes. Renders as a colored marker between timeline cards.
- **Effort**: L
- **Phase fit**: P1.5

---

## D. Prompt transparency & lineage

### D1. Prompt diff on retry  `[M]`  📌 reflected → GA §18
- **What**: When a user re-generates with overrides, show a diff of what changed vs. the previous request.
- **Why**: Today the regen modal is a fresh form — no signal about what's different from last roll.
- **Shape**: Compare previous `inputJson` with the new form values; show a colored diff list above the "Queue generation" button.
- **Effort**: S–M
- **Phase fit**: P1.5

### D2. Lineage view per scene  `[L]`  📌 reflected → GA §18
- **What**: Tree/list showing the genealogy of generations: which one was retried from which, which prompt-tweak chain led here.
- **Why**: Useful in long iteration sessions; aids reproducibility.
- **Shape**: `generation_requests.parentRequestId`; tree view in generation-history page.
- **Effort**: M
- **Phase fit**: P1.5

---

## E. Phase 2 (video) readiness — Phase 1 groundwork

### E1. Per-scene clip duration  `[H, P2 blocker]`
- **What**: `scenes.clipDurationSec` (default 5s) editable per scene.
- **Why**: Phase 2 video generation needs duration. Setting it up in Phase 1 lets storyboarding be "video-aware" early without committing to video gen.
- **Shape**: Slider 1–15s per scene; total runtime shown in storyboard header.
- **Effort**: S
- **Phase fit**: P1 foundation

### E2. Transition hint between scenes  `[M, P2 helper]`
- **What**: `scenes.transitionIn`: hard-cut / cross-dissolve / match-cut / whip-pan.
- **Why**: Video editors (and Phase 2 generator) will need this.
- **Shape**: Tiny dropdown on the inter-scene gap; defaults to hard-cut. JSON export already includes scene fields; add this one.
- **Effort**: S
- **Phase fit**: P1 foundation

### E3. Storyboard preview reel (Ken Burns slideshow)  `[H]`
- **What**: Auto-play adopted images sequentially with each scene's `clipDurationSec`, simple Ken Burns zoom in the direction implied by `motionDirection`.
- **Why**: Gives the user a tangible "this is the movie" preview before Phase 2 ships. Massive perceived-value win.
- **Shape**: New `/projects/:id/preview` route; client-only player; uses adopted image URLs and per-scene duration/motion fields.
- **Effort**: M
- **Phase fit**: P1 (delivers value before video gen)

### E4. Beat / rhythm timeline  `[M]`
- **What**: Horizontal bar timeline where each scene is a block sized by its `clipDurationSec`. User can drag to reorder and resize.
- **Why**: Helps users feel pacing without rendering video.
- **Shape**: Add a "Timeline editor" tab on `StoryboardPage` (next to scene list).
- **Effort**: M
- **Phase fit**: P1.5

### E5. BGM placeholder track  `[L, P2 prep]`
- **What**: Empty audio track below the beat timeline with markers for where BGM should swell / fade.
- **Why**: Sets up the data model for Phase 2 Suno BGM integration.
- **Shape**: `storyboards.musicHints` JSON; UI is read-only placeholder for now.
- **Effort**: S
- **Phase fit**: P2 prep

---

## F. Reliability & ergonomics

### F1. Auto-save draft for StoryboardPage  `[M]`
- **What**: Save scene-form edits to local storage and to server every N seconds; surface a "Saved 2s ago" indicator.
- **Why**: `StoryboardPage.tsx` is 1.4k lines of form. Losing work on a refresh is painful.
- **Shape**: Debounced PATCH; toast on save failure.
- **Effort**: M
- **Phase fit**: P1

### F2. Keyboard shortcuts on Review  `[L]`
- **What**: `j`/`k` to move between scenes, `a` to adopt latest, `r` to retry, `?` for cheat sheet.
- **Why**: Power-users iterate faster.
- **Effort**: S
- **Phase fit**: P1.5

### F3. Desktop notification on long generation  `[L]`
- **What**: Browser notification when a batch finishes (with permission).
- **Why**: Generations take minutes; users tab away.
- **Effort**: S
- **Phase fit**: P1.5

### F4. Model / provider picker UI  `[M]`
- **What**: Surface the provider/model dropdown — gap-analysis §4 has this `❌`.
- **Why**: Adapter and schema support exist; just no UI. Lets users A/B between gpt-image-2 and others.
- **Shape**: Dropdown in storyboard header. Persisted on `storyboards.modelId`.
- **Effort**: S
- **Phase fit**: P1.5

### F5. Project-level usage dashboard  `[L]`
- **What**: `/projects/:id/usage` page: count of generations, success rate, time histograms, $/¢ if tracked.
- **Why**: Helps users budget and debug.
- **Effort**: M
- **Phase fit**: P1.5

---

## G. Quick wins (low effort, high satisfaction)

| # | Item | Effort | Section |
|---|---|---|---|
| G1 | Composed-prompt preview panel | S–M | A4 |
| G2 | Negative prompt field | S | A5 |
| G3 | Failure clustering banner | S | A8 |
| G4 | Variant tray on Review card | S | C2 |
| G5 | Aspect ratio per scene | S–M | B4 |
| G6 | Per-scene clip duration | S | E1 |
| G7 | Cost estimate before Generate | S | A7 |
| G8 | Transition hint between scenes | S | E2 |

---

## H. Generation consistency (lessons from a real image-gen project)

> This section captures lessons from an actual image-generation project about keeping a series visually consistent ("non-drifting"), translated into changes for this app. H1–H6 are not covered anywhere in A–G; H7–H9 strengthen existing proposals.

### H1. Chain reference: previous adopted frame as the next scene's primary reference  `[H]` ★most important
- **What**: Allow an adopted generated image to be set as the **primary reference** for the next scene (or the next variant of the same scene). Make "build on the last good frame" a first-class flow instead of always editing from the original source photo.
- **Why**: In real serial generation this is the single most important continuity technique. Riding the previous good result (05A→05B→05D…) drifts far less in subject and style than re-editing the original photo every time. Today a request takes only a single source photo, with no path to feed an adopted frame forward.
- **Shape**: Extend `scene_photo_assets` (or the reference table) so a reference source can be a `generated_images.id`, not only a `photo_assets.id`. On Review/Storyboard, an adopted image gets a "Use as reference for next scene" action. The worker uses that adopted image as the primary input to `images.edit()` instead of the source photo.
- **Effort**: M–L
- **Phase fit**: P1
- **Related**: B1, B2, D2.

### H2. Text-free plate + reserved margin  `[M]`
- **What**: Give scenes/projects a "render no text" flag plus a "reserve negative space at `<position>`" hint.
- **Why**: Text and numbers are what the model breaks most, and the breakage drags the whole style down with it. The proven workflow is to generate a clean, text-free plate with reserved space and composite typography later. The concept exists nowhere today.
- **Shape**: `scenes.textFreePlate: boolean` and `scenes.reservedMarginHint` (e.g., top / center / lower-third). Composer injects `clean plate, no text, no letters, no numbers, leave clear negative space at <pos> for later typography`, and adds `text, captions, watermark, logo` to the negative prompt (H7).
- **Effort**: S–M
- **Phase fit**: P1
- **Related**: A5 / H7.

### H3. preserve / transform as a structured style attribute  `[M]` ★core
- **What**: Give each style preset a structured **preserve axis** (keep photographic: composition, perspective, lens feel, head-count, positions, clothing colors, geometry) and **transform axis** (push to hand-drawn: surface texture, contours, facial detail), composed as distinct prompt segments.
- **Why**: Articulating the preserve/transform line — "space stays photographic, surface goes hand-drawn" — is the single biggest reason a series keeps looking like one world. Today style is a single prompt string (`apps/api/src/generation/prompt-composer.ts`) with no notion of what to keep vs. transform.
- **Shape**: `style_presets.preserveAxes` / `transformAxes` (text or structured). `composeImagePrompt` emits explicit `preserve: <...>; transform: <...>` segments.
- **Effort**: M
- **Phase fit**: P1.5
- **Related**: B5.

### H4. Auto re-injection of invariant attributes (head-count, clothing colors, identity)  `[H]`
- **What**: Capture per-project "values that must never change" (head-count, subject labels, each subject's clothing color) and automatically re-declare them in every request's prompt across the series.
- **Why**: The model does not remember previous turns, so invariants must be restated each time (the real project re-wrote "keep the same 8 people; black/white/red/grey/yellow-green outfits" on every prompt). No such auto-injection exists today.
- **Shape**: `storyboards.invariants` JSON (e.g., `{ peopleCount: 8, subjects: [{ label, outfitColor }] }`). Composer appends `keep exactly N people; <label> wears <color>; preserve identities` to every request. Combined with B2 (character anchors), this gives dual locking — image references plus textual declaration.
- **Effort**: M
- **Phase fit**: P1
- **Related**: B2.

### H5. Generation meta: intent / accept criteria / reject reason / fallback plan  `[M]`
- **What**: Give scenes (or generation requests) structured meta beyond the free-form `notes`: intent, accept criteria, reject reason, and a fallback plan (which dial to turn when it breaks).
- **Why**: Deciding "one intent + reject condition per cut", recording the reject reason, and pre-defining the fallback turns iteration from a slot-machine reroll into a systematic adjustment. Today only an adopt/unadopt flag and free-form notes exist, so the reason a frame was rejected is lost and the same mistake recurs.
- **Shape**: `scenes.intent`, `scenes.acceptCriteria`, a per-image `rejectReason` (optional on unadopt), and `fallbackPlan` on storyboard/scene. Review records the reason with one tap when unadopting.
- **Effort**: M
- **Phase fit**: P1.5
- **Related**: D1, D2.

### H6. Auxiliary references to pin fragile parts (face / hands / objects)  `[M]` (refines B1)
- **What**: Split reference roles into "primary = continuity/composition" and "auxiliary = stabilizing fragile parts", letting face/hands/objects be pinned with their own reference images.
- **Why**: "Don't put everything on one image; pin fingers/face/objects with separate real photos" sharply cuts breakage. Today `ScenePhotoRole` is only `primary | reference`, with no per-part pinning.
- **Shape**: Extend `ScenePhotoRole` to `primary | reference_face | reference_hands | reference_object | reference_background` (concretizes B1's role additions for part-pinning). Composer attaches a "use this only for `<part>`" hint to each auxiliary reference.
- **Effort**: M
- **Phase fit**: P1
- **Related**: B1, H1.

---

### Reinforcements to existing proposals (raised by the learnings)

### H7. Design the Base Negative as a "deviation fence" (strengthens A5)  `[H]`
- Promote A5 from a plain exclusion list to a **fence** that keeps output inside the narrow target band: suppress drift toward photo (`raw photo, photoreal skin, CGI`) and drift toward illustration (`anime, chibi, sticker, thick outlines, storybook`) simultaneously, fixed per project and auto-injected into every request. Suggested status bump: A5 → P1, `[H]`.

### H8. Make adjustment chips named "dials" (strengthens A6)  `[M]`
- Design A6 (in progress) so chips are **signed adjustments on named axes** (e.g., luminous / cinematic / memory / sketch strength) rather than decorative adjectives, so that when output breaks you can name the cause ("sketch too strong / cinematic too weak") and dial back precisely.

### H9. Join adjacent scenes by "phase transition" (strengthens E2 / C7)  `[M]`
- Beyond E2 (transition hint) / C7 (continuity check), design **carry-over of a previous scene's visual elements** (white smoke, glow) into the next scene as content. Rather than a hard cut between styles, make front-to-back continuity ("the same footage phase-transitions into a hand-drawn memory") part of the consistency design.

---

## Recommended top picks (if you only do 5)

The five that, in combination, lift the product the most while staying in Phase 1 scope:

1. **A1 + A2** — Live generation feedback with background-safe progress. Makes the most-used screen feel fast.
2. **B1 + B2** — Multi-input photos and character anchors. Solves the #1 problem of family-story consistency.
3. **A3** — Variants per scene. The single biggest "wow" win during review.
4. **E1 + E3** — Per-scene duration plus the storyboard preview reel. Delivers a tangible "movie" preview now without waiting for Phase 2.
5. **A4 + A6** — Composed-prompt preview and adjustment chips. Closes the loop between "I want it warmer" and the prompt that gets sent.

### If you optimize for consistency (section H)

For "non-drifting" family/series work, prioritize in this order:

1. **H1** (chain reference) — biggest effect on continuity.
2. **H7** (= A5 strengthened, Base Negative) — the fence that keeps the narrow band; light to implement.
3. **H4** (auto re-injection of invariants) — lock head-count, clothing colors, identity.
4. **H2** (text-free plate + margin) — eliminate the style collapse caused by broken text.

---

## How to use this doc

1. Skim and mark which proposals you want.
2. For each accepted item, copy/promote the row to `docs/gap-analysis.md` under the appropriate section, marking it `❌ Not yet implemented` or `🟡 In progress` if an ExecPlan is being drafted.
3. Create the matching ExecPlan in `docs/plans/`.
