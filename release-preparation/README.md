# Preparing release notes

Keep a release preparation branch open for the whole release cycle, with a draft PR
into `main`. Refresh it weekly, after a substantial feature lands, and once more
immediately before release. Finalize and squash-merge it shortly before tagging
the release so temporary PR summaries never enter main's commit history.

## Start a release

Create a branch from `main` (for example `release-notes-0-7-0`). Under
`release-preparation/<version>/`, create `release.json`:

```json
{
  "repository": "EratoLab/erato",
  "base": "0.6.2"
}
```

The base is the previous released tag, not a date or PR number. It stays fixed
throughout preparation. The configuration for 0.7.0 is already present.

Install Python 3.9+ and the GitHub CLI, and authenticate with `gh auth login`.
From the repository root:

```sh
git fetch origin main --tags
python3 scripts/sync-release-notes.py sync --release 0.7.0 --head origin/main
```

The collector resolves both ends to commit hashes and saves the cutoff in
`manifest.json`. It discovers PRs from first-parent merge commits and squash
subjects ending in `(#123)`, rather than incidental issue references. It records
commits without these markers for manual reconciliation. Rebase merges and PRs
merged without markers require that review; the inventory is not claimed to be
complete until it is done.

Files in each release directory:

- `release.json`: fixed repository/base; optional `reconciled_commits` object mapping
  a full unmatched commit hash to an explanation of how its impact is covered;
  optional `pr_overrides` object mapping full commit hashes to PR numbers for
  verified PRs without recognizable merge markers.
- `manifest.json`: current PR inventory, cutoff, retrieval progress and failures.
- `prs/<number>.md`: one temporary, editable summary per contributing PR.
- `sources/<number>/`: cached PR title/body, paginated changed files/patches, and
  local commit messages/statistics. These are generated local files, ignored by Git.
- `notes.md`: the AI-assisted, human-reviewed release draft.

Every sync automatically creates a `[release-scratch]` commit containing the
release configuration, manifest, individual summaries and draft, including edits
made since the previous sync. Even an unchanged sync creates a checkpoint. These
commits live only on the preparation branch. Partial retrieval failures and
handled interruptions also checkpoint the work collected so far. A hard process
kill cannot create a commit; rerun sync to checkpoint the saved files.

Finalization removes all temporary files for that release, including the manifest,
draft, summaries and local source cache. Only `<version>/release.json` remains,
with the final cutoff and release date. The approved release prose lives in
`CHANGELOG.md`. Start a new directory for the next release.

## Refresh and resume

Fetch and merge the latest `origin/main` into the preparation branch, then repeat
`sync` with `--head origin/main`. This avoids including the preparation branch's
own commits in the release inventory. Resolve changelog conflicts by retaining
new upstream material and regenerating the release draft from the PR summaries.

Run sync on a named preparation branch with no pre-existing staged changes.
The automatic scratch commit includes only that release's directory; unrelated
working-tree edits stay outside it. Complete Git author setup before syncing.
Normal commit hooks run, so a failed hook must be resolved to create the checkpoint.
After editing AI summaries or the draft, rerun sync to checkpoint them.

Every successful GitHub request is cached separately, including individual pages
of the changed-file list. Writes use atomic replacement. A timeout retries with
bounded exponential backoff and jitter; exhausted requests are recorded and the
collector continues with the next PR. Authentication is checked once before the
batch. Rerunning skips saved requests and retains all authored Markdown. An
interruption leaves completed responses usable even if the last manifest update
was not written. A new checkout must retrieve its own source cache.

```sh
# Tune request timeout/retries when needed.
python3 scripts/sync-release-notes.py sync --release 0.7.0 --head origin/main --timeout 45 --attempts 5
# Work on a small batch; inventory and note stubs still cover the entire range.
python3 scripts/sync-release-notes.py sync --release 0.7.0 --head origin/main --pr 1265 --pr 1260
# Collect local commit evidence and reuse available responses without network access.
python3 scripts/sync-release-notes.py sync --release 0.7.0 --head origin/main --offline
```

An incomplete retrieval exits nonzero; completed work stays on disk. Offline mode
records missing GitHub evidence explicitly. File patches can be omitted by GitHub
for binary or large diffs, and its files endpoint caps results at 3,000 files; use
local diffs for those cases. Read the precise code at the recorded commit, not just
the current tree. For a merge or squash commit:

```sh
git diff <commit>^1 <commit> -- <relevant-path>
```

To refresh a cached PR body or file list, remove only that PR's generated
`sources/<number>/` directory and sync with `--pr <number>`. Summary files are
never overwritten. If the commit evidence for an existing PR changes, the
manifest records a review warning. Re-review its summary and remove that warning
from `manifest.json` only after reconciling it.

## Ask the AI to summarize PRs

Use this prompt in your coding assistant on the preparation branch:

> Follow `release-preparation/AGENTS.md`. Refresh the inventory for release 0.7.0
> against origin/main. Summarize pending PRs in small batches, reading their cached
> descriptions, relevant patches, and local code. Write each summary to its own
> `prs/<number>.md`. Preserve reviewed summaries. Identify related PRs using a
> shared Theme. Record breaking changes, configuration changes, defaults, feature
> flags and migrations precisely. Record uncertainties rather than guessing.
> Do not mark a summary reviewed while evidence or wording remains uncertain.

