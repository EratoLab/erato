#!/bin/bash
set -e

# Parse command line arguments
GIT_SHA=""

for arg in "$@"; do
  case $arg in
    --git-sha=*)
      GIT_SHA="${arg#*=}"
      ;;
    *)
      echo "Unknown argument: $arg"
      echo "Usage: $0 --git-sha=<GIT_SHA>"
      echo "Example: $0 --git-sha=a1b2c3d"
      exit 1
      ;;
  esac
done

# Check if git-sha is provided
if [ -z "$GIT_SHA" ]; then
  echo "Error: --git-sha flag is required"
  echo "Usage: $0 --git-sha=<GIT_SHA>"
  echo "Example: $0 --git-sha=a1b2c3d"
  exit 1
fi

# Set up directories
SCRIPT_DIR="$(dirname "$0")"
PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
CHART_DIR="$(dirname "$SCRIPT_DIR")/charts/erato"
TMP_DIR="${PROJECT_ROOT}/tmp/helm"

# Extract the original version from Chart.yaml
ORIGINAL_VERSION=$(grep '^version:' "${CHART_DIR}/Chart.yaml" | awk '{print $2}')
CHART_VERSION="${ORIGINAL_VERSION}-${GIT_SHA}"
CHART_NAME="erato"
OCI_REGISTRY="harbor.imassage.me"
OCI_REPO="erato-helm-dev"

# Create tmp directory if it doesn't exist
mkdir -p "${TMP_DIR}"

echo "Updating Helm chart version to ${CHART_VERSION}..."

# Update the version in Chart.yaml
sed -i.bak "s/^version:.*/version: ${CHART_VERSION}/" "${CHART_DIR}/Chart.yaml"
rm "${CHART_DIR}/Chart.yaml.bak"

echo "Packaging Helm chart..."
helm package "${CHART_DIR}" --destination "${TMP_DIR}"

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

# Restore original version in Chart.yaml
sed -i.bak "s/^version:.*/version: ${ORIGINAL_VERSION}/" "${CHART_DIR}/Chart.yaml"
rm "${CHART_DIR}/Chart.yaml.bak"
