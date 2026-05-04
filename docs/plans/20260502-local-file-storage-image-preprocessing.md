# Add Local File Storage And Image Preprocessing


This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds.

This plan follows `PLANS.md` at `/Users/ran/my-app/PLANS.md`.


## Purpose / Big Picture


Store uploaded photo files and derived image files locally without leaking absolute filesystem paths into the database, domain package, or application package. After this work, a user photo can be ingested from bytes, stored as an original file, converted into a display preview, normalized for future image-generation input, and registered as a `PhotoAsset` only after project-level exact duplicate detection has run.

This is Phase 4 from `IMPLEMENTATION_PLAN.md`: Local File Storage And Image Preprocessing. It comes after Phase 3 SQLite persistence and before Phase 5 REST routes and local authentication. The user-visible outcome is still mostly backend behavior, but it is observable through tests and local files: uploaded images appear under the `data/uploads/...` key layout, previews and AI input images can be read back through `ObjectStoragePort`, and duplicate uploads within one project are rejected by checksum before creating a second photo asset.


## Progress


- [x] (2026-05-02 13:58Z) Read `IMPLEMENTATION_PLAN.md`, `REQUIREMENTS_INIT.md`, `/Users/ran/my-app/PLANS.md`, and the completed Phase 3 ExecPlan.
- [x] (2026-05-02 13:58Z) Inspected the current workspace layout, package manifests, application ports, domain model, SQLite schema, repository adapters, and environment docs.
- [x] (2026-05-02 13:58Z) Created this ExecPlan for Phase 4 / Local File Storage And Image Preprocessing.
- [x] (2026-05-02 14:42Z) Added local object storage, storage key helpers, checksum helpers, photo ingestion, and image preprocessing adapters in `apps/api`.
- [x] (2026-05-02 14:42Z) Added the minimal application port and use case changes needed for project-level duplicate detection by checksum.
- [x] (2026-05-02 14:42Z) Added focused tests for storage safety, preview generation, AI input normalization, cleanup on failed registration, and duplicate detection.
- [x] (2026-05-02 14:42Z) Ran focused package verification for application and API changes.
- [x] (2026-05-02 14:42Z) Ran workspace format, typecheck, lint, test, build, and architecture boundary checks.
- [ ] Complete HEIC verification with a real HEIC-capable local image stack or approved converter.


## Surprises & Discoveries


- Observation: `ObjectStoragePort` and `ImagePreprocessingPort` already exist in `packages/application/src/ports.ts`, but `ObjectStoragePort` is intentionally minimal and no concrete adapter exists yet.
  Evidence: `packages/application/src/ports.ts` defines `putObject`, `getObject`, and `deleteObject`; `rg "class .*ObjectStorage|ObjectStoragePort" apps packages` finds only in-memory test doubles.

- Observation: `registerPhotoAsset` already accepts `storageKey`, MIME type, size, width, height, and checksum, but it only checks duplicate `photoAssetId`, not duplicate original file checksum within the same project.
  Evidence: `packages/application/src/use-cases.ts` checks `deps.photoAssets.findById(input.photoAssetId)` before saving and does not query by checksum.

- Observation: Phase 3 already stores the file metadata needed for this phase on `photo_assets` and `generated_images`.
  Evidence: `apps/api/src/db/schema.ts` has `storageKey`, `mimeType`, `size`, `width`, `height`, and `checksum` columns on both tables, plus an index on `photo_assets.checksum`.

- Observation: The repository already ignores local upload data.
  Evidence: `.gitignore` includes `data/uploads/`, `data/*.sqlite`, `data/*.sqlite-shm`, and `data/*.sqlite-wal`.

- Observation: The local `better-sqlite3` native binding was missing before verification, so the SQLite repository tests failed until the package install script was run inside the dependency directory.
  Evidence: `pnpm --filter @gen-story/api exec vitest run src/db/repositories.test.ts` initially failed with `Could not locate the bindings file`; `npm run install` in `node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3` rebuilt `build/Release/better_sqlite3.node`.

- Observation: The installed `sharp` stack can generate and read AVIF-style HEIF output, but it does not advertise `.heic` input suffix support and HEVC HEIF encoding fails.
  Evidence: `sharp.format.heif` reports `fileSuffix:[".avif"]`; `.heif({ compression: "hevc" })` fails with `heifsave: Unsupported compression`.


## Decision Log