Review a manageable batch, resolve uncertainties, and change `- Status: pending`
to `- Status: reviewed` once accepted. Replace every `TODO:` field, including
ones whose answer is `None`. Use the existing changelog categories. A PR with no
notable user impact still gets a summary and an explanation of why it appears
only in the full list.

## Contribute selected summaries back to PRs

Some PR bodies contain only `Related Linear issue: <ISSUE-REF>`. For these,
the AI must inspect the code before and after the PR, not summarize the issue
reference or assume the title describes the change. Read the cached PR base/head
hashes and patches. When those objects exist locally, inspect the PR diff using
`git diff <base-sha>...<head-sha>` and read relevant files at both revisions.
Otherwise inspect the recorded integration commit against its first parent,
explicitly noting that the review uses the merged change. Follow related code,
configuration and documentation far enough to explain behavior and limitations.

Once a maintainer has reviewed the summary, preview a comment for explicitly
selected PRs:

```sh
python3 scripts/sync-release-notes.py comment --release 0.7.0 --pr 1265
# Restrict selection further to empty or single-line Linear-only descriptions.
python3 scripts/sync-release-notes.py comment --release 0.7.0 --pr 1265 --only-stubs
# After inspecting the preview, contribute that selection.
python3 scripts/sync-release-notes.py comment --release 0.7.0 --pr 1265 --publish
```

The comment includes the reviewed Summary, Compatibility and configuration, and
Evidence and review sections, plus the integration commit hashes. Ensure those
sections are self-contained for PR readers: use repository paths and commit hashes
rather than local source-cache paths. Release-specific grouping and disposition
stay in the preparation branch. The original PR description is preserved.

Posting requires both explicit `--pr` selection and `--publish`; preview is the
default. The command reads fresh, paginated comments and uses a hidden PR-specific
marker to find the authenticated account's earlier summary. It updates that
comment, skips an unchanged comment, and leaves other authors' comments alone.
If multiple matching comments exist it stops for reconciliation. Writes are not
automatically retried: after a timeout inspect the PR, then rerun to discover a
comment that may already have been created. `--only-stubs` uses the cached body;
refresh that PR's cache if its description has changed since collection.

Suggested AI prompt:

> Analyze the before and after code for the selected PRs whose descriptions are
> stubs. Complete their individual summaries and prepare comment previews. Cite
> code evidence and state uncertainties. After I review the summaries, contribute
> comments only to the PRs I explicitly select. Use the marked comment workflow
> so future revisions update the same comments.

## Draft and finalize

After the summaries have been reviewed:

> Follow `release-preparation/AGENTS.md`. Draft
> `release-preparation/0.7.0/notes.md` from the reviewed PR summaries, matching the
> granularity and structure of CHANGELOG.md releases 0.6.2 and 0.6.1. Group PRs
> that implement the same feature into one entry, link every supporting PR, and
> keep ordinary fixes to one sentence. Clearly identify breaking changes and
> required upgrade actions. Include a full PR list from the inventory. Report
> uncovered PRs and uncertainties. Reconcile existing Unreleased changelog entries
> against the summaries so their information is retained without duplicate prose.

Generate the deterministic full list for the draft:

```sh
python3 scripts/sync-release-notes.py full-list --release 0.7.0
python3 scripts/sync-release-notes.py status --release 0.7.0 --head origin/main
```

`status` exits nonzero for pending/missing notes, unfinished retrieval, unresolved
unmatched commits, notes outside the selected range, or a changed cutoff. It checks
workflow bookkeeping; a reviewer must still check factual accuracy, grouping and
PR link coverage in `notes.md`. For a PR without a merge marker, verify the
association, add a `pr_overrides` entry in `release.json`, and sync again. For
direct commits with no PR, record their disposition in `reconciled_commits` and
include any notable impact in the draft.

Immediately before release, fetch/merge `main`, sync again, summarize new PRs,
and update the draft. Review the final range, including any direct commits.
Copy the approved draft into `CHANGELOG.md` under `## [<version>] - YYYY-MM-DD`,
using the actual release date. Remove only the Unreleased entries covered by this
release and retain changes outside the cutoff. Use direct PR links or add missing
`repo-pr-N` reference definitions, following the changelog's existing style.

Contribute any selected PR summary comments before deleting the temporary notes.
Then run:

```sh
python3 scripts/sync-release-notes.py finalize --release 0.7.0 --head origin/main
```

Finalization requires the inventory and reviews to be complete, an unchanged
cutoff, a dated release section already present in `CHANGELOG.md`, and no
pre-existing staged changes. It first checkpoints the current Markdown, removes
everything in that release directory except `release.json`, then commits the
cleanup and changelog. Finalized releases cannot be synced again. Check the
approved prose before invoking this command; its bookkeeping checks do not
verify the wording copied into the changelog.

Run `./scripts/prepare-release.py <version>` on a clean worktree to update and
commit package/chart versions and the lockfile. **Squash-merge** the reviewed
preparation PR into `main`, combining all branch commits into the final tree.
Do not use a merge commit or rebase merge: either would retain the scratch commits
and temporary Markdown in main history. No history rewrite or force push is
performed by the preparation script. Follow the tagging steps in CONTRIBUTING.md
after merging. The date, version changes, merge and tag remain maintainer actions.
