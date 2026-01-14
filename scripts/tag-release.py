#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# dependencies = [
#   "tomlkit"
# ]
# ///

import sys
import tomlkit
import subprocess
from pathlib import Path

def run_git_command(args, check=True):
    try:
        result = subprocess.run(["git"] + args, capture_output=True, text=True, check=check)
        return result
    except FileNotFoundError:
        print("Error: git command not found. Is git installed and in your PATH?", file=sys.stderr)
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print(f"Error running git command: {' '.join(['git'] + args)}", file=sys.stderr)
        print(f"Stderr: {e.stderr}", file=sys.stderr)
        if check:
            sys.exit(1)

def main():
    # Read version from the main erato package in the workspace
    cargo_toml_path = Path(__file__).parent.parent / "backend" / "erato" / "Cargo.toml"
    if not cargo_toml_path.exists():
        print(f"Error: {cargo_toml_path} not found.", file=sys.stderr)
        sys.exit(1)

    with open(cargo_toml_path, "r") as f:
        content = f.read()
        cargo_data = tomlkit.parse(content)

    version = cargo_data.get("package", {}).get("version")
    if not version:
        print("Could not find version in backend/erato/Cargo.toml", file=sys.stderr)
        sys.exit(1)

    print(f"Version found: {version}")

    # Check current branch is main
    current_branch = run_git_command(["rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()
    if current_branch != "main":
        print(f"Error: Not on main branch. Current branch is {current_branch}.", file=sys.stderr)
        sys.exit(1)

    # Check if working directory is clean
    if run_git_command(["status", "--porcelain"]).stdout:
        print("Error: Working directory is not clean. Please commit or stash your changes.", file=sys.stderr)
        sys.exit(1)

    # Fetch from origin and check if up to date
    print("Fetching from origin...")
    run_git_command(["fetch", "origin"])
    local_head = run_git_command(["rev-parse", "HEAD"]).stdout.strip()
    remote_head = run_git_command(["rev-parse", "origin/main"]).stdout.strip()

    if local_head != remote_head:
        print("Error: Local main branch is not up-to-date with origin/main.", file=sys.stderr)
        sys.exit(1)
    
    print("Current branch is main and up-to-date.")

    # Check if tag already exists
    tag_check_result = run_git_command(["rev-parse", version], check=False)
    if tag_check_result.returncode == 0:
        print(f"Error: Tag {version} already exists.", file=sys.stderr)
        sys.exit(1)

    print(f"Tag {version} does not exist yet. Creating it.")

    # Create and push tag
    run_git_command(["tag", "-a", str(version), "-m", f"Release {version}"])
    print(f"Created annotated tag '{version}'")
    run_git_command(["push", "origin", str(version)])
    print(f"Successfully pushed tag {version} to origin.")

if __name__ == "__main__":
    main() 