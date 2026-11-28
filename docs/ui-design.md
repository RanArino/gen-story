# UI Design Conventions

Conventions for designing, implementing, and reviewing the Gen Story web UI
(`apps/web`). Coding agents should use the shared `web-ui-design` skill
(`/web-ui-design` in Claude Code, `$web-ui-design` in Codex) for web UI work and
apply the app-specific rules below.

## Scope

- **App in scope:** `apps/web` only — Next.js 16 App Router, React 19, CSS
  Modules, `next-intl` (English and Japanese messages in
  `apps/web/src/i18n/messages/`). `apps/api` has no UI.
- **Target browsers:** current desktop Chrome is the primary, tested browser
  (Playwright `chromium` project). Current Safari and Firefox on desktop are
  expected to work. There are no WebView targets.
- **Baseline target:** This project's Baseline target is Baseline Widely
  available. Newly available features are allowed only as progressive
  enhancements with a fallback that keeps the primary workflow usable.

## Visual identity and existing components

Keep the existing look; extend it rather than introducing a new style.

- **Shell:** `apps/web/src/components/AppShell.tsx` — dark navy sidebar
  (`#101827`) with stage navigation (Photos → Storyboard → Generate → Review →
  Film, plus Projects and Settings), light canvas (`#f5f7fa`), body text
  `#152033`, Inter/system-ui font stack. The optional agent chat panel adds a
  third column.
- **Accent:** primary blue `#1a56db`; danger red `#dc2626`; muted text
  `#5a6a7e` / `#64748b`; borders `#d0d9e8` / `#e5e9f0`.
- **Shape:** 8px radius for cards and controls, 6px for small controls, 12px for
  large panels, pill (`999px`) for chips and badges.
- **Styling:** one `*.module.css` file per component, colocated with it. Shared
  page classes (`screen-header` and others) are declared with `:global(...)` in
  `AppShell.module.css`. There is no token file yet; colors are literal hex
  values.
  `var(--color-primary)` and `var(--border-color)` are referenced in
  `StoryboardPage.module.css` and `ReviewPage.module.css` but never defined.
  Fix that when you touch those rules, ideally by introducing shared tokens in a
  dedicated change.
- **Reusable components:** `ErrorAlert`, `common/ImageModelSelect`,
  `common/ComposedPromptPreview`, `storyboard/StoryboardStepper`,
  `storyboard/AdjustmentChips`, `agent-chat/ChangeApprovalCard`. Reuse them
  before creating new ones.
- **Dialogs:** prefer the native `<dialog>` element opened with `showModal()`, as
  used in `film/FilmPage.tsx` and `film/FilmDirectionPanel.tsx`. The
  storyboard modals still use `div role="dialog"`; move them to `<dialog>` when
  changing them so Escape and focus return work natively.
- **Copy:** every user-visible string goes through `next-intl`; add both `en.json`
  and `ja.json` entries.
- **Light theme only:** there is no dark mode. Do not add one-off dark styles;
  dark mode would be its own change.
- **Reduced motion:** only the Film workspace handles
  `prefers-reduced-motion` (camera samples open as a still frame comparison and
  never autoplay). Previews of rendered motion must honour the Film's own
  reduced-motion setting the same way the renderer does.
- **Film workspace:** `film/FilmPage.tsx` keeps the title, save status and next
  actions in a sticky top bar, a player plus Chapter/scene strip, and one
  inspector for the selection (a bottom sheet below 760px). Give each editable
  value one control there; dialogs (`CameraAudition`, `TemplatePicker`,
  `FilmExportDialog`) hold choices, not duplicate editors. Camera and paper-card
  previews use `@gen-story/infrastructure/camera-preview`, the renderer's own
  camera and frame layout path (`previewLayout`): the photo box, the card and
  the Memory Board note come from the same `math.js` helpers and line wrapping
  as the export, so do not position them in CSS. **Adjust layout** on the
  player edits the frame layout by drag, corner handle or keyboard; the scope
  (all photos / this photo), the photo shape (16:9 / 9:16 / 1:1 crop) and resets
  sit in the bar above the frame. Template samples are pre-rendered production exports
  (`public/film-previews/templates/manifest.json`), loaded on demand
  (`preload="none"`, poster, no autoplay); the picker and inspector list only
  templates and choices from the API catalog, so a new template needs no UI code.
  Film settings (template, video size, motion) sit in one row of labelled
  groups that wrap as whole units; the action that opens a dialog sits next to
  the value it changes.
