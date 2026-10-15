# Contributing

This document outlines the process for contributing to the project, including how to prepare and publish a new release.

## Development Process

[This section can be filled out later with details about the development workflow, such as branching strategy, code style, and testing requirements.]

## Release Process

The release process starts with a preparation branch that stays open throughout
the release cycle. Keep one summary per contributing PR, refresh the branch
regularly, and draft release notes from the reviewed summaries. Follow the
[release notes workflow](release-preparation/README.md) for resilient PR retrieval,
AI summarization, selective PR summary comments, and the final coverage review.
Finalize the temporary preparation files and squash-merge the branch shortly
before publishing from `main`, so scratch commits stay out of main history.

### 1. Preparing a Release

This step updates the application version and should be done in a pull request to allow for review.

1.  Early in the release cycle, create a preparation branch from `main` and open
    a draft PR. Initialize `release-preparation/<version>/release.json` and follow
    the release notes workflow. Refresh it weekly and before release.
2.  Shortly before release, copy the reviewed notes into the dated changelog
    section and run `sync-release-notes.py finalize` as described in the workflow.
    This retains only `release.json` for the release and commits the cleanup.
    Run the
    `prepare-release.py` script with the target version number on a clean worktree.
    The version should follow semantic versioning (e.g., `1.2.3` or `1.2.3-rc.1` for release candidates).

    ```bash
    ./scripts/prepare-release.py <version>
    ```

    For example:
    ```bash
    ./scripts/prepare-release.py 0.5.0
    ```

    This script will:
    -   Validate the version number format.
    -   Check if a Git tag for the specified version already exists.
    -   Update `backend/erato/Cargo.toml`, `backend/Cargo.lock`, and the Helm chart's
        version and appVersion.
    -   Commit the version changes automatically.

3.  Push the completed preparation branch and mark its draft PR ready for review.
4.  **Squash-merge** the reviewed preparation PR into `main` shortly before tagging.
    A normal merge or rebase merge would retain the temporary Markdown in history.

### 2. Publishing a Release

After the release preparation pull request has been merged into `main`, the release can be published. This step should only be performed on the `main` branch.

1.  Ensure your local `main` branch is up-to-date with the remote repository.

    ```bash
    git checkout main
    git pull origin main
    ```

2.  Run the `tag-release.py` script.

    ```bash
    ./scripts/tag-release.py
    ```

    This script will:
    -   Read the version from `backend/erato/Cargo.toml`.
    -   Verify that you are on the `main` branch and that it is up-to-date with `origin/main`.
    -   Check that your working directory is clean.
    -   Check that a tag for the current version doesn't already exist.
    -   Create a new Git tag for the version (e.g., `0.5.0`).
    -   Push the new tag to the remote repository (`origin`).

Once the tag is pushed, the CI/CD pipeline should automatically trigger to build and publish the release artifacts.
