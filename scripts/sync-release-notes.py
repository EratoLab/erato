#!/usr/bin/env python3
"""Collect resumable release evidence; leave editorial summaries to the reviewer/AI."""

import argparse
import json
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run(*args):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True, check=True).stdout


def write(path, content):
    """Replace only after a complete write, including when interrupted."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as f:
        temporary = Path(f.name)
        f.write(content)
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def save(path, data):
    write(path, json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def inventory(base, head, overrides=None):
    """First-parent history avoids counting references inside PR branch commits."""
    base_sha = run("git", "rev-parse", "--verify", base + "^{commit}").strip()
    head_sha = run("git", "rev-parse", "--verify", head + "^{commit}").strip()
    run("git", "merge-base", "--is-ancestor", base_sha, head_sha)
    prs, unmatched = {}, []
    log = run("git", "log", "--first-parent", "--reverse", "--format=%H%x00%s", f"{base_sha}..{head_sha}")
    for line in log.splitlines():
        sha, subject = line.split("\0", 1)
        match = re.match(r"Merge pull request #(\d+)\b", subject) or re.search(r"\(#(\d+)\)$", subject)
        number = str((overrides or {}).get(sha, match.group(1) if match else ""))
        if not number:
            unmatched.append({"commit": sha, "subject": subject})
            continue
        if not number.isdigit() or int(number) <= 0:
            raise ValueError(f"Invalid PR override for {sha}: {number}")
        entry = prs.setdefault(number, {"subject": subject, "commits": []})
        entry["commits"].append(sha)
    return base_sha, head_sha, prs, unmatched


def fetch(endpoint, path, args):
    if path is not None and path.exists():
        return read(path)
    if args.offline:
        raise RuntimeError(f"Missing cached response: {endpoint}")
    for attempt in range(args.attempts):
        try:
            result = subprocess.run(
                ["gh", "api", "--hostname", "github.com", endpoint], cwd=ROOT,
                capture_output=True, text=True, timeout=args.timeout,
            )
            if result.returncode == 0:
                data = json.loads(result.stdout)
                if path is not None:
                    save(path, data)
                return data
            error = result.stderr.strip()
            # Authentication, permissions and missing resources need intervention.
            if re.search(r"HTTP (401|404|422)|gh auth login|authentication", error, re.I):
                raise RuntimeError(error)
            if "HTTP 403" in error and not re.search(r"rate limit|secondary", error, re.I):
                raise RuntimeError(error)
        except subprocess.TimeoutExpired:
            error = f"Request timed out after {args.timeout}s: {endpoint}"
        except json.JSONDecodeError:
            error = f"Invalid JSON response: {endpoint}"
        if attempt + 1 < args.attempts:
            delay = min(30, 2 ** attempt) + random.random()
            print(f"Retry {attempt + 1}/{args.attempts}: {error}; waiting {delay:.1f}s", file=sys.stderr)
            time.sleep(delay)
    raise RuntimeError(error)


def collect(number, entry, directory, config, args):
    cache = directory / "sources" / number
    local = []
    for sha in entry["commits"]:
        local.append(run("git", "show", "--format=fuller", "--stat", "--first-parent", sha))
    write(cache / "local.txt", "\n".join(local))
    endpoint = f"repos/{config['repository']}/pulls/{number}"
    metadata = fetch(endpoint, cache / "pr.json", args)
    if not metadata.get("merged_at"):
        raise RuntimeError(f"#{number} is not a merged PR; review the commit marker")
    files = []
    page = 1
    while True:
        batch = fetch(f"{endpoint}/files?per_page=100&page={page}", cache / f"files-{page}.json", args)
        files.extend(batch)
        if len(batch) < 100:
            break
        page += 1
    if len(files) != metadata.get("changed_files"):
        raise RuntimeError(f"#{number}: incomplete file list ({len(files)}/{metadata.get('changed_files')}); inspect locally (GitHub caps this API at 3000 files)")
    return metadata


def seed(number, entry, directory, repository):
    path = directory / "prs" / f"{number}.md"
    if path.exists():
        return
    commits = "\n".join(f"- `{sha}`" for sha in entry["commits"])
    write(path, f"""# PR #{number}: {entry['subject']}

