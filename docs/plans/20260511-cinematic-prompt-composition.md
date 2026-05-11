# Cinematic Prompt Composition from Scene Fields

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.


## Purpose / Big Picture


Before this change, the `Scene` domain model already stored four cinematic composition fields — `cameraDirection`, `lightingDirection`, `emotion`, and `motionDirection` — and the `Storyboard` stored a `tone` and a `stylePresetId`. None of those fields were ever included in the prompt sent to OpenAI. Every generation used only the raw `imagePrompt` text that the user typed, with the style preset's visual instruction silently ignored.

After this change every generation request automatically composes a rich cinematic prompt from all available scene and storyboard metadata before the request reaches the OpenAI adapter. A user who sets Camera to "Telephoto", Lighting to "Backlit", Emotion to "Nostalgia", Tone to "Cinematic", and a style preset of "Watercolor" will see those choices reflected in the generated image without writing a single word of prompt engineering. The storyboard's tone also acts as a 60-30-10 color grading directive so every scene in a project shares a consistent palette.

The techniques applied come from `docs/video-editing-notes.md`, which documents professional cinematic composition principles: shot-type vocabulary, vanishing-point theory, foreground/midground/background depth layering, emotional framing language, and the 60-30-10 color rule. The video generation workflow described there (Seedance-style per-scene prompts with duration and transitions) is deliberately deferred to Phase 2.

The camera and lighting option menus in the Storyboard editor are also expanded to expose the full vocabulary of cinematic shot types and lighting conditions that the composer understands.


## Progress


- [x] (2026-05-11) Create `apps/api/src/generation/prompt-composer.ts` — pure `composeImagePrompt` function with lookup tables for camera, lighting, emotion, depth suffix, and tone color modifier.
- [x] (2026-05-11) Update `apps/api/src/images/local-image-preprocessing.ts` — load storyboard and style preset during preprocessing, call `composeImagePrompt`, inject `prompt` into returned `inputJson`.
- [x] (2026-05-11) Update `apps/api/src/app/create-api-context.ts` — pass `repos.storyboards` and `repos.stylePresets` to `LocalImagePreprocessingAdapter`.
- [x] (2026-05-11) Update `apps/web/src/components/storyboard/StoryboardPage.tsx` — expand `CAMERA_OPTIONS` from 5 to 11 and `LIGHTING_OPTIONS` from 5 to 8.
- [x] (2026-05-11) Update `docs/gap-analysis.md` — mark "Prompt consistency mechanism" as ⚠️, add cinematic prompt composition row to Section 13, annotate camera and lighting scene fields with composition status.


## Surprises & Discoveries


- **`motionDirection` was intentionally left out of the composer.** The field describes how the camera moves across a video clip (slow pan, zoom in, tracking). Passing it as a static-image generation hint would mislead the model. It will become relevant when `composeVideoPrompt` is added for Phase 2 (Seedance).

- **No port interface or domain model changes were needed.** `cameraDirection`, `lightingDirection`, and `emotion` are already plain `string` columns, so expanded option values store cleanly. `ApplicationDependencies` already declared `storyboards` and `stylePresets` — only the `LocalImagePreprocessingAdapter` constructor's `Pick` type needed to be widened.

- **`inputJson.prompt` is authoritative from preprocessing onward.** The OpenAI adapter already reads `prompt` from `inputJson` (with a fallback default). Injecting the composed prompt in the preprocessing step required no changes to the adapter or the `ImageGenerationPort` interface.


## Decision Log


- Decision: Compose the prompt inside `LocalImagePreprocessingAdapter.preprocess` rather than inside the OpenAI adapter or a new use-case step.
  Rationale: The preprocessing step is the single point where all scene, storyboard, and asset context is already available. Putting composition here keeps the OpenAI adapter stateless and lets a future mock adapter or alternative provider benefit from the same composed prompt automatically.
  Date/Author: 2026-05-11 / Claude

