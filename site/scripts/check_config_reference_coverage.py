#!/usr/bin/env -S uv run --script

"""Verify that all generated config reference keys are documented in site docs."""

from __future__ import annotations

import json
import re
from pathlib import Path

ALLOWED_UNDOCUMENTED_OPTIONS = 98
CONFIG_KEY_COMMENT_PREFIX = "erato_toml_config_key"


def load_config_reference_keys(path: Path) -> tuple[set[str], set[str]]:
    with path.open() as file:
        payload = json.load(file)

    if not isinstance(payload, dict):
        raise TypeError(f"Expected {path} to be a JSON object")

    all_keys: set[str] = set()
    documented_keys: set[str] = set()

    for key, metadata in payload.items():
        if not isinstance(key, str):
            continue

        all_keys.add(key)
        if not isinstance(metadata, dict):
            documented_keys.add(key)
            continue

        if not metadata.get("hide_in_docs", False):
            documented_keys.add(key)

    return all_keys, documented_keys


COMMENT_PATTERN = re.compile(
    rf"\{{/\*\s*{re.escape(CONFIG_KEY_COMMENT_PREFIX)}:\s*(.*?)\s*\*/\}}"
)


def is_superkey_or_exact_match(documented_key: str, config_keys: set[str]) -> bool:
    if documented_key in config_keys:
        return True

    prefix = f"{documented_key}."
    return any(key.startswith(prefix) for key in config_keys)


def load_documented_keys(path: Path) -> set[str]:
    content = path.read_text()
    documented: set[str] = set()

    for match in COMMENT_PATTERN.finditer(content):
        key = match.group(1).strip().strip("`").strip()
        if key:
            documented.add(key)

    return documented


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    config_reference_path = repo_root / "backend" / "generated" / "config_reference.json"
    config_docs_path = repo_root / "site" / "content" / "docs" / "configuration.mdx"

    all_config_keys, config_keys = load_config_reference_keys(config_reference_path)
    documented_keys = load_documented_keys(config_docs_path)

    valid_documented_keys = {
        documented_key
        for documented_key in documented_keys
        if is_superkey_or_exact_match(documented_key, config_keys)
    }

    undocumented_keys = sorted(config_keys - documented_keys)
    unknown_documented_keys = sorted(
        documented_keys - valid_documented_keys
    )
    documented_count = len(documented_keys & config_keys)
    undocumented_count = len(undocumented_keys)
    unknown_documented_count = len(unknown_documented_keys)
    documented_marker_count = len(documented_keys)
    valid_documented_marker_count = len(valid_documented_keys)

    print(f"Config reference options: {len(all_config_keys)}")
    print(f"Config reference visible options: {len(config_keys)}")
    print(f"Documented options: {documented_count}")
    print(f"Undocumented options: {undocumented_count}")
    print(f"Documented key markers: {documented_marker_count}")
    print(f"Documented markers that match config: {valid_documented_marker_count}")
    print(f"Unknown key markers: {unknown_documented_count}")

    if undocumented_count > 0:
        print("\nUndocumented config keys:")
        for key in undocumented_keys:
            print(f"- {key}")

    if unknown_documented_count > 0:
        print("\nUnknown documented config keys:")
        for key in unknown_documented_keys:
            print(f"- {key}")

    if undocumented_count > ALLOWED_UNDOCUMENTED_OPTIONS:
        print(
            f"\nError: undocumented options ({undocumented_count}) exceed allowed threshold "
            f"({ALLOWED_UNDOCUMENTED_OPTIONS})."
        )
        return 1
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except OSError as error:
        print(f"Error: {error}")
        raise SystemExit(1)
