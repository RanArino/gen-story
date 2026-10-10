# Private R2 media configuration review

Status: M4 adapters, direct executors, and browser integration are implemented and
verified in isolated fixtures. The user authorized execution with the defaults
below on 2026-10-10. Account ID and exact application origins remain required
operator inputs before live setup. Hosted startup remains disabled; local
SQLite/filesystem uploads remain available. No live provisioning, credentials,
configuration changes, deployment, or compatibility test has been performed.

## Configuration inventory

| Item                   | Proposed default or required operator input                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account                | Required: identify the Gen Story Cloudflare account name and account ID. No account has been selected.                                                  |
| Environment separation | Private `gen-story-staging-media` and `gen-story-production-media` buckets with independent credentials.                                                |
| Public access          | Disable public development URLs and public custom-domain access.                                                                                        |
| Lifecycle              | Expire `tmp/` objects after one day. No age-based expiration for finalized `media/`. Application cleanup remains authoritative.                         |
| Browser origins        | Required: exact staging and production HTTPS origins. Localhost is excluded unless explicitly approved for staging. No wildcards or inferred origins.   |
| CORS methods           | `PUT`, `GET`, `HEAD`.                                                                                                                                   |
| CORS allowed headers   | `Content-Type` and signed `x-amz-meta-sha256` upload metadata. No exposed headers are needed by the proposed browser contract.                          |
| Runtime credentials    | Separate bucket-scoped Object Read & Write credentials per environment. Keep management credentials separate.                                           |
| Upload grant lifetime  | 10 minutes.                                                                                                                                             |
| Read/HEAD lifetime     | 5 minutes; refresh browser reads 30 seconds before expiry. HEAD signing is service-only.                                                                |
| Recovery               | Preserve records and media for seven days after project/account deletion. Restoration cancels pending purge. Deny new access/publication while deleted. |
| Physical deletion      | Begin irreversible purge only after recovery expires and outstanding upload capabilities and processing claims are settled.                             |
| Secrets                | Server runtime secret storage only. Never supply credentials in chat, source, signed-URL records, logs, or browser storage.                             |

The approved account determines the exact R2 S3 endpoint origin. Browser CSP must
allow that exact origin in `connect-src` and `img-src` for browser integration. CORS
is required only by browser media composition; deletion workers and read-only orphan
inventory use server-side R2 credentials and do not require browser origins. Ownership
checks remain an API responsibility. See [R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/).

