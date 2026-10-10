# Hosted security control matrix

Status: Approved for staged implementation; control implementation remains in progress
Source: `internal/requirements/agent-security-cheetsheet.md`
Last updated: 2026-10-08

## How to read this matrix

Every checklist bullet in the source is covered by exactly one source range
below. A range is used where adjacent bullets form one control family and share
the same applicability, implementation owner, and evidence. `Implemented`
means executable evidence exists. `Planned` is a release-blocking task in the
named milestone. `N/A` requires a concrete product-boundary reason and must be
revisited if that boundary changes.

## Control coverage

| ID | Source lines / control family | Applicability and disposition | Implementation or required evidence | Status |
| --- | --- | --- | --- | --- |
| ASC-01 | 1-36, design principles | Applicable | Least agency, explicit scopes, independent enforcement, bounded execution, human ownership | Planned across milestones |
| ASC-02 | 43-52, agent necessity | Applicable | Accepted architecture uses user-owned agents only for creative interpretation; deterministic APIs handle storage and mutation; no hosted multi-agent or Computer Use | Accepted design |
| ASC-03 | 76-107, agent threat enumeration | Applicable except email/PDF/RAG sources not present | Threats T-01 through T-20 in `hosted-threat-model.md`; absent sources remain N/A until introduced | Documented; tests planned |
| ASC-04 | 121-140, default-deny tool permissions | Applicable | Separate explicit hosted registry; read/propose only; server-side ownership and scope checks | Milestone 6 |
| ASC-05 | 176-185, capability scope | Applicable | Project/user/tenant/action/time/request/destination/cost scopes in tokens, grants, quotas, and server checks | Milestones 2, 4, 6, 8 |
| ASC-06 | 209-228, credentials | Applicable | Attached keyless GCP identities, Secret Manager/KMS, narrow OAuth, no `.env` or provider login state in model context | Partially implemented; milestones 6, 8 |
| ASC-07 | 244-258, runtime isolation | Worker subset applicable; agent-runtime subset N/A | Hosted service never executes an agent CLI; Cloud Run worker uses non-root container and finite CPU/RAM/time/process limits | Milestone 8 |
| ASC-08 | 276-288, network and egress | Applicable | No generic HTTP tool; validated R2/model destinations; request/upload limits; metadata/internal destinations unavailable to agent tools; egress logging is metadata-only | Milestones 4, 6, 8 |
| ASC-09 | 356-363, source-to-sink control | Applicable | Untrusted content cannot directly cause secret access, payment, destructive write, or a new external destination; separately funded generation is server policy | Milestones 0, 6 |
| ASC-10 | 381-396, prompt injection | Applicable; HTML/PDF/email/RAG cases currently N/A | Content/tool results are untrusted; fixed instruction hierarchy and tools; server checks; human approval; abuse fixtures | Milestone 6 |
| ASC-11 | 412-431, safe tool design | Applicable | Narrow typed schemas, bounds, authorization, idempotence, timeout/retry/rate limits, preview, audit identity and IDs | Partially implemented; milestones 5, 6 |
| ASC-12 | 451-482, tool risk classification | Applicable | Read/propose tools are low/medium risk; approval/apply/delete/admin remain outside external registry; changes require review | Milestone 6 |
| ASC-13 | 489-502, approval-required actions | Applicable subset | Proposal apply, deletion, production deployment, permission/credential changes, publication, disclosure and external transfer remain human-controlled; payment/email/legal are N/A | Milestones 4, 6, 8 |
| ASC-14 | 537-545, meaningful approval UX | Applicable | Proposal cards show exact target, field diff, rationale, provenance, reversibility, and affected resource before apply | Milestone 7 |
| ASC-15 | 565-574, human control | Applicable | Cancel work, revoke token/connection, kill switches, inspect proposals; pause/resume applies only where durable state supports it | Milestones 5-8 |
| ASC-16 | 598-604, ask versus act | Applicable to agent UX | Material ambiguity or high-risk choice produces a proposal/question, never an automatic mutation | Milestones 6-7 |
| ASC-17 | 624-635, execution budgets | Applicable subset | Tool calls, retries, wall time, tokens, cost, external requests, writes and subprocesses bounded; email/financial amount N/A | Milestones 5, 6, 8 |
| ASC-18 | 649-659, fail closed | Applicable | Unknown identity/tenant/tool/destination, malformed input, failed signature/policy/approval reject without fallback | Partially implemented; milestones 2, 5, 6 |
| ASC-19 | 671-682, layered guardrails | Applicable | Transport, schema, intent/scope, tool authorization, human approval, output validation and monitoring; classifiers are supplementary | Milestones 0, 6, 8 |
| ASC-20 | 704-728, memory boundaries | Applicable | Project/conversation/purpose scope, bounded documents and retention; no cross-user or unlimited shared memory | Milestones 3, 6, 8 |
| ASC-21 | 735-758, sub-agent permission | N/A | Gen Story does not create or delegate to sub-agents in the hosted service | N/A; reopen if feature changes |
| ASC-22 | 763-791, MCP/connector supply chain | Applicable | Pinned SDK/OAuth library, explicit tools/scopes, validated metadata, no arbitrary server addition, versioned compatibility evidence | Milestone 6 |
| ASC-23 | 796-831, traceability | Applicable | Request/task/proposal/audit IDs, pseudonymous actor/client, policy outcome, duration and bounded hashes | Milestones 5, 6, 8 |
| ASC-24 | 832-850, audit integrity | Applicable | Agent has no audit mutation tool; runtime identity writes append-only events; operator retention and access review | Milestones 6, 8 |
| ASC-25 | 869-890, trajectory evaluation | Applicable | Evaluate intermediate tool choice, scope checks, proposal construction, refusal and final state, not only text output | Milestone 6 |
| ASC-26 | 891-914, repeated trials | Applicable | Run injection/authorization fixtures over repeated trials and retain rates, not one passing transcript | Milestones 6, 8 |
| ASC-27 | 925-941, multiple evaluation methods | Applicable | Deterministic tests, policy assertions, browser E2E, real-client transcripts, red-team cases and human review | Milestones 6, 8 |
| ASC-28 | 946-975, independent security eval | Applicable | Separate abuse suite covers exfiltration, scope widening, tool confusion, replay, cross-tenant and destructive attempts | Milestones 6, 8 |
| ASC-29 | 976-1010, misalignment and sabotage | Applicable | Goal drift, concealment, authority seeking, audit manipulation and destructive-output fixtures; system enforcement does not depend on cooperation | Milestone 6 |
| ASC-30 | 1019-1039, production monitoring | Applicable | Auth/replay/tenant/upload/task/rate/deletion alerts plus cost and service metrics | Milestone 8 |
| ASC-31 | 1040-1075, change management | Applicable | Dependency/tool/model/prompt/policy changes require audit, tests, version evidence, staged rollout and rollback | Milestones 0, 6, 8 |
| ASC-32 | 1076-1109, progressive autonomy | Applicable | First release is read/propose only; no path to self-approval; future authority requires a new accepted decision | Enforced by architecture |
| ASC-33 | 1110-1134, canary/shadow deployment | Applicable subset | Staging precedes invite-only production; OAuth compatibility gate and revision rollback; shadow execution only where it cannot cause external effects | Milestones 6, 8 |
| ASC-34 | 1139-1160, incident playbook | Applicable | Disable signup/upload/MCP refresh/paid generation/task dispatch independently; revoke/rotate/triage/notify/recover procedures | Milestone 8 |
| ASC-35 | 1161-1187, agent inventory | Applicable | Record client/library/model/tool versions, owner, scopes, data, environments, limits and last review | Milestones 6, 8 |
| ASC-36 | 1188-1206, human owner | Applicable | Gen Story operator owns release, access, incident and residual-risk decisions; agent is not the owner | Accepted governance |
| ASC-37 | 1211-1296, production minimum gate | Applicable | Every autonomy/access/environment/action/injection/data/observability/evaluation/operations/governance item must have executable staging evidence before real photos | Release blocker |
| ASC-38 | 1297-1349, ten-principle summary | Applicable duplicate summary | Covered by ASC-01 through ASC-37; it introduces no separate runtime control | Traced |

