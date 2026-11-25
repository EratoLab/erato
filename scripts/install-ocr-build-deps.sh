#!/usr/bin/env bash
# Installs the tesseract/leptonica build dependencies for the backend in CI.
# The Launchpad PPA answers 503 on and off, so the whole sequence is retried.
set -euo pipefail

ATTEMPTS="${RETRY_ATTEMPTS:-4}"
PAUSE="${RETRY_PAUSE_SECONDS:-20}"

# Runs "$@" up to ATTEMPTS times, pausing PAUSE * attempt seconds in between.
# Output is not captured, so the failing command's own error stays in the log.
retry() {
  local attempt=1 status=0
  while true; do
    status=0
    "$@" || status=$?
    if [ "$status" -eq 0 ]; then
      return 0
    fi
    if [ "$attempt" -ge "$ATTEMPTS" ]; then
      echo "Giving up after $attempt attempts (exit $status): $*" >&2
      return "$status"
    fi
    echo "Attempt $attempt/$ATTEMPTS failed (exit $status), retrying in $((PAUSE * attempt))s: $*" >&2
    sleep $((PAUSE * attempt))
    attempt=$((attempt + 1))
  done
}

install_ocr_build_deps() {
  # Called under "||" in retry, where set -e is off: every step returns itself.
  # The config file also covers the update add-apt-repository runs itself.
  echo 'Acquire::Retries "5";' | sudo tee /etc/apt/apt.conf.d/80-ci-retries > /dev/null || return
  sudo add-apt-repository -y ppa:alex-p/tesseract-ocr5 || return
  # Error-Mode=any makes a failed index download fail the update.
  sudo apt-get -o Acquire::Retries=5 -o APT::Update::Error-Mode=any update || return
  sudo apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
    libtesseract-dev libleptonica-dev libclang-dev
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  retry install_ocr_build_deps
fi
