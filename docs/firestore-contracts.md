# Firestore persistence contracts

The hosted persistence bootstrap connects the existing tenant-bound Firebase
verifier to all 15 application repository ports. The full hosted API still
refuses startup pending Cloud Tasks dispatch and hosted acceptance. Private R2
media is available only through extracted composition and isolated fixtures. The
bootstrap is exercised through an isolated HTTP harness; it does not enable a
deployed service or claim live authentication acceptance.

## Contract coverage

One reusable suite in `apps/api/src/test-support/repository-contracts.ts` runs
against SQLite and Firestore. SQLite migration, SQL inspection, and adapter-only
helpers retain their original tests. Repository fixtures close and reopen their
clients to verify durable proposals and preferences.

| Application port        | Firestore collection                                                                                        | Shared behavior checked                                                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Organizations           | `organizations`                                                                                             | Round trip, updates, creation timestamp                                                             |
| Users                   | `users`                                                                                                     | Round trip, updates, creation timestamp                                                             |
| Projects                | `projects`                                                                                                  | Organization lookup, ordering, deletion/restoration, seven-day recovery window                      |
| Photo assets            | `photo_assets`                                                                                              | Position ordering, checksum lookup, deletion/restoration, recovery window                           |
| Storyboards             | `storyboards`                                                                                               | Setup stamp, undecided tone, derived active scene IDs                                               |
| Scenes                  | `scenes`                                                                                                    | Scene/photo ordering, photo fidelity, duplicate/multi-primary photo rejection, deletion and re-save |
| Style presets           | `style_presets`                                                                                             | Scope/name ordering, system immutability, editable user presets                                     |
| Generation requests     | `generation_requests`                                                                                       | Scene/storyboard/batch queries, status counts, deletion, bounded recent lookup                      |
| AI jobs                 | `ai_jobs`                                                                                                   | Status/project queries, queued/running counts, result round trip                                    |
| Generated images        | `generated_images`                                                                                          | Image round trip, adoption switching, scene/image consistency                                       |
| Project photo analysis  | `project_photo_analyses`                                                                                    | Project lookup, replacement of the current analysis                                                 |
| Change proposals        | `change_proposals`                                                                                          | Items/choices replacement, status filters, ordering, request-ID uniqueness, restart durability      |
| Agent conversations     | `agent_conversations`, `agent_provider_bindings`, `agent_conversation_turns`, `agent_conversation_messages` | Transcript round trip, replay, append-only messages, sequence and turn-request uniqueness           |
| Test generation batches | `test_generation_batches`                                                                                   | Round trip, latest/list ordering, repeated saves                                                    |
| User preferences        | `user_preferences`                                                                                          | Lookup, upsert, replacement, restart durability                                                     |

Firestore-specific concurrent tests additionally exercise sequence reservations,
transcript collisions, and generated-image adoption. SQLite derives a sequence
from persisted messages; Firestore also reserves sequence numbers. The shared
suite checks persisted-message behavior without imposing reservation semantics
on SQLite.

## Storage and index inventory

The adapter retains its existing flat collections. Entity documents normally use
domain IDs; preferences use `userId`. The current photo analysis uses `projectId`
as its document key, matching SQLite's one-analysis-per-project replacement
behavior. No live data migration or local-to-hosted import is performed.

Transactions preserve creation timestamps, enforce system-preset immutability,
and atomically switch generated-image adoption. Proposals and turns reserve
hashed compound request keys in `change_proposal_request_keys` and
`agent_turn_request_keys`; messages reserve conversation/sequence pairs in
`agent_message_sequence_keys`. These hashes identify operations, not credentials.
`agent_conversation_counters` stores the last reserved or persisted sequence.
The four auxiliary collections inherit the same deny-all Rules.

Current queries use document lookups, a single equality filter, or collection
reads followed by application sorting/filtering. Equality fields are
`organizationId`, `projectId`, `storyboardId`, `sceneId`, `status`,
`testGenerationBatchId`, and `conversationId`. No composite index is required
by these query shapes, so `firestore.indexes.json` remains unchanged. Emulator
success does not demonstrate live index enforcement or large-dataset performance.

Existing ordering remains authoritative: project/proposal lists are oldest first,
photo lists use position, storyboard generation history is newest first, and
`findRecent` preserves SQLite's oldest-first bounded lookup. Domain timestamps
remain ISO strings; SDK objects and adapter-only deletion fields do not cross
domain boundaries.

## Emulator and authorization verification

From the repository root, run:

```sh
npx -y firebase-tools@15.31.0 emulators:exec \
  --config firebase.emulator.json --only firestore --project demo-gen-story \
  "pnpm test:firestore:contract"
```

The existing GitHub Actions workflow supplies JDK 21 and runs this same command.
Local Emulator execution is optional; no system-wide Java installation is
required. Without `FIRESTORE_EMULATOR_HOST`, the ordinary workspace suite skips
the integration tests. Skips do not count as parity evidence.

All integration suites run serially because they reset the isolated demo
database. Before creating a client or resetting data, the harness requires a
loopback Emulator host and rejects a live `GCLOUD_PROJECT`. It uses the
Emulator's `(default)` database so the repository and Rules suites exercise the
same configured Rules. Live hosted configuration still requires an explicit
`gen-story-staging` or `gen-story-production` database and the matching tenant.

Rules tests use the official Firebase testing helper and assert denied reads,
queries, creates, updates, and deletes for unauthenticated, owner, foreign-tenant,
deleted-user, and stale-claim fixtures. They also cover private user records and
orphaned subcollections. Admin SDK contracts are separate because Admin bypasses
Rules. These fixtures do not prove live token revocation.

The HTTP harness uses a controlled verifier and real Emulator repositories to
check concurrent principal isolation, owned metadata CRUD, saved preferences,
rejected identities, and exclusion of local-only routes. It proves that foreign
project restoration and storyboard reassignment are refused before mutation.
Real Identity Platform users and deployed browser acceptance remain a later
hosting gate.

## Private-media persistence

M4 adds `upload_sessions`, `media_deletions`, `media_deletion_items`, and
`account_deletion_guards`, plus per-user `media_deletion_locks`. All inherit deny-all direct-client Rules and are covered
by mandatory Emulator tests. These are API-level transactional adapters, not new
application repository ports. See [Private R2 media](r2-media.md) for DTOs,
claim/fencing semantics, atomic photo/session/scene publication, and durable purge
inventory. Project documents serialize competing publication; storage operations
never run inside retryable Firestore transaction callbacks.

Hosted user presets now record `ownerUserId` and use a principal-scoped repository.
System presets remain shared. Legacy ownerless private presets are excluded from
hosted private access and preserved during account purge because ownership cannot
be established safely. The principal bootstrap checks account deletion guards in
the same transaction as auto-provisioning. No local-data migration is introduced.
