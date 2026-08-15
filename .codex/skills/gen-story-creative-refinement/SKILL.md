---
name: gen-story-creative-refinement
description: Refine a Gen Story project's creative direction (AI photo analysis, emotion/tone, style preset) through the Gen Story MCP server. Use when the user asks to review, discuss, or change a Gen Story project's tone, mood, style preset, or photo analysis, or mentions a change proposal, an approval, or `@photo-analysis` / `@tone` / `@style-preset`. Read current values, discuss options, record a proposal, wait for the operator's approval, then apply.
---

# Gen Story creative refinement

Refine a Gen Story project's creative direction through the project-scoped MCP
server. You advise; the operator decides; only approved items are written.

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

## Attaching

The API must be running (`pnpm dev:api`, default port 4000). Both transports
serve the identical tool set.

HTTP (embedded chat, or an external client that speaks Streamable HTTP):

    http://localhost:4000/api/mcp/projects/<projectId>

stdio (external Codex or Claude Code session):

    pnpm --filter @gen-story/api mcp:stdio -- --project <projectId>

Claude Code:

    claude mcp add gen-story --transport http http://localhost:4000/api/mcp/projects/<projectId>

Codex (`~/.codex/config.toml`):

    [mcp_servers.gen_story]
    command = "pnpm"
    args = ["--filter", "@gen-story/api", "mcp:stdio", "--", "--project", "<projectId>"]

## Semantic targets

The first slice covers exactly three fields. Address them by target object, not
by column name or UI label:

| Reference | Target |
| --- | --- |
| `@photo-analysis` | `{ entityType: "project", entityId: <projectId>, field: "photoAnalysis" }` |
| `@emotion` / `@tone` | `{ entityType: "storyboard", entityId: <storyboardId>, field: "tone" }` |
| `@style-preset` | `{ entityType: "storyboard", entityId: <storyboardId>, field: "stylePresetId" }` |

There is no separate `emotion` field: emotion candidates are read-only output of
the photo analysis, and the emotional direction the operator commits to is
stored in `tone`.

Every read returns a `revision` for its target. A proposal is bound to the
revision it was read from; if the operator edits that entity afterwards, apply
fails with a conflict instead of overwriting their edit.

## Tools

- `get_creative_direction` — current values and revisions for the three fields.
- `list_change_proposals` — this project's proposals, optionally by status.
- `get_change_proposal` — one proposal with per-item before/after and approval.
- `propose_creative_direction_changes` — record a proposal. Changes nothing.
- `apply_approved_change_proposal` — write the approved items only.

## Workflow

1. **Read.** Call `get_creative_direction` first, every time. Never guess the
   current tone, style preset, or analysis, and never rely on a value from an
   earlier turn — the operator may have edited it since.
2. **Discuss.** Say what you would change and why, in the user's language. When
   a decision has genuinely different creative directions, offer two or three
   options with a reason and a likely impact each, and attach them as a `choice`
   on that item. Do not offer options that differ only in wording.
3. **Propose.** Call `propose_creative_direction_changes` with one item per
   field you want to change: the target, the `after` value, and an item-level
   `rationale` that explains the change on its own. Pass a stable
   `clientRequestId` for the proposal — retrying with the same id returns the
   proposal already created instead of a duplicate — plus the `conversationId`
   and `turnId` this proposal came from.
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