- Decision: Implement Phase 4 concrete filesystem and image adapters inside `apps/api`, not inside `packages/domain` or `packages/application`.
  Rationale: Local filesystem access, image libraries, and storage roots are infrastructure concerns. Keeping them in `apps/api` preserves the existing package boundaries and avoids creating `packages/infrastructure` before the adapter code is large enough to justify it.
  Date/Author: 2026-05-02 / Codex

- Decision: Keep database values as storage keys such as `data/uploads/originals/projects/{projectId}/{photoAssetId}.{ext}` and resolve them to absolute paths only inside `LocalObjectStorage`.
  Rationale: `IMPLEMENTATION_PLAN.md` requires storage keys instead of absolute paths. A single resolver with path traversal checks makes the boundary explicit and testable.
  Date/Author: 2026-05-02 / Codex

- Decision: Add a narrow checksum lookup to `PhotoAssetRepositoryPort` and enforce same-project exact duplicate detection in the application use case.
  Rationale: Duplicate detection is a business rule over `PhotoAsset` records, not a filesystem behavior. The application layer can enforce it using checksum values without knowing how files are stored.
  Date/Author: 2026-05-02 / Codex

- Decision: Add a small API-local `PhotoAssetIngestionService` rather than adding REST routes in this phase.
  Rationale: Phase 5 owns REST API wiring. A service can prove the upload pipeline end to end through tests now, then Phase 5 can call it from an HTTP route without changing storage behavior.
  Date/Author: 2026-05-02 / Codex

- Decision: Use `sharp` for image metadata, resizing, JPEG preview output, and HEIC to JPEG conversion, with a checked test proving HEIC support in the installed binary.
  Rationale: The project needs local image conversion and resizing, and `sharp` keeps this work in Node without adding a separate conversion service. HEIC support can vary by native build, so the acceptance test must verify it instead of assuming it.
  Date/Author: 2026-05-02 / Codex

- Decision: Use one initial preview preset and one AI input preset.
  Rationale: Phase 4 asks for one initial preview size and a maximum AI input resolution. Multiple presets, user settings, and runtime configurability are unnecessary until requirements demand them.
  Date/Author: 2026-05-02 / Codex


## Outcomes & Retrospective


Implemented the Phase 4 backend infrastructure and tests. The preview preset is `preview_640` with a 640px maximum edge and JPEG output. The AI input preset is `ai-input` with a 1536px maximum edge and JPEG output. The fixed local storage root remains `data/uploads`, and no new environment variable was added.

Added `LocalObjectStorage`, storage key helpers, SHA-256 checksum calculation, image metadata and JPEG derivative helpers, `PhotoAssetIngestionService`, and `LocalImagePreprocessingAdapter`. The application `PhotoAssetRepositoryPort` now supports `findByProjectIdAndChecksum`, and `registerPhotoAsset` rejects exact duplicate original checksums within the same project.

Verification completed:

    pnpm --filter @gen-story/application typecheck
    pnpm --filter @gen-story/api typecheck
    pnpm --filter @gen-story/application test
    pnpm --filter @gen-story/api exec vitest run src/storage/local-object-storage.test.ts
    pnpm --filter @gen-story/api exec vitest run src/photos/photo-asset-ingestion.test.ts
    pnpm --filter @gen-story/api exec vitest run src/images/local-image-preprocessing.test.ts
    pnpm --filter @gen-story/api exec vitest run src/db/repositories.test.ts
    pnpm --filter @gen-story/api test
    pnpm --filter @gen-story/application lint
    pnpm --filter @gen-story/api lint
    pnpm format
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build
    rg "from ['\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application

Remaining gap: HEIC acceptance is not complete in this local environment. The code accepts `image/heic` and `image/heif` when `file-type` detects them and `sharp` can decode them, but the installed `sharp`/libvips capability does not prove real `.heic` decoding locally.


## Context and Orientation


`gen-story` is a TypeScript monorepo for creating emotional storyboard sequences from user photos. The current package layout is:

    apps/web
    apps/api
    packages/domain
    packages/application
    packages/shared

The relevant current files are:

- `packages/domain/src/model.ts`, which defines `PhotoAsset` and `GeneratedImage` with storage metadata but no filesystem details.
- `packages/application/src/ports.ts`, which defines repository ports plus `ObjectStoragePort` and `ImagePreprocessingPort`.
- `packages/application/src/use-cases.ts`, which has `registerPhotoAsset` and `createGenerationRequestUseCase`.
- `apps/api/src/db/schema.ts`, which stores `photo_assets.storage_key`, `mime_type`, `size`, `width`, `height`, and `checksum`.
- `apps/api/src/db/repositories.ts`, which implements SQLite-backed repository adapters.
- `.env.example` and `apps/api/.env.example`, which currently define `GEN_STORY_SQLITE_PATH` but no storage root variable.
- `.gitignore`, which already excludes `data/uploads/`.

