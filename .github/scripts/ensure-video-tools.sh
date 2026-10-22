#!/usr/bin/env bash
set -euo pipefail

# Hosted runners normally have both binaries. Avoid an unnecessary package-index
# refresh, including unrelated third-party repositories, when they are present.
if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  apt_options=(
    -o Acquire::Retries=2
    -o Acquire::http::Timeout=15
    -o Acquire::https::Timeout=15
    -o DPkg::Lock::Timeout=30
  )
  # Bound each command as well as the workflow step. Disable debconf and
  # needrestart prompts, which can otherwise wait for input in an unattended job.
  run_apt() {
    sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a \
      timeout --signal=TERM --kill-after=10s 120s apt-get "${apt_options[@]}" "$@"
  }
  run_apt update
  run_apt install --yes --no-install-recommends ffmpeg
fi

ffmpeg -version
ffprobe -version
