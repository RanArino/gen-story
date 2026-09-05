---
name: capcut-reels-video-planner
description: Plan an Instagram Reels-first CapCut video from AI-generated images and their prompts. Use when Codex receives a Gen Story `storyboard.json` export bundle, image files with descriptions or prompts, or a request for a 60-second-or-less CapCut timeline, current music recommendations, transitions, or optional on-screen text for Reels or TikTok.
---

# CapCut Reels Video Planner

Create a vertical 9:16, Instagram Reels-first editing plan. Do not render a video or upload anything.

## Input

Prefer a Gen Story export bundle: `data/exports/storyboard-*/storyboard.json` with its `assets/` directory. Read scenes in ascending `orderIndex`; prefer `adoptedImagePath`, then `sourcePhotoPath`. Use `title`, `description`, `imagePrompt`, `emotion`, `motionDirection`, and storyboard `tone` as editorial context.

Before making any aesthetic judgment (mood, color, realism level, era/genre fit for transitions or music), actually view a representative sample of the images themselves (hook, peak, ending, and a few mid-journey scenes) — text prompts and descriptions do not reliably capture the final rendered style. Re-view images again after any major reframing of the story (e.g., a new emotional backstory) before proposing new creative options.

For another source, require ordered image paths and a corresponding description or generation prompt. Infer the response language from the request and input; use that language for the plan and on-screen text.

## Collaboration gates

Use independent agents when collaboration tools are available. Do not reveal private chain-of-thought or a transcript of their discussion.

1. **Editorial round**: ask separate agents to assess story structure/durations and transitions/text. Return a compact decision brief: recommendation and why, credible alternative and trade-off, decisions to lock next, and a direct request for feedback. Stop.
2. **Music round**: after the user responds, search the web for current music evidence and build a menu of 5 candidates each for 邦楽 (Japanese-language), 洋楽 (Western/international), and Instrumental — 15 total, each with a one-line mood/fit note and source link. Do not narrow to one genre or a short list yet. Ask independent agents to assess emotional fit, Reels/TikTok recency, 60-second hook/sound fit, and availability risk across the full menu. Present the menu and give the user an approval card to pick a genre direction. Once a direction is chosen, run 2–3 rounds of deep-dive follow-up questions to close in on a specific track; if a named track doesn't land with the user, keep surfacing concrete alternatives in that direction rather than stalling on one name. Only once a specific track is approved, return the compact decision brief (track, segment, timeline start, mood/tempo, Instagram search query, alternatives) with source links and the check date. Stop.
3. **Final review**: after the user responds, consolidate the approved timeline and BGM. Show a concise review summary and request explicit approval. Do not write final artifacts yet.
4. **Delivery**: only after explicit final approval, create `capcut-edit-plan.md`, `capcut-timeline.csv`, and the intermediate JSON beside the input bundle or in a user-specified output directory.

If agents are unavailable, perform the independent perspectives yourself and say that the perspectives were simulated. The user-feedback gates remain mandatory.

**Escalation rule**: if the user rejects a round's direction twice in a row (including for the same underlying reason stated differently), stop generating more full candidate lists. Instead, ask 1–3 targeted clarifying questions — a reference example/artist, a specific attribute (sound, palette, era), or a direct call-out of what's mismatched in the actual images — and get that confirmed before proposing again. Guessing a third time in the same direction is not permitted.

## Editorial rules

- Keep total timeline duration at or below 60.00 seconds. A shorter result is valid; do not pad weak material.
- Give the first image a clear hook and reserve extra time for the emotional peak and ending. Avoid equal timing by default.
- Represent a transition as occurring inside the outgoing clip. Consecutive scene boundaries must still be contiguous; do not subtract transition duration twice.
- Recommend restrained CapCut transitions: `None`, `Fade`, `Dissolve`, `Flash`, or `Slide`. Specify duration and a concrete visual reason. Prefer `None` for a hard beat or intentional contrast.
- Add text only when it supplies a hook, essential context, or a closing thought. For every other image write `None`. Keep text inside Reels-safe areas: away from the top 14% and bottom 22% of the 9:16 frame.

## Music rules

- Browse for current information every time music is selected; do not rely on remembered trends. Cite the supporting page URLs in the Markdown plan.
- Open with a 15-option menu (5 邦楽 / 5 洋楽 / 5 Instrumental) before narrowing. Let the user pick the genre direction, then iterate 2–3 rounds of follow-up questions; keep offering alternatives within that direction if specific tracks don't land.
- Recommend track title, artist, the source-track segment (maximum 60 seconds), timeline start, mood/BPM or tempo feel, Instagram search query, and alternatives.
- Treat Instagram and TikTok catalog availability as variable by country, account type, and posting date. Never promise a track is available. Include a final instruction to search the title in Instagram immediately before posting and use the named alternative if it is unavailable.
- Do not recommend a song solely because it is trending; it must also fit the story and provide a usable hook or chorus inside the approved duration.
- Fit the track's actual sound (instrumentation, production polish, vocal tone, era) to the images' visual character (realism level, color palette, texture, line quality) — matching only the lyrical/story theme while ignoring sonic fit is not sufficient.

## Deliverables

First write a JSON document matching `scripts/render_edit_plan.py`'s input schema. Then run:

```sh
python3 scripts/render_edit_plan.py /absolute/path/to/edit-plan.json --output-dir /absolute/path/to/output
```

The renderer produces:

- `capcut-edit-plan.md`: BGM evidence, source links, the edit table, CapCut notes, and pre-posting checks.
- `capcut-timeline.csv`: `order,asset_path,start_sec,end_sec,duration_sec,transition,transition_sec,text,text_start_sec,text_end_sec,bgm_track,bgm_track_start_sec`.

Never deliver either final artifact before the final approval gate. The renderer rejects durations over 60 seconds, non-contiguous scenes, invalid text windows, and transition durations longer than their outgoing clip.
