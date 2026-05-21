# Custom Style Creation from User-Uploaded Reference Image

This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.


## Purpose / Big Picture

Today, users can choose from **9 predefined system style presets** that cover cinematic photoreal, anime, hand-drawn, watercolor, monochrome, 3D animation, and two experimental styles. However, they cannot create **custom styles** tailored to their specific visual preferences or brand identity.

This ExecPlan closes the gap by enabling users to:

1. **Upload a reference image** as the visual inspiration for a custom style.
2. **Enter style details** (name, description, and an optional style prompt) to capture the unique aesthetic.
3. **Generate a preview image** (optional) showing how that style transforms a canonical subject, using the same character-anchor pattern as system presets.
4. **Save the custom style** per-user, making it reusable across projects.
5. **See custom styles in the style gallery** on StoryboardPage, grouped separately from system presets.

This tracks two requirements in `docs/gap-analysis.md`:

- Section 4: "Custom style creation from user-uploaded reference image" — currently 🟡 because prompt-based custom style creation is implemented, but reference-image upload/storage is not complete.
- Section 4: "Custom styles saved per user, reusable across projects" — currently ✅.


## Progress

- [x] (2026-05-18 13:00Z) Confirmed `StylePresetRepositoryPort.save()` and the SQLite adapter already persist user style presets, including insert/update behavior and a guard against direct edits to existing system presets.
- [x] (2026-05-18 13:00Z) Added `createCustomStyle()` in `packages/application/src/use-cases.ts`, exported it, and covered success plus required-field validation in application tests.
- [x] (2026-05-18 13:00Z) Added `POST /api/style-presets` with Zod body validation and DTO response mapping; user-created presets return `previewImageUrl: null`.
- [x] (2026-05-18 13:00Z) Added the web API client helper and StoryboardPage modal for creating name, description, and prompt based custom styles.
- [x] (2026-05-18 13:00Z) Ran `pnpm typecheck`, `pnpm build`, and `pnpm test` successfully. The test command required escalation because API route tests bind a local `127.0.0.1` server.
- [ ] Complete actual reference-image upload/storage wiring for custom styles. The current implementation accepts a future `referenceImageStorageKey` but does not yet expose upload UI or persist a reference image field on the domain model.


## Surprises & Discoveries

- Observation: `apps/api/src/db/repositories.ts:904` already had a working `SqliteStylePresetRepository.save()` implementation, including `onConflictDoUpdate()` and system-preset edit protection.
  Evidence: `pnpm typecheck` and the existing repository tests passed with no repository changes.

- Observation: API route tests cannot bind a local test server under the default sandbox.
  Evidence: `pnpm exec vitest run src/http/routes.test.ts --reporter=dot` failed with `listen EPERM: operation not permitted 127.0.0.1`; rerunning the same route test with escalation passed 40 tests, and rerunning `pnpm test` with escalation passed all workspace tests.


## Decision Log