## Implemented evidence in this milestone

- Production dependency audit: `pnpm audit --prod --audit-level=high`
  reports no known vulnerability on 2026-10-08 after the post-merge remediation
  below. This is dated evidence, not a guarantee about future advisories.
- HTTP JSON inputs require a JSON media type, use a 256 KiB standard limit or
  an explicit 16 MiB local-photo limit, stop processing on overflow, and return
  distinct `400`, `413`, and `415` responses.
- High-risk request schemas reject unknown fields and bound identifiers, text,
  arrays, object field counts, and arbitrary JSON nesting.
- Request logs remove query strings before emission.
- Browser origins use an exact allowlist and are never reflected when denied.
- Foreign and missing tenant-owned resources use the same outward `404` shape.
- Web responses define CSP, frame denial, MIME-sniffing, referrer, permissions,
  and production-only HSTS policies.

## Dependency baseline

| Direct package              | Resolved requirement           | Security reason                                                                                                 |
| --------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `next`                      | `^16.3.8` (locked to `16.3.8`) | Fixes image-optimization SSRF, GHSA-cjq9-62q9-8jv4                                                              |
| `sharp`                     | `^0.35.5` (locked to `0.35.5`) | Includes the patched librsvg line, GHSA-wq5f-xc86-pv6w                                                          |
| `@google/genai`             | `^2.24.0`                      | Allows patched `ws` and `protobufjs` transitive versions                                                        |
| `@modelcontextprotocol/sdk` | `^1.31.0` (locked to `1.32.1`) | Fixes OAuth credential forwarding, GHSA-6qxp-vccf-f47h, and resolves compatible patched transitive dependencies |

