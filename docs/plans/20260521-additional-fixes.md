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

_Add future fixes below as new `## Fix N` sections._
