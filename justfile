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