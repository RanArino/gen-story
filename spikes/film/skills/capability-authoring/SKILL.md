---
name: capability-authoring
description: Author a quarantined film-spike Capability when existing Recipes and catalog Capabilities cannot express the requested look, stopping for operator approvals and independent review.
---

# Capability authoring

This is an agent-neutral repository workflow, not a registered editor Skill. Run CLI
operations from `spikes/film/` using `pnpm cli` in place of `film-spike` below.

## Inputs and boundaries

Obtain the desired visual behavior, candidate id and exact version, target Recipe and
Treatment, Chapters, representative fixture cases, parameter bounds, fallback, license,
and provenance. For a resumed candidate, read its request, saved reports, and approval
references before deciding which gate is next. Never treat an earlier version's approval
as authorization for changed bytes.

Read `spikes/film/src/`, `schemas/`, `fixtures/`, and `.state/registry/` (read-only).
Read the selected candidate and its evidence to resume. Direct author edits may write only
`.state/quarantine/capabilities/<candidate>/` and `out/evidence/`. Never edit the registry,
approval records, trusted runner, SDK, compiler, contracts, or renderer. Service operations
own their documented output locations, including `out/candidates/` evidence and review
records; these are not additional roots for direct edits. Registry promotion is an operator
handoff, outside this authoring workflow's write scope.

## Catalog-first decision

1. Inspect the existing Recipe fixtures. Prefer a Recipe parameter change or a composition
   of existing slots. Use `film-spike catalog search <query>` and
   `film-spike catalog inspect <id> <version>` to check exact promoted Capabilities.
2. If existing Capabilities suffice, propose `film-spike recipe fork <id> <revision> --as <org.local.id>`
   in dry-run mode and hand the Recipe change back to the user. Do not create executable code.
3. Only if the catalog cannot express the behavior, prepare a Capability Request with
   catalog attempts and the reason composition is insufficient. Validate it using
   `film-spike validate request <request.json>`. Save the request and command transcript
   under `out/evidence/`.
4. A new painter primitive, Capability kind, permission, or renderer change returns the
   work to an architecture decision immediately. Do not enlarge this workflow to implement it.

## Approval stops and gates

At every stop, print the exact operator command, subject, full digest, and confirmation
(the first eight hex characters after `sha256:`). Wait for the operator's recorded approval
id; never execute `approve`, script its input, fake a TTY, or create approval records directly.
Use the operator command template `pnpm cli approve <kind> <sha256:digest> --subject <id@version>`.
Existing authoring/evidence writes (Recipe fork, static checks, fallback compilation,
font quarantine/inspection, ordinary compilation, contact sheets, and review records)
do not gain extra approval gates. Tool calls still default to dry run; an applied static
check requires its existing approved request receipt.

An approval permits only the matching operation and bytes. If inputs change, show the new
target and stop again. Unrelated work can continue while waiting.

1. **Request stop.** Present the validated request digest before scaffolding or authoring.
   After the operator supplies the request approval id, use
   `film-spike candidate scaffold <request.json> --approval <id> --apply`.
   Author only the candidate manifest and implementation against the existing SDK.
2. Run `film-spike candidate static-check <candidate>` without importing candidate code.
   Inspect `static.json` and `source.diff`. Run
   `film-spike candidate compile <candidate> --treatment <file> --chapters <file>`
   to check compatibility and the reduced-motion and forced-Level-0 fallback paths.
   **Execution stop.** Present the execution digest and source diff before any candidate
   runtime or painter evidence. Static success is not execution authorization.
3. With matching execution approval, use
   `film-spike candidate run <candidate> --approval <id> --apply`, then
   `film-spike candidate evidence <candidate> --approval <id> --apply`.
   Inspect the deterministic runtime report, budgets, fixture coverage, contact sheet,
   and short clip. Do not re-render existing films as part of this workflow.
4. Use `film-spike candidate promotion-target <candidate>` to obtain the exact review
   and promotion digest. Request review from someone other than the candidate author;
   never invent an accepted review. Record only the supplied review with
   `film-spike review record <digest> --subject <id@version> --reviewer <name> --verdict <accept|reject> --notes <text>`.
   **Promotion stop.** Present the exact promotion command and confirmation after an
   accepted review of the same target. Stop here; this walkthrough does not promote.
   The operator's later handoff is `film-spike registry promote <candidate> --approval <id> --apply`.

## Retry limits and evidence

Allow at most three static-check iterations and two runtime iterations per task, then
return the failures to the user. Every changed execution target needs a new approval;
retry limits never authorize bypassing a gate. Stop immediately on an architecture trigger.

Retain the request and catalog rationale, manifest and exact source diff, static report,
fallback compile report, execution target and approval reference, all deterministic fixture
results and resource measurements, painter clip and contact sheet, independent review,
and promotion target. Keep a CLI transcript under `out/evidence/skill-walkthrough.md`
with actual commands, outcomes, each approval stop and confirmation, and separately
attributed operator actions. Never describe an unexecuted command as executed. A resumed
walkthrough identifies the previously completed request gate and starts at the next gate.

If historical replay is in scope, use `film-spike replay <plan> --treatment <file> --chapters <file>`
to verify the exact pinned versions without changing the Plan or re-rendering the film.