- Decision: Use plain lookup tables (JavaScript object literals) in `prompt-composer.ts` rather than a data file or DB-driven configuration.
  Rationale: The vocabulary is tightly coupled to what the image model understands. Keeping it as code makes it easy to review, adjust, and test. A DB-driven approach would add schema complexity with no user-visible benefit at this stage.
  Date/Author: 2026-05-11 / Claude

- Decision: Overwrite any existing `prompt` key in `inputJson` with the composed prompt.
  Rationale: The current `GeneratePage` always passes an empty `inputJson`, so there is no real caller that sets `prompt` explicitly. The composer's output is always more informative than a manually typed prompt alone, because it wraps the user's subject description with cinematic context. If a future caller needs to bypass composition, it can be made opt-out at that time.
  Date/Author: 2026-05-11 / Claude

- Decision: Defer `composeVideoPrompt` (Seedance-style per-scene prompts with `clipDuration` and `transitionType`) to Phase 2.
  Rationale: Video generation is explicitly out of scope for Phase 1. The `composeVideoPrompt` function will live in the same `prompt-composer.ts` file when the time comes, but adding unused code and schema columns now has no value.
  Date/Author: 2026-05-11 / Claude


## Outcomes & Retrospective


All tasks completed on 2026-05-11. `pnpm typecheck` passes clean across all five workspace packages. The cinematic composition layer is in production for image generation. The video composition path remains a clearly documented gap in `docs/gap-analysis.md` (Phase 2 — `🔮`).

The 60-30-10 color rule from `docs/video-editing-notes.md` is implemented via the `TONE_COLOR_MODIFIERS` table in `prompt-composer.ts`. Vanishing-point and depth-layering language is incorporated into the camera direction lookup and `depthSuffix` function.


## Context and Orientation


This is a pnpm monorepo (`gen-story`) following clean architecture. The relevant layers are:

- `packages/domain/src/model.ts` — `Scene` type: holds `imagePrompt`, `emotion`, `cameraDirection`, `lightingDirection`, `motionDirection`. `Storyboard` type: holds `tone` and `stylePresetId`. `StylePreset` type: holds `prompt` (a visual style instruction string).
- `packages/application/src/ports.ts` — `ImagePreprocessingPort`: single method `preprocess({ projectId, storyboardId, sceneId, inputJson })` → `Promise<Record<string, unknown>>`. The returned object is stored as `generationRequest.inputJson`.
- `apps/api/src/images/local-image-preprocessing.ts` — concrete implementation of `ImagePreprocessingPort`. Previously only normalized photo assets; now also composes the prompt.
- `apps/api/src/generation/prompt-composer.ts` — **new file**. Pure function `composeImagePrompt` with all lookup tables.
- `apps/api/src/generation/openai-image-generation.ts` — reads `prompt` from `inputJson` (line ~32); unchanged.
- `apps/api/src/app/create-api-context.ts` — wires all adapter dependencies; updated to pass `storyboards` and `stylePresets` to `LocalImagePreprocessingAdapter`.
- `apps/web/src/components/storyboard/StoryboardPage.tsx` — Storyboard editor; `CAMERA_OPTIONS` and `LIGHTING_OPTIONS` constants expanded.

Data flow:

    GeneratePage → POST /api/scenes/:sceneId/generation-requests
      → createGenerationRequestUseCase
        → imagePreprocessing.preprocess({ projectId, storyboardId, sceneId, inputJson: {} })
          → LocalImagePreprocessingAdapter
              load scene → load storyboard → load stylePreset (if any)
              composeImagePrompt(...) → rich cinematic string
              normalize photos (unchanged)
              return { normalizedInputImages, prompt: composedPrompt }
          stored as generationRequest.inputJson
        → job queued
      → LocalJobWorker picks up job
        → OpenAiImageGenerationAdapter.generate({ requestId, inputJson })
            const { prompt = "A cinematic still image." } = inputJson
            → OpenAI API


## Plan of Work


The only user-visible gap was that structured scene fields were never used in generation. Closing it required four file changes:

