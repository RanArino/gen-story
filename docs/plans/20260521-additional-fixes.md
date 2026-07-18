# Small Fixes — Implementation Tracker

## Fix 1: PhotosPage — Manage tab improvements

**Request:** Add select-all checkbox, per-image checkboxes, view-size toggle (S/M/L), and confirm scroll direction.

### Tasks
- [x] Select-all checkbox + per-card checkbox overlay (top-left of each card)
- [x] Bulk-action bar appears when ≥1 photo is selected (shows count + bulk-delete or bulk-usage buttons)
- [x] View-size toggle: 3 icon buttons (small / medium / large grid columns)
  - Small  → `minmax(120px, 1fr)`
  - Medium → `minmax(200px, 1fr)` (default)
  - Large  → `minmax(300px, 1fr)`
- [x] Scroll direction: grid wraps into new rows → vertical scroll. Correct, no change needed.

### Files changed

- `apps/web/src/components/photos/PhotosPage.tsx`
- `apps/web/src/components/photos/PhotosPage.module.css`
- `apps/web/src/components/storyboard/StoryboardPage.tsx`

---

## Fix 2: Style Preset — system style preview images not loading

**Request:** Preview images for system styles are uploaded to `apps/web/public/style-previews/` but do not display in the UI.

**Root cause:** `apps/api/src/http/dto-mappers.ts` constructs the URL as `/public/style-previews/<name>.jpg`. In Next.js, files under `public/` are served from the root path, so the correct URL is `/style-previews/<name>.jpg`. The `/public` prefix causes a 404.

### Tasks
- [x] In `toStylePresetDto()` (`apps/api/src/http/dto-mappers.ts`), change `/public/style-previews/` → `/style-previews/`

### Files changed

- `apps/api/src/http/dto-mappers.ts`

---

## Fix 3: StoryboardPage — Primary Photo section shows all candidate photos as if selected

**Request:** Even if the user selects only one image and clicks "Select photos to create scenes", the PRIMARY PHOTO section under each scene card displays every candidate photo, making them all look selected/assigned.

**Root cause:** `sceneDtoToState()` does not map `scene.photoAssets` into `SceneState`. So `SceneCard` has no way to know which photo is already assigned as primary. It falls back to rendering all `candidatePhotos` as identical clickable buttons — no visual distinction between "assigned" and "unassigned".

**Fix:**
1. Add `photoAssets: ScenePhotoAssetDto[]` to `SceneState` and populate it from `SceneDto` in `sceneDtoToState`.
2. In `SceneCard`, derive the current primary photo from `scene.photoAssets`.
3. Show the assigned primary photo highlighted (border/active style); show others as dimmed "click to reassign" options.
4. After a successful `handleAssignPhoto` call, update `scene.photoAssets` locally via `onUpdate` so the UI reflects the change immediately without a full reload.

### Tasks
- [x] Add `photoAssets` field to `SceneState` type and `sceneDtoToState()`
- [x] In `SceneCard.handleAssignPhoto`: call `onUpdate({ photoAssets: [...] })` after the API call succeeds
- [x] In `SceneCard` Primary Photo UI: visually distinguish the assigned primary photo from unassigned candidates

### Files to change

- `apps/web/src/components/storyboard/StoryboardPage.tsx`

---

---

## Fix 4: PhotosPage — usage buttons overflow at small thumbnail size

**Request:** On `projects/[projectId]/photos` Manage tab, when the user selects the "Small" view size, the per-card usage buttons (CANDIDATE / REFERENCE / EXCLUDED) overflow the card width and get clipped — only "CANDIDATE" is fully visible, "REFERENCE" is cut, "EXCLUDED" is hidden.

**Root cause:** `.usageRow` is a single-line flexbox (`display: flex` with no wrap). Each `.usageBtn` has `flex: 1` but the uppercase label text has an intrinsic minimum width that exceeds `(120px card − 28px padding) / 3 ≈ 30px`, so flex shrinking fails and the row overflows.

**Fix:** Allow `.usageRow` to wrap and let each button take a sensible minimum width so they reflow to a second line at small sizes.

### Tasks
- [x] Add `flex-wrap: wrap` to `.usageRow`
- [x] Set each `.usageBtn` to `flex: 1 1 60px` and `min-width: 0` so buttons can shrink/wrap without overflowing

