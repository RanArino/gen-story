#!/usr/bin/env python3
"""Render an approved CapCut edit-plan JSON document as Markdown and CSV."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

MAX_DURATION_SECONDS = 60.0
CSV_COLUMNS = [
    "order", "asset_path", "start_sec", "end_sec", "duration_sec", "transition",
    "transition_sec", "text", "text_start_sec", "text_end_sec", "bgm_track",
    "bgm_track_start_sec",
]


def number(value: Any, name: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ValueError(f"{name} must be a number")
    return round(float(value), 2)


def text(value: Any, name: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        raise ValueError(f"{name} must be a non-empty string")
    return value.strip()


def validate(plan: dict[str, Any]) -> list[dict[str, Any]]:
    video = plan.get("video")
    scenes = plan.get("scenes")
    if not isinstance(video, dict) or not isinstance(scenes, list) or not scenes:
        raise ValueError("plan requires video metadata and at least one scene")
    if text(video.get("platform"), "video.platform") != "instagram_reels":
        raise ValueError("video.platform must be instagram_reels")
    if text(video.get("aspect_ratio"), "video.aspect_ratio") != "9:16":
        raise ValueError("video.aspect_ratio must be 9:16")
    bgm = plan.get("bgm")
    if not isinstance(bgm, dict):
        raise ValueError("plan requires bgm metadata")
    source_start = number(bgm.get("source_start_sec"), "bgm.source_start_sec")
    source_end = number(bgm.get("source_end_sec"), "bgm.source_end_sec")
    timeline_start = number(bgm.get("timeline_start_sec"), "bgm.timeline_start_sec")
    if source_start < 0 or source_end <= source_start:
        raise ValueError("BGM source segment must have a positive duration")
    if source_end - source_start > MAX_DURATION_SECONDS:
        raise ValueError("BGM source segment exceeds the 60.00-second maximum")
    if timeline_start < 0 or timeline_start > MAX_DURATION_SECONDS:
        raise ValueError("BGM timeline start must be within the video")

    previous_end = 0.0
    normalized: list[dict[str, Any]] = []
    for expected_order, scene in enumerate(scenes, start=1):
        if not isinstance(scene, dict):
            raise ValueError(f"scene {expected_order} must be an object")
        order = scene.get("order")
        if order != expected_order:
            raise ValueError("scene order must start at 1 and be contiguous")
        start = number(scene.get("start_sec"), f"scene {order}.start_sec")
        end = number(scene.get("end_sec"), f"scene {order}.end_sec")
        if start != previous_end or end <= start:
            raise ValueError("scenes must be contiguous with positive durations")
        transition = scene.get("transition") or {"name": "None", "duration_sec": 0}
        if not isinstance(transition, dict):
            raise ValueError(f"scene {order}.transition must be an object")
        transition_duration = number(transition.get("duration_sec"), f"scene {order}.transition.duration_sec")
        duration = round(end - start, 2)
        if transition_duration < 0 or transition_duration > duration:
            raise ValueError("transition duration must fit inside its outgoing clip")
        raw_text = scene.get("text")
        caption = ""
        caption_start = ""
        caption_end = ""
        if raw_text is not None:
            if not isinstance(raw_text, dict):
                raise ValueError(f"scene {order}.text must be an object or null")
            caption = text(raw_text.get("content"), f"scene {order}.text.content")
            caption_start_value = number(raw_text.get("start_sec"), f"scene {order}.text.start_sec")
            caption_end_value = number(raw_text.get("end_sec"), f"scene {order}.text.end_sec")
            if not (start <= caption_start_value < caption_end_value <= end):
                raise ValueError("text timing must be within its scene")
            caption_start, caption_end = caption_start_value, caption_end_value
        normalized.append({
            "order": order, "asset_path": text(scene.get("asset_path"), f"scene {order}.asset_path"),
            "start_sec": start, "end_sec": end, "duration_sec": duration,
            "transition": text(transition.get("name"), f"scene {order}.transition.name"),
            "transition_sec": transition_duration, "text": caption,
            "text_start_sec": caption_start, "text_end_sec": caption_end,
            "transition_reason": text(transition.get("reason", "No transition"), f"scene {order}.transition.reason"),
        })
        previous_end = end
    if previous_end > MAX_DURATION_SECONDS:
        raise ValueError("timeline exceeds the 60.00-second maximum")
    if timeline_start + (source_end - source_start) > previous_end:
        raise ValueError("BGM segment does not fit within the timeline")
    return normalized


def render(plan: dict[str, Any], scenes: list[dict[str, Any]], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    video, bgm = plan["video"], plan["bgm"]
    track = text(bgm.get("track"), "bgm.track")
    artist = text(bgm.get("artist"), "bgm.artist")
    sources = bgm.get("sources", [])
    if not isinstance(sources, list) or not all(isinstance(source, str) for source in sources):
        raise ValueError("bgm.sources must be an array of URLs")
    with (output_dir / "capcut-timeline.csv").open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for scene in scenes:
            writer.writerow({**{key: scene[key] for key in CSV_COLUMNS if key in scene}, "bgm_track": f"{track} — {artist}", "bgm_track_start_sec": bgm["timeline_start_sec"]})

    lines = [
        "# CapCut edit plan", "", f"- Platform: {video['platform']}", f"- Aspect ratio: {video['aspect_ratio']}",
        f"- Language: {video['language']}", f"- Total duration: {scenes[-1]['end_sec']:.2f}s", "",
        "## BGM", "", f"- Track: {track} — {artist}", f"- Source-track segment: {bgm['source_start_sec']:.2f}s–{bgm['source_end_sec']:.2f}s",
        f"- Start on timeline: {bgm['timeline_start_sec']:.2f}s", f"- Instagram search: {bgm['instagram_search_query']}",
        f"- Alternatives: {', '.join(bgm.get('alternatives', [])) or 'None'}", "- Checked: " + bgm["checked_on"],
        "- Before posting, search the track in Instagram. Catalog availability varies by region, account type, and posting date; use an alternative if it is unavailable.",
        "", "### Sources", *([f"- {source}" for source in sources] or ["- No sources supplied"]), "", "## Timeline", "",
        "| # | Asset | Time | Transition | Text |", "| --- | --- | --- | --- | --- |",
    ]
    for scene in scenes:
        caption = scene["text"] or "None"
        lines.append(f"| {scene['order']} | `{scene['asset_path']}` | {scene['start_sec']:.2f}s–{scene['end_sec']:.2f}s | {scene['transition']} ({scene['transition_sec']:.2f}s): {scene['transition_reason']} | {caption} |")
    lines.extend(["", "## CapCut checks", "", "- Use 9:16 and keep text outside the top 14% and bottom 22% of the frame.", "- Apply transitions inside the outgoing clip at the durations above.", "- Confirm audio availability in Instagram immediately before posting.", ""])
    (output_dir / "capcut-edit-plan.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("plan_json", type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    plan = json.loads(args.plan_json.read_text(encoding="utf-8"))
    if not isinstance(plan, dict):
        raise ValueError("plan JSON must be an object")
    scenes = validate(plan)
    render(plan, scenes, args.output_dir)


if __name__ == "__main__":
    main()