- **Film controls:** match the Film's forest-green and paper palette
  (`#294f3d`, `#536b5c`, `#dce3df`, focus `#91b69e`) in
  `FilmWorkspace.module.css`. Use a switch (`role="switch"` checkbox) for an
  on/off setting, a segmented control for a short single choice whose options
  should all stay visible, toggle chips for multi-select, and native `<select>`
  and `<input type="range">` restyled with CSS (chevron, thin filled track,
  round thumb; `Range` sets `--fill`). Keep native inputs underneath for
  keyboard and screen reader behaviour.

## Modern Web Guidance

Use [Modern Web Guidance](https://developer.chrome.com/docs/modern-web-guidance)
for browser compatibility, accessibility, performance, and platform features
that the existing components do not cover (dialogs, popovers, forms, focus
management, layout, image loading, and similar).

The CLI is a pinned root dev dependency, so it works from the repository
without a plugin:

```sh
pnpm exec modern-web-guidance search "confirmation modal dialog"
pnpm exec modern-web-guidance retrieve dialog
```

The Claude Code plugin (optional) loads the `modern-web-guidance` skill, which
calls the same CLI through `npx`. Install it per developer from the
repository root:

```sh
claude plugin marketplace add GoogleChrome/modern-web-guidance --scope local
claude plugin install modern-web-guidance@googlechrome --scope local
```

`--scope local` writes to `.claude/settings.local.json` (not committed). For
Codex, `codex plugin marketplace add GoogleChrome/modern-web-guidance` and
`codex plugin add modern-web-guidance@googlechrome` install at user scope; the
pinned CLI above is enough for this repository.

## Astryx

[Astryx](https://github.com/meta/astryx) (`@astryxdesign/core`, React 19+, beta)
is **not adopted** as a runtime dependency. It requires `@stylexjs/stylex` and a
theme provider, and it would replace the hand-written CSS Modules and visual
identity above. That is a separate, explicitly approved UI task.

Until then, use Astryx as a reference for component states, keyboard behavior,
and accessibility patterns when building something the app lacks (for example
tabs, menus, toasts, or a typeahead), and implement it with CSS Modules in
the app's own style. Look up component docs without installing anything:

```sh
npx -y -p @astryxdesign/cli@0.7.16 astryx component --list
npx -y -p @astryxdesign/cli@0.7.16 astryx search tabs
npx -y -p @astryxdesign/cli@0.7.16 astryx component TabList
```

Always use the scoped package name; the unscoped `astryx` on npm is an
unrelated package. If Astryx is adopted later, add `@astryxdesign/core` and
`@astryxdesign/cli` to `apps/web` at the same version through pnpm, and update
this section.

## Verifying UI changes

1. `pnpm typecheck`, then `pnpm --filter @gen-story/web test` (Vitest + Testing
   Library) for component behavior.
2. Run the app (`pnpm dev`) and drive the affected workflow end to end in a
   browser, for example from photo upload to a reviewed image or a rendered
   film, not just the changed widget.
3. Check the layout at desktop width and at the breakpoints the screen uses
   (the chat column collapses at 1100px; the Film shell switches to a single
   column with horizontal stage tabs at 760px). Also check keyboard-only
   operation with visible focus, dialog Escape and focus return, and text
   contrast against the colors above.
4. For flows that have Playwright coverage (`apps/web/e2e/`), run
   `pnpm --filter @gen-story/web test:e2e` against the running app.
5. For changes to existing screens, compare before and after screenshots of
   the primary workflow. On the Storyboard, close the open AI chat drawer
   (`chatDrawerClose`) at 1100px and below, and expand **Project settings**
   only after the storyboard has loaded: its load effect resets that accordion.
