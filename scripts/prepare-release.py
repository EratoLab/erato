#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# dependencies = [
#   "tomlkit",
#   "semver",
#   "pyyaml",
# ]
# ///

import sys
import tomlkit
import subprocess
from pathlib import Path
import semver

def main():
    if len(sys.argv) != 2:
        print("Usage: ./prepare-release.py <version>", file=sys.stderr)
        sys.exit(1)

    new_version = sys.argv[1]

    try:
        semver.Version.parse(new_version)
    except ValueError as e:
        print(f"Invalid version: {e}", file=sys.stderr)
        sys.exit(1)

    try:
        # Check if working tree is dirty
        result = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True, check=True)
        if result.stdout:
            print("Error: Working tree is dirty. Please commit or stash your changes.", file=sys.stderr)
            sys.exit(1)

        # Check if git tag exists
        result = subprocess.run(["git", "tag", "-l", new_version], capture_output=True, text=True, check=True)
        if result.stdout.strip() == new_version:
            print(f"Error: Git tag '{new_version}' already exists.", file=sys.stderr)
            sys.exit(1)
    except FileNotFoundError:
        print("Error: git command not found. Is git installed and in your PATH?", file=sys.stderr)
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print(f"Error during git checks: {e}", file=sys.stderr)
        sys.exit(1)

    # Update the main erato package in the workspace
    cargo_toml_path = Path(__file__).parent.parent / "backend" / "erato" / "Cargo.toml"
    chart_yaml_path = Path(__file__).parent.parent / "infrastructure" / "charts" / "erato" / "Chart.yaml"

    if not cargo_toml_path.exists():
        print(f"Error: {cargo_toml_path} not found.", file=sys.stderr)
        sys.exit(1)

    if not chart_yaml_path.exists():
        print(f"Error: {chart_yaml_path} not found.", file=sys.stderr)
        sys.exit(1)

    # Update Cargo.toml
    with open(cargo_toml_path, "r") as f:
        content = f.read()
        cargo_data = tomlkit.parse(content)

    package_table = cargo_data.get("package")
    if not package_table:
        print("Error: 'package' table not found in Cargo.toml", file=sys.stderr)
        sys.exit(1)

    current_version = package_table.get("version")
    print(f"Found current backend version: {current_version}")

    package_table["version"] = new_version

    with open(cargo_toml_path, "w") as f:
        f.write(tomlkit.dumps(cargo_data))

    print(f"Updated 'backend/erato/Cargo.toml' to version {new_version}")

    # Update Chart.yaml
    import yaml
    with open(chart_yaml_path, "r") as f:
        chart_data = yaml.safe_load(f)

    current_chart_version = chart_data.get("version")
    current_app_version = chart_data.get("appVersion")
    print(f"Found current chart version: {current_chart_version}, appVersion: {current_app_version}")

    chart_data["version"] = new_version
    chart_data["appVersion"] = new_version

    with open(chart_yaml_path, "w") as f:
        yaml.dump(chart_data, f, default_flow_style=False, sort_keys=False)

    print(f"Updated 'infrastructure/charts/erato/Chart.yaml' version and appVersion to {new_version}")

    # Update Cargo.lock in the workspace root
    backend_workspace_dir = Path(__file__).parent.parent / "backend"
    try:
        print("Updating Cargo.lock...")
        subprocess.run(
            ["cargo", "update", "erato"],
            cwd=backend_workspace_dir,
            check=True,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        print("Error: cargo command not found. Is rust/cargo installed and in your PATH?", file=sys.stderr)
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print("Error running 'cargo update erato'. Is 'erato' the correct package name in backend/erato/Cargo.toml?", file=sys.stderr)
        print(f"Stderr: {e.stderr}", file=sys.stderr)
        sys.exit(1)

    try:
        cargo_lock_path = backend_workspace_dir / "Cargo.lock"
        subprocess.run(["git", "add", str(cargo_toml_path), str(cargo_lock_path), str(chart_yaml_path)], check=True)
        subprocess.run(["git", "commit", "-m", f"Prepare release {new_version}"], check=True)
        print(f"Committed changes with message 'Prepare release {new_version}'")
    except FileNotFoundError:
        print("Error: git command not found. Is git installed and in your PATH?", file=sys.stderr)
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print(f"Error creating git commit: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main() 