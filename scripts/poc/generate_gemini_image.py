#!/usr/bin/env python3
"""Single-file Gemini image generation POC.

This script intentionally uses only Python's standard library so it can run
without installing a Python SDK. It reads GEMINI_API_KEY from the shell
environment, then from local .env files if needed.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


DEFAULT_MODEL = "gemini-3.1-flash-image"
DEFAULT_PROMPT = (
    "Create a warm cinematic image of a small family photo album open on a "
    "wooden table, with soft morning light, nostalgic but realistic mood, no text."
)


def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def parse_env_line(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("#") or "=" not in stripped:
        return None

    key, value = stripped.split("=", 1)
    key = key.strip()
    value = value.strip()

    if not key:
        return None

    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        value = value[1:-1]

    return key, value


def load_local_env_files(root: Path) -> None:
    shell_env_keys = set(os.environ)
    env_files = [
        root / ".env",
        root / ".env.local",
        root / "apps" / "api" / ".env",
        root / "apps" / "api" / ".env.local",
    ]

    for env_file in env_files:
        if not env_file.exists():
            continue

        for line in env_file.read_text(encoding="utf-8").splitlines():
            parsed = parse_env_line(line)
            if parsed is None:
                continue

            key, value = parsed
            if key in shell_env_keys or value == "":
                continue

            os.environ[key] = value


def build_request(prompt: str) -> bytes:
    payload = {
        "contents": [
            {
                "parts": [
                    {
                        "text": prompt,
                    }
                ],
            }
        ],
    }
    return json.dumps(payload).encode("utf-8")


def call_gemini(api_key: str, model: str, api_version: str, prompt: str) -> dict:
    url = (
        "https://generativelanguage.googleapis.com/"
        f"{api_version}/models/{model}:generateContent"
    )
    request = urllib.request.Request(
        url=url,
        data=build_request(prompt),
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Gemini API returned HTTP {error.code}: {body}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Could not reach Gemini API: {error.reason}") from error


def first_image_part(response_json: dict) -> tuple[str, str] | None:
    for candidate in response_json.get("candidates", []):
        content = candidate.get("content") or {}
        for part in content.get("parts", []):
            inline_data = part.get("inlineData") or part.get("inline_data")
            if not inline_data:
                continue

            image_base64 = inline_data.get("data")
            if image_base64:
                mime_type = inline_data.get("mimeType") or inline_data.get("mime_type")
                return image_base64, mime_type or "image/png"

    return None


def print_text_parts(response_json: dict) -> None:
    for candidate in response_json.get("candidates", []):
        content = candidate.get("content") or {}
        for part in content.get("parts", []):
            text = part.get("text")
            if text:
                print(text)


def parse_args() -> argparse.Namespace:
    default_output = repo_root() / "scripts" / "poc" / "output" / "gemini-image.png"
    parser = argparse.ArgumentParser(description="Generate one image with Gemini.")
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    parser.add_argument("--output", type=Path, default=default_output)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--api-version", default="v1")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = repo_root()
    load_local_env_files(root)

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print(
            "GEMINI_API_KEY is not set. Add it to the shell environment, .env, "
            ".env.local, apps/api/.env, or apps/api/.env.local.",
            file=sys.stderr,
        )
        return 1

    try:
        response_json = call_gemini(
            api_key=api_key,
            model=args.model,
            api_version=args.api_version,
            prompt=args.prompt,
        )
    except RuntimeError as error:
        print(error, file=sys.stderr)
        return 1

    print_text_parts(response_json)

    image_part = first_image_part(response_json)
    if image_part is None:
        print("Gemini response did not contain image data.", file=sys.stderr)
        print(json.dumps(response_json, indent=2), file=sys.stderr)
        return 1

    image_base64, mime_type = image_part
    image_bytes = base64.b64decode(image_base64)

    output_path = args.output
    if not output_path.is_absolute():
        output_path = root / output_path

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(image_bytes)

    print(f"Saved {mime_type} image to {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
