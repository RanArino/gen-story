---
name: gen-story-creative-refinement
description: Reference for Gen Story's project-scoped MCP contract (AI photo analysis, tone, style preset, common prompt, story/worldview, negative prompt, character policy, and individual scenes). Not a supported way to refine a live project — the app's own embedded "AI refine" chat has a separate, independent implementation of this same workflow and does not read this file. Use only to understand or manually exercise the MCP tool surface (e.g. while developing Gen Story itself); never suggest attaching an external agent session to refine a real project.
---

# Gen Story creative refinement — MCP contract reference

This documents the project-scoped MCP tool surface Gen Story's application
layer exposes for creative-direction changes: read → discuss → propose →
operator approval in the app → apply.

**This is not a live product feature.** Gen Story's own embedded "AI refine"
chat panel implements this same read/propose/approve/apply workflow with its
own instructions (`apps/api/src/agent-chat/turn-input.ts`) and does not load
this file. An earlier plan (capability C, "external agent handoff") intended
to let an operator's own separate Codex/Claude Code terminal session drive
this MCP surface directly, with proposals surfacing in the app for approval;
that plan was withdrawn (2026-08-18) before a proposal from such a session
could be made visible anywhere in the UI. A proposal created outside an
active app chat conversation today is not shown anywhere in the app.

Keep this file as a reference for understanding or manually testing the MCP
tools (e.g. while developing Gen Story itself). Do not present it to an
operator as a way to refine their project — direct them to the app's chat
panel instead.

## Absolute rules

- **Never touch the database.** No SQL, no `sqlite3`, no reading or writing
  `data/gen-story.sqlite`, no editing repository files to change project data.
  Every read and write goes through an MCP tool.
- **Never write a field directly.** There is no update tool, by design. A change
  becomes real only through `propose_creative_direction_changes` →
  operator approval → `apply_approved_change_proposal`.
- **Never approve your own proposal.** Approval is the operator's action in the
  Gen Story UI (or its REST API). If you cannot find an approval, it has not
  happened — say so and wait.
- **One project per session.** Every tool acts on the project the session is
  attached to. There is no project argument; a different project needs a
  different session.
- **No paid image generation here.** Image generation is a separate,
  cost-labelled action in the product. Never fold it into a proposal.

## For an operator who wants to refine a project

Stop here and tell them to open the project in the Gen Story app and use its
"AI refine" chat panel. Do not attach to the MCP endpoint on their behalf —
any proposal you created that way would not appear anywhere in the app for
them to approve.

## For manual/developer use of the MCP surface

With the API running (`pnpm dev:api`, default port 4000), the tool surface is
reachable at `http://localhost:4000/api/mcp/projects/<projectId>` over
Streamable HTTP. This is the same endpoint the app's embedded chat uses
internally; connecting to it directly is for understanding or testing the
contract below, not for producing a proposal an operator will ever see.

## Semantic targets

Address fields by target object, not by column name or UI label. Call
`get_creative_direction` to get the exact `entityType`/`entityId`/`field`/
`revision` for each one — never construct a target from memory, since
`entityId` values (the storyboard and each scene) are project-specific.

| Reference | Target field | Notes |
| --- | --- | --- |
| `@photo-analysis` | `{ entityType: "project", field: "photoAnalysis" }` | |
| `@tone` | `{ entityType: "storyboard", field: "tone" }` | The operator-committed emotional direction. Emotion candidates from photo analysis are read-only input, not a separate writable field. |
| `@style-preset` | `{ entityType: "storyboard", field: "stylePresetId" }` | `get_creative_direction` also returns the valid style preset IDs; never invent one. |
| `@common-prompt` | `{ entityType: "storyboard", field: "commonPrompt" }` | Shared prompt text applied across every scene. |
| `@story` | `{ entityType: "storyboard", field: "story" }` | The story/worldview text. |
| `@negative-prompt` | `{ entityType: "storyboard", field: "negativePrompt" }` | |
| `@character-policy` | `{ entityType: "storyboard", field: "characterPolicy" }` | The one-time character decision (e.g. consistent character sheet vs. none). |
| `@scene` (per scene) | `{ entityType: "scene", field: "scene" }` | A scene is addressed as one unit — prompt, emotion, camera, lighting, motion are only meaningful reviewed together, not as separate targets. |

Every read returns a `revision` for its target. A proposal is bound to the
revision it was read from; if the operator edits that entity afterwards, apply
fails with a conflict instead of overwriting their edit.

## Tools

- `get_creative_direction` — current values and revisions for every field above, plus valid style preset options.
- `list_change_proposals` — this project's proposals, optionally by status.
- `get_change_proposal` — one proposal with per-item before/after and approval.
- `propose_creative_direction_changes` — record a proposal. Changes nothing.
- `apply_approved_change_proposal` — write the approved items only.

## Workflow

1. **Read.** Call `get_creative_direction` first, every time. Never guess the
   current tone, style preset, prompt, or scene content, and never rely on a
   value from an earlier turn — the operator may have edited it since.
2. **Discuss.** Say what you would change and why, in the user's language. When
   a decision has genuinely different creative directions, offer two or three
   options with a reason and a likely impact each, and attach them as a `choice`
   on that item. Do not offer options that differ only in wording.
3. **Propose.** Call `propose_creative_direction_changes` with one item per
   field you want to change: the target, the `after` value, and an item-level
   `rationale` that explains the change on its own. Pass a stable
   `clientRequestId` for the proposal — retrying with the same id returns the
   proposal already created instead of a duplicate — plus the `conversationId`
   and `turnId` of the app chat turn this proposal came from; both are
   required, and a proposal only reaches the operator's approval UI when they
   identify a real, currently open conversation and turn.
4. **Wait.** Tell the operator the proposal is pending and what they will see:
   a field-level diff they can approve or reject item by item. Then stop. The
   proposal is durable — it survives a closed browser and an API restart — so
   waiting costs nothing. Do not poll in a loop; check with
   `get_change_proposal` when the operator says they have decided.
5. **Apply.** Once items are approved, call `apply_approved_change_proposal`
   with the proposal id. Rejected and still-pending items are not written.
   Report exactly which fields changed.

## Handling refusals

- `not_found` on a proposal id: it belongs to another project, or it never
  existed. Do not retry with a different session; ask which project.
- `invalid_state` on apply: nothing has been approved yet. Return to step 4.
- `conflict` on apply: the operator edited the target after the diff was made.
  The proposal is preserved and marked conflicted. Re-read the current value,
  explain what changed, and propose a rebased revision — never re-apply.
- Repeating a successful apply is a no-op that returns the applied proposal.

## Reporting

Keep the operator oriented in plain language: what the value is now, what you
propose, why, and what is waiting on them. Quote proposal ids when you refer to
one. Do not describe internal tool mechanics unless asked.
