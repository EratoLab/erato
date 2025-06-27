#!/bin/bash
set -e

# Read version from Cargo.toml
VERSION=$(grep '^version = ' backend/Cargo.toml | sed 's/version = "\(.*\)"/\1/')

if [ -z "$VERSION" ]; then
    echo "Could not find version in backend/Cargo.toml"
    exit 1
fi

echo "Version found: $VERSION"

# Check current branch is main
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "Error: Not on main branch. Current branch is $CURRENT_BRANCH."
    exit 1
fi

# Check if working directory is clean
if [ -n "$(git status --porcelain)" ]; then
    echo "Error: Working directory is not clean. Please commit or stash your changes."
    exit 1
fi

# Fetch from origin and check if up to date
git fetch origin
LOCAL_HEAD=$(git rev-parse HEAD)
REMOTE_HEAD=$(git rev-parse origin/main)

if [ "$LOCAL_HEAD" != "$REMOTE_HEAD" ]; then
    echo "Error: Local main branch is not up-to-date with origin/main."
    exit 1
fi

echo "Current branch is main and up-to-date."

# Check if tag already exists
if git rev-parse "$VERSION" >/dev/null 2>&1; then
    echo "Error: Tag $VERSION already exists."
    exit 1
fi

echo "Tag $VERSION does not exist yet. Creating it."

# Create and push tag
git tag -a "$VERSION" -m "Release $VERSION"
git push origin "$VERSION"

echo "Successfully tagged and pushed version $VERSION." 