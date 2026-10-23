#!/usr/bin/env bash
set -euo pipefail

# Reuse both binaries when available, avoiding an unnecessary package install.
if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  # The runner's Azure mirror can stall while fetching codec packages. Use
  # Ubuntu's standard mirrors for this invocation only, retaining signed apt
  # packages and leaving the runner's global repository configuration intact.
  # shellcheck source=/dev/null
  . /etc/os-release
  if [[ "$ID" != ubuntu || -z "${VERSION_CODENAME:-}" ]]; then
    echo 'Video-tool installation requires an Ubuntu runner' >&2
    exit 1
  fi
  apt_sources="$(mktemp --suffix=.sources)"
  trap 'rm -f "$apt_sources"' EXIT
  cat > "$apt_sources" <<EOF
Types: deb
URIs: http://archive.ubuntu.com/ubuntu
Suites: ${VERSION_CODENAME} ${VERSION_CODENAME}-updates
Components: main universe
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg

Types: deb
URIs: http://security.ubuntu.com/ubuntu
Suites: ${VERSION_CODENAME}-security
Components: main universe
Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg
EOF
  apt_options=(
    # FFmpeg only needs Ubuntu packages. Do not refresh the runner's unrelated
    # Microsoft, Docker, or other third-party repositories.
    -o "Dir::Etc::sourcelist=$apt_sources"
    -o Dir::Etc::sourceparts=-
    -o APT::Get::List-Cleanup=0
    -o Acquire::Retries=2
    -o Acquire::http::Timeout=15
    -o Acquire::https::Timeout=15
    -o DPkg::Lock::Timeout=30
  )
  # Bound each command as well as the workflow step. Disable debconf and
  # needrestart prompts, which can otherwise wait for input in an unattended job.
  run_apt() {
    local command_timeout="$1"
    shift
    sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a \
      timeout --signal=TERM --kill-after=10s "$command_timeout" apt-get "${apt_options[@]}" "$@"
  }
  echo 'Refreshing Ubuntu package indexes for video-processing tools'
  run_apt 120s update
  echo 'Installing ffmpeg and ffprobe'
  # A fresh runner can need hundreds of MB of codec dependencies. Allow more
  # time for installation than for refreshing the package indexes.
  run_apt 240s install --yes --no-install-recommends ffmpeg
fi

ffmpeg -version
ffprobe -version
