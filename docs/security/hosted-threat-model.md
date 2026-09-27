# Hosted Gen Story threat model

Status: Approved for staged implementation
Owner: Gen Story operator
Last reviewed: 2026-09-27

## Scope

This threat model covers the invited-user hosted composition described by
`internal/plans/active/20260926-gcp-firestore-r2-hosted-service.md`. It does not
change the local SQLite, local-file, or local-agent development composition.
The hosted service does not execute Codex or Claude Code and does not receive
their login state.

The initial cohort is approximately one hundred invited users. Staging and
production use environment-specific resource names, identities, queues,
secrets, and configuration inside the standalone Google Cloud project
`gen-story-496911`. Regional Google Cloud resources use `asia-northeast1`.

## Assets and security objectives

| Asset | Classification | Required property |
| --- | --- | --- |
| Original photos and generated media | Highly sensitive user content | Confidentiality, integrity, complete deletion |
| Project/storyboard metadata | Private user content | Tenant isolation, integrity, availability |
| Browser sessions and Firebase tokens | Authentication secret | Short lifetime, revocation, no logging |
| MCP authorization codes and refresh tokens | Authentication secret | Hash at rest, rotation, replay detection |
| R2, provider, and runtime credentials | Infrastructure secret | Server-only, least privilege, rotation |
| Proposals and approvals | Security-sensitive workflow state | Provenance, revision checks, human authorization |
| Job and task state | Operational state | Idempotence, authenticated delivery, bounded retry |
| Security audit events | Sensitive operational metadata | Integrity, minimization, retention, operator access |
| Budget and quota state | Operational control | Bounded use, detection, kill switches |

## Actors and trust assumptions

| Actor | Trust position |
| --- | --- |
| Invited organizer | Authenticated but not trusted to name another tenant's resources |
| Unauthenticated internet client | Untrusted |
| Codex or Claude Code client | Untrusted client software with explicitly delegated MCP scopes |
| Model output and tool arguments | Untrusted data, never authorization |
| Uploaded media and project text | Untrusted content that may contain malicious instructions or malformed bytes |
| Cloud Tasks caller | Trusted only after Google OIDC issuer, subject, audience, and age validation |
| Cloud Run API and worker identities | Trusted only for their assigned environment and least-privilege roles |
| Operator | Privileged human; production and destructive actions require meaningful review |
| Third-party packages and MCP/OAuth libraries | Supply-chain dependencies requiring version pinning and audit |

## Components and trust boundaries

1. The browser crosses the public HTTPS boundary to the Cloud Run web and API
   services. Origin, session, CSRF, content type, size, and schema checks apply.
2. The API crosses the identity boundary to Firebase Authentication / Identity
   Platform. A verified identity is converted to a request-scoped principal.
3. The API and worker cross the persistence boundary to Firestore. Admin SDK
   access bypasses Firestore Rules, so repository authorization remains
   mandatory.
4. The browser crosses the storage boundary directly to private R2 only through
   one-operation, one-object, short-lived presigned URLs.
5. Cloud Tasks crosses the private worker boundary with a Google-signed OIDC
   token and an ID-only task payload.
6. A user-owned agent client crosses the OAuth and MCP boundary. MCP tokens have
   a distinct audience and read/propose-only scopes.
7. The API or worker crosses model-provider boundaries only for separately
   configured, explicitly funded operations. Secrets and authority never enter
   model context.
8. Operators cross the cloud administration boundary through audited human
   credentials. User-managed service-account keys are not used.

## Data flows

### Browser session and REST

The browser authenticates with Identity Platform, exchanges the verified login
for a secure host-only session, and sends same-site requests to the API. The API
validates the session, exact origin, CSRF proof for mutations, input bounds, and
tenant ownership. Responses expose explicit DTOs only. Missing and foreign
tenant resources share the same outward `404` response.

### Direct media upload

The authenticated browser requests an upload grant. The API creates an opaque
temporary key bound to the user, project, operation, content type, checksum,
size ceiling, and expiry. The browser uploads directly to private R2. Completion
does not trust the browser assertion: the API checks the durable upload session
and the worker verifies object metadata and decoded-media limits before a photo
becomes visible. Display and agent access use re-encoded metadata-stripped
derivatives.

### Asynchronous work

The API persists a queued work record before dispatch. Cloud Tasks sends only
the work type and deterministic ID to a private worker. The worker validates
OIDC identity and transactionally claims queued work. Duplicate or terminal
delivery is a successful no-op. Cancellation is checked before output commit,
and orphaned output is removed or reported.

### External MCP

The agent client discovers the protected resource and authorization server,
uses authorization code with PKCE, and obtains a short-lived audience-bound
token after user consent. The server revalidates token signature, issuer,
audience, expiry, revocation, scope, user status, and current project ownership
for every tool call. The hosted tool registry contains only explicit read and
proposal operations. Approval and apply remain first-party browser actions.

### Deletion

Deletion first revokes access, then removes every known R2 object and Firestore
descendant in bounded resumable phases, and finally removes the parent. A retry
continues from durable phase markers. No prefix is derived solely from request
input.

## Threat register

