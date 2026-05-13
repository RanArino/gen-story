# Gap Analysis: Requirements vs. Implementation

This document maps every requirement in `REQUIREMENTS_INIT.md` against what is currently implemented,
so the team can quickly identify what remains and decide next steps.

**Legend**
- ✅ Implemented: Feature is fully implemented and works as specified.
- 🟡 In progress: Feature is actively being developed or under review.
- ❌ Not yet implemented: Feature is not yet implemented; no functionality exists.
- 🔮 Future / out-of-scope for Phase 1: Feature is planned for a future phase or considered out of scope for Phase 1.

---

## Phase 1 — Storyboard & Adopted Image Set

Phase 1 goal: produce a storyboard and adopted generated-image set that can be handed to video generation.

---

### 1. Project Management

| Requirement | Status | Notes |
|---|---|---|
| Project list screen | ✅ | `ProjectListPage` connected to API |
| Create project | ✅ | Persisted via `POST /api/projects` |
| Delete project (soft delete, 7-day restore) | ✅ | Soft delete + restore endpoints |
| Project status lifecycle (draft / active / completed / archived) | ✅ | Domain model + DB column |
| Project-scoped data isolation | ✅ | All queries scoped to `projectId` |

---

### 2. Photo Upload & Management

| Requirement | Status | Notes |
|---|---|---|
| Max 20 photos per project | ✅ | Enforced in upload handler |
| Supported formats: JPG, PNG, WebP | ✅ | Validated via `sharp` |
| Supported format: HEIC | ✅ | Converted to JPEG on ingest |
| Original HEIC retained | ✅ | Stored under `original.heic` key |
| Per-photo memo / notes field | ✅ | `notes` column on `photo_assets` |
| Photo usage states: candidate / excluded / reference | ✅ | `curationStatus` column + `PATCH` endpoint |
| Manual photo ordering (upload order) | ✅ | Implicit via `createdAt` ordering |
| Manual drag-and-drop reordering | ❌ | UI does not support DnD yet |
| AI-recommended ordering (opt-in toggle) | ❌ | No AI ordering logic |
| Checksum-based exact duplicate detection within project | ✅ | SHA-256 checksum on ingest |
| Duplicate presented to user (not auto-deleted) | ✅ | Returns conflict error with details |
| Soft delete + 7-day restore for photos | ✅ | `deletedAt` + restore endpoint |
| Preview image generation (display-optimized) | ✅ | 640 px max edge via `sharp` |
| AI-input normalization image (max 1536 px) | ✅ | Generated on ingest |
| Photo metadata stored (dimensions, MIME, size, checksum) | ✅ | All columns present in `photo_assets` |

---

### 3. Emotion / Feeling Design

| Requirement | Status | Notes |
|---|---|---|
| User can select target emotion/tone for storyboard | ✅ | `tone` field on storyboard |
| AI analyzes photos and proposes emotion candidates | ❌ | No AI photo analysis implemented |
| AI reads: person relationships, expressions, age changes | ❌ | Part of missing AI analysis |
| AI reads: location, season, photo era | ❌ | Part of missing AI analysis |
| AI reads: event type (birthday, wedding, trip, graduation…) | ❌ | Part of missing AI analysis |
| AI reads: overall atmosphere, story across multiple photos | ❌ | Part of missing AI analysis |
| User selects / adjusts AI-proposed emotions | ❌ | Requires AI analysis first |

---

### 4. Image Style Selection

| Requirement | Status | Notes |
|---|---|---|
| System style presets (8 predefined styles + AI auto) | ⚠️ | `style_presets` table and seeding script exist; need to verify all 9 system presets are seeded |
| Style preset preview images for comparison | ❌ | No preview images in `public/` |
| Style preview shows same subject in each style | ❌ | Not implemented |
| Custom style creation from user-uploaded reference image | ❌ | No custom style workflow |
| Custom styles saved per user, reusable across projects | ❌ | Schema supports `scope=user` but no creation UI/API |
| Style applied at project level (not per scene) | ✅ | `storyboards.stylePresetId`; `stylePreset.prompt` is now composed into every generation prompt via `prompt-composer.ts` |
| Model selection UI (provider / model chooser) | ❌ | Provider hard-coded to OpenAI; no model picker UI |

---

### 5. Common Project Prompt

| Requirement | Status | Notes |
|---|---|---|
| Per-project common prompt (auto-generated from emotion + style) | ❌ | No common prompt field or generation |
| Common prompt editable by user | ❌ | Depends on above |
| Prompt consistency mechanism across scenes | ⚠️ | `storyboard.tone` and `stylePreset.prompt` are now applied consistently to all scenes via `prompt-composer.ts`; no user-editable common prompt field yet |
| Story-level AI context across uploaded photos | ❌ | Future AI fill-in should be able to analyze all current project photos and use the overall story structure as context when generating per-scene text |