### Post-merge audit remediation (2026-10-08)

[Security baseline run 37752771520](https://github.com/RanArino/gen-story/actions/runs/37752771520)
failed after PR #52 merged because the locked production graph had one Critical
and five High advisories (16 findings in total). The same failure was reproduced
locally before changes. CI's audit threshold and workflow remain unchanged.

In addition to the direct upgrades above, the lockfile resolves `proxy-addr`
`2.0.8` (GHSA-jqcg-44mw-7w3h) and `source-map-js` `1.2.2`
(GHSA-68fv-2mgg-jv7q). A parent-scoped root override selects
`@firebase/firestore>@grpc/grpc-js: 1.14.5` to address GHSA-m9gg-hp2v-232j.
The latest published Firestore browser SDK still declares `~1.9.0`, so an
in-range refresh cannot reach a patched version. Remove this override after an
upstream release declares a patched range and passes the same regression checks.
The existing `gaxios>uuid` override is preserved; unrelated direct dependencies
remain at their previous locked versions.

`pnpm install --frozen-lockfile` and `pnpm audit --prod --audit-level=high`
both exit zero locally. The latter reports no known vulnerabilities across all
severities. Remote CI still requires publishing the updated manifests and
lockfile; rerunning the original commit is not remediation. Hosted deployment
and the remaining security controls are not completed by this dependency fix.

There is no accepted Critical or High exception. Any future exception must name
the advisory, reachable path, compensating control, human owner, and expiry;
an expired exception blocks deployment.

## Remaining release blockers

Rows marked `Planned` or `Partially implemented` are not waived. Their named
milestones must add executable evidence before the staged production gate can
pass. The operator and external reviewer must sign off on the final residual
risk; this document does not self-approve a release.

## M4 isolated media evidence (2026-10-10)

Private R2 adapters, signed upload grants, durable sessions, bounded Linux image
processing, atomic publication, and browser URL isolation are implemented and
verified in isolated fixtures. Recoverable project/account purge and read-only
orphan reporting are directly exercised against the flat Firestore inventory.
The decoder enforces 512 MiB hard memory, no additional swap, one CPU, one frame,
40 million pixels, 10 MiB input/derivatives, and a 15-second termination deadline.
Owner/deletion checks and account provisioning guards prevent new access or
publication during recovery. Existing bearer read URLs last until expiry/deletion.
See [Private R2 media](../r2-media.md) for evidence boundaries and exact APIs.

This does not satisfy live R2 compatibility, real two-user hosted authentication,
HP-5.2a deletion-task delivery, HP-5.3 hosted preprocessing, or deployment approval.
Hosted startup remains disabled. No release control is waived by fixture success.
