# Private hosted deletion worker

HP-4.4 and HP-5.2a are complete against a **Docker simulation**: the Firestore Emulator, an S3-compatible container standing in for R2, the deletion worker running as a container, a local delivery/retry queue standing in for Cloud Tasks, repair invoked directly in place of Cloud Scheduler, and RS256-signed test tokens. **Real-cloud acceptance has not been performed.** It is deferred to the deployment milestone and listed below as unverified. This runbook's cloud sections are a deployment proposal, not deployment authorization; obtain separate approval for provisioning, IAM changes, image publication, deployment, and irreversible deletion of synthetic fixtures. Production is outside this procedure.

## Execution contract

`apps/api/src/deletion-worker.ts` starts only the deletion worker. It does not start the public API, local routes, image generation, or preprocessing. The full hosted API remains fail closed. Cloud Run authentication and application signature verification both apply. The application validates Google's signature, exact issuer/audience, numeric subject, verified email, expiration and issue time; queue headers provide no authority. Task and Scheduler callers must be different service accounts.

| Endpoint                                        | Caller                                       | Body                                                           | Result                                                        |
| ----------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------- |
| `POST /internal/tasks/work`                     | Exact task caller                            | `{ "workType": "media_deletion", "workId": "<persisted-id>" }` | 204 completed/canceled/missing; 503 busy/deferred/interrupted |
| `POST /internal/tasks/deletion-dispatch/repair` | Exact Scheduler caller                       | `{}`                                                           | 204 sweep completed; 503 interrupted/yielded                  |
| `GET /health`                                   | Cloud Run still controls external invocation | None                                                           | 200                                                           |

Extra body fields and arbitrary paths are rejected. Authentication precedes body processing and Firestore access. Logs contain route, status, sanitized outcome and duration, never bearer tokens or object keys.

Scheduling persists recovery intent before attempting enqueue. Dispatch stores a deterministic task name per record/generation, a fenced dispatch lease and enqueue status. Failed or uncertain enqueue is repaired from persisted records. A missing enqueued task advances the generation; three automatic generations are allowed, then `dispatch_exhausted` requires trusted operator repair. Restored or completed work is acknowledged without deletion. Each task has ten attempts with 10–300 second backoff. Worker execution yields at 240 seconds, before the 300-second service/task deadline.

Recovery remains seven days. Claims wait for issued upload capabilities, processing settlement and pre-existing running jobs. Per-user locks serialize account/project purges; claim tokens fence heartbeats, checkpoints, parent removal, final cleanup and release. Durable pages retain ownership links after parent removal. Object progress and finalization survive ambiguous commits. Application writes re-read deletion guards in their write transaction. Completion retains a terminal deletion receipt; account completion also retains the minimal purge guard, preventing principal reprovisioning. Shared organizations, system presets, and legacy ownerless private presets remain outside a user's purge because they cannot be safely attributed.

## Inputs and resource proposal

Use `apps/api/.env.example` as the only local environment template. Missing values fail startup. Supply the approved Cloudflare account ID, exact browser origins, staging-only bucket credentials through pinned Secret Manager versions, and an immutable worker image digest. Never put credentials in commands, documentation or task bodies. Use attached service accounts/ADC; service-account key files are rejected.

| Resource              | Proposed staging value                                                   |
| --------------------- | ------------------------------------------------------------------------ |
| Project / region      | `gen-story-496911` / `asia-northeast1`                                   |
| Firestore / R2        | Existing `gen-story-staging` / `gen-story-staging-media`                 |
| Cloud Run service     | `gen-story-staging-deletion-worker`                                      |
| Worker identity       | `gs-staging-deletion-worker@gen-story-496911.iam.gserviceaccount.com`    |
| Task caller           | `gs-staging-task-caller@gen-story-496911.iam.gserviceaccount.com`        |
| Scheduler caller      | `gs-staging-delete-scheduler@gen-story-496911.iam.gserviceaccount.com`   |
| Queue / Scheduler job | `gen-story-staging-deletions` / `gen-story-staging-deletion-repair`      |
| Image repository      | Approved existing repository, or separately approved `gen-story-staging` |