The terms used in this phase are:

- `Storage key` means the stable relative key stored in the database and passed through ports. It is not an absolute local path.
- `Local object storage` means an adapter that maps approved storage keys to files under the repository's local `data/uploads` tree.
- `Original file` means the exact uploaded bytes, including original HEIC files.
- `Preview image` means a derived JPEG or WebP image for display in the web UI. Phase 4 creates one preset only.
- `AI input image` means a derived normalized image with bounded resolution and a model-friendly MIME type for later image generation.
- `Exact duplicate` means two original uploads in the same project with identical cryptographic checksums.

The storage key conventions from `IMPLEMENTATION_PLAN.md` are:

    data/uploads/originals/projects/{projectId}/{photoAssetId}.{ext}
    data/uploads/previews/projects/{projectId}/{photoAssetId}_{preset}.{ext}
    data/uploads/generated/images/projects/{projectId}/scenes/{sceneId}/{generatedImageId}.{ext}
    data/uploads/generated/videos/projects/{projectId}/scenes/{sceneId}/{generatedVideoId}.{ext}
    data/uploads/generated/bgms/projects/{projectId}/{generatedBgmId}.{ext}

Phase 4 should implement the original, preview, and AI-ready image paths. The generated image path is already represented by the `GeneratedImage` domain model and should only receive storage key helpers in this phase. Generated videos and BGM are future placeholders only; do not implement video or BGM generation.


## Plan of Work


First, add small storage primitives in `apps/api/src/storage`. Create `storage-keys.ts` for deterministic key construction, `local-object-storage.ts` for the `ObjectStoragePort` adapter, and `checksum.ts` for SHA-256 checksum calculation. `LocalObjectStorage` should accept a base directory or repository root, reject absolute keys and `..` segments, create parent directories on writes, and read or delete objects by storage key. It should not expose resolved absolute paths outside the adapter.

Second, add a narrow image module in `apps/api/src/images`. Add an image metadata and conversion adapter backed by `sharp`. It should read image dimensions from bytes, convert HEIC and HEIF originals to JPEG for preview and AI input, resize images without upscaling, and emit metadata for each derived object. Keep the first preview preset as a constant, for example `preview_640`, and the AI input max edge as one constant, for example 1536 pixels. If implementation chooses different values, record that decision in the plan before coding.

Third, add a `PhotoAssetIngestionService` in `apps/api/src/photos`. This service should take a `projectId`, `photoAssetId`, original filename or MIME hint, original bytes, optional notes, and optional usage. It should detect the actual image type, reject unsupported formats, compute the original checksum, ask the application use case to reject same-project duplicates, write the original bytes to the original storage key, generate and write the initial preview, then call `registerPhotoAsset` with the original storage key and metadata. If registration fails after writing files, it should delete the just-written original and preview objects before returning the failure.

Fourth, update `packages/application/src/ports.ts`, `packages/application/src/use-cases.ts`, and the repository implementations just enough for duplicate detection. Add `findByProjectIdAndChecksum(projectId, checksum)` to `PhotoAssetRepositoryPort`. In `registerPhotoAsset`, after confirming the project exists and the `photoAssetId` is not already used, query by project and checksum. If another active photo asset exists for that project, return a `conflict` result without saving. Update the in-memory test repository and `SqlitePhotoAssetRepository` accordingly.

Fifth, implement `LocalImagePreprocessingAdapter` for the existing `ImagePreprocessingPort`. It should load the target scene and its assigned photo assets through repositories, read each original file through `ObjectStoragePort`, generate or overwrite deterministic AI input objects under `data/uploads/previews/projects/{projectId}/{photoAssetId}_ai-input.jpg` or another documented derived-image key, then return `inputJson` augmented with normalized input image metadata. The returned JSON must use storage keys, MIME types, sizes, dimensions, checksums, and related photo asset IDs; it must not include local paths or binary data.

Sixth, add focused tests. Storage tests should use temporary directories and prove safe key handling, write/read/delete behavior, and path traversal rejection. Image tests should use small generated JPEG, PNG, and WebP buffers and a tiny HEIC fixture or generated HEIC fixture to prove conversion. Ingestion tests should prove original retention, preview creation, metadata registration, and cleanup on failed registration. Application tests should prove same-project checksum duplicates are rejected while the same checksum in a different project is allowed. Preprocessing tests should prove AI input images are generated from scene photo assignments and that returned generation input JSON contains only storage-key metadata.

