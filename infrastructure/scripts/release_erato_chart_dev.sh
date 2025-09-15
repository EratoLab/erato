#!/bin/bash
set -e

# Parse command line arguments
GIT_SHA=""
RELEASE_MODE=false

for arg in "$@"; do
  case $arg in
    --git-sha=*)
      GIT_SHA="${arg#*=}"
      ;;
    --release)
      RELEASE_MODE=true
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 [--git-sha=<GIT_SHA>] [--release]"
      echo "Examples:"
      echo "  $0 --git-sha=a1b2c3d                   # Dev build with git sha suffix"
      echo "  $0 --release                           # Release build with chart version as-is"
      exit 1
      ;;
  esac
done

# Check argument validation
if [ "$RELEASE_MODE" = true ] && [ -n "$GIT_SHA" ]; then
  echo "Error: --release and --git-sha flags are mutually exclusive"
  exit 1
fi

if [ "$RELEASE_MODE" = false ] && [ -z "$GIT_SHA" ]; then
  echo "Error: Either --git-sha or --release flag is required"
  echo "Usage: $0 [--git-sha=<GIT_SHA>] [--release]"
  echo "Examples:"
  echo "  $0 --git-sha=a1b2c3d                   # Dev build with git sha suffix"
  echo "  $0 --release                           # Release build with chart version as-is"
  exit 1
fi

# Set up directories
SCRIPT_DIR="$(dirname "$0")"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
CHART_DIR="$(dirname "$SCRIPT_DIR")/charts/erato"
TMP_DIR="${PROJECT_ROOT}/tmp/helm"

# Extract the original version from Chart.yaml
ORIGINAL_VERSION=$(grep '^version:' "${CHART_DIR}/Chart.yaml" | awk '{print $2}')
CHART_NAME="erato"
OCI_REGISTRY="harbor.imassage.me"

# Set chart version and OCI repository based on mode
if [ "$RELEASE_MODE" = true ]; then
  CHART_VERSION="${ORIGINAL_VERSION}"
  OCI_REPO="erato-helm"
  echo "Publishing release chart version ${CHART_VERSION}..."
else
  CHART_VERSION="${ORIGINAL_VERSION}-${GIT_SHA}"
  OCI_REPO="erato-helm-dev"
  echo "Publishing dev chart version ${CHART_VERSION}..."
  
  # Update the version in Chart.yaml for dev builds only
  sed -i.bak "s/^version:.*/version: ${CHART_VERSION}/" "${CHART_DIR}/Chart.yaml"
  rm "${CHART_DIR}/Chart.yaml.bak"
fi

# Create tmp directory if it doesn't exist
mkdir -p "${TMP_DIR}"

echo "Packaging Helm chart..."
helm package "${CHART_DIR}" --dependency-update --destination "${TMP_DIR}"

# Get the packaged chart filename
CHART_PACKAGE=$(find "${TMP_DIR}" -name "${CHART_NAME}-${CHART_VERSION}.tgz" -type f)

if [ -z "${CHART_PACKAGE}" ]; then
  echo "Error: Could not find packaged chart"
  exit 1
fi

echo "Pushing Helm chart to OCI registry ${OCI_REGISTRY}/${OCI_REPO}..."
helm push "${CHART_PACKAGE}" "oci://${OCI_REGISTRY}/${OCI_REPO}"

echo "Successfully published ${CHART_NAME} chart version ${CHART_VERSION} to oci://${OCI_REGISTRY}/${OCI_REPO}"

# Clean up
rm "${CHART_PACKAGE}"

# Restore original version in Chart.yaml (only for dev builds)
if [ "$RELEASE_MODE" = false ]; then
  sed -i.bak "s/^version:.*/version: ${ORIGINAL_VERSION}/" "${CHART_DIR}/Chart.yaml"
  rm "${CHART_DIR}/Chart.yaml.bak"
fi
