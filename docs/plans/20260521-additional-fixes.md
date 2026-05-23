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

_Add future fixes below as new `## Fix N` sections._
