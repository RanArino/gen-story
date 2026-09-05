import json
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("render_edit_plan.py")


def plan_with(scene_count: int, duration: float = 60.0) -> dict:
    scene_duration = duration / scene_count
    scenes = []
    for index in range(scene_count):
        start, end = round(index * scene_duration, 2), round((index + 1) * scene_duration, 2)
        scenes.append({"order": index + 1, "asset_path": f"assets/{index + 1}.jpg", "start_sec": start, "end_sec": end, "transition": {"name": "Fade", "duration_sec": 0.3, "reason": "Gentle continuity"}, "text": {"content": "Opening", "start_sec": start, "end_sec": end} if index == 0 else None})
    return {"video": {"platform": "instagram_reels", "aspect_ratio": "9:16", "language": "en"}, "bgm": {"track": "Track", "artist": "Artist", "source_start_sec": 10, "source_end_sec": 10 + duration, "timeline_start_sec": 0, "instagram_search_query": "Track Artist", "alternatives": ["Alternative"], "checked_on": "2026-08-10", "sources": ["https://example.com"]}, "scenes": scenes}


class RenderEditPlanTests(unittest.TestCase):
    def run_renderer(self, plan: dict) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "plan.json"
            source.write_text(json.dumps(plan), encoding="utf-8")
            output = root / "output"
            result = subprocess.run(["python3", str(SCRIPT), str(source), "--output-dir", str(output)], capture_output=True, text=True)
            if result.returncode == 0:
                self.assertTrue((output / "capcut-edit-plan.md").exists())
                self.assertTrue((output / "capcut-timeline.csv").exists())
                self.assertIn("Track — Artist", (output / "capcut-timeline.csv").read_text())
            return result

    def test_renders_3_8_and_15_scene_timelines(self) -> None:
        for scene_count in (3, 8, 15):
            with self.subTest(scene_count=scene_count):
                self.assertEqual(self.run_renderer(plan_with(scene_count)).returncode, 0)

    def test_rejects_more_than_60_seconds(self) -> None:
        self.assertNotEqual(self.run_renderer(plan_with(3, 60.01)).returncode, 0)

    def test_rejects_a_bgm_segment_longer_than_60_seconds(self) -> None:
        plan = plan_with(3)
        plan["bgm"]["source_end_sec"] = 70.01
        self.assertNotEqual(self.run_renderer(plan).returncode, 0)


if __name__ == "__main__":
    unittest.main()
