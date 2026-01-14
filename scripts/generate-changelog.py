#!/usr/bin/env python3
"""
Script to extract PR information from git log for changelog generation.
"""

import subprocess
import re
import sys


def extract_title_from_commit(commit_msg):
    """Extract a readable title from a commit message"""
    # Try to get title from merge commit branch name
    merge_match = re.search(r'Merge pull request #(\d+) from EratoLab/(.+)$', commit_msg)
    if merge_match:
        branch = merge_match.group(2)
        # Clean up the branch name
        title = branch.replace('-', ' ').replace('_', ' ')
        # Remove common prefixes
        title = re.sub(r'^feat\s+', '', title)
        title = re.sub(r'^fix\s+', '', title)
        title = re.sub(r'^chore\s+', '', title)
        title = re.sub(r'^refactor\s+', '', title)
        title = re.sub(r'^test\s+', '', title)
        title = re.sub(r'^perf\s+', '', title)
        title = re.sub(r'^docs\s+', '', title)
        title = re.sub(r'^website\s+', '', title)
        title = re.sub(r'^cursor\s+', '', title)
        # Capitalize first letter
        title = title.strip().capitalize()
        return title

    # Try to extract from regular commit with PR reference
    # Remove PR number at the end
    title = re.sub(r'\s*\(#[0-9]+\)\s*$', '', commit_msg)
    # Remove common prefixes
    title = re.sub(r'^feat:\s*', '', title, flags=re.IGNORECASE)
    title = re.sub(r'^fix:\s*', '', title, flags=re.IGNORECASE)
    title = re.sub(r'^chore:\s*', '', title, flags=re.IGNORECASE)
    title = re.sub(r'^refactor:\s*', '', title, flags=re.IGNORECASE)
    title = re.sub(r'^test:\s*', '', title, flags=re.IGNORECASE)
    title = re.sub(r'^perf:\s*', '', title, flags=re.IGNORECASE)
    title = title.strip()
    return title if title else commit_msg


def get_prs_for_range(tag_range):
    """Get all PRs with titles for a git tag range"""
    result = subprocess.run(
        ['git', 'log', tag_range, '--pretty=format:%s'],
        capture_output=True,
        text=True
    )
    commits = result.stdout.strip().split('\n')

    pr_data = {}  # pr_number -> title
    seen_prs = set()

    for commit in commits:
        matches = re.findall(r'#(\d+)', commit)
        for pr in matches:
            if pr not in seen_prs:
                title = extract_title_from_commit(commit)
                pr_data[pr] = title
                seen_prs.add(pr)

    # Sort by PR number
    sorted_prs = sorted(pr_data.items(), key=lambda x: int(x[0]))
    return sorted_prs


def main():
    if len(sys.argv) < 2:
        print("Usage: generate-changelog.py <tag_range> [version]")
        print("Example: generate-changelog.py 0.4.0..0.5.0 0.5.0")
        sys.exit(1)

    tag_range = sys.argv[1]
    version = sys.argv[2] if len(sys.argv) > 2 else tag_range.split('..')[1]

    prs = get_prs_for_range(tag_range)

    print(f"## [{version}]")
    print(f"\n### Full list of changes\n")
    for pr, title in prs:
        print(f"- {title} [#{pr}][repo-pr-{pr}]")
    print(f"\nTotal: {len(prs)} PRs")


if __name__ == '__main__':
    main()