---

### 6. Test Generation Workflow

| Requirement | Status | Notes |
|---|---|---|
| Test-generate 3 pattern images before bulk generation | ❌ | No test generation workflow |
| Adjustment sliders / buttons (warmer, more cinematic, etc.) | ❌ | Not implemented |
| Adjustments update common project prompt internally | ❌ | No common prompt |
| User selects one test image to confirm style | ❌ | Not implemented |
| "Generate more tests" option | ❌ | Not implemented |
| Bulk generation starts only after test confirmation | ❌ | Currently goes straight to full generation |

---

### 7. Storyboard Composition

| Requirement | Status | Notes |
|---|---|---|
| Storyboard creation and editing | ✅ | `StoryboardPage` + `PUT /api/storyboards/:id` |
| Template scene creation from uploaded photos | ✅ | `POST /api/storyboards/:storyboardId/template-scenes` creates draft scenes from photos; source photo assigned as primary; title/description/imagePrompt blank for manual editing |
| AI proposes scene composition from photos | ❌ | User builds scenes manually |
| AI proposes scene ordering (opt-in toggle) | ❌ | No AI ordering |
| User can reorder scenes | ✅ | Scene list UI; no DnD yet |
| User can adjust / edit scene composition | ✅ | Full scene edit form |
| Storyboard status: draft / editing / ready / completed | ✅ | Domain + DB |

---

### 8. Scene Content

| Requirement | Status | Notes |
|---|---|---|
| Source / primary photo per scene | ✅ | `scene_photo_assets` with `role=primary` |
| Scene title | ✅ | `scenes.title` |
| Scene description | ✅ | `scenes.description` |
| Target emotion per scene | ✅ | `scenes.emotion` |
| Image generation prompt | ✅ | `scenes.image_prompt` |
| Blank draft title / description / image prompt before generation | ✅ | Template scenes created via `createTemplateScenesFromPhotos` allow blank fields for manual editing or later AI fill-in |
| Camera angle / camera work (selection) | ✅ | `scenes.camera_direction`; translated to cinematic shot descriptors (incl. depth, vanishing point) in generation prompt; 11 options including Telephoto, Voyeur, Low Angle, Overhead |
| Color / lighting direction (selection) | ✅ | `scenes.lighting_direction`; translated to cinematic lighting descriptors in generation prompt; 8 options including Backlit, Silhouette, Volumetric |
| Animation movement direction (selection) | ✅ | `scenes.motion_direction`; stored only — not yet composed into generation prompt |
| User editing notes | ✅ | `scenes.notes` |
| AI-only complement scene (no source photo) | ❌ | Schema requires photo; AI-only scene not supported |
| Complement scene marks which scenes it bridges | ❌ | No bridge metadata |
| AI generates 1–3 proposals for complement scenes | ❌ | No complement scene workflow |
| Hover "+" between scenes to insert complement | ❌ | No inter-scene insert UI |
| AI-generated scene title (not manual-only) | ❌ | Titles entered manually |
| AI-generated scene description | ❌ | Descriptions entered manually |
| AI-generated image prompt per scene | ❌ | Prompts entered manually |

---

### 9. Scene Editing UX

| Requirement | Status | Notes |
|---|---|---|
| All storyboard fields editable by user | ✅ | Full edit form in `StoryboardPage` |
| Professional fields use selection UI (camera, lighting, motion) | ✅ | Dropdown selects |
| Uploaded primary photo preview inside each scene card | ✅ | Template-created scenes assigned with uploaded photo as primary; preview visible in scene editor |
| Per-scene AI fill button for empty text fields | ❌ | Scene cards should expose an AI action that can populate blank title, description, and image prompt fields while preserving user-edited values |
| Beginner-friendly labels for selections | ⚠️ | English labels present; no i18n yet |
| Labels follow app language setting | ❌ | No language setting |

---

### 10. Language Settings

| Requirement | Status | Notes |
|---|---|---|
| UI language: Japanese and English | ❌ | English-only; no i18n framework |
| AI-generated content follows selected language | ❌ | Requires AI generation + i18n |
| Language switcher in app settings | ❌ | No settings screen |
| Selection labels follow language | ❌ | Hard-coded English |
| Exported storyboard follows language | ❌ | No export yet |

---

### 11. Generated Image Handling

| Requirement | Status | Notes |
|---|---|---|
| Original photo vs. generated image comparison | ✅ | `ReviewPage` side-by-side layout |
| One generated image per scene initially | ✅ | One request per scene by default |
| Per-scene regeneration | ✅ | Retry endpoint + UI button |
| Adopt / unadopt per scene | ✅ | `POST /adopt` + `isAdopted` flag |
| Regenerate with same conditions | ⚠️ | Retry copies `inputJson` but no explicit "same-conditions" UX |
| Regenerate with changed scene settings | ❌ | No per-scene re-generation with modified settings UI |
| Non-adopted images retained as history | ✅ | `deletedAt` null until user explicitly deletes |
| Version history across multiple generations | ❌ | No versioning; all images shown flat |
| Previous version retrievable after re-test | ❌ | No version grouping |

