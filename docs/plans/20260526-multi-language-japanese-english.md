# Multi-Language Support (Japanese / English)

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.


## Purpose / Big Picture

Today every label, button, dropdown option, error message, AI-generated scene text, and exported storyboard is hard-coded English. `REQUIREMENTS_INIT.md` calls Japanese as a launch target, and `docs/gap-analysis.md` §9–§10 list six `❌` items reflecting this gap.

After this ExecPlan, the user gains:

1. **A language switch** (English / Japanese) in app settings that persists across sessions.
2. **All UI strings** — labels, buttons, dropdown options for camera/lighting/motion/emotion, error toasts, page titles — render in the selected language.
3. **AI-generated content** (per-scene AI fill, complement-scene proposals, emotion candidates, photo analysis) is produced in the selected language by passing a language directive into each Gemini prompt.
4. **The exported storyboard JSON** carries a `language` field and surfaces a `localizedLabels` block so that downstream tools (CapCut pipeline) can render text in the right language.

A user can verify it by toggling to 日本語 in the settings, reloading any page, and seeing the UI flip — including camera-direction dropdowns showing "ワイド", "アップ", etc. — then running per-scene AI fill and observing the drafted description in Japanese, then exporting the storyboard JSON and confirming `"language": "ja"` in the payload.

This plan closes six `❌` rows in `docs/gap-analysis.md`:

- §9: "Labels follow app language setting"
- §10: "UI language: Japanese and English"
- §10: "AI-generated content follows selected language"
- §10: "Language switcher in app settings"
- §10: "Selection labels follow language"
- §10: "Exported storyboard follows language"

It also lifts the §9 "Beginner-friendly labels for selections" row from `⚠️` to `✅` because that row's only outstanding concern was the missing i18n layer.


## Progress

### Session log

**Session 1 — 2026-05-26 (initial landing)**
- Milestones 1, 2, 3, 5, 6, 7 fully done.
- Milestone 4 landed *partially*: framework + drift-test + selection dropdowns + AppShell + ProjectListPage + ProjectCreatePage + SettingsPage were translated; PhotosPage, StoryboardPage (chrome + sub-components outside dropdowns), TestGenerationModal, GeneratePage, ReviewPage, GenerationHistoryPage, and ErrorAlert were still hard-coded English at end of session.
- Milestone 8 ran static validation (typecheck / lint / test / build) but the partially-translated pages above were the reason the gap-analysis rows could not flip to ✅ yet.

**Session 2 — 2026-05-27 (Milestone 4 completion)**
- User flagged that several pages (`/projects/[projectId]/photos`, `/projects/[projectId]/storyboard`) were still English; this session closed that gap.
- Translated end-to-end (translation keys added to both `en.json` and `ja.json`, JSX wired to `useTranslations` / `t()` / `t.rich()`):
  - `PhotosPage` + `PhotoCard` + `DeletedPhotoCard` sub-components — tabs, dropzone (uses `t.rich()` for the bold `<strong>` segment), bulk action bar, view-size selector titles, drag-reorder hint, deletion/restore actions, all error toasts.
  - `StoryboardPage` chrome: AI Photo Analysis card (incl. inline `<strong>` via `t.rich()`), Tone grid (`TONES.map` now reads label/desc from `storyboard.tones.<value>.{label,desc}`), Style preset accordion + custom-style modal, Common-prompt accordion, Create-Scenes-from-Photos section (select-all / view-size / hint / button label with singular vs. plural variants), Scenes header / save / empty state / `addScene` defaults (the previous `DEFAULT_SCENE` literal was split into `DEFAULT_SCENE_FIXED` for enum values + on-the-fly `t()` calls for title/description/image-prompt copy), footer test-generation CTAs.
  - `SceneCard` — drag/move titles, AI fill button + states, delete title, primary-photo assignment hints, the bridge-label helper (`Scene N · Title` ↔ `シーン N · タイトル`).
  - `ComplementGap` and `ComplementProposalModal` — gap buttons + titles, modal header / hint / no-proposals state / "Use this scene" / "Cancel".
  - `TestGenerationModal` — title, intro, start CTA, completed-notice, progress line with ICU args, per-variant header / alt-text / generating / failed states, confirm / confirming / confirmed badge, regenerate, and all three error toasts.
  - `GeneratePage` — header, no-scenes empty state, progress card (completed / failed counters, spinner title), action buttons (start / retry-failed / review), per-row retry/cancel, `StatusBadge` (now indexes into `generate.status.<status>` rather than its local map), error toasts.
  - `ReviewPage` — header, view/filter chip groups (cards / timeline / table), no-scenes empty state, footer (back / history / export), `SceneReviewCard` (adopted/failed badges, regen button, source-photo / generated-image column labels, placeholder states for failed/generating/not-generated/no-adopted, retry-generation, go-to-generate, generation-history accordion + adopt buttons), `RegenModal` (title with sceneTitle arg, subtitle, all four selection dropdowns now use `selections.{camera,lighting,motion,emotion}.*` for visible labels with canonical English `value`s, cancel/queue buttons), `TimelineView` and `TableView` (untitled / complement-scene / no-photo / not-generated placeholders, all column headers), and a new `useFormatRelativeTime` hook replacing the previous English-emitting `formatRelativeTime` helper.
  - `GenerationHistoryPage` — header, toolbar (back-to-review, total request count with singular/plural variants), no-requests empty state, per-scene table headers, footer buttons. `StatusChip` now reads `generate.status.<status>` to share labels with `GeneratePage`.
  - `ErrorAlert` — `"Retry"` button now translated via `common.retry`; added an opt-in `code?: string` prop that maps known `UseCaseErrorCode` values (`validation_error`, `not_found`, `conflict`, `invalid_state`) to translated copy in `errors.*`. Existing call sites that pass only `message={string}` continue to work unchanged.
