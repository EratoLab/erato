default:
    just --list

install_hooks:
    ln -sf ../../.hooks/pre-push .git/hooks/pre-push

# Lint all Dockerfiles in the repository
lint-docker:
    #!/usr/bin/env sh
    if ! command -v hadolint >/dev/null 2>&1; then
        echo "Error: hadolint is not installed. Please install it first:"
        echo "  brew install hadolint    # macOS"
        echo "  or visit: https://github.com/hadolint/hadolint#install"
        exit 1
    fi
    find . -name "Dockerfile*" -type f -exec hadolint {} \;

# Validate, regenerate-check, type-check, and test the desktop sidecar protocol.
protocol-check:
    cd desktop-sidecar-protocol && pnpm run check

# Regenerate TypeScript contracts and compiled protocol artifacts.
protocol-generate:
    cd desktop-sidecar-protocol && pnpm run generate

# Run the desktop sidecar protocol conformance suite.
protocol-test:
    cd desktop-sidecar-protocol && pnpm run test