---

### 12. Storyboard Viewing & Export

| Requirement | Status | Notes |
|---|---|---|
| Card view inside app | ✅ | `ReviewPage` card layout |
| Timeline view | ❌ | Not implemented |
| Table / spreadsheet view | ❌ | Not implemented |
| Filter: original only / generated only | ❌ | No filter controls |
| JSON export | ❌ | No export endpoint or UI |
| Structured data for CapCut / video generation pipeline | ❌ | No export format defined |

---

### 13. Image Generation Infrastructure

| Requirement | Status | Notes |
|---|---|---|
| Default model: OpenAI `gpt-image-2` | ✅ | Hard-coded in OpenAI adapter |
| Text-to-image generation | ✅ | `images.generate()` |
| Image-to-image with source photo | ✅ | `images.edit()` with primary photo |
| Multiple reference images for consistency | ❌ | Only single input photo per request |
| Cinematic prompt composition (60-30-10 color, shot type, depth layering, vanishing point) | ✅ | `apps/api/src/generation/prompt-composer.ts`; composes scene emotion, camera, lighting, tone, and style preset into a rich cinematic prompt before each generation request |
| Size / quality / format configuration | ⚠️ | Defaults set; no user-facing preset picker |
| Asynchronous job queue (queued → running → succeeded/failed) | ✅ | Local worker + `generation_requests` state machine |
| Max 5 concurrent running jobs per project | ✅ | `GenerationConcurrencyPolicy` |
| Queued jobs execute when slots free up | ✅ | Local worker polls queued jobs |
| Cancel generation request | ✅ | `POST /api/generation-requests/:id/cancel` + UI cancel button on GeneratePage; graceful handling for in-flight jobs |
| Per-scene retry of failed jobs | ✅ | `POST /generation-requests/:id/retry` |
| Short failure reason displayed | ✅ | `errorMessage` stored; shown in UI |
| Generation progress UI (N of M completed) | ✅ | Polling every 2 s in `GeneratePage` |
| Scene name shown in progress | ✅ | Scene title displayed per row |
| State survives page reload / navigation | ✅ | DB-backed state restored on load |

---

### 14. Generation History

| Requirement | Status | Notes |
|---|---|---|
| Generation request history persisted | ✅ | All requests in `generation_requests` |
| Fields: model, prompt, source photo ID, size/quality | ✅ | Stored in `inputJson` + dedicated columns |
| Fields: success/failure, error reason, timestamp | ✅ | `status`, `errorMessage`, `completedAt` |
| Fields: cost / coin consumption | ❌ | No cost tracking |
| User-facing generation history view | ❌ | Debug endpoint exists; no user UI |

---

### 15. File Lifecycle & Cleanup

| Requirement | Status | Notes |
|---|---|---|
| Files stored under storage keys (no absolute paths in DB) | ✅ | `storageKey` pattern throughout |
| Storage key naming convention enforced | ✅ | `storage-keys.ts` helpers |
| Soft delete with 7-day restore window | ✅ | `deletedAt` on all major tables |
| Cleanup script for expired deleted files | ✅ | `scripts/cleanup-expired.ts` |
| Orphan file detection | ✅ | `scripts/detect-orphans.ts` |
| File deletion on project delete (cascade) | ⚠️ | DB soft-delete cascades; physical file cleanup not triggered automatically |

---

### 16. Local Release Readiness (Phase 8)

| Requirement | Status | Notes |
|---|---|---|
| Error display cleanup | ✅ | `ErrorAlert` component; API error mapping |
| Basic server-side logging | ✅ | `request-logger.ts` + console logging in worker |
| Debug view for generation requests | ✅ | `GET /api/debug/generation-requests` |
| Seed / demo data script | ✅ | `scripts/seed.ts` |
| README setup instructions | ✅ | `README.md` updated |
| README test instructions | ✅ | Documented |
| Known limitations list | ✅ | `docs/known-limitations.md` |
| Clean-checkout setup works from README | ✅ | Verified in Phase 8 |
| Migrations apply from scratch | ✅ | Drizzle Kit migrations |
| Main unit + integration tests pass | ✅ | Vitest suite green |
| E2E main flow passes | ✅ | `e2e/main-flow.spec.ts` |

---

## Phase 2 — Video Generation (Future)

All Phase 2 items are **🔮 not started** and explicitly out of scope for the initial release.