Inspect existing resources and IAM before creating or changing anything. Obtain the project number and each caller's numeric `uniqueId` with read-only wrapper commands:

```sh
pnpm gcloud projects describe gen-story-496911 --format='value(projectNumber)'
pnpm gcloud iam service-accounts describe gs-staging-task-caller@gen-story-496911.iam.gserviceaccount.com --format='value(uniqueId)'
pnpm gcloud iam service-accounts describe gs-staging-delete-scheduler@gen-story-496911.iam.gserviceaccount.com --format='value(uniqueId)'
```

Set `GEN_STORY_TASK_WORKER_AUDIENCE` to the exact deterministic origin `https://gen-story-staging-deletion-worker-PROJECT_NUMBER.asia-northeast1.run.app`, without a trailing slash. Confirm the origin on the deployed service before queue delivery. This avoids a bootstrap deployment with an invented audience. Use the same origin for task and Scheduler OIDC tokens. See [Cloud Run service URLs](https://docs.cloud.google.com/run/docs/triggering/https-request).

Required IAM scope: worker `roles/datastore.user` conditioned to `resource.name == "projects/gen-story-496911/databases/gen-story-staging"`; queue-scoped `roles/cloudtasks.enqueuer` and `roles/cloudtasks.viewer`; `roles/iam.serviceAccountUser` on the task caller; secret accessor on only the two approved R2 secrets. Caller and Scheduler receive `roles/run.invoker` only on this worker. Keep Cloud Tasks/Scheduler service-agent roles attached to their Google-managed service agents. Do not grant owner/editor or project-wide token creator. Confirm the worker cannot read production Firestore or production secrets through the SDK. Database conditions follow [Firestore per-database IAM](https://docs.cloud.google.com/firestore/native/docs/manage-databases). An example proposed binding is:

```sh
pnpm gcloud projects add-iam-policy-binding gen-story-496911 \
  --member=serviceAccount:gs-staging-deletion-worker@gen-story-496911.iam.gserviceaccount.com \
  --role=roles/datastore.user \
  --condition='expression=resource.name=="projects/gen-story-496911/databases/gen-story-staging",title=staging-deletion-database'
```

## Build and approved deployment

Local build is reversible and requires no cloud operations:

```sh
docker build -t gen-story-deletion-worker:hp44 -f apps/api/deletion-worker.Dockerfile .
docker run --rm --network none gen-story-deletion-worker:hp44
```

The second command must exit nonzero because required configuration is absent. The image runs as the unprivileged `node` user; the Docker-specific ignore file excludes environment files and tests. Publish only after reviewing the image and approving the artifact destination. Record its registry digest rather than deploy a mutable tag.

After approval, configure the queue:

```sh
pnpm gcloud tasks queues create gen-story-staging-deletions --location=asia-northeast1 \
  --max-attempts=10 --max-retry-duration=0s --min-backoff=10s --max-backoff=300s \
  --max-doublings=5 --max-concurrent-dispatches=1 --max-dispatches-per-second=1 \
  --log-sampling-ratio=1
```

If the queue already exists, inspect it and use `update` for this exact approved configuration. Pause it during setup. Deploy with the reviewed digest and approved nonsecret environment YAML stored outside the repository. The YAML contains every deletion worker variable from the template, `FIREBASE_PROJECT_ID`, `FIRESTORE_DATABASE_ID`, R2 account/bucket, and both callers' emails/subjects. Browser CORS origins are not required by this deletion-only worker. Credentials use secret references:

```sh
pnpm gcloud run deploy gen-story-staging-deletion-worker --region=asia-northeast1 \
  --image="$DELETION_IMAGE_DIGEST" \
  --service-account=gs-staging-deletion-worker@gen-story-496911.iam.gserviceaccount.com \
  --ingress=internal --no-allow-unauthenticated --timeout=300s \
  --concurrency=1 --max-instances=2 --cpu=1 --memory=512Mi \
  --env-vars-file="$DELETION_ENV_YAML" \
  --set-secrets="R2_ACCESS_KEY_ID=$DELETION_R2_KEY_SECRET:VERSION,R2_SECRET_ACCESS_KEY=$DELETION_R2_SECRET:VERSION"
```

These shell variables are operator-supplied reviewed references, not literal defaults; replace `VERSION` with pinned versions. Configure invoker bindings and check ingress/IAM before resuming the queue. Cloud Tasks and Scheduler must be in the same project and use the default run.app origin for [internal ingress recognition](https://docs.cloud.google.com/run/docs/securing/ingress).

```sh
pnpm gcloud scheduler jobs create http gen-story-staging-deletion-repair \
  --location=asia-northeast1 --schedule='*/5 * * * *' --time-zone=UTC \
  --uri="$DELETION_WORKER_AUDIENCE/internal/tasks/deletion-dispatch/repair" \
  --http-method=POST --headers=Content-Type=application/json --message-body='{}' \
  --oidc-service-account-email=gs-staging-delete-scheduler@gen-story-496911.iam.gserviceaccount.com \
  --oidc-token-audience="$DELETION_WORKER_AUDIENCE" --attempt-deadline=300s \
  --max-retry-attempts=3 --min-backoff=10s --max-backoff=300s --max-retry-duration=900s
```

Queue retry semantics are described in [Cloud Tasks queue configuration](https://docs.cloud.google.com/tasks/docs/configuring-queues). Verify actual limits and the Scheduler's next run; task creation is not execution evidence.

## Trusted operations

With approved staging ADC and the explicit staging environment loaded:

```sh
pnpm --filter @gen-story/api media:repair-deletions
pnpm --filter @gen-story/api media:repair-deletions --retry-exhausted PERSISTED_DELETION_ID
pnpm --filter @gen-story/api media:detect-orphans
```

Manual exhausted retry resets the bounded generation budget only for an existing exhausted record. It never invents deletion intent. Orphan reporting exposes list/HEAD only and accepts no mutation flags; prefer read-only staging credentials for that command. Inspect unresolved findings rather than interpreting them as deletion approval. Account deletion remains a trusted repository operation, without a new public account-purge endpoint.

## Approval package (staging, prepared 2026-10-10)

> **Not part of the current completion criteria.** This package is the starting point for the deployment milestone's real-cloud acceptance. Nothing in it has been executed.

Read-only inventory of `gen-story-496911` (project number `1000015687935`): the Cloud Run, Cloud Tasks, Artifact Registry, Secret Manager, Cloud Build and IAM APIs are enabled; **Cloud Scheduler is not enabled**. No Cloud Run service, queue, Artifact Registry repository, secret, or worker/caller/Scheduler service account exists. Firestore contains `gen-story-staging` and `gen-story-production`. Nothing below has been executed.

Fixed values once approved:

| Item                   | Value                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker audience        | `https://gen-story-staging-deletion-worker-1000015687935.asia-northeast1.run.app`                                                           |
| Registry               | Docker repository `gen-story-staging` in `asia-northeast1`; images `deletion-worker` (normal) and `deletion-worker-fault` (acceptance only) |
| Image reference        | `asia-northeast1-docker.pkg.dev/gen-story-496911/gen-story-staging/deletion-worker@sha256:<digest recorded from the push result>`           |
| R2 secrets             | `gen-story-staging-r2-access-key-id` and `gen-story-staging-r2-secret-access-key`, referenced as `:1` after the operator creates version 1  |
| Caller identity inputs | Emails in the resource table; numeric subjects from `iam service-accounts describe ... --format='value(uniqueId)'` after creation           |

Operator-supplied inputs (never sent through chat or committed): the 32-hex `R2_ACCOUNT_ID`, confirmation that bucket `gen-story-staging-media` exists, and the staging-scoped R2 token stored by the operator directly into the two secrets above. The approved nonsecret environment YAML is stored outside the repository.

Operations requiring approval, in order:

1. Enable `cloudscheduler.googleapis.com`.
2. Create the three service accounts listed above; read their numeric `uniqueId` values.
3. Create the IAM bindings described in this document, including the conditional Firestore binding, queue-scoped Cloud Tasks roles, secret accessor on only the two secrets, and `roles/run.invoker` on the worker for the two callers.
4. Create the Docker repository, build the image from `apps/api/deletion-worker.Dockerfile`, push it, and record the digest.
5. Create the queue paused, deploy the worker by digest, verify ingress and IAM, then resume the queue.
6. Create the Scheduler job and verify its next run.
7. Seed the synthetic fixture namespace and run the acceptance checks below.

The acceptance fixture namespace is `m4-<runId>`: two fresh users (`owner`, `other`), each with projects, so that account and project purges can overlap. The `owner` fixture holds at least 101 documents in one manifest-covered collection family, 201 or more objects below one owned prefix, one nested manifest, one linked child without `projectId`, one expired temporary object older than 24 hours, and one active upload session. The `other` fixture is a byte-for-byte comparison baseline and is never targeted. Every created document path and object key is recorded in a manifest kept with the redacted evidence.

Worker interruption uses a separate `deletion-worker-fault` image containing a preload that exits the process once after the first persisted object checkpoint, and only when the task's deletion ID equals the single `GEN_STORY_FAULT_DELETION_ID` value. It is never part of the normal image. After the resume check, redeploy the normal digest and confirm the effective image, the queue configuration and the Scheduler job.

Rollback: pause the Scheduler job and the queue, then `pnpm gcloud run services update-traffic gen-story-staging-deletion-worker --region=asia-northeast1 --to-revisions=<recorded previous revision>=100`. Only fixture resources created under `m4-<runId>`, the fault image, and the contract's synthetic data may be cleaned up; shared resources, manifests, guards and the other owner's fixture stay.

## Docker acceptance (completion criteria)

Run the Firestore Emulator, then the serial acceptance suite. The suite builds the production worker image and an acceptance layer, starts an S3-compatible container (SeaweedFS; MinIO's public images are no longer available) and the worker, and removes both afterwards. Docker, the Emulator on loopback with `GCLOUD_PROJECT=demo-gen-story`, and no skipped cases are required.

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-gen-story pnpm test:deletion:docker
```

The test-only worker entry (`apps/api/src/test-support/docker-deletion/`) reuses the production task handler, authenticator, dispatch, repository and executor. It replaces only the Google verifier with an RS256 public-key verifier, Cloud Tasks with a local queue, and the R2 endpoint with the S3 container. It can exit once after a chosen number of object deletes. The acceptance layer is never part of the normal image.

| Scenario         | Evidence                                                                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recovery period  | Early delivery returns 503 with no data or object change; after restoration, replay returns 204 and nothing is deleted.                                                                                                                                   |
| Delivery deletes | The local queue delivers the due task; project records and objects are removed and foreign fixtures are unchanged.                                                                                                                                        |
| Scale            | 105 flat records plus a linked child without `projectId` and 201 objects under one prefix (a full 200-key page plus one).                                                                                                                                 |
| Interruption     | The container exits after a persisted checkpoint; restart and redelivery resume and complete.                                                                                                                                                             |
| Repair           | A removed task is recreated by the repair endpoint using the Scheduler identity.                                                                                                                                                                          |
| Exhaustion       | Three generations are used, repair then stops, and the trusted retry creates the next generation and completes.                                                                                                                                           |
| Competing purges | Account and project purges for one user both complete; the other owner is unchanged.                                                                                                                                                                      |
| Account guard    | Writes and reprovisioning are rejected before and after the purge; the guard document remains.                                                                                                                                                            |
| Authentication   | Absent, malformed, tampered, other-key, wrong audience/subject/email, unverified, expired, mis-scoped, queue-header-only, extra-field and wrong-path requests are rejected with the Firestore and object state unchanged; the exact identity is accepted. |
| Orphan report    | Firestore documents and object metadata are identical before and after the report.                                                                                                                                                                        |

## Deferred real-cloud acceptance (unverified)

These checks are **not verified** and are not part of the HP-4.4/HP-5.2a completion criteria. They move to the deployment milestone: real Cloud Tasks delivery and retry, real Cloud Scheduler invocation, Google-signed identity tokens, real IAM and Cloud Run ingress, and R2 page boundaries (more than 200 objects) on the real service. Run them only after approving the exact synthetic fixture namespace and operations. Keep existing staging user data out of the test, preserve a second owner's fixture for comparison, do not reset the staging database, and never shorten the production seven-day policy.

1. Schedule project deletion through the repository with the dispatch adapter. Confirm persisted intent and the real queue task. Before the recovery boundary, submit authenticated work and prove zero record/object deletions; restore, edit and save a scene, then replay the old task and confirm cancellation.
2. Reject absent, expired, tampered, wrong-audience, wrong-subject and wrong-email tokens, the Scheduler identity on the work endpoint, the task identity on the repair endpoint, arbitrary queue headers and extra body fields. Demonstrate no database changes. Test both Cloud Run IAM and application OIDC; a mocked verifier is insufficient evidence.
3. For an eligible project, observe actual Cloud Tasks delivery, paged object removal, all flat record removal and 204 completion. Interrupt a worker revision after persisted progress under an approved staging-only fault procedure; restore service and prove a later delivery resumes. Replay completed work and verify no new mutation. Inject a late linked child through trusted fixture tooling and prove it is captured on retry.
4. Simulate enqueue failure/uncertain response, remove an approved fixture's task, and invoke actual Scheduler repair. Confirm deterministic deduplication, next-generation recreation and eventual execution. Exhaust three generations for a fixture, verify persisted `dispatch_exhausted`, then run the trusted exhausted-retry command and complete it.
5. Schedule account deletion with multiple projects and overlapping project work. Verify serialization, uploaded capability/processing settlement, account guard rejection of new writes and principal provisioning, every owned prefix/document removed, shared/system and other owner's fixtures unchanged, and minimal `{ state: "purged" }` guard retained.
6. Snapshot all fixture documents and object metadata, run the readonly orphan command across more than one page, and compare snapshots exactly. Include missing references, expired temporaries, unreferenced finalized objects, recoverable and actively purging work. No mutations are permitted.

Save redacted evidence: image digest/revision, effective IAM and resource configuration, fixture path manifest, actual task names/generations, sanitized task/repair outcomes, before/after counts and preserved foreign fixtures, restoration browser evidence, and nonmutation comparisons. These checks close the deployment milestone's deletion acceptance. HP-5.2 generation and HP-5.3 preprocessing remain separate.

## Monitoring and rollback

Inspect queue failed attempts, Scheduler failures and worker 401/503 outcomes. Alert on `dispatch_exhausted`, repeated `dispatch_interrupted`, expired purge leases without progress and overdue nonterminal deletion records. Counts alone do not prove orphan absence. Never log credentials or user media contents.

Pause the deletion queue and Scheduler before rollback, select the recorded previous worker revision, verify identical environment/IAM, and resume only after checking persisted claims. Do not clear manifests, guards, checkpoints or locks. Physical deletions cannot be undone; rollback preserves durable progress and stops additional delivery, while seven-day recovery applies only before irreversible claim.
