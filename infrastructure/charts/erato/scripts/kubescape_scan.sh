#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHART_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if ! command -v kubescape >/dev/null 2>&1; then
  echo "Error: kubescape is not installed"
  echo "Install: https://kubescape.io/docs/install"
  exit 1
fi

# Baseline thresholds established from 2026-02-20 scan results.
declare -A COMPLIANCE_THRESHOLDS=(
  [AllControls]=80
  [ArmoBest]=70
  [DevOpsBest]=80
  [MITRE]=100
  [NSA]=80
  [SOC2]=100
)

mapfile -t FRAMEWORKS < <(kubescape list frameworks --format json | tr -d '[]"' | tr ',' '\n' | sed 's/^ *//; s/ *$//' | sed '/^$/d' | grep -Ev '^cis-')

if [ "${#FRAMEWORKS[@]}" -eq 0 ]; then
  echo "Error: no frameworks returned by 'kubescape list frameworks'"
  exit 1
fi

cd "${CHART_DIR}"

TMP_DIR="$(mktemp -d)"
RENDERED_MANIFEST="${TMP_DIR}/rendered.yaml"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "Rendering Helm chart once for Kubescape scans..."
helm template erato . \
  --namespace erato \
  --set namespaceOverride=erato \
  --set postgresql.namespaceOverride=erato \
  > "${RENDERED_MANIFEST}"

for framework in "${FRAMEWORKS[@]}"; do
  threshold="${COMPLIANCE_THRESHOLDS[$framework]:-}"
  if [ -z "${threshold}" ]; then
    echo "Error: missing compliance threshold for framework '${framework}'"
    echo "Update scripts/kubescape_scan.sh to include a baseline threshold for this framework."
    exit 1
  fi

  echo "Running Kubescape for framework '${framework}' (compliance threshold: ${threshold})"
  kubescape scan framework "${framework}" "${RENDERED_MANIFEST}" --compliance-threshold "${threshold}"
done