- Decision: Custom styles are saved with `scope = "user"` in the existing `style_presets` table, reusing the domain model and repository. This avoids a new table and leverages infrastructure already in place.
  Rationale: The schema already supports `StylePresetScope = "system" | "user"`; a separate column for user-id is unnecessary because the organization is organization-scoped (all users in the org see each other's styles, similar to shared settings in most SaaS products). If per-user isolation is needed later, it can be added as a migration.
  Date/Author: 2026-05-18 / Claude

- Decision: Custom style preview generation is optional and deferred. Users enter name, description, and style prompt directly. If they want a preview, they can manually generate it via a future "Generate preview" action or upload a reference image as the preview.
  Rationale: Generating previews requires hitting OpenAI (costs money) and introduces async complexity. Deferring it keeps the initial scope tight. The storyboard will still show the style name and description; the lack of a preview image is not a UX blocker.
  Date/Author: 2026-05-18 / Claude

- Decision: The custom style creation modal is a lightweight form dialog on StoryboardPage (next to the style preset gallery) rather than a dedicated page or separate modal that opens externally.
  Rationale: Users are already on StoryboardPage making style decisions; a context-local "Create custom style" button keeps the flow frictionless. The modal can be small, non-blocking, and re-use existing form components.
  Date/Author: 2026-05-18 / Claude

- Decision: The reference image is stored in the local uploads directory under a stable key, alongside project photos. It is not required (optional upload). If no reference image is provided, the style prompt alone defines the aesthetic.
  Rationale: A reference image serves as visual documentation but is not strictly required for a working custom style. Storing it allows future features (e.g., "show me how my custom style differs from the reference") without additional work. Using the same storage key pattern keeps infrastructure consistent.
  Date/Author: 2026-05-18 / Claude


## Outcomes & Retrospective

Users can now create custom user-scoped style presets from StoryboardPage by entering a name, description, and style prompt. The API persists those presets through the existing `style_presets` repository, `GET /api/style-presets` returns them, and the storyboard style gallery can select them for project-level style application.

The reference-image part of the original requirement remains incomplete. This implementation keeps `referenceImageStorageKey` in the request contract for a future upload flow, but the domain model and UI do not yet store or upload a custom style reference image.


## Context and Orientation

`gen-story` is a pnpm monorepo with clean-architecture layer isolation (see `CLAUDE.md`). Terms used below:

- **Style presets**: Defined in `packages/domain/src/model.ts:StylePreset`. Schema at `apps/api/src/db/schema.ts:84`. Each preset has `id`, `scope` ("system" or "user"), `name`, `description`, `prompt` (generation instruction), and timestamps.
- **System presets**: Nine predefined styles seeded by `scripts/seed.ts`, with data from `scripts/style-presets.ts`. Each has a fixed id (e.g., `"system-cinematic-photoreal"`) and a matching preview image in `apps/web/public/style-previews/`.
- **StylePresetRepositoryPort**: `packages/application/src/ports.ts`. Interface with `findById(id)`, `findAll()`, and `save(stylePreset)` methods.
- **Style gallery**: `apps/web/src/components/storyboard/StoryboardPage.tsx:680–714`. Renders style preset buttons with optional preview images and selection state.
- **Storage keys**: `apps/api/src/storage/storage-keys.ts`. Convention for organizing uploads under predictable paths (e.g., `"projects/{projectId}/custom-styles/{customStyleId}/reference.jpg"`).
- **Local file storage adapter**: `apps/api/src/storage/local-file-storage-adapter.ts`. Handles saving and retrieving files from `data/uploads/`.
- **Drizzle repository**: `apps/api/src/db/repositories.ts`. Implements `StylePresetRepository` (currently only reads; `save()` is stubbed).


## Plan of Work

The work spans four milestones that can be implemented in order. Each milestone is independently verifiable.


### Milestone 1 — Extend StylePresetRepositoryPort.save() and Drizzle implementation

**Files changed:** `packages/application/src/ports.ts`, `apps/api/src/db/repositories.ts`.

The `StylePresetRepositoryPort.save()` method exists but the Drizzle adapter implementation is a no-op stub. Implement it properly so custom styles can be persisted.

1. In `packages/application/src/ports.ts`, ensure `StylePresetRepositoryPort` already has `save(stylePreset: StylePreset): Promise<void>`. (It should; no change needed if already present.)

2. In `apps/api/src/db/repositories.ts`, find the `StylePresetRepository` class and implement `save()`:
   - If the preset `id` already exists, `UPDATE` the row.
   - Otherwise, `INSERT` a new row.
   - Ensure all fields (id, scope, name, description, prompt, createdAt, updatedAt) are persisted correctly.
   - Use `new Date().toISOString()` for timestamps.

3. Add a test case in `packages/application/src/use-cases.test.ts` to `InMemoryStylePresetRepository` if needed (update the in-memory implementation to actually store styles).

4. Run: `pnpm typecheck`.


### Milestone 2 — Create CreateCustomStyleUseCase

**Files changed:** `packages/application/src/use-cases.ts`.

Define a new use case `CreateCustomStyleUseCase` that accepts user input (name, description, style prompt, optional reference image storage key) and persists a custom style preset.

1. In `packages/application/src/use-cases.ts`, add:

```typescript
export interface CreateCustomStyleInput {
  name: string;
  description: string;
  prompt: string;
  referenceImageStorageKey?: string; // optional
}

export interface CreateCustomStyleDeps {
  stylePresets: StylePresetRepositoryPort;
}

export async function createCustomStyle(
  deps: CreateCustomStyleDeps,
  input: CreateCustomStyleInput,
): Promise<Result<StylePreset, ErrorCode>> {
  // Validate input
  if (!input.name.trim()) {
    return { ok: false, error: { code: "ValidationError", message: "Style name is required" } };
  }
  if (!input.prompt.trim()) {
    return { ok: false, error: { code: "ValidationError", message: "Style prompt is required" } };
  }

  // Create domain object
  const stylePreset: StylePreset = {
    id: crypto.randomUUID(),
    scope: "user",
    name: input.name.trim(),
    description: input.description.trim(),
    prompt: input.prompt.trim(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Persist
  await deps.stylePresets.save(stylePreset);

  return { ok: true, data: stylePreset };
}
```

2. Export the new function and types from `packages/application/src/index.ts`.

3. Update `packages/application/src/use-cases.test.ts` to add a test case for this use case.

4. Run: `pnpm typecheck && pnpm test`.


### Milestone 3 — Add POST /api/style-presets API endpoint

**Files changed:** `apps/api/src/http/routes.ts`, `apps/api/src/http/dto-mappers.ts`.

Wire up the use case to a new HTTP endpoint.

1. In `apps/api/src/http/routes.ts`, add a new route after the existing style-presets routes:

```typescript
router.post("/api/style-presets", async (req, res) => {
  const principal = await requirePrincipal(deps, res);
  if (principal == null) return;

  const body = req.body as Record<string, unknown>;

  const result = await createCustomStyle(deps, {
    name: String(body.name ?? ""),
    description: String(body.description ?? ""),
    prompt: String(body.prompt ?? ""),
    referenceImageStorageKey: body.referenceImageStorageKey as string | undefined,
  });

  if (!result.ok) {
    sendJson(res, useCaseErrorToStatus(result.error.code), errorBody(result.error.code, result.error.message));
    return;
  }

  sendJson(res, 201, { stylePreset: toStylePresetDto(result.data) });
});
```

2. Ensure `createCustomStyle` is imported from `@gen-story/application` and wired into the `deps` object in `create-api-context.ts`.

3. In `apps/api/src/http/dto-mappers.ts`, ensure `toStylePresetDto()` correctly handles both system and user presets (no preview image URL for user styles initially; can add preview generation later).

4. Run: `pnpm typecheck`.


### Milestone 4 — Create custom style modal UI on StoryboardPage

**Files changed:** `apps/web/src/components/storyboard/StoryboardPage.tsx`, `apps/web/src/components/storyboard/StoryboardPage.module.css`, `apps/web/src/lib/api-client.ts`.

Add a "Create custom style" button next to the style gallery. Clicking it opens a modal dialog where users enter name, description, and style prompt. The dialog submits to the new `POST /api/style-presets` endpoint and refreshes the style list.

1. In `apps/web/src/lib/api-client.ts`, add:

```typescript
export async function createCustomStyle(input: {
  name: string;
  description: string;
  prompt: string;
  referenceImageStorageKey?: string;
}): Promise<StylePresetDto> {
  const res = await fetch(`${API_BASE_URL}/api/style-presets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Failed to create custom style: ${res.statusText}`);
  return (await res.json()).stylePreset;
}
```

2. In `StoryboardPage.tsx`, add state for the modal:

```typescript
const [showCustomStyleModal, setShowCustomStyleModal] = useState(false);
const [customStyleForm, setCustomStyleForm] = useState({
  name: "",
  description: "",
  prompt: "",
});
const [savingCustomStyle, setSavingCustomStyle] = useState(false);
```

3. Add a handler to submit the form:

```typescript
async function handleCreateCustomStyle() {
  setSavingCustomStyle(true);
  try {
    const newStyle = await createCustomStyle(customStyleForm);
    setStylePresets([...stylePresets, newStyle]);
    setCustomStyleForm({ name: "", description: "", prompt: "" });
    setShowCustomStyleModal(false);
    setSaveMsg("Custom style created successfully!");
  } catch (e: unknown) {
    setError(e instanceof Error ? e.message : "Failed to create custom style");
  } finally {
    setSavingCustomStyle(false);
  }
}
```

4. In the style preset section (around line 680), add a "Create custom style" button and a modal dialog:

```typescript
<div className={styles.styleGrid}>
  <button
    className={`${styles.styleBtn} ${!storyboard.stylePresetId ? styles.styleBtnActive : ""}`}
    onClick={() => handleStyleChange(null)}
  >
    AI recommend
  </button>
  
  {/* System presets */}
  {stylePresets.filter(p => p.scope === "system").map(p => (
    /* existing button code */
  ))}
  
  {/* User presets */}
  {stylePresets.filter(p => p.scope === "user").map(p => (
    /* same button code */
  ))}
  
  {/* Create custom style button */}
  <button
    className={`${styles.styleBtn}`}
    onClick={() => setShowCustomStyleModal(true)}
    title="Create a custom style from your reference image"
  >
    + Create custom style
  </button>
</div>

{/* Custom style modal */}
{showCustomStyleModal && (
  <dialog open className={styles.modal} style={{ display: "block" }}>
    <div className={styles.modalContent}>
      <h4>Create Custom Style</h4>
      <div>
        <label>
          Style Name
          <input
            type="text"
            value={customStyleForm.name}
            onChange={(e) => setCustomStyleForm({ ...customStyleForm, name: e.target.value })}
            placeholder="e.g., Vintage Film"
            disabled={savingCustomStyle}
          />
        </label>
      </div>
      <div>
        <label>
          Description
          <textarea
            value={customStyleForm.description}
            onChange={(e) => setCustomStyleForm({ ...customStyleForm, description: e.target.value })}
            placeholder="Briefly describe the visual aesthetic..."
            rows={2}
            disabled={savingCustomStyle}
          />
        </label>
      </div>
      <div>
        <label>
          Style Prompt
          <textarea
            value={customStyleForm.prompt}
            onChange={(e) => setCustomStyleForm({ ...customStyleForm, prompt: e.target.value })}
            placeholder="Describe how you want the style to look in generation prompts..."
            rows={4}
            disabled={savingCustomStyle}
          />
        </label>
      </div>
      <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
        <button
          className="btn btn-primary"
          onClick={handleCreateCustomStyle}
          disabled={!customStyleForm.name.trim() || !customStyleForm.prompt.trim() || savingCustomStyle}
        >
          {savingCustomStyle ? "Creating..." : "Create Style"}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => setShowCustomStyleModal(false)}
          disabled={savingCustomStyle}
        >
          Cancel
        </button>
      </div>
    </div>
  </dialog>
)}
```

5. In `StoryboardPage.module.css`, add basic modal styles (you can adapt from existing modal patterns in the codebase or keep it minimal).

6. Run: `pnpm typecheck`.


### Milestone 5 — Test and validation

1. Run `pnpm build` to ensure no build errors.
2. Start the dev server: `pnpm dev`.
3. Navigate to the StoryboardPage.
4. Click "Create custom style" button.
5. Fill in name, description, and style prompt.
6. Submit.
7. Verify the new custom style appears in the style gallery.
8. Select it for the storyboard.
9. Proceed to generate an image and verify the custom style prompt is composed into the generation request (inspect via debug endpoint or network tab).


## Concrete Steps

Run all commands from `/Users/ran/my-app/gen-story`.


### Step-by-step implementation

1. **Implement `StylePresetRepository.save()` in Drizzle:**
   - Edit `apps/api/src/db/repositories.ts`
   - Find `class StylePresetRepository`
   - Implement the `save()` method to INSERT or UPDATE the `style_presets` table

2. **Create the use case:**
   - Edit `packages/application/src/use-cases.ts`
   - Add `CreateCustomStyleInput`, `CreateCustomStyleDeps`, and `createCustomStyle()` function
   - Edit `packages/application/src/index.ts` to export the new types and function
   - Update `packages/application/src/use-cases.test.ts` with a test

3. **Add the API endpoint:**
   - Edit `apps/api/src/http/routes.ts`
   - Add `POST /api/style-presets` route
   - Ensure `createCustomStyle` is imported and wired in `create-api-context.ts`

4. **Add the client helper:**
   - Edit `apps/web/src/lib/api-client.ts`
   - Add `createCustomStyle()` function

5. **Add the modal UI:**
   - Edit `apps/web/src/components/storyboard/StoryboardPage.tsx`
   - Add state for modal and form
   - Add handler function
   - Add modal JSX in the template (after the style gallery)
   - Update style filter to separate system and user presets (optional; can display all together)

6. **Add CSS for modal (optional):**
   - Edit `apps/web/src/components/storyboard/StoryboardPage.module.css`
   - Add `.modal` and `.modalContent` classes if not already present

7. **Test:**
   - Run `pnpm typecheck`
   - Run `pnpm test`
   - Run `pnpm dev` and manually test the UI flow
   - Run `pnpm build`


## Validation and Acceptance

### After Milestone 1

- `pnpm typecheck` passes.
- `pnpm test` passes (with updated in-memory repository).

### After Milestone 2

- `pnpm typecheck` passes.
- `pnpm test` passes (with the new use-case test).

### After Milestone 3

- `pnpm typecheck` passes.
- Posting to `POST http://localhost:4000/api/style-presets` with valid JSON creates a custom style and returns `{ stylePreset: { ... } }` with status 201.
- Query `GET /api/style-presets` includes the new custom style (with `scope: "user"`).

### After Milestone 4

- `pnpm typecheck` passes.
- `pnpm dev` runs without errors.
- On StoryboardPage, a "Create custom style" button is visible in the style gallery.
- Clicking it opens a modal with name, description, and prompt fields.
- Submitting the form creates the style, adds it to the gallery, and clears the form.
- The custom style can be selected and used for generation.
- On GeneratePage, inspecting a generation request shows the custom style prompt composed into the image-generation prompt.

### After Milestone 5

- `pnpm build` succeeds.
- Manual end-to-end test: create a custom style, select it, generate an image, verify the style prompt appears in the prompt composition.


## Idempotence and Recovery

- All milestones are purely additive (new code, one new API route, no DB migrations, no destructive changes).
- Milestones 1–4 can be developed and tested in isolation; each leaves the app in a coherent state.
- The `save()` method handles both INSERT and UPDATE, so re-running is safe.
- If the modal state gets stuck, refreshing the page resets it (no persistence in localStorage).
- Custom styles are deleted via a future soft-delete endpoint (not in scope for this plan).


## Artifacts and Notes

- **Validation performed**: `pnpm typecheck` passed; `pnpm build` passed; `pnpm test` passed with 16 API test files and 85 API tests, plus domain and application tests. API route tests require permission to bind `127.0.0.1`.
- **Custom style scope**: All custom styles are saved with `scope = "user"`. If per-user filtering is needed in the future, a migration can add a `userId` foreign key to `style_presets`. For now, the organization-scoped approach (all org users see all styles) is simpler.
- **Reference image storage**: The optional reference image can be stored under `projects/{projectId}/custom-styles/{styleId}/reference.jpg` if needed. The storage key is optional; the custom style works without it.
- **Preview generation**: User-custom-style preview image generation is deferred. For now, custom styles appear in the gallery without preview images (showing only name and description). A future feature can add "Generate preview" buttons.
- **Style prompt composition**: The custom style's `prompt` field is composed into every generation request using the existing `composeImagePrompt()` function (same as system presets). No changes to the prompt composer are needed.


## Interfaces and Dependencies

- `packages/domain/src/model.ts` — no changes (StylePreset type already exists with `scope` field).
- `packages/application/src/ports.ts` — ensure `StylePresetRepositoryPort.save()` is already declared.
- `packages/application/src/use-cases.ts` — add `createCustomStyle()` and related types.
- `apps/api/src/db/repositories.ts` — implement `StylePresetRepository.save()`.
- `apps/api/src/http/routes.ts` — add `POST /api/style-presets` endpoint.
- `apps/api/src/http/dto-mappers.ts` — ensure `toStylePresetDto()` works for both scopes.
- `apps/web/src/lib/api-client.ts` — add `createCustomStyle()` client helper.
- `apps/web/src/components/storyboard/StoryboardPage.tsx` — add modal, form state, and handlers.
- `apps/web/src/components/storyboard/StoryboardPage.module.css` — add modal styles (if not reusing existing classes).
