---
name: gh-pr-maintainer
description: "Manage GitHub pull requests end-to-end with the gh CLI: fetch metadata and diffs, author standardized PR description files, update titles/bodies, and create/assign labels (<=10). Trigger when a user needs to inspect a specific PR and synchronize its content with GitHub."
---

# GitHub PR Maintenance Workflow

Use this skill whenever you must retrieve an existing pull request, review its changes, rewrite the title/body, manage labels, and (only when appropriate) add the PR to a GitHub Project. All actions rely on the GitHub CLI (`gh`).

## Prerequisites
- Confirm `gh auth status` succeeds for the GitHub account that owns the PR.
- Identify the absolute repo path and PR number before running commands.
- Ensure you have write access to the repo so the PR description file can be created in the root directory.

## Required Inputs to Gather
1. Repository directory name (relative or absolute path inside the workspace).
2. Pull request number.
3. Any updates that should go into the PR title, description content, and label selections.

## Asset
- `assets/pr-description-template.md`: Copy this template whenever you create `PR<pr_number>.md`. Replace placeholder lines and mark the appropriate checkboxes before uploading.

## Ordered Procedure
Follow the steps in exact order—steps 1 through 6 are mandatory whenever you modify titles, descriptions, or labels. Only proceed to the next step after the previous one completes successfully.

### Step 0 – Move into the Repository
```bash
cd <repository_name>
```
Stay inside this directory for every command below.

### Step 0.5 – Create a Temporary Artifact Directory (Required)
Capture outputs (view JSON, diff, etc.) into a temp folder so they do not show up in `git status` / Git “Changes”.
```bash
PR_ARTIFACT_DIR="$(mktemp -d "/tmp/gh-pr-maintainer-XXXX")"
echo "$PR_ARTIFACT_DIR"
```
Keep `PR_ARTIFACT_DIR` for subsequent steps.

### Step 1 – Fetch PR Metadata
```bash
gh pr view <pr_number> --json number,title,body,headRefName,baseRefName,changedFiles,additions,deletions,files,url > "$PR_ARTIFACT_DIR/PR<pr_number>-view.json"
cat "$PR_ARTIFACT_DIR/PR<pr_number>-view.json"
```
- Save the JSON output for reference (in the temp directory).
- Confirm branch names, counts, and the current title/body before deciding on edits.

### Step 2 – Capture the Diff
```bash
gh pr diff <pr_number> > "$PR_ARTIFACT_DIR/PR<pr_number>-diff.patch"
cat "$PR_ARTIFACT_DIR/PR<pr_number>-diff.patch"
```

### Step 3 – Author the PR Description File
1. From the repo root, run:
   ```bash
   SKILL_DIR=<path_to_this_skill>
   cp "$SKILL_DIR/assets/pr-description-template.md" "PR<pr_number>.md"
   ```
   Replace `<path_to_this_skill>` with the directory that contains this `SKILL.md`. If copying is inconvenient, open the template file and paste its contents manually.
2. Edit `PR<pr_number>.md` in place:
   - Replace placeholder text with the actual summary, related PR references, and detailed change bullets.
   - Mark the appropriate checkboxes with `[x]` or leave unchecked `[ ]`.
   - Under **Changes Made**, bullet every meaningful update surfaced from Step 2.
   - Under **Testing**, reflect the true validation performed.
3. Keep this file in the repo root; it becomes the canonical PR body for the next step.

### Step 4 – Update Title and Body on GitHub
```bash
gh pr edit <pr_number> --title "<new_pr_title>" --body-file PR<pr_number>.md
```
- Quote the title to preserve spaces.
- If the PR body already contains tables or checklists, ensure the markdown in `PR<pr_number>.md` captures them so GitHub renders identically.

### Step 5 – Inspect Available Labels
```bash
gh label list --limit 100
```
- Note the exact casing of each label.
- Decide which existing labels apply; keep the final selection under 10 items.

### Step 6 – Create Missing Labels (If Needed)
```bash
gh label create <name1> --description "<description_text1>" \
  <name2> --description "<description_text2>" \
  <name3> --description "<description_text3>"
```
- Run this only for labels that do not already exist.
- Re-run Step 5 afterward to confirm the new labels are present before assignment.

### Step 7 – Assign Labels (+ Conditionally Add to Scaler Project)
Always assign labels as needed. 

### Step 8 – Cleanup Temporary Artifacts (Required)
Remove any generated temp files created by this workflow:
```bash
test -n "$PR_ARTIFACT_DIR" && rm -rf "$PR_ARTIFACT_DIR"
unset PR_ARTIFACT_DIR
```

## Verification Checklist
- [ ] JSON + diff outputs fetched and understood.
- [ ] `PR<pr_number>.md` exists at the repo root and mirrors the GitHub PR body.
- [ ] New title/body confirmed on GitHub via `gh pr view <pr_number>`.
- [ ] Labels show up under the PR conversation tab and in `gh pr view` output.