| ID | Threat | Preventive controls | Detection and test | Owner milestone | Residual decision |
| --- | --- | --- | --- | --- | --- |
| T-01 | Tenant IDOR and guessed identifiers | Request-scoped principal; repository ownership checks; foreign and missing resources return the same response | Two-user list/read/write/signed-URL tests | 1-4 | No cross-tenant read or write accepted |
| T-02 | Session theft, fixation, or stale access | Secure HttpOnly host-only cookies; bounded idle/absolute lifetime; rotation; revocation; recent-auth checks | Login/logout/recovery/disablement tests and auth-failure alerts | 2 | Public rollout blocked until complete |
| T-03 | CSRF and malicious origins | Exact origin allowlist, `Vary: Origin`, credentialed CORS only for approved origins, CSRF token on mutations | Wrong-origin, missing-token, and preflight tests | 0, 2 | No wildcard origin |
| T-04 | OAuth mix-up, redirect abuse, downgrade, or replay | Pinned library; exact redirect URI; PKCE S256; resource/audience binding; hashed codes; rotated refresh tokens; revocation | Compatibility and abuse suite with real clients | 6 | Milestone stops if standard flow is incompatible |
| T-05 | Forged or replayed Cloud Task | Exact OIDC issuer, subject, audience, age; private worker; transactional deterministic claim | Forgery, duplicate delivery, and worker-termination tests | 5 | Duplicate delivery must be harmless |
| T-06 | Presigned URL leakage or key substitution | Private bucket; opaque server key; exact operation/header/checksum; short expiry; no persistence or logs | Reuse, mismatch, foreign-prefix, and expiry tests | 4 | Existing URL remains usable only until bounded expiry |
| T-07 | Malformed media or decompression bomb | Encoded-byte, magic-byte, dimension, pixel, frame, memory, CPU, and time limits; isolated worker; derivative re-encoding | Hostile image corpus and resource-limit tests | 0, 4 | Originals never render inline before validation |
| T-08 | Prompt injection and confused deputy | Treat content/output as data; no authority in prompts; fixed tool registry; server authorization; schema validation; human approval | Injection fixtures cannot widen tool, scope, project, URL, or storage access | 0, 6 | Classifier is optional defense, never the authorization control |
| T-09 | Excessive agent agency | External tools are read/propose only; no shell, filesystem, generic HTTP, database, approval, apply, or discovery tools | Tool allowlist and negative authorization tests | 6 | Any new tool requires control-matrix review |
| T-10 | Input/resource exhaustion | Per-route byte limits; bounded strings, arrays, objects, nesting; request/header/idle timeouts; quotas and rate limits | Wrong-type, oversize, slow-body, rate-limit, and budget tests | 0, 6, 8 | Limits change only with evidence |
| T-11 | Sensitive log or audit leakage | Central field allowlist; path without query; identifiers/hashes/outcomes only; sanitized errors | Canary-secret log tests and retention review | 0, 6, 8 | Raw prompts, values, tokens, URLs, and images prohibited |
| T-12 | Vulnerable dependency or supply-chain compromise | Direct supported upgrades; lockfile; production audit; SBOM; pinned OAuth/client evidence | CI audit and SBOM diff | 0, 6 | No unaccepted reachable Critical/High advisory |
| T-13 | Credential exfiltration | Attached keyless service identities; Secret Manager/KMS; no provider login state; secrets excluded from prompts and logs | IAM inventory, secret-canary tests, rotation exercise | 6, 8 | No user-managed service-account keys |
| T-14 | Privilege escalation across environments | Environment-specific identities and resources; least privilege; no default Compute identity | IAM diff and negative invocation tests | 8 | Same-project quota/blast-radius limitation accepted by design |
| T-15 | Irreversible deletion or partial cleanup | Human confirmation; durable deletion phases; bounded enumeration; idempotent retry; verified ownership | Complete and repeated deletion transcript | 4, 8 | Automatic orphan deletion disabled until detector is proven |
| T-16 | Runaway cost or infinite work | Finite retries, concurrency, request/tool budgets, per-user/project quotas, billing alerts, independent kill switches | Budget dashboard and kill-switch exercises | 5, 6, 8 | Free tier is not treated as an SLA |
| T-17 | Local-only surface exposed publicly | Separate route registries; hosted startup cannot register `/files/*`, local MCP, seeded principal, debug, or CLI routes | Hosted composition contract tests | 0, 1 | Hosted mode fails closed rather than falling back |
| T-18 | Browser content injection/clickjacking | Text-only rendering, URL scheme allowlist, CSP, frame denial, nosniff, referrer and permissions policy | Header tests and browser abuse cases | 0, 7 | CSP exceptions require review |
| T-19 | Availability failure in Firestore/R2/provider | Short retryable errors; persisted work remains unchanged; idempotent retry; scale and timeout bounds | Fault injection and recovery tests | 3-8 | No cross-service distributed transaction assumed |
| T-20 | Operator error or compromised privileged account | Human ownership, staged rollout, read-before-write commands, redacted evidence, rotation and incident runbook | Staging rehearsal and audit-log review | 8 | Production mutation remains an explicit operator decision |

## Security invariants

- Authorization comes only from validated identity, token scope/audience, and
  current persisted ownership.
- User, project, provider, object key, or destination fields supplied by a
  client are never authority by themselves.
- The hosted agent surface cannot approve or apply a proposal.
- A failed security dependency fails closed; there is no anonymous or static
  bearer-token fallback.
- A task, upload completion, deletion, or proposal retry cannot duplicate the
  terminal business result.
- Secret or private content is not accepted in logs as an observability trade.

## Review and release requirement

This document requires an operator review and a lightweight external review of
the staged public endpoints before real customer photos are accepted. Every
open or partially implemented control is tracked in
`docs/security/security-control-matrix.md`; a checked-in document alone is not
evidence that a runtime control works.