Finally, update documentation only where the developer workflow changes. If storage configuration remains the fixed `data/uploads` default, update `README.md` current limitations and storage notes without adding a new environment variable. If an environment variable is added, document it in `.env.example`, `apps/api/.env.example`, and `README.md`.


## Concrete Steps


Run all commands from `/Users/ran/my-app/gen-story` unless a step explicitly names another working directory.

Inspect the current contracts before editing:

    sed -n '1,220p' packages/application/src/ports.ts
    sed -n '1,260p' packages/application/src/use-cases.ts
    sed -n '1,260p' apps/api/src/db/repositories.ts
    sed -n '1,220p' apps/api/src/db/schema.ts

Add image processing dependencies to the API app:

    pnpm --filter @gen-story/api add sharp file-type

Create storage and image adapter files:

    apps/api/src/storage/checksum.ts
    apps/api/src/storage/storage-keys.ts
    apps/api/src/storage/local-object-storage.ts
    apps/api/src/storage/local-object-storage.test.ts
    apps/api/src/images/image-metadata.ts
    apps/api/src/images/local-image-preprocessing.ts
    apps/api/src/images/local-image-preprocessing.test.ts
    apps/api/src/photos/photo-asset-ingestion.ts
    apps/api/src/photos/photo-asset-ingestion.test.ts

Apply the minimal application and repository changes:

    packages/application/src/ports.ts
    packages/application/src/use-cases.ts
    packages/application/src/use-cases.test.ts
    apps/api/src/db/repositories.ts
    apps/api/src/db/repositories.test.ts

Run focused tests as each layer is completed:

    pnpm --filter @gen-story/application test
    pnpm --filter @gen-story/api exec vitest run src/storage/local-object-storage.test.ts
    pnpm --filter @gen-story/api exec vitest run src/photos/photo-asset-ingestion.test.ts
    pnpm --filter @gen-story/api exec vitest run src/images/local-image-preprocessing.test.ts
    pnpm --filter @gen-story/api test

Run static checks for the touched packages:

    pnpm --filter @gen-story/application typecheck
    pnpm --filter @gen-story/api typecheck
    pnpm --filter @gen-story/application lint
    pnpm --filter @gen-story/api lint

Run workspace verification after the full phase is implemented:

    pnpm format
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build
    rg "from ['\\\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application


## Validation and Acceptance


This phase is accepted when local file storage and image preprocessing work through ports and adapter services without exposing absolute paths outside `apps/api`.

The storage layer must prove these observable behaviors:

- `LocalObjectStorage.putObject` writes bytes under the expected `data/uploads/...` key.
- `LocalObjectStorage.getObject` reads the same bytes back by storage key.
- `LocalObjectStorage.deleteObject` removes the object and treats a missing key as safe to delete.
- Absolute keys, empty keys, and keys containing `..` are rejected.
- No database row or returned application object contains an absolute local path.

The photo ingestion pipeline must prove these observable behaviors:

- JPG, JPEG, PNG, WebP, and HEIC inputs are accepted when the installed image stack supports them.
- Original files are retained under `data/uploads/originals/projects/{projectId}/{photoAssetId}.{ext}`.
- HEIC originals remain stored as HEIC or HEIF, while preview and AI input derivatives are generated as JPEG.
- One initial preview image is generated and retrievable through `ObjectStoragePort`.
- Original file SHA-256 checksums are calculated from uploaded bytes.
- Uploading the exact same original bytes twice within one project returns a `conflict` result and does not create a second active `PhotoAsset`.
- Uploading the same original bytes to a different project is allowed.
- If registration fails after file writes, the service removes the files it just wrote.

The AI input preprocessing adapter must prove these observable behaviors:

- Creating a generation request invokes `ImagePreprocessingPort`.
- Assigned scene photo assets are read through repositories, not by caller-provided paths.
- Normalized AI input images are generated with a bounded maximum resolution and are retrievable through storage keys.
- The returned generation request `inputJson` contains normalized image metadata and storage keys, not absolute paths or binary image data.

The required verification commands must pass:

    pnpm --filter @gen-story/application test
    pnpm --filter @gen-story/api test
    pnpm --filter @gen-story/application typecheck
    pnpm --filter @gen-story/api typecheck
    pnpm --filter @gen-story/application lint
    pnpm --filter @gen-story/api lint
    pnpm format
    pnpm typecheck
    pnpm lint
    pnpm test
    pnpm build

