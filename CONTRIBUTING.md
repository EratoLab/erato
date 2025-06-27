# Contributing

This document outlines the process for contributing to the project, including how to prepare and publish a new release.

## Development Process

[This section can be filled out later with details about the development workflow, such as branching strategy, code style, and testing requirements.]

## Release Process

The release process is divided into two main parts: preparing a release and publishing it. This is to ensure that version numbers are consistent and that releases are made from the `main` branch in a controlled manner.

### 1. Preparing a Release

This step updates the application version and should be done in a pull request to allow for review.

1.  From the `main` branch, create a new branch for the release preparation (e.g., `release/prepare-0.5.0`).
2.  Run the `prepare-release.py` script with the target version number. The version should follow semantic versioning (e.g., `1.2.3` or `1.2.3-rc.1` for release candidates).

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
    -   Update the version in `backend/Cargo.toml`.

3.  Commit the changes to `backend/Cargo.toml`.
4.  Push the branch and create a pull request to `main`.

### 2. Publishing a Release

After the release preparation pull request has been merged into `main`, the release can be published. This step should only be performed on the `main` branch.

1.  Ensure your local `main` branch is up-to-date with the remote repository.

    ```bash
    git checkout main
    git pull origin main
    ```

2.  Run the `tag-release.sh` script.

    ```bash
    ./scripts/tag-release.sh
    ```

    This script will:
    -   Read the version from `backend/Cargo.toml`.
    -   Verify that you are on the `main` branch and that it is up-to-date with `origin/main`.
    -   Check that your working directory is clean.
    -   Check that a tag for the current version doesn't already exist.
    -   Create a new Git tag for the version (e.g., `0.5.0`).
    -   Push the new tag to the remote repository (`origin`).

Once the tag is pushed, the CI/CD pipeline should automatically trigger to build and publish the release artifacts. 