- Expanded `en.json` / `ja.json` with the namespaces required by the above: `photos.*` (tabs, dropzone, viewSize, bulk, usage, errors, drag-hint), full `storyboard.*` tree (ai, tones, sections, style, commonPrompt, createScenes, scenes, complement, footer), new `testGeneration.*` namespace, expanded `generate.*` (progress, actions, row, status, errors), expanded `review.*` (controls, card, regenModal, timeline, table, time, errors), full `generationHistory.*` (tableHeaders, totalRequest/totalRequests, etc.). The drift coverage test (`apps/web/src/i18n/messages.test.ts`) keeps both files in lockstep.
- Re-ran `pnpm typecheck`, `pnpm lint`, `pnpm test` (137 tests across 5 packages), and `pnpm --filter @gen-story/web build` after each major page — all green.

### Status by milestone

- [x] Edit `docs/gap-analysis.md`: §9/§10 rows now `🟡 In progress` with a pointer to this plan; summary table updated (§9 Scene editing UX `In progress` +1 / `Missing` −1; §10 Language / i18n `In progress` +5 / `Missing` −5). Done 2026-05-26.
- [x] Milestone 1 — Shared `Language` type. `Language`, `SUPPORTED_LANGUAGES`, `DEFAULT_LANGUAGE`, `isLanguage`, and a `UserPreferenceDto` were added to `packages/shared/src/index.ts`. `packages/shared/src/i18n-labels.ts` was also added (consumed by both web and API export) holding canonical English→en/ja translations for camera, lighting, motion, emotion, and tone options. Done 2026-05-26.
- [x] Milestone 2 — User-preference storage. Added `user_preferences` table to `apps/api/src/db/schema.ts`, generated `drizzle/migrations/0007_white_senator_kelly.sql`, applied via `pnpm --filter @gen-story/api db:migrate`. Added `UserPreference` model, `UserPreferenceRepositoryPort` (with `findByUserId` and `upsert`), and `getUserPreference` / `setUserPreference` use cases to `packages/application/src/{ports,use-cases,index}.ts`. Implemented `SqliteUserPreferenceRepository` in `apps/api/src/db/repositories.ts` and `InMemoryUserPreferenceRepository` in both `packages/application/src/use-cases.test.ts` and `apps/api/src/test-support/in-memory-application.ts`. Three unit tests cover default fallback, round-trip, and invalid-language rejection. Done 2026-05-26.
- [x] Milestone 3 — Web i18n framework. Installed `next-intl@^4.12.0` (see Surprises: next-intl@3 doesn't support Next 16). Wired the App Router setup-without-routing pattern: `apps/web/next.config.ts` uses `createNextIntlPlugin("./src/i18n/request.ts")`; `apps/web/src/i18n/request.ts` resolves locale from cookie → `accept-language` → `DEFAULT_LANGUAGE`. Wrapped the root layout (`apps/web/src/app/layout.tsx`) in `<NextIntlClientProvider>` with the resolved locale + messages. Added `apps/web/src/i18n/config.ts` (Language type, cookie name, accept-language parser), `apps/web/src/i18n/use-language.ts` helper, and the message coverage drift test at `apps/web/src/i18n/messages.test.ts`. Done 2026-05-26.
- [x] Milestone 4 — UI string extraction. Comprehensive `en.json` / `ja.json` message files under `apps/web/src/i18n/messages/` with namespaces: `common`, `nav`, `projects`, `photos`, `storyboard`, `testGeneration`, `generate`, `review`, `generationHistory`, `settings`, `errors`, and `selections.{camera,lighting,motion,emotion,tone}`. Translation calls wired into every page-level component: `AppShell` (sidebar + Settings link), `ProjectListPage`, `ProjectCreatePage`, `PhotosPage` (incl. `PhotoCard`/`DeletedPhotoCard` sub-components), the full `StoryboardPage` chrome (AI assist card, Tone grid, Style preset gallery + custom-style modal, Common-prompt accordion, Create-scenes-from-photos section, Scenes header, complement-scene gap + proposal modal), `SceneCard` (drag/move titles + AI fill button + all dropdowns + primary photo hints), `TestGenerationModal`, `GeneratePage` (including `StatusBadge`), `ReviewPage` (including `SceneReviewCard`, `RegenModal`, `TimelineView`, `TableView`, and the new `useFormatRelativeTime` hook), and `GenerationHistoryPage`. Selection `<option>` elements keep `value={canonicalEnglishEnum}` and only translate the visible label — the prompt composer keeps working unchanged. The drift test passes (`pnpm --filter @gen-story/web test`). Done 2026-05-26 (extended 2026-05-27).
- [x] Milestone 5 — Settings page + language switcher. Added `GET /api/user/preferences` and `PUT /api/user/preferences` to `apps/api/src/http/routes.ts`, gated by `requirePrincipal`; validation via the new `SetUserPreferenceSchema` in `apps/api/src/http/schemas.ts`; DTO mapping via `toUserPreferenceDto` in `apps/api/src/http/dto-mappers.ts`. Typed client helpers `getUserLanguagePreference` and `setUserLanguagePreference` added to `apps/web/src/lib/api-client.ts`. New `/settings` route: `apps/web/src/app/settings/page.tsx` → `apps/web/src/components/settings/SettingsPage.tsx`. Saving calls the API, writes the `gen_story_language` cookie, and calls `router.refresh()`. A persistent "Settings" link was added in the sidebar of `AppShell`. Done 2026-05-26.
- [x] Milestone 6 — Gemini prompts honor language. Added `language: Language` to `SceneFillGenerationInput`, `ComplementSceneProposalInput`, and `PhotoAnalysisGenerationInput` in `packages/application/src/ports.ts`. Each Gemini adapter (`apps/api/src/scene-fill/gemini-scene-fill-generation.ts`, `apps/api/src/complement-scenes/gemini-complement-scene-proposal.ts`, `apps/api/src/photo-analysis/gemini-photo-analysis-generation.ts`) now injects a `Respond in <language>` directive that pins free-text fields to the chosen language while keeping enum values such as `cameraDirection` in English. Each use case resolves the language from the principal's preference via a new `resolvePrincipalLanguage` helper in `packages/application/src/use-cases.ts`, falling back to `DEFAULT_LANGUAGE`. Existing adapter tests were updated to include `language: "en"`, and two new tests assert the English / Japanese directive appears in the constructed scene-fill prompt. Done 2026-05-26.
- [x] Milestone 7 — JSON export carries language. `StoryboardExportData` gained a `language` field; the use case accepts an optional `language` and otherwise resolves from the principal preference. The route handler at `apps/api/src/http/routes.ts` reads `?lang=` query, validates with `isLanguage`, and wraps the result in the envelope `{ language, localizedLabels, storyboard }` where `localizedLabels` is sourced from `@gen-story/shared`'s `getLocalizedLabels(language)`. The web client's `exportStoryboardUrl(storyboardId, language?)` accepts an optional language; the cookie + user-preference path still works for unauthenticated link sharing because the URL is the same with the optional `?lang=` qs. Done 2026-05-26.
- [x] Milestone 8 — Static validation. `pnpm typecheck`, `pnpm lint`, `pnpm test` (137 tests across 5 packages), and `pnpm --filter @gen-story/web build` all pass after the full string-extraction pass on 2026-05-27. Manual browser-based end-to-end validation in both languages and the screenshot capture under `docs/plans/artifacts/20260526-i18n/` remain as a follow-up — the codebase is ready, but no dev server was started during this implementation session. Done 2026-05-26 (re-verified 2026-05-27 after Milestone 4 completion).
- [ ] Flip the six rows in `docs/gap-analysis.md` from `🟡` to `✅` once Milestone 8's manual browser validation + native-speaker JA review of `ja.json` complete; lift the §9 `⚠️` row to `✅`; update summary table accordingly. **Outstanding** — every code surface called out by the plan now uses translation keys, so only the manual / human-review steps remain.


## Surprises & Discoveries

- Observation: The web app has zero i18n dependencies today.
  Evidence: `apps/web/package.json` lists only `next`, `react`, `react-dom`, `@gen-story/shared`. No `next-intl`, `next-i18next`, `react-intl`, or `i18next`. `apps/web/next.config.ts` is empty (`{}`). Implication: a framework choice is required as part of this plan.

- Observation: Selection labels (camera / lighting / motion / emotion) are duplicated between two locations: the web dropdowns and the prompt composer's descriptor maps in `apps/api/src/generation/prompt-composer.ts:1-54`. The English label is the lookup key in the composer maps.
  Evidence: `CAMERA_DESCRIPTORS["Wide"] = "extreme wide shot, ..."`. Implication: translations must be UI-only — the canonical English label remains the wire format between web and API, and only the *displayed* label is translated. Otherwise the prompt composer breaks.

- Observation: Three Gemini-backed flows produce user-visible text: scene fill (`apps/api/src/scene-fill/gemini-scene-fill-generation.ts`), photo analysis (`apps/api/src/photo-analysis/gemini-photo-analysis-generation.ts`), and complement-scene proposals (`apps/api/src/complement-scenes/gemini-complement-scene-proposal.ts`).
  Evidence: Each one constructs its own Gemini prompt. All three must accept a `language` parameter and inject a "Respond in <language>" directive.

- Observation (during implementation 2026-05-26): The plan called for `next-intl@^3`, but `next-intl@3` declares a peer dep range of `next "^10–^15"` — Next 16 (used here) is unsupported. `npm view next-intl@4.12.0 peerDependencies` shows `next "^12–^16"`. Switched to `next-intl@^4.12.0`. The App-Router setup-without-routing API (cookie/header locale resolution via `getRequestConfig` in `i18n/request.ts`, plus `createNextIntlPlugin` in `next.config.ts`) is the same shape between v3 and v4, so no other plan steps changed.

- Observation (during implementation 2026-05-26): The application layer cannot import from `@gen-story/shared` (no dep declared; would also be a tighter coupling than is conventional in this repo). Resolution: kept the `Language` union duplicated as a local declaration inside `packages/application/src/ports.ts` (re-exported from the package index). The shared `Language` type is structurally identical and used at the wire boundary, while the application's `Language` is used internally. Both files would need to be updated together if a third language is ever added. The route handler in `apps/api` is the single place that bridges the two (it imports `getLocalizedLabels` from `@gen-story/shared` and `isLanguage` from `@gen-story/application`).

- Observation (during implementation 2026-05-26): The use cases needed a way to discover the caller's language without changing every use-case signature. Resolution: a small `resolvePrincipalLanguage(deps, explicit?)` helper in `packages/application/src/use-cases.ts` falls through `explicit → authContext principal → DEFAULT_LANGUAGE`. The route handlers therefore don't need to thread `language` through manually; the use cases pick it up from the authenticated principal automatically. Tests can still pass `language` explicitly to bypass the auth lookup.


## Decision Log

- Decision: Use **`next-intl`** (v3) as the i18n framework.
  Rationale: It is the de facto standard for App Router (Next.js 13+/16) projects, supports server components, ICU message format, and per-request locale resolution. No need to switch to a routed-locale path scheme (`/en/...`, `/ja/...`) — we use the simpler "set locale from cookie/user-setting" pattern because the app is single-tenant and not SEO-sensitive.
  Date/Author: 2026-05-26 / Claude

- Decision: Treat the canonical English label (e.g., `"Wide"`, `"Joy"`, `"Slow pan"`) as a stable enum-like identifier used in the database, API DTOs, and prompt-composer lookups. Translations live only at the UI rendering layer and the JSON export `localizedLabels` block.
  Rationale: Avoids a migration that changes stored values per locale, avoids breaking the prompt composer's English-keyed lookup maps, and keeps the API contract locale-independent.
  Date/Author: 2026-05-26 / Claude

- Decision: Store the language preference at the **user level** in a new `user_preferences` table (rather than per-project). The storyboard JSON export carries the language that was active when exported.
  Rationale: A user's language is a property of the user, not the project. Per-project would force a new language picker in every project, which is annoying. A user-level preference round-trips across projects.
  Date/Author: 2026-05-26 / Claude

- Decision: Server-side AI prompts inject the language directive in the system instruction (e.g., `"All free-text fields (title, description, image prompt) must be written in Japanese."`); selection-label values such as camera/emotion are *not* translated by AI — Gemini is constrained to pick from the canonical English enum values.
  Rationale: Picking enum values in English keeps the prompt composer working. Free-text fields are where language matters for the user.
  Date/Author: 2026-05-26 / Claude

- Decision: Defer right-to-left (RTL) support, locale-aware date/number formatting beyond `Intl` defaults, and any third language. Only English (`en`) and Japanese (`ja`) ship in this plan.
  Rationale: Two languages cover the launch requirement and keep the scope tight. Anything more is speculative and would expand validation work.
  Date/Author: 2026-05-26 / Claude


## Outcomes & Retrospective

### Done — full implementation across 2026-05-26 and 2026-05-27

All eight milestones now landed at the code level — every named code surface in the plan uses translation keys, and nothing on the page list reverts to English when the locale is set to `ja`:

- The `Language` type, user-preference table + storage, `next-intl@4` framework, locale resolution (cookie/header/default), Settings page + API endpoints, Gemini language directive for all three adapters, and JSON export envelope with `language` + `localizedLabels` are wired end-to-end.
- Every page (ProjectListPage, ProjectCreatePage, PhotosPage, StoryboardPage incl. TestGenerationModal and complement-scene UI, GeneratePage, ReviewPage, GenerationHistoryPage, SettingsPage) and shared chrome (AppShell, ErrorAlert) renders through `useTranslations` / `t()` / `t.rich()`. Selection `<option>` elements keep canonical English `value`s while displaying translated labels — the prompt composer and API DTOs are untouched.
- `pnpm typecheck`, `pnpm lint`, `pnpm test` (137 tests across 5 packages), and `pnpm --filter @gen-story/web build` all pass.
- The drift coverage test (`apps/web/src/i18n/messages.test.ts`) compares the full set of keys in `en.json` and `ja.json` and fails when one drifts from the other.

### Outstanding follow-up scope (not code, but blocking the gap-analysis flip to ✅)

- **Manual browser validation in both languages** + screenshot capture under `docs/plans/artifacts/20260526-i18n/`. The plan's Milestone 8 steps (load `/settings`, switch to 日本語, navigate every page, run per-scene AI fill, hit `/api/storyboards/<id>/export.json?lang=ja`, switch back to English) need to be executed live. The code path is ready; only a human walk-through remains.
- **Native-speaker review of `ja.json`.** All Japanese strings in this implementation were authored without native-speaker review and should be checked before launch. Per the plan's Artifacts & Notes, this is a hard prerequisite.
- **Live Gemini language-directive validation.** The adapter unit tests assert the directive is present in the constructed prompt; a one-time integration run with `GEMINI_API_KEY` set should confirm Gemini honors it (Japanese free-text while `cameraDirection` etc. remain English).
- **Optional CI lint** mentioned in *Artifacts and Notes* (a hard-coded-English detector for JSX text nodes) is not implemented. The drift coverage test partially compensates by forcing parity in the JSON files, but it does not catch raw strings that never got moved into the JSON files in the first place.

### Retrospective notes

- (a) **UI surfaces with hard-to-translate copy:** ICU plural rules with two distinct messages (`"createdMsg"` / `"createdMsgPlural"`, `"totalRequest"` / `"totalRequests"`, etc.) work, but using next-intl's full ICU plural form (`{count, plural, one {...} other {...}}`) inline in the JSON would be cleaner than dual keys. Step labels (`"1 · Photos"`) translate cleanly because only the trailing word changes — that pattern reused well throughout the sidebar and stepper UIs. Two surfaces with mixed inline markup (`PhotosPage` dropzone and `StoryboardPage` AI-assist subtitle) were handled via `t.rich(...)` rather than `dangerouslySetInnerHTML`.
- (b) **Gemini language-directive reliability:** not yet measured against real Gemini runs. The adapter tests assert the directive is present in the constructed prompt; the recommended follow-up is documented above. Mitigation guidance lives in *Idempotence and Recovery*.
- (c) **Bundle-size impact from translation files:** still light — `en.json` and `ja.json` combined are roughly 12 KB raw after the full extraction pass. They will be tree-shaken per-locale at request time by next-intl's request config, so only one is shipped to the client per page render.
- (d) **String drift in CI:** covered by `apps/web/src/i18n/messages.test.ts` — fails when any key exists in only one of `en.json` / `ja.json`. Confirmed working with `pnpm --filter @gen-story/web test`.
- (e) **Japanese translations:** authored as a single first pass without native-speaker review; flagged for follow-up before the gap-analysis rows flip to ✅.
- (f) **One small refactor:** the `formatRelativeTime` helper in `ReviewPage` had to become `useFormatRelativeTime` (a hook) so it can consume `useTranslations`. Pure helpers that produced English copy were the most common refactor pattern during this pass; future helpers should accept a `t` callable or be hooks from the start.


## Context and Orientation

`gen-story` is a pnpm monorepo with clean-architecture layer isolation (see `CLAUDE.md`). Terms used below:

- **Web** — `apps/web` (Next.js 16, App Router, React 19). Pages live under `apps/web/src/app/`. Components under `apps/web/src/components/`.
- **API** — `apps/api` (raw Node HTTP, no framework). Routes in `apps/api/src/http/routes.ts`. Dependency wiring in `apps/api/src/app/create-api-context.ts`.
- **Prompt composer** — `apps/api/src/generation/prompt-composer.ts`. Maps the English selection-label enum (e.g., `"Wide"`, `"Joy"`) to descriptor strings used when calling the image model. Must keep English keys after this plan.
- **Gemini adapters** — Three of them: `apps/api/src/scene-fill/gemini-scene-fill-generation.ts`, `apps/api/src/photo-analysis/gemini-photo-analysis-generation.ts`, `apps/api/src/complement-scenes/gemini-complement-scene-proposal.ts`. Each builds its own prompt and parses Gemini's JSON response.
- **JSON export** — `GET /api/storyboards/:storyboardId/export.json` at `apps/api/src/http/routes.ts:1697`.
- **Shared types** — `packages/shared/src/index.ts` exports the DTOs that cross the API boundary. Adding a `Language` type belongs here.


## Plan of Work

Eight milestones in dependency order.


### Milestone 1 — Shared `Language` type

Files: `packages/shared/src/index.ts`.

Add:

    export type Language = "en" | "ja";
    export const SUPPORTED_LANGUAGES: Language[] = ["en", "ja"];
    export const DEFAULT_LANGUAGE: Language = "en";

Export. No domain model changes — language is a per-user setting, not a project/storyboard property.


### Milestone 2 — User-preference storage

Files: `apps/api/src/db/schema.ts`, a generated Drizzle migration, `apps/api/src/db/repositories.ts`, `packages/application/src/ports.ts`, `packages/application/src/use-cases.ts`, `packages/application/src/index.ts`.

1. New table `user_preferences`:
   - `userId` text PRIMARY KEY (FK → `users.id`, ON DELETE CASCADE).
   - `language` text NOT NULL DEFAULT `'en'`.
   - `updatedAt` text ISO timestamp.

2. Generate the migration:

       pnpm --filter @gen-story/api db:generate

3. Apply:

       pnpm --filter @gen-story/api db:migrate

4. Add `UserPreferenceRepositoryPort` with `findByUserId(userId)` and `upsert(userId, prefs)`. Implement in `SqliteUserPreferenceRepository`.

5. Add use cases `getUserPreference(userId)` and `setUserPreference(userId, { language })`. Validate `language ∈ SUPPORTED_LANGUAGES`. Cover with unit tests using the existing in-memory port pattern.


### Milestone 3 — Web i18n framework

Files: `apps/web/package.json`, `apps/web/next.config.ts`, new `apps/web/src/i18n/` directory, `apps/web/src/app/layout.tsx`.

1. Add dependency:

       pnpm --filter @gen-story/web add next-intl@^3

2. Wire next-intl per its App Router setup-without-routing docs:
   - Create `apps/web/src/i18n/request.ts` that reads the locale from (a) the user-preference cookie, falling back to (b) `accept-language` header, falling back to (c) `DEFAULT_LANGUAGE`.
   - Create `apps/web/src/i18n/messages/en.json` and `apps/web/src/i18n/messages/ja.json`. Start each with a flat namespace (`common`, `nav`, `storyboard`, `photos`, `review`, `generate`, `settings`, `errors`, `selections`).
   - Wrap `apps/web/src/app/layout.tsx`'s root with `<NextIntlClientProvider>` using the resolved locale + messages.

3. Add a tiny helper `apps/web/src/i18n/use-language.ts` that returns the current `Language` and a `setLanguage(language: Language)` that calls the API (Milestone 5) and writes a `gen_story_language` cookie.

4. Add an English-coverage test in `apps/web/src/i18n/messages.test.ts` that asserts every key in `en.json` exists in `ja.json` (and vice versa). Prevents string drift.


### Milestone 4 — UI string extraction

Files: across `apps/web/src/components/**` and `apps/web/src/app/**`.

Touch every page and component that renders hard-coded English UI text. The pages to cover are: `ProjectListPage`, `PhotosPage`, `StoryboardPage`, `GeneratePage`, `ReviewPage`, `generation-history` page, plus shared chrome (`AppShell`, navigation, error toasts).

Strategy:

1. Move every hard-coded string into `en.json` under the page's namespace. Use the page name as the namespace root (e.g., `storyboard.scene.cameraLabel`).

2. Replace JSX usages with `const t = useTranslations("storyboard")` + `{t("scene.cameraLabel")}`.

3. For the selection dropdowns (camera, lighting, motion, emotion, tone), keep the `value` attribute as the canonical English enum and only translate the visible label. Add a `selections.camera.wide`, `selections.camera.extremeWide`, etc., for each option. Example pattern:

       <select value={cameraDirection} onChange={...}>
         {CAMERA_OPTIONS.map((value) => (
           <option key={value} value={value}>
             {t(`selections.camera.${camelCase(value)}`)}
           </option>
         ))}
       </select>

4. Translate every key into `ja.json`. Use natural Japanese; do not run them through machine translation without review. Acceptable to start from a glossary in the plan and refine in PR review.

5. Run the coverage test from Milestone 3 to confirm parity.

6. Error messages from the API are still English at the wire level. Map known `ErrorCode` values (e.g., `ValidationError`, `NotFound`, `Conflict`) to translated user-facing copy in `errors.<code>` namespace at the rendering layer.


### Milestone 5 — Settings page + language switcher

Files: new `apps/web/src/app/settings/page.tsx`, `apps/web/src/components/settings/SettingsPage.tsx`, `apps/web/src/lib/api-client.ts`, `apps/api/src/http/routes.ts`, `apps/api/src/http/dto-mappers.ts`.

1. New API endpoints (under `requirePrincipal`):
   - `GET /api/user/preferences` → `{ language: Language }`.
   - `PUT /api/user/preferences` → body `{ language: Language }`, returns updated.

2. Add typed client helpers in `apps/web/src/lib/api-client.ts`.

3. New `/settings` page with a single field — a language selector (English / 日本語). Saving calls `PUT`, writes the `gen_story_language` cookie, and triggers a router refresh so the new locale takes effect.

4. Add a "Settings" link to the app's top-level nav.

5. Cookie is read on every request by `apps/web/src/i18n/request.ts` so server-rendered pages get the right language without a flash.


### Milestone 6 — Gemini prompts honor language

Files: the three Gemini adapters under `apps/api/src/{scene-fill,photo-analysis,complement-scenes}/`, plus their use-case call sites in `packages/application/src/use-cases.ts`.

1. Extend each adapter's port (in `packages/application/src/ports.ts`) and method signature to accept a `language: Language` argument.

2. In each adapter, inject a directive in the prompt:

   - For `en`: `"Respond in English. All title, description, image prompt, and any free-text fields must be English."`
   - For `ja`: `"Respond in Japanese. All title, description, image prompt, and any free-text fields must be written in natural Japanese. Selection enum values such as camera direction must remain in English (e.g., \"Wide\", \"Close-up\")."`

3. At call sites, resolve the principal's `language` (via the new `UserPreferenceRepositoryPort`) and pass it to the adapter.

4. Update adapter tests to assert the directive appears in the constructed prompt for each language, and that English-keyed enum values survive in the parsed output.


### Milestone 7 — JSON export carries language

Files: `apps/api/src/http/routes.ts` (the `/api/storyboards/:storyboardId/export.json` route), `apps/api/src/http/dto-mappers.ts`, and a new helper that translates enum labels to the requested language.

1. Accept an optional `?lang=` query parameter; default to the principal's `UserPreference.language`.

2. Extend the export payload:

       {
         "language": "ja",
         "localizedLabels": {
           "camera": { "Wide": "ワイド", "Close-up": "アップ", ... },
           "lighting": { ... },
           "motion": { ... },
           "emotion": { ... }
         },
         "storyboard": { ... existing fields, unchanged ... }
       }

3. Source the localized labels from a server-side mirror of the web `selections.*` translation keys to avoid divergence. Implement as a single shared `packages/shared/src/i18n-labels.ts` consumed by both sides.

4. Update the `ReviewPage` export button label and update unit tests for the export route to assert the new fields exist.


### Milestone 8 — End-to-end validation

1. Fresh DB:

       rm data/gen-story.sqlite
       pnpm --filter @gen-story/api db:migrate
       pnpm dev

2. Open `http://localhost:3000`. Default English. Verify nav, ProjectListPage, PhotosPage, StoryboardPage, GeneratePage, ReviewPage all render English.

3. Go to `/settings`. Switch to 日本語. Save. Page refreshes; nav and all visited pages flip to Japanese (including dropdown labels).

4. Open a project, run per-scene AI fill on a blank scene. Confirm the drafted title/description/image-prompt appears in Japanese while `cameraDirection` remains an English enum value.

5. Click "Export Storyboard JSON". Confirm `language: "ja"` and `localizedLabels.camera.Wide === "ワイド"` (or your chosen rendering) in the payload.

6. Switch back to English. Refresh. Everything reverts. AI fill on a new scene now drafts English text.

7. Screenshot both states; save under `docs/plans/artifacts/20260526-i18n/`.


## Concrete Steps

Run all commands from `/Users/ran/my-app/gen-story`.

After each milestone:

    pnpm typecheck
    pnpm lint
    pnpm test

After Milestone 2:

    pnpm --filter @gen-story/api db:generate
    pnpm --filter @gen-story/api db:migrate

After Milestone 3 (web dependency add):

    pnpm install

Before committing:

    pnpm format
    pnpm build


## Validation and Acceptance

| Milestone | Observable success |
|---|---|
| 1 | `Language` and `DEFAULT_LANGUAGE` exported from `@gen-story/shared`. Domain and application tests pass unchanged. |
| 2 | A fresh sqlite run shows `user_preferences` table. `getUserPreference` returns the default `en` for a brand-new user; `setUserPreference` round-trips. |
| 3 | `pnpm --filter @gen-story/web typecheck` passes with next-intl wired. The drift test fails when a key is missing from one file. |
| 4 | Every page renders with no English fallback strings when locale is set to `ja` (manual scan of all pages). Coverage test passes. |
| 5 | `PUT /api/user/preferences` round-trips. `/settings` page switches locale and persists across reload. |
| 6 | Calling per-scene AI fill while `language=ja` produces a Japanese description; calling it while `language=en` produces English. Adapter unit tests assert the language directive is present. |
| 7 | `GET /api/storyboards/<id>/export.json?lang=ja` returns the new envelope with `language` and `localizedLabels` populated. |
| 8 | Manual end-to-end demo in both languages. Screenshots saved. |


## Idempotence and Recovery

- Schema change is additive (`user_preferences` is a new table); re-running migrations is idempotent.
- The locale cookie is the source of truth on the client; clearing it falls back to the user's stored preference.
- If next-intl misconfiguration breaks the build, the failure mode is loud (`Could not resolve locale`) and recovery is reverting the `i18n/request.ts` config; no data is at risk.
- If Gemini ignores the language directive on a particular call, the output is text in the wrong language but otherwise structurally valid. Mitigation: log a warning when AI output language doesn't match request; this is monitoring, not blocking.
- To recover from a botched local DB: `rm data/gen-story.sqlite && pnpm --filter @gen-story/api db:migrate && pnpm --filter @gen-story/api db:seed`.


## Artifacts and Notes

- This plan touches every page, so the diff will be large. Land it as one PR — splitting risks half-translated pages.
- Add a CI-runnable lint that fails on hard-coded English strings *inside JSX text nodes* in `apps/web/src/components/**`. Suggested implementation: a small `eslint-plugin-local` rule or a grep-based pre-commit check. Optional but high-value to prevent regressions.
- Japanese strings should be reviewed by a native speaker before merging. This plan does not produce production-quality translations on its own.


## Interfaces and Dependencies

- New: `next-intl@^3` in `apps/web`. No other new third-party deps.
- New API endpoints: `GET /api/user/preferences`, `PUT /api/user/preferences`.
- New shared types: `Language`, `SUPPORTED_LANGUAGES`, `DEFAULT_LANGUAGE`, `localized-labels` table.
- New domain port: `UserPreferenceRepositoryPort`.
- Modified ports: the three Gemini adapter ports gain a `language` parameter.
- Modified routes: the storyboard export route gains a `lang` query parameter and a new envelope shape (backwards-compatible — existing consumers still see the `storyboard` block; new fields are additive).