The boundary check must still return no matches in `packages/domain` and `packages/application` for forbidden framework, SDK, ORM, HTTP, cloud, and app imports:

    rg "from ['\\\"](next|drizzle|openai|@workos|@google|aws-sdk|zod|express|fastify|hono|\\.\\./\\.\\./apps)" packages/domain packages/application


## Idempotence and Recovery


Storage writes should use deterministic keys. Re-ingesting the same `photoAssetId` should overwrite only the deterministic objects for that photo asset or return a conflict before creating a second record. Tests must use temporary directories so repeated runs do not modify `data/uploads`.

Preview and AI input generation should be safe to rerun. If a derived file already exists for the same photo asset and preset, the adapter may overwrite it with equivalent output. The original upload must never be overwritten for a different photo asset ID.

If `sharp` cannot decode or encode HEIC in the local environment, do not silently drop HEIC support. Record the failure in `Surprises & Discoveries`, keep JPG/PNG/WebP behavior tested, and mark Phase 4 acceptance blocked until the HEIC-capable image stack is available or an explicitly approved converter is chosen.

If ingestion writes an original or preview and later fails to register the `PhotoAsset`, delete only the storage keys created during that ingestion attempt. Do not delete pre-existing keys or project directories recursively.

If duplicate detection is accidentally implemented only in the API-local ingestion service, move the same-project checksum check into `registerPhotoAsset` before considering the phase complete. The rule belongs at the application boundary because later REST routes or batch import flows should get the same behavior.


## Artifacts and Notes


Expected new files:

    apps/api/src/storage/checksum.ts
    apps/api/src/storage/storage-keys.ts
    apps/api/src/storage/local-object-storage.ts
    apps/api/src/storage/local-object-storage.test.ts
    apps/api/src/images/image-metadata.ts
    apps/api/src/images/local-image-preprocessing.ts
    apps/api/src/images/local-image-preprocessing.test.ts
    apps/api/src/photos/photo-asset-ingestion.ts
    apps/api/src/photos/photo-asset-ingestion.test.ts

Expected changed files:

    apps/api/package.json
    packages/application/src/ports.ts
    packages/application/src/use-cases.ts
    packages/application/src/use-cases.test.ts
    apps/api/src/db/repositories.ts
    apps/api/src/db/repositories.test.ts
    README.md
    .env.example
    apps/api/.env.example

Only update `.env.example` and `apps/api/.env.example` if implementation adds a new storage root variable. Otherwise keep the fixed local default documented as `data/uploads`.

After implementation, add a concise note here with the exact preview preset name, AI input max edge, file types accepted by tests, and command results.


## Interfaces and Dependencies


The application interfaces involved are:

- `ObjectStoragePort` in `packages/application/src/ports.ts`, used by the local storage adapter and later by REST/API composition code.
- `ImagePreprocessingPort` in `packages/application/src/ports.ts`, called by `createGenerationRequestUseCase` before queueing generation work.
- `PhotoAssetRepositoryPort` in `packages/application/src/ports.ts`, extended with `findByProjectIdAndChecksum(projectId, checksum)` for duplicate detection.
- `registerPhotoAsset` in `packages/application/src/use-cases.ts`, updated to reject project-level exact duplicates.
- `createGenerationRequestUseCase` in `packages/application/src/use-cases.ts`, already responsible for invoking preprocessing.

The API-local adapters and services involved are:

- `LocalObjectStorage`, which is the only code that resolves storage keys to local filesystem paths.
- `PhotoAssetIngestionService`, which coordinates checksum calculation, original storage, preview generation, cleanup, and `registerPhotoAsset`.
- `LocalImagePreprocessingAdapter`, which turns scene photo assignments into normalized AI input storage keys inside generation request input JSON.
- `SqlitePhotoAssetRepository`, which implements checksum lookup without exposing Drizzle outside `apps/api`.

The required dependency set for this phase is intentionally small:

- `sharp` for local image metadata, resize, and conversion.
- `file-type` for content sniffing from bytes instead of trusting filenames or browser-provided MIME values.
- Node built-ins `node:crypto`, `node:fs/promises`, and `node:path` for checksums and local file I/O.

No Next.js, Drizzle, OpenAI SDK, WorkOS SDK, GCP SDK, AWS SDK, filesystem APIs, image libraries, or local path types should be imported by `packages/domain`. `packages/application` may receive the checksum lookup method and tests, but it must not import filesystem APIs, image libraries, Drizzle, HTTP frameworks, cloud SDKs, or app code.
