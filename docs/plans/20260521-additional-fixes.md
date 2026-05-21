# Small Fixes — Implementation Tracker

## Fix 1: PhotosPage — Manage tab improvements

**Request:** Add select-all checkbox, per-image checkboxes, view-size toggle (S/M/L), and confirm scroll direction.

### Tasks
#### Photo Selection, Bulk Actions, View Options
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

_Add future fixes below as new `## Fix N` sections._