| Requirement | Status |
|---|---|
| Video generation from adopted image set | 🔮 |
| `VideoGenerationPort` / `SeedanceVideoGenerationAdapter` | 🔮 |
| Per-scene video clip (default 5 s) | 🔮 |
| BGM generation (Suno AI, no lyrics initially) | 🔮 |
| CapCut-ready asset bundle export | 🔮 |
| In-app MP4 export | 🔮 |
| Video generation request history | 🔮 |

---

## Phase 3 — AI Editor Automation (Future)

All Phase 3 items are **🔮 not started** and out of scope for the initial release.

| Requirement | Status |
|---|---|
| Storyboard editing via Codex / Claude Code chat | 🔮 |
| Bulk prompt adjustment via AI editor | 🔮 |
| Phase 2 video prompt generation via AI editor | 🔮 |
| Structured storyboard JSON safe for AI editing | 🔮 |

---

## Phase 4+ — Future Expansion (Out of Scope)

Travel planning, Google Calendar, Google Maps, coin/payment system, SNS auto-publish, affiliate links, mobile/desktop apps — all **🔮 explicitly deferred**.

---

## Summary Table

| Area | Implemented | Partial | Missing |
|---|---|---|---|
| Project management | 5 | 0 | 0 |
| Photo upload & management | 13 | 0 | 2 (DnD, AI order) |
| Emotion / AI photo analysis | 1 | 0 | 6 |
| Image style selection | 2 | 1 | 4 |
| Common project prompt | 0 | 1 | 3 |
| Test generation workflow | 0 | 0 | 6 |
| Storyboard composition | 5 | 0 | 3 |
| Scene content | 10 | 0 | 7 (AI gen + complement) |
| Scene editing UX | 4 | 2 | 1 |
| Language / i18n | 0 | 0 | 5 |
| Generated image handling | 5 | 2 | 3 |
| Storyboard viewing & export | 1 | 0 | 5 |
| Image generation infra | 13 | 2 | 2 |
| Generation history | 5 | 0 | 2 |
| File lifecycle & cleanup | 5 | 1 | 0 |
| Local release readiness | 11 | 0 | 0 |

---

## Prioritized Next Steps

The items below are the highest-value gaps to close before Phase 1 is fully realized as described in `REQUIREMENTS_INIT.md`.

### High Priority — Core Phase 1 Value

1. **AI photo analysis → emotion candidates**
   Analyzing uploaded photos with the latest Gemini model (e.g., Gemini 2.0 Flash) and proposing emotion/tone candidates is the core differentiating feature of Phase 1. Without it, the user must fill in all emotion and scene fields manually.

2. **AI-generated scene descriptions and image prompts**
   The system currently creates placeholder scenes; users must write titles, descriptions, and prompts by hand. Generating these from photo analysis closes the biggest usability gap.

3. ✅ **Template scene creation from uploaded photos** (COMPLETED)
   Uploaded candidate photos are now convertible into editable draft scenes via `POST /api/storyboards/:storyboardId/template-scenes`. Each draft scene assigns the uploaded image as its primary photo and leaves title, description, and image prompt blank for manual editing or later per-scene AI fill-in.

4. **Test generation workflow (3 patterns → adjust → confirm → bulk)**
   The spec requires a test cycle before committing to full generation. The current flow goes straight to bulk generation, skipping style validation.

5. **Storyboard JSON export**
   Required for the Phase 1 deliverable ("hand off to video generation"). Without export, Phase 2 cannot begin.

### Medium Priority — UX Completeness

6. **Style preset preview images**
   Users need visual comparison to choose a style. Placeholder comparison images in `public/` would unblock this.

7. **Drag-and-drop photo reordering**
   Specified as a core photo management feature; currently only implicit ordering is available.

8. **AI-only complement scenes (inter-scene "+")**
   Needed to bridge shots and produce a coherent storyboard; requires optional photo assignment on scenes.

9. **Timeline and table views of storyboard**
   Two of three specified storyboard viewing modes are missing.

10. ✅ **Cancel generation request** (COMPLETED)
   `POST /api/generation-requests/:generationRequestId/cancel` endpoint added with graceful handling for in-flight jobs. UI cancel button added to GeneratePage for queued/running requests.

### Lower Priority — Polish & Future-Readiness

10. **Multi-language support (Japanese / English)**
    Specified as an initial target; currently English-only. Unblocks Japanese user testing.

11. **Custom style creation from user-uploaded reference image**
    Higher value once system presets are proven; safe to defer slightly.

12. **Model / provider selection UI**
    Schema and adapter support exist; surfacing it in the UI is straightforward once test generation is in place.

13. **Generation version history**
    Important for recovering from bad re-generations; schema changes needed.

14. **User-facing generation history screen**
    Debug endpoint exists; wrapping it in a proper UI is low effort.

15. **Cascade physical file deletion on project/photo delete**
    Soft delete works; file cleanup on hard-delete path needs to be wired up.
