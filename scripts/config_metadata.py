#!/usr/bin/env python3
"""Audit config introduction dates using release snapshots (never used by codegen).

Run `git fetch origin --tags` first. This tool only reports differences;
config types and their facet attributes are the sole maintained metadata source.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

REFERENCE = Path("backend/generated/config_reference.json")
VERSION = re.compile(
    r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
    r"(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?"
)


def version_key(version: str) -> tuple:
    match = VERSION.fullmatch(version)
    if not match:
        raise ValueError(f"Invalid release version: {version}")
    major, minor, patch, prerelease, _ = match.groups()
    identifiers = tuple(
        (0, int(part)) if part.isdigit() else (1, part)
        for part in (prerelease or "").split(".")
    )
    if prerelease and any(
        part.isdigit() and len(part) > 1 and part.startswith("0")
        for part in prerelease.split(".")
    ):
        raise ValueError(f"Invalid release version: {version}")
    return int(major), int(minor), int(patch), prerelease is None, identifiers


def git(repo: Path, *args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=repo, text=True).strip()


def introduction_versions(repo: Path, keys: set[str]) -> dict[str, str]:
    if git(repo, "rev-parse", "--is-shallow-repository") == "true":
        raise ValueError("Introduction audit needs full history; fetch --unshallow and --tags first")
    tags = []
    for tag in git(repo, "tag", "--merged", "HEAD").splitlines():
        version = tag[1:] if tag.startswith("v") else tag
        try:
            order = version_key(version)
        except ValueError:
            continue  # Helm, sidecar, and other unrelated tags.
        tags.append((order, tag, version))
    first = {}
    found_reference = False
    for _, tag, version in sorted(tags):
        if not git(repo, "ls-tree", "--name-only", tag, "--", str(REFERENCE)):
            continue
        snapshot = json.loads(git(repo, "show", f"{tag}:{REFERENCE}"))
        if not isinstance(snapshot, dict):
            raise ValueError(f"Invalid config reference in tag {tag}")
        found_reference = True
        for key in snapshot:
            first.setdefault(key, version)
    if not found_reference:
        raise ValueError("No release tags contain the config reference; fetch origin --tags first")
    return {key: first.get(key, "unreleased") for key in sorted(keys)}


def audit(repo: Path) -> tuple[dict[str, str], dict]:
    reference = json.loads((repo / REFERENCE).read_text())
    versions = introduction_versions(repo, set(reference))
    differences = {
        key: {"expected": version, "actual": reference[key].get("introduced_in")}
        for key, version in versions.items()
        if reference[key].get("introduced_in") != version
    }
    return versions, differences


# Match only the introduced_in attribute, never unrelated "unreleased" strings.
INTRODUCED_ATTRIBUTE = re.compile(
    r'(?P<prefix>#\[facet\(\s*erato_config::introduced_in\(\s*version\s*=\s*")'
    r'unreleased(?P<suffix>"(?:\s*,\s*under\s*=\s*"[^"]+")?\s*,?\s*\)\s*\)\])'
)


def validate_released_reference(repo: Path) -> None:
    reference = json.loads((repo / REFERENCE).read_text())
    for key, metadata in reference.items():
        version = metadata.get("introduced_in")
        if not isinstance(version, str) or version == "unreleased":
            raise ValueError(f"Config key {key!r} has no released introduced_in version")
        version_key(version)
        if metadata.get("stability") not in {"stable", "alpha", "beta", "unstable", "deprecated"}:
            raise ValueError(f"Config key {key!r} has invalid stability")


def prepare_config_release(repo: Path, version: str, run=subprocess.run) -> list[Path]:
    """Freeze source declarations, regenerate, and verify before the caller commits."""
    version_key(version)
    changed = []
    for source in sorted((repo / "backend/erato_config/src").rglob("*.rs")):
        content = source.read_text()
        updated = INTRODUCED_ATTRIBUTE.sub(
            lambda match: match["prefix"] + version + match["suffix"], content
        )
        if updated != content:
            source.write_text(updated)
            changed.append(source)
    run(
        ["cargo", "run", "-p", "erato_config", "--bin", "gen-config-reference"],
        cwd=repo / "backend", check=True,
    )
    validate_released_reference(repo)
    return [*changed, repo / REFERENCE]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    versions, differences = audit(repo)
    print(json.dumps({"introduced_in": versions, "differences": differences}, indent=2))
    return bool(differences)


if __name__ == "__main__":
    raise SystemExit(main())