### Files changed

- `apps/web/src/components/photos/PhotosPage.module.css`

---

## Fix 5: StoryboardPage — Accordion layout + section reorder

**Request:** Wrap the "base settings" sections in collapsible Accordion panels so users can focus on photo selection and scene creation. Reorder sections so base settings come first and "Create Scenes from Photos" sits immediately above "Scenes".

**New section order:**
1. Emotion / Tone [Accordion, default open]
2. AI Photo Analysis [Accordion, default closed; auto-opens after analysis runs or if analysis already exists]
3. Style preset [Accordion, default open]
4. Common prompt [Accordion, default open; auto-opens after "Regenerate" completes]
5. Create Scenes from Photos (no accordion — primary action, always visible)
6. Scenes (no accordion — primary content, always visible)

**Implementation approach:**
- Add `accordionOpen` state object (keys: `tone`, `photoAnalysis`, `style`, `commonPrompt`)
- Add `useEffect` to open `photoAnalysis` accordion when `photoAnalysis` data exists on load
- In `handleAnalyzePhotos`: call `setAccordionOpen(prev => ({ ...prev, photoAnalysis: true }))` after success
- In `saveCommonPrompt("")` (regenerate): call `setAccordionOpen(prev => ({ ...prev, commonPrompt: true }))` after success
- Create inline `CollapsibleSection` component (no external library — button toggle + `aria-expanded`, action buttons in header remain clickable and don't toggle)
- Move "Create Scenes from Photos" IIFE block to position 5 (after Common prompt, before Scenes)
- Add accordion CSS (`.accordionHeader`, `.accordionToggle`, `.accordionCaret`, `.accordionBody`)

### Tasks
- [x] Add `accordionOpen` state + `useEffect` for `photoAnalysis`
- [x] Wire `setAccordionOpen` in `handleAnalyzePhotos` and `saveCommonPrompt`
- [x] Create `CollapsibleSection` component
- [x] Reorder JSX sections + wrap base settings in `CollapsibleSection`
- [x] Add accordion CSS
- [x] `pnpm typecheck`

### Files changed
- `apps/web/src/components/storyboard/StoryboardPage.tsx`
- `apps/web/src/components/storyboard/StoryboardPage.module.css`

---

## Fix 6: StoryboardPage — Accordion UX refinements (review feedback)

**Request:** After Fix 5 shipped, review feedback identified three UI/UX gaps that violate accordion best practices:

1. **AI Photo Analysis should not be its own accordion** — it's a one-button helper that produces tone candidates. Wrapping it in an accordion is over-engineering. It belongs *inside* the Tone section as a subsection.
2. **Collapsed accordions must show the current selection** — without a summary in the header, users have to expand every section to recall what they picked. Industry standard (iOS Settings, Stripe, Figma) is "title | summary | action".
3. **Common prompt textarea is too small** — `rows={4}` is for short notes; a prompt that applies to every scene's image generation needs ~10 rows of vertical space.

### Tasks
- [x] Add `summary?: React.ReactNode` prop to `CollapsibleSection`; render it in the header only when `open === false`
- [x] Add CSS: `.accordionSummary`, `.accordionSummaryStyle`, `.accordionSummaryThumb` (truncate with ellipsis, muted color)
- [x] Tone accordion: show selected tone label as summary (e.g. "Warm")
- [x] Style accordion: show selected style thumb + name as summary (or "AI recommend" when unset)
- [x] Common prompt accordion: show first ~60 chars of prompt as summary (or italic "Not set")
- [x] Remove AI Photo Analysis as a standalone accordion
- [x] Merge AI Photo Analysis content into the Tone accordion as a subsection (`.toneAnalysisSubsection`) with its own header "AI suggestions from your photos" + inline Analyze button
- [x] Remove `photoAnalysis` from `accordionOpen` state and its `useEffect` (no longer needed)
- [x] Remove the `setAccordionOpen` call in `handleAnalyzePhotos` (the subsection is always visible inside Tone)
- [x] Enlarge Common prompt textarea: `rows={4}` → `rows={10}`
- [x] `pnpm typecheck`

### Files changed
- `apps/web/src/components/storyboard/StoryboardPage.tsx`
- `apps/web/src/components/storyboard/StoryboardPage.module.css`

---

## Fix 7: StoryboardPage — Promote AI Photo Analysis to a top-level assistant card (review feedback)

**Issue:** Burying AI Photo Analysis as a subsection inside the Tone accordion (introduced in Fix 6) created two UX problems:

1. **Discoverability** — Users who keep Tone collapsed never see that an AI helper exists.
2. **Scope ambiguity** — Nesting inside Tone implies AI might affect other settings. Reviewer's question "what sections will be assigned automatically?" proves the scope is not legible.

**Best practice:** AI assistance is *meta* to the form — it informs decisions across the page. Industry pattern (Notion AI inline cards, Linear AI summarize, GitHub Copilot suggestions) surfaces AI as a **distinct, prominently styled card with explicit scope labels** placed *above* the settings it influences. Burying it inside a single accordion is wrong because it inverts the hierarchy: AI is a tool that helps configure settings, not one of the settings.

**Fix:**
- Remove the `toneAnalysisSubsection` block from inside the Tone accordion
- Add a new top-level `aiAssistCard` section between the page header and the first accordion
- Card includes: sparkle icon + "AI Photo Analysis" title, explicit subtitle stating exactly what it affects (tone only, with link to clicking a suggestion to apply), Analyze/Re-analyze button, story summary, tone candidate buttons
- Use tinted gradient background to visually distinguish from the regular accordion sections
- Empty states: clear guidance when no candidate photos are marked yet

### Tasks
- [x] Remove `toneAnalysisSubsection` JSX from inside the Tone accordion
- [x] Add `aiAssistCard` section at the top of the page (above the accordions, below the error alert)
- [x] Card variants: empty state (no candidate photos), pre-analysis (button only), post-analysis (summary + candidates)
- [x] Explicit scope text in the subtitle: "Suggests an emotion/tone based on your photos. Click a suggestion to apply it to the Tone setting below."
- [x] Add CSS: `.aiAssistCard`, `.aiAssistHeader`, `.aiAssistTitleBlock`, `.aiAssistIcon`, `.aiAssistTitle`, `.aiAssistSubtitle`, `.aiAssistBody`
- [x] Remove now-unused `.toneAnalysisSubsection`, `.toneAnalysisHeader`, `.toneAnalysisTitle` CSS
- [x] `pnpm typecheck`

### Files changed
- `apps/web/src/components/storyboard/StoryboardPage.tsx`
- `apps/web/src/components/storyboard/StoryboardPage.module.css`

---

## Fix 8: StoryboardPage — Add delete button to each scene card

**Request:** There is no way to delete an individual scene. Users can reorder scenes via drag-and-drop or ↑/↓ buttons but cannot remove one.

**Fix:**
- Add `deleteScene(idx)` in `StoryboardPage` that filters the scene out of local state and re-indexes `orderIndex`
- Add `onDelete` prop to `SceneCard`
- Add a delete (×) button in `sceneHeaderActions`, styled with `.deleteBtn` (muted red, visible but not alarming)
- Deletion is local; persisted on the next "Save scenes" click (consistent with existing add/edit behaviour)

### Tasks
- [x] Add `deleteScene(idx)` function and pass `onDelete` to `SceneCard`
- [x] Add `onDelete` prop to `SceneCard` props interface + delete button in header
- [x] Add `.deleteBtn` CSS
- [x] `pnpm typecheck`

### Files changed
- `apps/web/src/components/storyboard/StoryboardPage.tsx`
- `apps/web/src/components/storyboard/StoryboardPage.module.css`

---

## Fix 9: StoryboardPage — Common prompt textarea does not fill container width

**Request:** The textarea in the Common prompt accordion section is narrow (≈¼ of the page), making it hard to read/edit. Scene card textareas are full-width because they sit inside a `flex-direction: column` parent that stretches children, but the Common prompt textarea is a direct child of a plain `<div>` and gets its browser-default intrinsic width.

**Fix:** Add `width: 100%; box-sizing: border-box;` to `.fieldInput` so every input/textarea fills its container regardless of layout context.

### Tasks
- [x] Add `width: 100%; box-sizing: border-box;` to `.fieldInput`
- [x] `pnpm typecheck`

### Files changed
- `apps/web/src/components/storyboard/StoryboardPage.module.css`

---

_Add future fixes below as new `## Fix N` sections._