The `x-amz-meta-sha256` header binds the declared checksum to the upload grant.
Completion must independently hash the actual bytes. A presigned PUT does not
enforce the application size ceiling or prove that the declaration is correct.
Use SDK region `auto` and configure SDK checksum behavior against the
[R2 S3 compatibility contract](https://developers.cloudflare.com/r2/api/s3/api/);
do not substitute an assumed S3 SHA-256 checksum feature for application validation.

Lifecycle deletion is eventual. It is cleanup for temporary uploads, not the
seven-day recovery policy for finalized media. See
[R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).
Already-issued read URLs remain bearer capabilities until expiry or object
deletion. Soft deletion and sign-out prevent new grants. See
[R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/).

## Approval and authorization record

| Gate                                      | Current record                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Configuration approval (HP-4.0)           | User authorizes execution with these defaults on 2026-10-10. Account/origins remain required before live setup.            |
| Local implementation request              | Requested; M4 implementation authorized explicitly by the user; unknown account/origins remain required deployment inputs. |
| Live provisioning or credential creation  | Not authorized.                                                                                                            |
| Live CORS/lifecycle/configuration changes | Not authorized.                                                                                                            |
| Deployment                                | Not authorized.                                                                                                            |
| Live compatibility tests                  | Not authorized; require separate authorization and a unique staging test prefix.                                           |

Approval of this inventory permits no live operation. The only environment
template is `apps/api/.env.example`; runtime variables are documented there, without secrets or a second environment template.

## Upload and temporary access contracts

These routes exist only on the extracted hosted router composed with
`createHostedMediaContext`. The ordinary hosted bootstrap still refuses startup.
Every route checks the authenticated owner and current deletion state, preserves
session/CSRF enforcement, and sends `Cache-Control: private, no-store`. Foreign
resources return the established indistinguishable 404 response.

| Operation                                                          | Request and result                                                                                                                                      |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/projects/:projectId/upload-grants`                      | `{name, mimeType, size, sha256, notes?, usage?}`; 201 `{uploadId, method: "PUT", url, headers, expiresAt}`. Size is bytes and SHA-256 is lowercase hex. |
| `POST /api/projects/:projectId/upload-sessions/:uploadId/complete` | No body or `{}`; 202 `{uploadId, status: "processing", failureCode: null, photo: null}`. Repeated completion conflicts. No object key is accepted.      |
| `GET /api/projects/:projectId/upload-sessions/:uploadId`           | Durable `{uploadId, status, failureCode, photo}`; photo is present after publication. Status is issued, processing, completed, or failed.               |
| `GET /api/photo-assets/:id/media-url?variant=preview`              | `{url, expiresAt}` for preview, agent-preview, or original download.                                                                                    |
| `GET /api/generated-images/:id/media-url?variant=preview`          | Equivalent owner-authorized generated-image access.                                                                                                     |
| `GET /api/character-sheets/:id/media-url?variant=preview`          | Equivalent access using the successful character-sheet AI job ID.                                                                                       |
| `DELETE /api/projects/:projectId`                                  | 204; starts seven-day recovery and denies new media grants.                                                                                             |
| `POST /api/projects/:projectId/restore`                            | Restores during recovery and cancels pending purge.                                                                                                     |

Shared DTOs are explicit in `packages/shared`. Signed URLs occur only in transient
grant/access responses; persisted photo/session records and exports contain
stable object keys. HEAD signing is service-only. The browser hashes and PUTs the
raw file using exactly the returned headers, without API cookies or authentication
headers. It treats 202 as processing, polls status, and queries status after an
uncertain completion response. Local uploads retain the existing base64 path.

Preview URLs are cached only in memory, refreshed 30 seconds before expiry, and
retried once after an image error. Account changes/sign-out clear the cache. The
exact account endpoint in `NEXT_PUBLIC_R2_ENDPOINT_ORIGIN` is validated and added
to browser CSP image and connection sources; wildcards are refused. No image proxy
or persistent browser URL cache is introduced.

## Processing and publication

`executeUploadCompletion` is directly callable for M5 dispatch. HTTP completion
only persists intent: it starts no background promise or hosted poller. Sessions
in `upload_sessions` retain ownership, reserved photo ID, source declaration,
expiry, state, executor lease/fencing token, current/retired write manifests, and a
sanitized failure code. Ownership/deletion checks occur at grant issuance,
completion acceptance, claim, each write intent, and atomic publication.

The executor reads one bounded byte snapshot, independently verifies its size and
SHA-256, identifies magic-byte type, and fully decodes JPEG, PNG, WebP, HEIC, or
HEIF. Limits are 10 MiB input, 40 million pixels, and one frame. PNG animation control is inspected independently of native metadata. HEIC image count
and dimensions are inspected before pixel expansion; EXIF orientation is applied.
A supervised Linux decoder container has 512 MiB hard memory including native/WASM
allocations, zero additional swap, one CPU, one decode at a time, and a 15-second
termination deadline. Container execution requires Docker; unavailable executors
leave persisted work retryable. Each derivative is limited to 10 MiB.

The exact original and metadata-free JPEG previews (640-edge display and
1024-edge agent) are written from that snapshot to attempt-owned keys below
`media/users/{userId}/projects/{projectId}/`. Browser PUT grants target only
`tmp/users/{userId}/projects/{projectId}/uploads/{uploadId}`. Rewriting temporary
bytes during or after execution cannot alter finalized originals. Write intents
precede storage operations. An uncertain commit is resolved before cleanup;
committed output is never deleted. Retired attempts remain recorded for inventory
and orphan reporting.

Publication serializes through the project document and transactionally saves the
photo, completed session/manifest, photo position, storyboard updates, and required
primary-photo scenes. Duplicate source checksums are checked inside that same
transaction. Transaction callbacks perform no storage operations. Trusted retries
resume claims with fencing; browser completion remains intentionally single-use.

## Recovery, purge, and orphan inventory

`FirestoreMediaDeletionRepository.schedule/restore` and `executeMediaDeletion`
provide directly callable project/account deletion. Account deletion has no new UI
or public endpoint; identity-provider removal remains outside M4. Recovery lasts
seven days and preserves records/bytes. An account guard prevents principal
provisioning in the same Firestore transaction used to create a principal.

Irreversible purge waits for outstanding upload URLs, processing leases plus
settlement grace, and pre-existing running generation jobs. It persists bounded
100-item pages in `media_deletion_items`, claims/fences execution in
`media_deletions`, removes all pages of owned temporary/final prefixes, checkpoints
flat descendants, verifies absence, and removes parents last. Late descendants are
captured into additional durable pages before retry. Restoration is refused once
purging starts. Account purge leaves the minimal `account_deletion_guards` record.

Inventory covers the 18 entity and four auxiliary collections listed in
[Firestore contracts](firestore-contracts.md), plus all five media collections.
Scene/storyboard/conversation links locate records lacking `projectId`; hashed
reservations are captured before deleting their parent data. Shared organizations
and system presets survive. Hosted private presets now persist `ownerUserId`;
legacy ownerless private presets cannot safely be attributed and are preserved.
No live migration is performed.

`detectMediaOrphans` exposes only read/list/HEAD capabilities and performs no
deletion. Findings distinguish missing references, unreferenced finalized objects,
active temporary uploads, expired candidates, recoverable records, and uncertain
concurrent writes. A session write intent is not a committed photo reference.
Application cleanup remains authoritative; R2 lifecycle cleanup is eventual.

## Isolated verification

Use a dedicated loopback Firestore Emulator with `GCLOUD_PROJECT=demo-gen-story`.
The test helper rejects live projects and non-loopback endpoints. These commands
reset that isolated Emulator's fixtures; never point them at existing data.

When Java is not installed on the host, run the Emulator in a disposable container
from any local image that already contains the Firebase CLI and a Java runtime,
publishing it on loopback only and mounting just the repository's Rules and
indexes read-only. Do not mount credentials or pull images for this purpose.

```sh
docker run -d --name gen-story-emulator -p 127.0.0.1:8080:8080 --entrypoint sh \
  -v "$PWD/firestore.rules:/m4/firestore.rules:ro" \
  -v "$PWD/firestore.indexes.json:/m4/firestore.indexes.json:ro" \
  "$FIREBASE_EMULATOR_IMAGE" -c 'cd /tmp && node -e '"'"'require("fs").writeFileSync("firebase.json",JSON.stringify({firestore:{rules:"/m4/firestore.rules",indexes:"/m4/firestore.indexes.json"},emulators:{firestore:{host:"0.0.0.0",port:8080},ui:{enabled:false}}}))'"'"' && firebase emulators:start --only firestore --project demo-gen-story --config /tmp/firebase.json'
docker rm -f gen-story-emulator   # after the suites finish
```

Choose another free loopback port if 8080 is in use and set `FIRESTORE_EMULATOR_HOST`
to match.

```sh
docker build -t gen-story-media-decoder:m4 -f apps/api/src/photos/decoder.Dockerfile apps/api/src/photos
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-gen-story pnpm test:firestore:contract
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-gen-story pnpm test:media:linux
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-gen-story pnpm --filter @gen-story/web exec playwright test e2e/private-media.spec.ts --project=chromium
```

Run Emulator and browser suites serially because they reset the same demo database.
The Emulator can answer a losing concurrent transaction with `Transaction is invalid or
closed`; the upload executor reports that as interrupted work to retry, as the persisted
queue would.
The browser command creates its own isolated API and signature-verifying storage
servers and bundles actual Photos/Storyboard components. It explicitly invokes
extracted processing rather than pretending Cloud Tasks dispatch exists. Evidence
includes two principals, raw PUTs, processing status, reload, expiry refresh,
scene editing/saving, and sign-out. Linux cases cover all formats, oriented
metadata-free derivatives, hostile inputs, hard memory/swap/CPU limits and actual
15-second process termination. Emulator cases cover races, overwrite resistance,
uncertain publication, deletion recovery/retries, foreign fixtures, account guards,
and nonmutating orphan reporting. Deny-all Rules tests cover the new collections.

## Optional live probe and remaining acceptance

`apps/api/src/storage/r2-live.test.ts` is disabled by default. After separate live
test authorization, configure the staging runtime variables from
`apps/api/.env.example` and set `GEN_STORY_R2_LIVE_TEST=authorized` for a targeted
Vitest invocation. The probe refuses production and touches only a unique
`tmp/m4-compatibility/{uuid}/` prefix, testing signed PUT/GET/HEAD, bytes, listing,
and cleanup. Do not run it as ordinary CI. Local fixture success does not prove
live R2 compatibility or browser CORS configuration.

HP-4.0 execution defaults and HP-4.1–HP-4.3 isolated acceptance are complete.
HP-4.4 direct execution is verified; its hosted deletion-task acceptance remains
open until HP-5.2a. M4 is **4/5**, not 5/5. HP-5.3 hosted preprocessing delivery,
real authentication acceptance, deployment, operator account/origins, and live R2
compatibility remain open. Hosted startup remains fail closed.

Deletion-only Cloud Tasks dispatch, OIDC verification, bounded repair and the private
worker are implemented locally. See [Hosted deletion](hosted-deletion.md) for
contracts and staging acceptance. Live acceptance remains required.