1. A new pure module `prompt-composer.ts` to encode the cinematic vocabulary from `docs/video-editing-notes.md`. No dependencies on any framework or external library — just lookup tables and string concatenation.

2. Widening `LocalImagePreprocessingAdapter`'s dependency set to include `storyboards` and `stylePresets`, then loading them inside `preprocess` and calling the composer. The composed prompt is injected as `inputJson.prompt`, which the OpenAI adapter already reads.

3. Passing the two new deps into the adapter in `create-api-context.ts`.

4. Expanding the camera and lighting option arrays in `StoryboardPage.tsx` so the UI exposes the full vocabulary the composer understands.


## Concrete Steps


All steps run from the repository root (`/Users/ran/my-app/gen-story`).

Create `apps/api/src/generation/prompt-composer.ts` with `composeImagePrompt` (see file for full lookup tables).

Edit `apps/api/src/images/local-image-preprocessing.ts`:
- Add import: `import { composeImagePrompt } from "../generation/prompt-composer";`
- Extend the `deps` Pick type: `"scenes" | "photoAssets" | "objectStorage" | "storyboards" | "stylePresets"`
- After validating the scene, load the storyboard and optionally the style preset.
- Call `composeImagePrompt(...)` and add `prompt: composedPrompt` to the return value.

Edit `apps/api/src/app/create-api-context.ts`:
- Add `storyboards: repos.storyboards` and `stylePresets: repos.stylePresets` to the `LocalImagePreprocessingAdapter` constructor call.

Edit `apps/web/src/components/storyboard/StoryboardPage.tsx`:
- Replace `CAMERA_OPTIONS` with the 11-item array.
- Replace `LIGHTING_OPTIONS` with the 8-item array.

Verify:

    pnpm typecheck


## Validation and Acceptance


Run from repository root:

    pnpm typecheck       # must report no errors across all 5 packages

Manual smoke test:

1. Start the dev server: `pnpm dev`
2. Open the Storyboard page for any project.
3. Set Camera to "Telephoto", Lighting to "Backlit", Emotion to "Nostalgia". Save.
4. Navigate to Generate and trigger generation for that scene.
5. Open the SQLite DB (e.g., with `sqlite3 data/gen-story.sqlite`) and run:
       SELECT input_json FROM generation_requests ORDER BY created_at DESC LIMIT 1;
   The `prompt` field in the JSON must contain substrings like "telephoto compressed shot", "strong backlight", "subtle melancholy", and the tone's color modifier.
6. If `OPENAI_API_KEY` is set, the generated image should visually reflect the telephoto framing and backlit silhouette.


## Idempotence and Recovery


`pnpm typecheck` is safe to repeat. The preprocessing changes are applied at job-execution time, so re-queuing an existing generation request will produce a freshly composed prompt. No DB migrations are needed; no stored data is altered.

If the composed prompt produces undesirable results for a scene, the user can manually edit `imagePrompt` to override the subject description. The composer wraps the user's text, not the other way around.


## Artifacts and Notes


`pnpm typecheck` output after implementation:

    Scope: 5 of 6 workspace projects
    packages/domain typecheck: Done
    packages/shared typecheck: Done
    packages/application typecheck: Done
    apps/web typecheck: Done
    apps/api typecheck: Done


## Interfaces and Dependencies


- `composeImagePrompt` (`apps/api/src/generation/prompt-composer.ts`) — takes `{ imagePrompt, emotion, cameraDirection, lightingDirection, tone, stylePresetPrompt }`, returns a plain string. No external dependencies.
- `StoryboardRepositoryPort.findById` (`packages/application/src/ports.ts`) — already declared; used in preprocessing to load the storyboard.
- `StylePresetRepositoryPort.findById` (`packages/application/src/ports.ts`) — already declared; used to load the style preset prompt if `stylePresetId` is set.
- `ApplicationDependencies` (`packages/application/src/ports.ts`) — already includes `storyboards` and `stylePresets`; no interface changes needed.