- PR: https://github.com/{repository}/pull/{number}
- Status: pending
- Category: pending
- Theme: pending

## Summary

TODO: Describe the user or operator impact in one or two sentences.

## Compatibility and configuration

TODO: Record breaking changes, migrations, exact configuration keys and defaults, or 'None'.

## Evidence and review

TODO: Cite source files/commits; record verification and any uncertainty. If GitHub is unavailable,
review the local diff and explain that limitation. Do not infer behavior from a branch name.

## Release note disposition

TODO: Proposed wording, or why this belongs only in the full PR list.

## Local commits

{commits}

Source material: `../sources/{number}/` (local commit evidence, PR metadata and paginated file patches).
""")


def report(directory, manifest, config):
    problems = []
    for number in manifest["prs"]:
        path = directory / "prs" / f"{number}.md"
        if not path.exists():
            problems.append(f"#{number}: missing note")
            continue
        note = path.read_text(encoding="utf-8")
        if not re.search(r"^- Status: reviewed$", note, re.M) or "TODO:" in note:
            problems.append(f"#{number}: summary needs review")
        if number in manifest["errors"]:
            problems.append(f"#{number}: evidence incomplete: {manifest['errors'][number]}")
        if manifest.get("collected", {}).get(number) != manifest["prs"][number]["commits"]:
            problems.append(f"#{number}: source retrieval unfinished")
        elif not (directory / "sources" / number / "pr.json").exists():
            problems.append(f"#{number}: local source cache missing; run sync")
    expected = {f"{n}.md" for n in manifest["prs"]}
    for path in sorted((directory / "prs").glob("*.md")):
        if path.name not in expected:
            problems.append(f"{path.name}: outside current range; reconcile manually")
    for commit in manifest["unmatched_commits"]:
        if not config.get("reconciled_commits", {}).get(commit["commit"]):
            problems.append(f"Unmatched commit {commit['commit'][:12]}: {commit['subject']}")
    print(f"{len(manifest['prs'])} PRs; {len(problems)} items to review; cutoff {manifest['head_sha']}")
    for problem in problems:
        print(problem)
    return bool(problems)


def positive(value):
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be positive")
    return number


def check_preparation_branch():
    branch = run("git", "branch", "--show-current").strip()
    if not branch or branch in ("main", "master"):
        raise ValueError("Use a release preparation branch; sync/finalize cannot commit on main or detached HEAD")
    if run("git", "diff", "--cached", "--name-only").strip():
        raise ValueError("Commit or unstage existing staged changes before sync/finalize")


def commit_paths(paths, message, allow_empty=False):
    relative = [str(path.relative_to(ROOT)) for path in paths]
    run("git", "add", "--all", "--", *relative)
    command = ["git", "commit", "--only", "-m", message]
    if allow_empty:
        command.append("--allow-empty")
    run(*command, "--", *relative)
    print(f"Created {run('git', 'rev-parse', '--short', 'HEAD').strip()}: {message}")


def checkpoint(directory, release):
    commit_paths([directory, ROOT / "CHANGELOG.md"],
                 f"[release-scratch] Sync release notes {release}", allow_empty=True)


def finalize(directory, manifest, config, args):
    check_preparation_branch()
    base_sha, head_sha, prs, _ = inventory(config["base"], args.head, config.get("pr_overrides"))
    if (base_sha, head_sha, prs) != (manifest["base_sha"], manifest["head_sha"], manifest["prs"]):
        raise ValueError("Release cutoff changed; sync and review again before finalizing")
    if report(directory, manifest, config):
        raise ValueError("Resolve release review items before finalizing")
    changelog = ROOT / "CHANGELOG.md"
    text = changelog.read_text(encoding="utf-8")
    match = re.search(rf"^## \[{re.escape(args.release)}\] - (\d{{4}}-\d{{2}}-\d{{2}})\s*$", text, re.M)
    if not match:
        raise ValueError("Copy the approved notes into a dated CHANGELOG.md release section before finalizing")
    # Save the final editorial work before deleting temporary files.
    checkpoint(directory, args.release)
    config["finalized"] = {"base_sha": base_sha, "head_sha": head_sha, "date": match.group(1)}
    save(directory / "release.json", config)
    for path in directory.iterdir():
        if path.name == "release.json":
            continue
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink()
    commit_paths([directory, changelog], f"Finalize release notes {args.release}")
    print("Only release.json remains for this release. Squash-merge the preparation PR so scratch commits stay out of main history.")
    return 0


def comment_body(number, directory, manifest):
    note = (directory / "prs" / f"{number}.md").read_text(encoding="utf-8")
    if not re.search(r"^- Status: reviewed$", note, re.M) or "TODO:" in note:
        raise ValueError(f"#{number}: review and complete the summary before contributing it")
    sections = []
    for heading in ("Summary", "Compatibility and configuration", "Evidence and review"):
        match = re.search(rf"^## {re.escape(heading)}\n(.*?)(?=^## |\Z)", note, re.M | re.S)
        if not match or not match.group(1).strip():
            raise ValueError(f"#{number}: missing {heading}")
        sections.append(f"### {heading}\n\n{match.group(1).strip()}")
    commits = ", ".join(f"`{sha}`" for sha in manifest["prs"][number]["commits"])
    return (f"<!-- erato-release-summary:pr-{number} -->\n"
            "## PR change summary\n\n" + "\n\n".join(sections)
            + f"\n\nPrepared from code review for release notes. Local integration commits: {commits}.\n")


def contribute(directory, manifest, config, args):
    """Preview by default; publish only selected, reviewed notes."""
    if not args.pr:
        raise ValueError("comment requires one or more explicit --pr selections")
    login = None
    for selected in args.pr:
        number = str(selected)
        if number not in manifest["prs"]:
            raise ValueError(f"#{number}: not in this release inventory")
        if args.only_stubs:
            metadata = read(directory / "sources" / number / "pr.json")
            body = (metadata.get("body") or "").strip()
            if body and not re.fullmatch(r"Related Linear issue:\s*\S+", body, re.I):
                print(f"#{number}: skipped (description is not empty or a Linear-only stub)")
                continue
        body = comment_body(number, directory, manifest)
        if not args.publish:
            print(f"--- Preview for https://github.com/{config['repository']}/pull/{number} ---\n{body}")
            continue
        if login is None:
            login = fetch("user", None, args)["login"]
        endpoint = f"repos/{config['repository']}/issues/{number}/comments"
        comments, page = [], 1
        while True:
            batch = fetch(f"{endpoint}?per_page=100&page={page}", None, args)
            comments.extend(batch)
            if len(batch) < 100:
                break
            page += 1
        marker = f"<!-- erato-release-summary:pr-{number} -->"
        existing = [c for c in comments if marker in c.get("body", "") and c["user"]["login"] == login]
        if len(existing) > 1:
            raise ValueError(f"#{number}: multiple summary comments by {login}; reconcile manually")
        if existing and existing[0]["body"].strip() == body.strip():
            print(f"#{number}: existing comment unchanged")
            continue
        method = "PATCH" if existing else "POST"
        target = f"repos/{config['repository']}/issues/comments/{existing[0]['id']}" if existing else endpoint
        # Never retry a write blindly: an ambiguous timeout might already have posted it.
        try:
            result = subprocess.run(
                ["gh", "api", "--hostname", "github.com", target, "--method", method, "--input", "-"],
                cwd=ROOT, input=json.dumps({"body": body}), capture_output=True,
                text=True, timeout=args.timeout,
            )
        except subprocess.TimeoutExpired as error:
            raise RuntimeError(f"#{number}: comment write timed out and may have succeeded; inspect the PR before rerunning") from error
        if result.returncode:
            raise ValueError(f"#{number}: comment write failed; inspect the PR before rerunning: {result.stderr.strip()}")
        print(f"#{number}: {json.loads(result.stdout)['html_url']}")
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["sync", "status", "full-list", "comment", "finalize"])
    parser.add_argument("--release", required=True)
    parser.add_argument("--head", default="HEAD", help="explicit release cutoff, normally origin/main")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--timeout", type=positive, default=30)
    parser.add_argument("--attempts", type=positive, default=4)
    parser.add_argument("--pr", type=positive, action="append", help="fetch only selected PRs; inventory remains complete")
    parser.add_argument("--publish", action="store_true", help="post/update selected PR comments (otherwise preview)")
    parser.add_argument("--only-stubs", action="store_true", help="comment only on empty or Linear-only descriptions")
    args = parser.parse_args()
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", args.release):
        parser.error("release must be a version, e.g. 0.7.0")
    directory = ROOT / "release-preparation" / args.release
    config = read(directory / "release.json")
    if config.get("finalized"):
        raise ValueError("This release is finalized; its temporary notes have been removed")
    manifest_path = directory / "manifest.json"
    if args.publish and (args.command != "comment" or args.offline):
        parser.error("--publish requires comment and network access")
    if args.command != "sync":
        manifest = read(manifest_path)
        if args.command == "finalize":
            return finalize(directory, manifest, config, args)
        if args.command == "comment":
            return contribute(directory, manifest, config, args)
        if args.command == "status":
            base_sha, head_sha, prs, _ = inventory(config["base"], args.head, config.get("pr_overrides"))
            stale = (head_sha != manifest["head_sha"] or base_sha != manifest["base_sha"]
                     or prs != manifest["prs"])
            if stale:
                print("Cutoff changed; run sync again before reviewing the release.")
            return int(report(directory, manifest, config) or stale)
        print("### Full list of changes\n")
        for number in sorted(manifest["prs"], key=int):
            metadata_path = directory / "sources" / number / "pr.json"
            title = (read(metadata_path)["title"] if metadata_path.exists()
                     else manifest.get("titles", {}).get(number, manifest["prs"][number]["subject"]))
            print(f"- {title} [#{number}](https://github.com/{config['repository']}/pull/{number})")
        return 0
    check_preparation_branch()
    base_sha, head_sha, prs, unmatched = inventory(config["base"], args.head, config.get("pr_overrides"))
    previous = read(manifest_path) if manifest_path.exists() else {}
    if args.pr and not set(map(str, args.pr)).issubset(prs):
        parser.error("--pr must identify a PR in the selected release range")
    manifest = {"base_sha": base_sha, "head_sha": head_sha, "prs": prs,
                "unmatched_commits": unmatched, "errors": {},
                "collected": previous.get("collected", {}),
                "titles": previous.get("titles", {})}
    for number, entry in prs.items():
        seed(number, entry, directory, config["repository"])
        if previous.get("prs", {}).get(number, entry) != entry:
            manifest["errors"][number] = "Commit evidence changed; re-review the preserved summary"
        elif number in previous.get("errors", {}):
            manifest["errors"][number] = previous["errors"][number]
    save(manifest_path, manifest)
    failed = False
    try:
        if not args.offline:
            # Fail once for an unavailable account, rather than repeating for every PR.
            subprocess.run(["gh", "auth", "status", "--hostname", "github.com"],
                           cwd=ROOT, check=True, timeout=args.timeout)
        for number, entry in prs.items():
            if args.pr and int(number) not in args.pr:
                continue
            try:
                metadata = collect(number, entry, directory, config, args)
                manifest["titles"][number] = metadata["title"]
                manifest["collected"][number] = entry["commits"]
                if not manifest["errors"].get(number, "").startswith("Commit evidence changed"):
                    manifest["errors"].pop(number, None)
                print(f"#{number}: evidence complete", flush=True)
            except RuntimeError as error:
                manifest["errors"][number] = str(error)
                failed = True
                print(f"#{number}: {error}", file=sys.stderr, flush=True)
            save(manifest_path, manifest)
    finally:
        save(manifest_path, manifest)
        checkpoint(directory, args.release)
    print(f"Saved inventory and notes for {len(prs)} PRs in {directory.relative_to(ROOT)}")
    return int(failed)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("Interrupted; collected responses are saved. Inspect any in-flight comment write before rerunning.", file=sys.stderr)
        sys.exit(130)
